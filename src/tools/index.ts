import { FunctionDeclaration, SchemaType } from '@google/generative-ai';
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
      name: tool.name,
      description: tool.description,
      parameters: this.sanitizeSchema(tool.parameters),
    }));

    const mcpTools = mcpService.getTools().map((tool: any) => ({
        name: `${tool._mcp_instance}__${tool.name}`,
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
    const rawName = name.includes(':') ? name.split(':').pop()! : name;
    let cleanName = rawName;
    let detectedInstance: string | undefined;

    if (rawName.includes('__')) {
        const parts = rawName.split('__');
        const prefix = parts[0];
        if (prefix !== 'mcp') {
            detectedInstance = prefix;
        }
        cleanName = parts.slice(1).join('__');
    }
    
    // Check native tools first (only if no explicit instance prefix detected)
    if (!detectedInstance) {
        const tool = this.tools.get(cleanName);
        if (tool) {
            try {
                return await tool.execute(args);
            } catch (error: any) {
                return `Error executing tool ${name}: ${error.message}`;
            }
        }
    }

    // Check MCP tools
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
      const safePath = path.join(process.cwd(), filePath.replace(/^(\.\.[/\\])+/, ''));
      const file = new InputFile(safePath);
      if (type === 'photo') await bot.api.sendPhoto(config.TELEGRAM_USER_ID, file, { caption });
      else if (type === 'video') await bot.api.sendVideo(config.TELEGRAM_USER_ID, file, { caption });
      else if (type === 'audio') await bot.api.sendAudio(config.TELEGRAM_USER_ID, file, { caption });
      else if (type === 'document') await bot.api.sendDocument(config.TELEGRAM_USER_ID, file, { caption });
      return `Successfully sent ${type} to user.`;
    } catch (error: any) {
      return `Error sending media: ${error.message}`;
    }
  }
};

const calculator: Tool = {
  name: 'calculator',
  description: 'Perform advanced mathematical calculations using Python.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      expression: { type: SchemaType.STRING, description: 'The math expression to evaluate (e.g., "sqrt(25) + 10 * 5")' }
    },
    required: ['expression']
  },
  execute: async ({ expression }: { expression: string }) => {
    try {
        const pythonCode = `import math; print(eval("${expression.replace(/"/g, '\\"')}"))`;
        const { stdout } = await execAsync(`python3 -c '${pythonCode}'`, {} as any) as any;
        return stdout.trim();
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
        const pythonCode = `import qrcode; img = qrcode.make("${data.replace(/"/g, '\\"')}"); img.save("${filename.replace(/"/g, '\\"')}")`;
        await execAsync(`python3 -c '${pythonCode}'`, {} as any);
        return `QR code generated and saved to ${filename}.`;
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
        const pythonCode = `from duckduckgo_search import DDGS; results = list(DDGS().${searchType}("${query.replace(/"/g, '\\"')}", max_results=${limit})); import json; print(json.dumps(results))`;
        const { stdout } = await execAsync(`python3 -c '${pythonCode}'`, {} as any) as any;
        return stdout;
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
        const pythonCode = `import wikipediaapi; wiki = wikipediaapi.Wikipedia("AmmarClaw/1.25 (ammar@example.com)", "en"); page = wiki.page("${query.replace(/"/g, '\\"')}"); print(page.summary[:5000] if page.exists() else "Page not found.")`;
        const { stdout } = await execAsync(`python3 -c '${pythonCode}'`, {} as any) as any;
        return stdout;
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
        const pythonCode = `from telegraph import Telegraph; t = Telegraph(); t.create_account(short_name="AmmarClaw"); response = t.create_page("${title.replace(/"/g, '\\"')}", html_content="${content.replace(/"/g, '\\"')}", author_name="${(author_name || 'AmmarClaw').replace(/"/g, '\\"')}"); print(response['url'])`;
        const { stdout } = await execAsync(`python3 -c '${pythonCode}'`, {} as any) as any;
        return `Page created: ${stdout.trim()}`;
    } catch (error: any) {
        return `Error creating Telegraph page: ${error.message}`;
    }
  }
};

