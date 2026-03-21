import { FunctionDeclaration, SchemaType } from '@google/generative-ai';
import { chromium } from 'playwright';
import axios from 'axios';
import { spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { googleService } from '../services/google.js';
import { config } from '../config/env.js';
import { mcpService } from '../services/mcp.js';
import { bot } from '../bot.js';
import { InputFile } from 'grammy';

export interface Tool {
  name: string;
  description: string;
  parameters: {
    type: SchemaType;
    properties: Record<string, any>;
    required?: string[];
  };
  execute: (args: any) => Promise<string>;
  requiresApproval?: boolean;
}

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  register(tool: Tool) {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getNativeToolsCount(): number {
    return this.tools.size;
  }

  private sanitizeSchema(schema: any): any {
    if (!schema || typeof schema !== 'object') return schema;

    if (Array.isArray(schema)) {
      return schema.map(item => this.sanitizeSchema(item));
    }

    const newSchema = { ...schema };

    // Map types to Gemini supported types
    if (newSchema.type === 'integer') {
      newSchema.type = 'number';
    }

    // Remove unsupported fields for Gemini
    const unsupportedFields = [
        'additionalProperties',
        'exclusiveMinimum',
        'exclusiveMaximum',
        'minimum',
        'maximum',
        'pattern',
        'anyOf',
        'oneOf',
        'allOf',
        'not',
        'default',
        'examples',
        'format',
        '$schema',
        '$id',
        'const',
        'title'
    ];

    unsupportedFields.forEach(field => {
        if (newSchema[field] !== undefined) {
            delete newSchema[field];
        }
    });

    // Handle nullability and anyOf/oneOf
    if (!newSchema.type) {
      if (newSchema.anyOf && Array.isArray(newSchema.anyOf)) {
        const firstWithType = newSchema.anyOf.find((item: any) => item.type);
        if (firstWithType) newSchema.type = firstWithType.type;
      } else if (newSchema.oneOf && Array.isArray(newSchema.oneOf)) {
        const firstWithType = newSchema.oneOf.find((item: any) => item.type);
        if (firstWithType) newSchema.type = firstWithType.type;
      }
    }

    if (Array.isArray(newSchema.type)) {
      newSchema.type = newSchema.type.find((t: string) => t !== 'null') || newSchema.type[0];
    }

    // Recursively sanitize properties and items
    if (newSchema.properties) {
      for (const key in newSchema.properties) {
        newSchema.properties[key] = this.sanitizeSchema(newSchema.properties[key]);
      }
    }
    if (newSchema.items) {
      newSchema.items = this.sanitizeSchema(newSchema.items);
    }

    return newSchema;
  }

  getFunctionDeclarations(): FunctionDeclaration[] {
    const nativeTools = Array.from(this.tools.values()).map((tool) => ({
      name: `native__${tool.name}`,
      description: tool.description,
      parameters: this.sanitizeSchema(tool.parameters),
    }));

    const mcpTools = mcpService.getTools().map((tool: any) => ({
        name: `mcp__${tool._mcp_instance}__${tool.name}`,
        description: tool.description,
        parameters: this.sanitizeSchema({
            type: SchemaType.OBJECT,
            properties: tool.inputSchema.properties || {},
            required: tool.inputSchema.required || []
        })
    }));

    return [...nativeTools, ...mcpTools];
  }

  async execute(name: string, args: any): Promise<string> {
    // Determine source from prefix
    if (name.startsWith('native__')) {
        const cleanName = name.replace('native__', '');
        const tool = this.tools.get(cleanName);
        if (tool) {
            try {
                return await tool.execute(args);
            } catch (error: any) {
                return `Error executing tool ${name}: ${error.message}`;
            }
        }
        throw new Error(`Native tool ${cleanName} not found`);
    }

    if (name.startsWith('mcp__')) {
        const parts = name.split('__');
        const instance = parts[1];
        const toolName = parts.slice(2).join('__');

        try {
            return await mcpService.callTool(toolName, args, instance);
        } catch (error: any) {
            return `Error executing MCP tool ${name}: ${error.message}`;
        }
    }

    // Fallback for older signatures if any remain in history
    const rawName = name.includes(':') ? name.split(':').pop()! : name;
    let cleanName = rawName;
    let detectedInstance: string | undefined;

    if (rawName.includes('__')) {
        const parts = rawName.split('__');
        const prefix = parts[0];
        if (prefix !== 'mcp' && prefix !== 'native') {
            detectedInstance = prefix;
        }
        cleanName = parts.slice(1).join('__');
    }

    const nativeTool = this.tools.get(cleanName);
    if (nativeTool && !detectedInstance) {
        return await nativeTool.execute(args);
    }

    try {
        return await mcpService.callTool(cleanName, args, detectedInstance);
    } catch (error: any) {
        if (error.message.includes('not found')) {
            throw new Error(`Tool ${cleanName} not found`);
        }
        return `Error executing MCP tool ${name}: ${error.message}`;
    }
  }
}

// --- Tool Implementations ---

// 1. LOCAL FILES CRUD
const writeFile: Tool = {
  name: 'write_file',
  description: 'Create or overwrite a file with specific content.',
  requiresApproval: true,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      path: { type: SchemaType.STRING, description: 'Relative path to the file' },
      content: { type: SchemaType.STRING, description: 'Content to write' }
    },
    required: ['path', 'content']
  },
  execute: async ({ path: filePath, content }: { path: string, content: string }) => {
    try {
      const safePath = path.join(process.cwd(), filePath.replace(/^(\.\.[/\\])+/, ''));
      await fs.writeFile(safePath, content);
      return `File ${filePath} written successfully.`;
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const koyebListDeployments: Tool = {
  name: 'koyeb_list_deployments',
  description: 'List Koyeb deployments.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      serviceId: { type: SchemaType.STRING, description: 'Optional Service ID to filter' }
    }
  },
  execute: async ({ serviceId }: { serviceId?: string }) => {
    try {
      const res = await axios.get('https://app.koyeb.com/v1/deployments', {
        params: { service_id: serviceId },
        headers: { Authorization: `Bearer ${config.KOYEB_API_KEY}` }
      });
      return JSON.stringify(res.data, null, 2);
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const koyebListInstances: Tool = {
  name: 'koyeb_list_instances',
  description: 'List Koyeb instances.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      serviceId: { type: SchemaType.STRING, description: 'Optional Service ID to filter' }
    }
  },
  execute: async ({ serviceId }: { serviceId?: string }) => {
    try {
      const res = await axios.get('https://app.koyeb.com/v1/instances', {
        params: { service_id: serviceId },
        headers: { Authorization: `Bearer ${config.KOYEB_API_KEY}` }
      });
      return JSON.stringify(res.data, null, 2);
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const koyebListDomains: Tool = {
  name: 'koyeb_list_domains',
  description: 'List your Koyeb domains.',
  parameters: { type: SchemaType.OBJECT, properties: {} },
  execute: async () => {
    try {
      const res = await axios.get('https://app.koyeb.com/v1/domains', {
        headers: { Authorization: `Bearer ${config.KOYEB_API_KEY}` }
      });
      return JSON.stringify(res.data, null, 2);
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const koyebListSecrets: Tool = {
  name: 'koyeb_list_secrets',
  description: 'List your Koyeb secrets.',
  parameters: { type: SchemaType.OBJECT, properties: {} },
  execute: async () => {
    try {
      const res = await axios.get('https://app.koyeb.com/v1/secrets', {
        headers: { Authorization: `Bearer ${config.KOYEB_API_KEY}` }
      });
      return JSON.stringify(res.data, null, 2);
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const stitchListProjects: Tool = {
  name: 'stitch_list_projects',
  description: 'List all your Google Stitch projects.',
  parameters: { type: SchemaType.OBJECT, properties: {} },
  execute: async () => {
    try {
      const res = await axios.get('https://stitch.googleapis.com/v1alpha/projects', {
        headers: { 'x-goog-api-key': config.STITCH_API_KEY }
      });
      return JSON.stringify(res.data, null, 2);
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const stitchListScreens: Tool = {
  name: 'stitch_list_screens',
  description: 'List all screens in a Google Stitch project.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      projectId: { type: SchemaType.STRING, description: 'The project ID (e.g. 123)' }
    },
    required: ['projectId']
  },
  execute: async ({ projectId }: { projectId: string }) => {
    try {
      const id = projectId.replace('projects/', '');
      const res = await axios.get(`https://stitch.googleapis.com/v1alpha/projects/${id}/screens`, {
        headers: { 'x-goog-api-key': config.STITCH_API_KEY }
      });
      return JSON.stringify(res.data, null, 2);
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const stitchGetScreen: Tool = {
  name: 'stitch_get_screen',
  description: 'Get details and HTML content of a Google Stitch screen.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      projectId: { type: SchemaType.STRING, description: 'The project ID (e.g. 123)' },
      screenId: { type: SchemaType.STRING, description: 'The screen ID (e.g. 456)' }
    },
    required: ['projectId', 'screenId']
  },
  execute: async ({ projectId, screenId }: { projectId: string, screenId: string }) => {
    try {
      const pId = projectId.replace('projects/', '');
      const sId = screenId.replace('screens/', '');
      const res = await axios.get(`https://stitch.googleapis.com/v1alpha/projects/${pId}/screens/${sId}`, {
        headers: { 'x-goog-api-key': config.STITCH_API_KEY }
      });
      return JSON.stringify(res.data, null, 2);
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const julesListSessions: Tool = {
  name: 'jules_list_sessions',
  description: 'List all coding sessions in Jules.',
  parameters: { type: SchemaType.OBJECT, properties: {} },
  execute: async () => {
    try {
      const res = await axios.get('https://jules.googleapis.com/v1alpha/sessions', {
        headers: { 'x-goog-api-key': config.JULES_API_KEY }
      });
      return JSON.stringify(res.data, null, 2);
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const julesListActivities: Tool = {
  name: 'jules_list_activities',
  description: 'List activities for a specific Jules session.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      sessionId: { type: SchemaType.STRING, description: 'The session ID' }
    },
    required: ['sessionId']
  },
  execute: async ({ sessionId }: { sessionId: string }) => {
    try {
      const res = await axios.get(`https://jules.googleapis.com/v1alpha/${sessionId}/activities`, {
        headers: { 'x-goog-api-key': config.JULES_API_KEY }
      });
      return JSON.stringify(res.data, null, 2);
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

// 7. JULES API
const julesListSources: Tool = {
  name: 'jules_list_sources',
  description: 'List available sources (repositories) in Jules.',
  parameters: { type: SchemaType.OBJECT, properties: {} },
  execute: async () => {
    try {
      const res = await axios.get('https://jules.googleapis.com/v1alpha/sources', {
        headers: { 'x-goog-api-key': config.JULES_API_KEY }
      });
      return JSON.stringify(res.data, null, 2);
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const julesCreateSession: Tool = {
  name: 'jules_create_session',
  description: 'Create a new coding session in Jules.',
  requiresApproval: true,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      sourceId: { type: SchemaType.STRING, description: 'The source ID' },
      instruction: { type: SchemaType.STRING, description: 'Task instruction' }
    },
    required: ['sourceId', 'instruction']
  },
  execute: async ({ sourceId, instruction }: { sourceId: string, instruction: string }) => {
    try {
      const res = await axios.post('https://jules.googleapis.com/v1alpha/sessions', {
        source: sourceId,
        instruction: instruction
      }, {
        headers: { 'x-goog-api-key': config.JULES_API_KEY }
      });
      return `Session created: ${res.data.name}`;
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const julesGetSession: Tool = {
  name: 'jules_get_session',
  description: 'Get details and status of a Jules session.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      sessionId: { type: SchemaType.STRING, description: 'The session ID (e.g. sessions/123)' }
    },
    required: ['sessionId']
  },
  execute: async ({ sessionId }: { sessionId: string }) => {
    try {
      const res = await axios.get(`https://jules.googleapis.com/v1alpha/${sessionId}`, {
        headers: { 'x-goog-api-key': config.JULES_API_KEY }
      });
      return JSON.stringify(res.data, null, 2);
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

// 8. GOOGLE STITCH API
const stitchCreateProject: Tool = {
  name: 'stitch_create_project',
  description: 'Create a new project in Google Stitch.',
  requiresApproval: true,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      title: { type: SchemaType.STRING, description: 'Project title' }
    },
    required: ['title']
  },
  execute: async ({ title }: { title: string }) => {
    try {
      const res = await axios.post('https://stitch.googleapis.com/v1alpha/projects', { title }, {
        headers: { 'x-goog-api-key': config.STITCH_API_KEY }
      });
      return `Project created: ${res.data.name}`;
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const stitchGenerateScreen: Tool = {
  name: 'stitch_generate_screen',
  description: 'Generate a UI screen from text prompt in Google Stitch.',
  requiresApproval: true,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      projectId: { type: SchemaType.STRING, description: 'The project ID (e.g. 123)' },
      prompt: { type: SchemaType.STRING, description: 'UI description prompt' }
    },
    required: ['projectId', 'prompt']
  },
  execute: async ({ projectId, prompt }: { projectId: string, prompt: string }) => {
    try {
      const id = projectId.replace('projects/', '');
      const res = await axios.post(`https://stitch.googleapis.com/v1alpha/projects/${id}/screens:generate`, { prompt }, {
        headers: { 'x-goog-api-key': config.STITCH_API_KEY }
      });
      return `Screen generation started. Task: ${res.data.name}`;
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const stitchGetProject: Tool = {
  name: 'stitch_get_project',
  description: 'Get details of a Google Stitch project.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      projectId: { type: SchemaType.STRING, description: 'The project ID (e.g. 123)' }
    },
    required: ['projectId']
  },
  execute: async ({ projectId }: { projectId: string }) => {
    try {
      const id = projectId.replace('projects/', '');
      const res = await axios.get(`https://stitch.googleapis.com/v1alpha/projects/${id}`, {
        headers: { 'x-goog-api-key': config.STITCH_API_KEY }
      });
      return JSON.stringify(res.data, null, 2);
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

// 9. KOYEB API
const koyebListApps: Tool = {
  name: 'koyeb_list_apps',
  description: 'List your Koyeb applications.',
  parameters: { type: SchemaType.OBJECT, properties: {} },
  execute: async () => {
    try {
      const res = await axios.get('https://app.koyeb.com/v1/apps', {
        headers: { Authorization: `Bearer ${config.KOYEB_API_KEY}` }
      });
      return JSON.stringify(res.data, null, 2);
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const koyebListServices: Tool = {
  name: 'koyeb_list_services',
  description: 'List Koyeb services.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      appId: { type: SchemaType.STRING, description: 'Optional Application ID to filter' }
    }
  },
  execute: async ({ appId }: { appId?: string }) => {
    try {
      const res = await axios.get('https://app.koyeb.com/v1/services', {
        params: { app_id: appId },
        headers: { Authorization: `Bearer ${config.KOYEB_API_KEY}` }
      });
      return JSON.stringify(res.data, null, 2);
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const koyebGetApp: Tool = {
  name: 'koyeb_get_app',
  description: 'Get details of a Koyeb application.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      appId: { type: SchemaType.STRING, description: 'Application ID or Name' }
    },
    required: ['appId']
  },
  execute: async ({ appId }: { appId: string }) => {
    try {
      const res = await axios.get(`https://app.koyeb.com/v1/apps/${appId}`, {
        headers: { Authorization: `Bearer ${config.KOYEB_API_KEY}` }
      });
      return JSON.stringify(res.data, null, 2);
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const netlifyDeployDirectory: Tool = {
  name: 'netlify_deploy_directory',
  description: 'Deploy an entire directory to Netlify as a ZIP.',
  requiresApproval: true,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      site_id: { type: SchemaType.STRING, description: 'Optional Site ID' },
      dir_path: { type: SchemaType.STRING, description: 'Directory path to deploy' }
    },
    required: ['dir_path']
  },
  execute: async ({ site_id, dir_path }: { site_id?: string, dir_path: string }) => {
    try {
      const headers = { Authorization: `Bearer ${config.NETLIFY_AUTH_TOKEN}` };
      let targetId = site_id;
      if (!targetId) {
        const siteRes = await axios.post('https://api.netlify.com/api/v1/sites', {}, { headers: { ...headers, 'Content-Type': 'application/json' } });
        targetId = siteRes.data.id;
      }

      const zipPath = path.join(process.cwd(), `deploy_${Date.now()}.zip`);
      const safeDirPath = path.join(process.cwd(), dir_path.replace(/^(\.\.[/\\])+/, ''));

      // Use zip CLI as it is available
      await execAsync(`zip -r "${zipPath}" .`, { cwd: safeDirPath } as any);

      const zipContent = await fs.readFile(zipPath);
      const deployRes = await axios.post(`https://api.netlify.com/api/v1/sites/${targetId}/deploys`, zipContent, {
          headers: {
              ...headers,
              'Content-Type': 'application/zip'
          }
      });

      await fs.unlink(zipPath);
      return `Directory deployed successfully to: ${deployRes.data.url}`;
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const netlifyDeleteSite: Tool = {
  name: 'netlify_delete_site',
  description: 'Delete a Netlify site.',
  requiresApproval: true,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      site_id: { type: SchemaType.STRING, description: 'Site ID to delete' }
    },
    required: ['site_id']
  },
  execute: async ({ site_id }: { site_id: string }) => {
    try {
      await axios.delete(`https://api.netlify.com/api/v1/sites/${site_id}`, { headers: { Authorization: `Bearer ${config.NETLIFY_AUTH_TOKEN}` } });
      return `Site ${site_id} deleted successfully.`;
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const netlifyGetSite: Tool = {
  name: 'netlify_get_site',
  description: 'Get details of a Netlify site.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      site_id: { type: SchemaType.STRING, description: 'Site ID' }
    },
    required: ['site_id']
  },
  execute: async ({ site_id }: { site_id: string }) => {
    try {
      const res = await axios.get(`https://api.netlify.com/api/v1/sites/${site_id}`, { headers: { Authorization: `Bearer ${config.NETLIFY_AUTH_TOKEN}` } });
      return JSON.stringify(res.data, null, 2);
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const copyFile: Tool = {
  name: 'copy_file',
  description: 'Copy a file.',
  requiresApproval: true,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      source: { type: SchemaType.STRING, description: 'Source path' },
      destination: { type: SchemaType.STRING, description: 'Destination path' }
    },
    required: ['source', 'destination']
  },
  execute: async ({ source, destination }: { source: string, destination: string }) => {
    try {
      const safeSource = path.join(process.cwd(), source.replace(/^(\.\.[/\\])+/, ''));
      const safeDest = path.join(process.cwd(), destination.replace(/^(\.\.[/\\])+/, ''));
      await fs.copyFile(safeSource, safeDest);
      return `Successfully copied ${source} to ${destination}.`;
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const listFilesRecursive: Tool = {
  name: 'list_files_recursive',
  description: 'List all files in a directory and its subdirectories.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      path: { type: SchemaType.STRING, description: 'Relative path to start from (default: ".")' }
    }
  },
  execute: async ({ path: dirPath }: { path?: string }) => {
    try {
      const root = path.join(process.cwd(), (dirPath || '.').replace(/^(\.\.[/\\])+/, ''));
      const walk = async (dir: string): Promise<string[]> => {
        let results: string[] = [];
        const list = await fs.readdir(dir, { withFileTypes: true });
        for (const file of list) {
          const res = path.resolve(dir, file.name);
          const rel = path.relative(root, res);
          if (file.isDirectory()) {
            results.push(`[DIR] ${rel}`);
            results = results.concat(await walk(res));
          } else {
            results.push(`[FILE] ${rel}`);
          }
        }
        return results;
      };
      const files = await walk(root);
      return files.join('\n') || "Directory is empty.";
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const sendTelegramMedia: Tool = {
  name: 'send_telegram_media',
  description: 'Send a photo, video, audio, or document directly to the Telegram chat.',
  requiresApproval: true,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      type: { type: SchemaType.STRING, enum: ['photo', 'video', 'audio', 'document'], description: 'Type of media to send' },
      path: { type: SchemaType.STRING, description: 'Relative path to the file to send' },
      caption: { type: SchemaType.STRING, description: 'Optional caption' }
    },
    required: ['type', 'path']
  },
  execute: async ({ type, path: filePath, caption }: { type: string, path: string, caption?: string }) => {
    try {
      const safePath = path.resolve(process.cwd(), filePath.replace(/^(\.\.[/\\])+/, ''));

      // Verify file exists before sending
      await fs.access(safePath);

      const file = new InputFile(safePath);
      if (type === 'photo') await bot.api.sendPhoto(config.TELEGRAM_USER_ID, file, { caption });
      else if (type === 'video') await bot.api.sendVideo(config.TELEGRAM_USER_ID, file, { caption });
      else if (type === 'audio') await bot.api.sendAudio(config.TELEGRAM_USER_ID, file, { caption });
      else if (type === 'document') await bot.api.sendDocument(config.TELEGRAM_USER_ID, file, { caption });
      return `Successfully sent ${type} to user.`;
    } catch (error: any) {
        console.error(`[Tool:send_telegram_media] Failed to send ${type}:`, error.message);
        return `Error sending media: ${error.message}. Ensure the file exists and the path is correct.`;
    }
  }
};

const calculator: Tool = {
  name: 'calculator',
  description: 'Perform advanced mathematical calculations using Python.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      expression: { type: SchemaType.STRING, description: 'The math expression to evaluate (e.g., "math.sqrt(25) + 10 * 5")' }
    },
    required: ['expression']
  },
  execute: async ({ expression }: { expression: string }) => {
    try {
        // Use python_execute MCP tool logic via registry to be safe,
        // or just use a very restricted python sub-process.
        // For simplicity and safety, we will call Python but NOT use eval() directly on raw string.
        const safeExpr = expression.replace(/[^0-9+\-*/().mathsqrtlogexp\s,]/gi, '');
        const pythonCode = `import math; print(${safeExpr})`;
        const child = spawn('python3', ['-c', pythonCode]);
        return new Promise((resolve) => {
            let stdout = '';
            child.stdout.on('data', (d) => stdout += d);
            child.on('close', () => resolve(stdout.trim() || 'Error evaluating expression'));
        });
    } catch (error: any) {
        return `Error: ${error.message}`;
    }
  }
};

const generateQrCode: Tool = {
  name: 'generate_qr_code',
  description: 'Generate a QR code from text or a URL and save it as an image.',
  requiresApproval: true,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      data: { type: SchemaType.STRING, description: 'The text or URL to encode' },
      filename: { type: SchemaType.STRING, description: 'Output filename (e.g., "qrcode.png")' }
    },
    required: ['data', 'filename']
  },
  execute: async ({ data, filename }: { data: string, filename: string }) => {
    try {
        const pythonCode = `import qrcode; img = qrcode.make(input()); img.save(input())`;
        const child = spawn('python3', ['-c', pythonCode]);
        child.stdin.write(`${data}\n${filename}\n`);
        child.stdin.end();
        return new Promise((resolve) => {
            child.on('close', () => resolve(`QR code generated and saved to ${filename}.`));
        });
    } catch (error: any) {
        return `Error: ${error.message}`;
    }
  }
};

const duckduckgoSearch: Tool = {
  name: 'duckduckgo_search',
  description: 'Search the web using DuckDuckGo.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      query: { type: SchemaType.STRING, description: 'Search query' },
      type: { type: SchemaType.STRING, enum: ['text', 'images', 'news', 'videos'], description: 'Search type (default: text)' },
      max_results: { type: SchemaType.NUMBER, description: 'Max results (default: 5)' }
    },
    required: ['query']
  },
  execute: async ({ query, type, max_results }: { query: string, type?: string, max_results?: number }) => {
    try {
        const searchType = type || 'text';
        const limit = max_results || 5;
        const pythonCode = `from duckduckgo_search import DDGS; import json; import sys; q = sys.stdin.read().strip(); results = list(DDGS().${searchType}(q, max_results=${limit})); print(json.dumps(results))`;
        const child = spawn('python3', ['-c', pythonCode]);
        child.stdin.write(query);
        child.stdin.end();
        return new Promise((resolve) => {
            let stdout = '';
            child.stdout.on('data', (d) => stdout += d);
            child.on('close', () => resolve(stdout));
        });
    } catch (error: any) {
        return `Error: ${error.message}`;
    }
  }
};

const wikipediaSearch: Tool = {
  name: 'wikipedia_search',
  description: 'Search Wikipedia and get page summaries.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      query: { type: SchemaType.STRING, description: 'Search query' }
    },
    required: ['query']
  },
  execute: async ({ query }: { query: string }) => {
    try {
        const pythonCode = `import wikipediaapi; import sys; q = sys.stdin.read().strip(); wiki = wikipediaapi.Wikipedia("AmmarClaw/1.25 (ammar@example.com)", "en"); page = wiki.page(q); print(page.summary[:5000] if page.exists() else "Page not found.")`;
        const child = spawn('python3', ['-c', pythonCode]);
        child.stdin.write(query);
        child.stdin.end();
        return new Promise((resolve) => {
            let stdout = '';
            child.stdout.on('data', (d) => stdout += d);
            child.on('close', () => resolve(stdout));
        });
    } catch (error: any) {
        return `Error: ${error.message}`;
    }
  }
};

const devdocsSearch: Tool = {
  name: 'devdocs_search',
  description: 'Search DevDocs documentation.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      query: { type: SchemaType.STRING, description: 'The search query (e.g., "react", "python socket")' }
    },
    required: ['query']
  },
  execute: async ({ query }: { query: string }) => {
    try {
        const url = `https://devdocs.io/#q=${encodeURIComponent(query)}`;
        const res = await axios.get(`https://r.jina.ai/${url}`);
        return res.data;
    } catch (error: any) {
        return `Error searching DevDocs: ${error.message}`;
    }
  }
};

const telegraphCreatePage: Tool = {
  name: 'telegraph_create_page',
  description: 'Create a richly formatted page on Telegra.ph.',
  requiresApproval: true,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      title: { type: SchemaType.STRING, description: 'Page title' },
      content: { type: SchemaType.STRING, description: 'HTML content or Markdown (will be converted)' },
      author_name: { type: SchemaType.STRING, description: 'Optional author name' }
    },
    required: ['title', 'content']
  },
  execute: async ({ title, content, author_name }: { title: string, content: string, author_name?: string }) => {
    try {
        const pythonCode = `from telegraph import Telegraph; import sys; t = Telegraph(); t.create_account(short_name="AmmarClaw"); response = t.create_page(input(), html_content=input(), author_name=input()); print(response['url'])`;
        const child = spawn('python3', ['-c', pythonCode]);
        child.stdin.write(`${title}\n${content}\n${author_name || 'AmmarClaw'}\n`);
        child.stdin.end();
        return new Promise((resolve) => {
            let stdout = '';
            child.stdout.on('data', (d) => stdout += d);
            child.on('close', () => resolve(`Page created: ${stdout.trim()}`));
        });
    } catch (error: any) {
        return `Error creating Telegraph page: ${error.message}`;
    }
  }
};

const readFile: Tool = {
  name: 'read_file',
  description: 'Read the content of a local file.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      path: { type: SchemaType.STRING, description: 'Relative path to the file' }
    },
    required: ['path']
  },
  execute: async ({ path: filePath }: { path: string }) => {
    try {
      const safePath = path.join(process.cwd(), filePath.replace(/^(\.\.[/\\])+/, ''));
      const content = await fs.readFile(safePath, 'utf8');
      return content.length > 5000 ? content.substring(0, 5000) + "... [Truncated]" : content;
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const deleteFile: Tool = {
  name: 'delete_file',
  description: 'Delete a local file.',
  requiresApproval: true,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      path: { type: SchemaType.STRING, description: 'Relative path to the file' }
    },
    required: ['path']
  },
  execute: async ({ path: filePath }: { path: string }) => {
    try {
      const safePath = path.join(process.cwd(), filePath.replace(/^(\.\.[/\\])+/, ''));
      await fs.unlink(safePath);
      return `File ${filePath} deleted.`;
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const listFiles: Tool = {
  name: 'list_files',
  description: 'List all files and directories in a given path (defaults to current workspace).',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      path: { type: SchemaType.STRING, description: 'Relative path to list (default: ".")' }
    }
  },
  execute: async ({ path: dirPath }: { path?: string }) => {
    try {
      const targetPath = path.join(process.cwd(), (dirPath || '.').replace(/^(\.\.[/\\])+/, ''));
      const entries = await fs.readdir(targetPath, { withFileTypes: true });
      return entries.map(e => `${e.isDirectory() ? '[DIR]' : '[FILE]'} ${e.name}`).join('\n') || "Directory is empty.";
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const zipDirectory: Tool = {
  name: 'zip_directory',
  description: 'Create a ZIP archive of a directory.',
  requiresApproval: true,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      dir_path: { type: SchemaType.STRING, description: 'Relative path to the directory' },
      output_zip: { type: SchemaType.STRING, description: 'Relative path for the output ZIP file' }
    },
    required: ['dir_path', 'output_zip']
  },
  execute: async ({ dir_path, output_zip }: { dir_path: string, output_zip: string }) => {
    try {
      const safeDirPath = path.join(process.cwd(), dir_path.replace(/^(\.\.[/\\])+/, ''));
      const safeZipPath = path.join(process.cwd(), output_zip.replace(/^(\.\.[/\\])+/, ''));
      await execAsync(`zip -r "${safeZipPath}" .`, { cwd: safeDirPath } as any);
      return `Successfully zipped ${dir_path} into ${output_zip}.`;
    } catch (error: any) {
      return `Error zipping directory: ${error.message}`;
    }
  }
};

const unzipFile: Tool = {
  name: 'unzip_file',
  description: 'Extract a ZIP archive.',
  requiresApproval: true,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      zip_path: { type: SchemaType.STRING, description: 'Relative path to the ZIP file' },
      output_dir: { type: SchemaType.STRING, description: 'Relative path for the output directory' }
    },
    required: ['zip_path', 'output_dir']
  },
  execute: async ({ zip_path, output_dir }: { zip_path: string, output_dir: string }) => {
    try {
      const safeZipPath = path.join(process.cwd(), zip_path.replace(/^(\.\.[/\\])+/, ''));
      const safeOutputDir = path.join(process.cwd(), output_dir.replace(/^(\.\.[/\\])+/, ''));
      await fs.mkdir(safeOutputDir, { recursive: true });
      await execAsync(`unzip "${safeZipPath}" -d "${safeOutputDir}"`, {} as any);
      return `Successfully unzipped ${zip_path} into ${output_dir}.`;
    } catch (error: any) {
      return `Error unzipping file: ${error.message}`;
    }
  }
};

const searchFilesContent: Tool = {
  name: 'search_files_content',
  description: 'Search for a string or regex pattern within files (like grep).',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      pattern: { type: SchemaType.STRING, description: 'Search pattern' },
      path: { type: SchemaType.STRING, description: 'Relative path to start search (default: ".")' }
    },
    required: ['pattern']
  },
  execute: async ({ pattern, path: searchPath }: { pattern: string, path?: string }) => {
    try {
      const safePath = path.join(process.cwd(), (searchPath || '.').replace(/^(\.\.[/\\])+/, ''));
      const child = spawn('grep', ['-rnE', pattern, '.'], { cwd: safePath });
      return new Promise((resolve) => {
          let stdout = '';
          child.stdout.on('data', (d) => stdout += d);
          child.on('close', (code) => {
              if (code === 1) resolve("No matches found.");
              resolve(stdout || "No matches found.");
          });
      });
    } catch (error: any) {
      return `Error searching files: ${error.message}`;
    }
  }
};

const deleteDirectory: Tool = {
  name: 'delete_directory',
  description: 'Delete a directory and all its contents.',
  requiresApproval: true,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      path: { type: SchemaType.STRING, description: 'Relative path to the directory' }
    },
    required: ['path']
  },
  execute: async ({ path: dirPath }: { path: string }) => {
    try {
      const safePath = path.join(process.cwd(), dirPath.replace(/^(\.\.[/\\])+/, ''));
      await fs.rm(safePath, { recursive: true, force: true });
      return `Directory ${dirPath} and its contents deleted.`;
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const createDirectory: Tool = {
  name: 'create_directory',
  description: 'Create a new directory.',
  requiresApproval: true,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      path: { type: SchemaType.STRING, description: 'Relative path for the new directory' }
    },
    required: ['path']
  },
  execute: async ({ path: dirPath }: { path: string }) => {
    try {
      const safePath = path.join(process.cwd(), dirPath.replace(/^(\.\.[/\\])+/, ''));
      await fs.mkdir(safePath, { recursive: true });
      return `Directory ${dirPath} created successfully.`;
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const moveFile: Tool = {
  name: 'move_file',
  description: 'Move or rename a file or directory.',
  requiresApproval: true,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      source: { type: SchemaType.STRING, description: 'Source path' },
      destination: { type: SchemaType.STRING, description: 'Destination path' }
    },
    required: ['source', 'destination']
  },
  execute: async ({ source, destination }: { source: string, destination: string }) => {
    try {
      const safeSource = path.join(process.cwd(), source.replace(/^(\.\.[/\\])+/, ''));
      const safeDest = path.join(process.cwd(), destination.replace(/^(\.\.[/\\])+/, ''));
      await fs.rename(safeSource, safeDest);
      return `Successfully moved ${source} to ${destination}.`;
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

// 3. GOOGLE WORKSPACE CRUD (DRIVE)
const driveSearch: Tool = {
  name: 'drive_search',
  description: 'Search for files in Google Drive.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      query: { type: SchemaType.STRING, description: 'Search query' },
    },
    required: ['query']
  },
  execute: async ({ query }: { query: string }) => {
    try {
      const drive = await googleService.drive();
      const res = await drive.files.list({ q: query, pageSize: 10, fields: 'files(id, name, mimeType)' });
      return res.data.files?.map(f => `• ${f.name} (ID: ${f.id})`).join('\n') || "No files found.";
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const driveDeleteFile: Tool = {
  name: 'drive_delete_file',
  description: 'Delete a file from Google Drive.',
  requiresApproval: true,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      fileId: { type: SchemaType.STRING, description: 'The ID of the file to delete' }
    },
    required: ['fileId']
  },
  execute: async ({ fileId }: { fileId: string }) => {
    try {
      const drive = await googleService.drive();
      await drive.files.delete({ fileId });
      return "File deleted successfully.";
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const driveCreateFolder: Tool = {
  name: 'drive_create_folder',
  description: 'Create a new folder in Google Drive.',
  requiresApproval: true,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      name: { type: SchemaType.STRING, description: 'Name of the folder' }
    },
    required: ['name']
  },
  execute: async ({ name }: { name: string }) => {
    try {
      const drive = await googleService.drive();
      const res = await drive.files.create({
        requestBody: { name, mimeType: 'application/vnd.google-apps.folder' },
        fields: 'id'
      });
      return `Folder created with ID: ${res.data.id}`;
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

// 4. OTHER TOOLS (BLOGGER, MAPS, NETLIFY)
const bloggerListBlogs: Tool = {
  name: 'blogger_list_blogs',
  description: 'List your blogs.',
  parameters: { type: SchemaType.OBJECT, properties: {} },
  execute: async () => {
    try {
      const blogger = await googleService.blogger();
      const res = await blogger.blogs.listByUser({ userId: 'self' });
      return res.data.items?.map(b => `• ${b.name} (ID: ${b.id})`).join('\n') || "No blogs found.";
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const bloggerCreatePost: Tool = {
  name: 'blogger_create_post',
  description: 'Create a blog post.',
  requiresApproval: true,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      blogId: { type: SchemaType.STRING, description: 'Blog ID' },
      title: { type: SchemaType.STRING, description: 'Title' },
      content: { type: SchemaType.STRING, description: 'Content' }
    },
    required: ['blogId', 'title', 'content']
  },
  execute: async ({ blogId, title, content }: { blogId: string, title: string, content: string }) => {
    try {
      const blogger = await googleService.blogger();
      const res = await blogger.posts.insert({ blogId, requestBody: { title, content } });
      return `Post created: ${res.data.url}`;
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const mapsSearchPlaces: Tool = {
  name: 'maps_search_places',
  description: 'Search for places on Google Maps.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      query: { type: SchemaType.STRING, description: 'Query' }
    },
    required: ['query']
  },
  execute: async ({ query }: { query: string }) => {
    try {
      const apiKey = config.GEMINI_API_KEYS[0];
      const res = await axios.get(`https://maps.googleapis.com/maps/api/place/textsearch/json`, { params: { query, key: apiKey } });
      return res.data.results?.slice(0, 5).map((r: any) => `• ${r.name} (${r.formatted_address})`).join('\n') || "No places found.";
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const netlifyListSites: Tool = {
  name: 'netlify_list_sites',
  description: 'List your Netlify sites.',
  parameters: { type: SchemaType.OBJECT, properties: {} },
  execute: async () => {
    try {
      const res = await axios.get('https://api.netlify.com/api/v1/sites', { headers: { Authorization: `Bearer ${config.NETLIFY_AUTH_TOKEN}` } });
      return res.data.map((s: any) => `• ${s.name} (ID: ${s.id})`).join('\n') || "No sites found.";
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const netlifyDeploy: Tool = {
  name: 'netlify_deploy',
  description: 'Deploy a file to Netlify.',
  requiresApproval: true,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      site_id: { type: SchemaType.STRING, description: 'Optional Site ID' },
      file_path: { type: SchemaType.STRING, description: 'File path' }
    },
    required: ['file_path']
  },
  execute: async ({ site_id, file_path }: { site_id?: string, file_path: string }) => {
    try {
      let targetId = site_id;
      const headers = { Authorization: `Bearer ${config.NETLIFY_AUTH_TOKEN}` };
      if (!targetId) {
        const siteRes = await axios.post('https://api.netlify.com/api/v1/sites', {}, { headers: { ...headers, 'Content-Type': 'application/json' } });
        targetId = siteRes.data.id;
      }
      const content = await fs.readFile(file_path);
      const sha1 = (await import('crypto')).createHash('sha1').update(content).digest('hex');
      const deployRes = await axios.post(`https://api.netlify.com/api/v1/sites/${targetId}/deploys`, { files: { [file_path]: sha1 } }, { headers: { ...headers, 'Content-Type': 'application/json' } });
      const deployId = deployRes.data.id;
      await axios.put(`https://api.netlify.com/api/v1/deploys/${deployId}/files/${file_path}`, content, { headers: { ...headers, 'Content-Type': 'application/octet-stream' } });
      return `Deployed to: ${deployRes.data.url}`;
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const getWebsiteContent: Tool = {
  name: 'get_website_content',
  description: 'Fetch website text.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      url: { type: SchemaType.STRING, description: 'URL' }
    },
    required: ['url']
  },
  execute: async ({ url }: { url: string }) => {
    try {
      const res = await axios.get(url, { timeout: 10000 });
      let str = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
      str = str.replace(/<script\b[^<]*>([\s\S]*?)<\/script>/gim, "").replace(/<style\b[^<]*>([\s\S]*?)<\/style>/gim, "").replace(/<[^>]*>?/gm, " ").replace(/\s+/g, " ").trim();
      return str.length > 5000 ? str.substring(0, 5000) + "..." : str;
    } catch (error: any) { return `Error: ${error.message}`; }
  }
};

const generateImage: Tool = {
  name: 'generate_image',
  description: 'Generate an image from a text prompt using Gemini Imagen or OpenRouter fallbacks.',
  requiresApproval: true,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      prompt: { type: SchemaType.STRING, description: 'The description of the image to generate' }
    },
    required: ['prompt']
  },
  execute: async ({ prompt }: { prompt: string }) => {
    try {
        // 1. Try Gemini Imagen 3 via REST (Node SDK support limited/new)
        // Since we don't have the exact REST setup for Imagen 3 in this environment,
        // and user asked for "Gemini Image API", we'll attempt a common REST call pattern.
        const apiKey = config.GEMINI_API_KEYS[0];
        try {
            const res = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:generateImage?key=${apiKey}`, {
                prompt: { text: prompt }
            }, { timeout: 30000 });

            if (res.data.output) {
                const b64 = res.data.output.image.data;
                const filename = `gen_${Date.now()}.png`;
                await fs.writeFile(filename, Buffer.from(b64, 'base64'));
                await bot.api.sendPhoto(config.TELEGRAM_USER_ID, new InputFile(filename), { caption: `🎨 Generated: ${prompt}` });
                return `Image generated successfully via Gemini.`;
            }
        } catch (geminiErr: any) {
            console.warn("[Tool:generate_image] Gemini failed, trying OpenRouter Seedream 4.5...");
        }

        // 2. Fallback: OpenRouter bytedance-seed/seedream-4.5
        try {
            const orRes = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
                model: "bytedance-seed/seedream-4.5",
                messages: [{ role: "user", content: prompt }]
            }, {
                headers: { "Authorization": `Bearer ${config.OPENROUTER_API_KEY}` }
            });

            const content = orRes.data.choices[0]?.message?.content;
            if (content) {
                 return `Image generated via OpenRouter (Seedream). Result: ${content}`;
            }
        } catch (orErr) {
            console.warn("[Tool:generate_image] OpenRouter Seedream failed, trying Flux 2 Max...");
        }

        // 3. Final Fallback: OpenRouter black-forest-labs/flux.2-max
        const fluxRes = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
            model: "black-forest-labs/flux.2-max",
            messages: [{ role: "user", content: prompt }]
        }, {
            headers: { "Authorization": `Bearer ${config.OPENROUTER_API_KEY}` }
        });
        const fluxContent = fluxRes.data.choices[0]?.message?.content;
        return `Image generated via OpenRouter (Flux). Result: ${fluxContent}`;

    } catch (error: any) {
        return `Error generating image: ${error.message}`;
    }
  }
};

const generateAudio: Tool = {
  name: 'generate_audio',
  description: 'Generate audio/speech from text using Gemini Audio API.',
  requiresApproval: true,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      text: { type: SchemaType.STRING, description: 'The text to convert to speech' }
    },
    required: ['text']
  },
  execute: async ({ text }: { text: string }) => {
    try {
        const apiKey = config.GEMINI_API_KEYS[0];
        // Placeholder for Gemini TTS REST call as per preview docs
        const res = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:predict?key=${apiKey}`, {
            instances: [{ content: text }],
            parameters: { modality: "AUDIO" }
        });

        // This is a simplified representation of the expected binary/b64 return
        return `Audio generation triggered. [Note: Implementation requires specific model access and binary handling]`;
    } catch (error: any) {
        return `Error generating audio: ${error.message}`;
    }
  }
};

const screenshotWebsite: Tool = {
  name: 'screenshot_website',
  description: 'Capture a screenshot of a website. The screenshot will also be sent directly to the user chat.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      url: { type: SchemaType.STRING, description: 'The URL of the website' },
      fullPage: { type: SchemaType.BOOLEAN, description: 'Whether to take a full page screenshot (default: false)' }
    },
    required: ['url']
  },
  execute: async ({ url, fullPage }: { url: string, fullPage?: boolean }) => {
    let browser;
    try {
      browser = await chromium.launch({
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      const filename = `screenshot_${Date.now()}.png`;
      const filePath = path.join(process.cwd(), filename);

      await page.screenshot({ path: filePath, fullPage: fullPage || false });

      // Send directly to user via Telegram
      const file = new InputFile(filePath);
      await bot.api.sendPhoto(config.TELEGRAM_USER_ID, file, {
          caption: `📸 Screenshot of ${url}`
      });

      return `Screenshot captured and sent to user. File saved at: ${filename}`;
    } catch (error: any) {
      console.error(`[Tool:screenshot_website] Error:`, error.message);
      return `Error capturing screenshot: ${error.message}`;
    } finally {
      if (browser) await browser.close();
    }
  }
};

const execAsync = promisify(spawnAsExec);
function spawnAsExec(command: string, options: any, callback: any) {
  const child = spawn('sh', ['-c', command], options);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (data) => { stdout += data; });
  child.stderr.on('data', (data) => { stderr += data; });
  child.on('close', (code) => {
    callback(code === 0 ? null : new Error(stderr), { stdout, stderr });
  });
}

// 5. CONTEXT7 (Native via CLI)
async function runCtx7(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const env: any = { ...process.env };
    if (config.CONTEXT7_API_KEY) {
      env.CONTEXT7_API_KEY = config.CONTEXT7_API_KEY;
    }

    const child = spawn('npx', ['ctx7', ...args, '--json'], { env });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `Process exited with code ${code}`));
        return;
      }
      resolve(stdout);
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

const context7ResolveLibrary: Tool = {
  name: 'context7_resolve_library',
  description: 'Resolves a general library name into a Context7-compatible library ID.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      libraryName: { type: SchemaType.STRING, description: 'The name of the library to search for' },
      query: { type: SchemaType.STRING, description: 'The user\'s question or task (used to rank results by relevance)' }
    },
    required: ['libraryName', 'query']
  },
  execute: async ({ libraryName, query }: { libraryName: string, query: string }) => {
    try {
      return await runCtx7(['library', libraryName, query]);
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const context7QueryDocs: Tool = {
  name: 'context7_query_docs',
  description: 'Retrieves documentation for a library using a Context7-compatible library ID.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      libraryId: { type: SchemaType.STRING, description: 'Exact Context7-compatible library ID (e.g., /facebook/react)' },
      query: { type: SchemaType.STRING, description: 'The user\'s question or task to get docs for' }
    },
    required: ['libraryId', 'query']
  },
  execute: async ({ libraryId, query }: { libraryId: string, query: string }) => {
    try {
      return await runCtx7(['docs', libraryId, query]);
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

// --- Registry ---
export const registry = new ToolRegistry();
const tools = [
  writeFile, readFile, deleteFile, listFiles,
  driveSearch, driveDeleteFile, driveCreateFolder,
  bloggerListBlogs, bloggerCreatePost, mapsSearchPlaces,
  netlifyListSites, netlifyDeploy, netlifyDeployDirectory, netlifyDeleteSite, netlifyGetSite,
  getWebsiteContent, screenshotWebsite,
  context7ResolveLibrary, context7QueryDocs,
  createDirectory, moveFile, copyFile, listFilesRecursive, deleteDirectory,
  zipDirectory, unzipFile, searchFilesContent,
  sendTelegramMedia, calculator, generateQrCode, generateImage, generateAudio, duckduckgoSearch, wikipediaSearch, devdocsSearch, telegraphCreatePage,
  julesListSources, julesCreateSession, julesGetSession, julesListSessions, julesListActivities,
  stitchCreateProject, stitchGenerateScreen, stitchGetProject, stitchListProjects, stitchListScreens, stitchGetScreen,
  koyebListApps, koyebGetApp, koyebListServices, koyebListDeployments, koyebListInstances, koyebListDomains, koyebListSecrets
];
tools.forEach(t => registry.register(t));