// 6. JINA AI
const jinaSearch: Tool = {
  name: 'jina_search',
  description: 'Search the web using Jina AI and get SERP as LLM-friendly text.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      query: { type: SchemaType.STRING, description: 'Search query' }
    },
    required: ['query']
  },
  execute: async ({ query }: { query: string }) => {
    try {
      const headers: any = {};
      if (config.JINA_API_KEY) headers['Authorization'] = `Bearer ${config.JINA_API_KEY}`;
      const res = await axios.get(`https://s.jina.ai/${encodeURIComponent(query)}`, { headers });
      return res.data;
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const jinaReader: Tool = {
  name: 'jina_reader',
  description: 'Convert any URL to Markdown for better grounding LLMs using Jina Reader.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      url: { type: SchemaType.STRING, description: 'URL to read' }
    },
    required: ['url']
  },
  execute: async ({ url }: { url: string }) => {
    try {
      const headers: any = {};
      if (config.JINA_API_KEY) headers['Authorization'] = `Bearer ${config.JINA_API_KEY}`;
      const res = await axios.get(`https://r.jina.ai/${url}`, { headers });
      return res.data;
    } catch (error: any) {
      return `Error: ${error.message}`;
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

// 3. GOOGLE WORKSPACE CRUD (GMAIL/DRIVE)
const gmailSearch: Tool = {
  name: 'gmail_search',
  description: 'Search for emails in Gmail.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      query: { type: SchemaType.STRING, description: 'Search query' },
      maxResults: { type: SchemaType.NUMBER, description: 'Max results (default 5)' }
    },
    required: ['query']
  },
  execute: async ({ query, maxResults }: { query: string, maxResults?: number }) => {
    try {
      const gmail = await googleService.gmail();
      const res = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: maxResults || 5 });
      if (!res.data.messages) return "No messages found.";
      const messages = await Promise.all(res.data.messages.map(async (m) => {
        const detail = await gmail.users.messages.get({ userId: 'me', id: m.id! });
        return `From: ${detail.data.payload?.headers?.find(h => h.name === 'From')?.value}\nSubject: ${detail.data.payload?.headers?.find(h => h.name === 'Subject')?.value}\nSnippet: ${detail.data.snippet}\n---`;
      }));
      return messages.join('\n');
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const gmailSend: Tool = {
  name: 'gmail_send',
  description: 'Send an email.',
  requiresApproval: true,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      to: { type: SchemaType.STRING, description: 'Recipient' },
      subject: { type: SchemaType.STRING, description: 'Subject' },
      body: { type: SchemaType.STRING, description: 'Body' }
    },
    required: ['to', 'subject', 'body']
  },
  execute: async ({ to, subject, body }: { to: string, subject: string, body: string }) => {
    try {
      const gmail = await googleService.gmail();
      const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
      const message = [`To: ${to}`, 'Content-Type: text/plain; charset=utf-8', 'MIME-Version: 1.0', `Subject: ${utf8Subject}`, '', body].join('\n');
      const encoded = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encoded } });
      return "Email sent successfully.";
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const gmailDeleteMessage: Tool = {
  name: 'gmail_delete_message',
  description: 'Delete a specific email message by ID.',
  requiresApproval: true,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      id: { type: SchemaType.STRING, description: 'The ID of the message to delete' }
    },
    required: ['id']
  },
  execute: async ({ id }: { id: string }) => {
    try {
      const gmail = await googleService.gmail();
      await gmail.users.messages.delete({ userId: 'me', id });
      return "Message deleted successfully.";
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

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

const getCurrentTime: Tool = {
  name: 'get_current_time',
  description: 'Get current time.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      timezone: { type: SchemaType.STRING, description: 'Timezone (default UTC)' }
    }
  },
  execute: async ({ timezone }: { timezone?: string }) => {
    return new Date().toLocaleString('en-US', { timeZone: timezone || 'UTC' });
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
  gmailSearch, gmailSend, gmailDeleteMessage,
  driveSearch, driveDeleteFile, driveCreateFolder,
  bloggerListBlogs, bloggerCreatePost, mapsSearchPlaces,
  netlifyListSites, netlifyDeploy, netlifyDeployDirectory, netlifyDeleteSite, netlifyGetSite,
  getCurrentTime, getWebsiteContent,
  context7ResolveLibrary, context7QueryDocs,
  jinaReader,
  createDirectory, moveFile, copyFile, listFilesRecursive, deleteDirectory,
  sendTelegramMedia, calculator, generateQrCode, duckduckgoSearch, wikipediaSearch, devdocsSearch, telegraphCreatePage
];
tools.forEach(t => registry.register(t));
