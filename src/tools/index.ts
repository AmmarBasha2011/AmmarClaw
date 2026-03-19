import { FunctionDeclaration, SchemaType } from '@google/generative-ai';
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { googleService } from '../services/google.js';
import { config } from '../config/env.js';
import { mcpService } from '../services/mcp.js';

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

  getFunctionDeclarations(): FunctionDeclaration[] {
    const nativeTools = Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));

    const mcpTools = mcpService.getTools().map((tool: any) => ({
        name: tool.name,
        description: tool.description,
        parameters: {
            type: SchemaType.OBJECT,
            properties: tool.inputSchema.properties || {},
            required: tool.inputSchema.required || []
        }
    }));

    return [...nativeTools, ...mcpTools];
  }

  async execute(name: string, args: any): Promise<string> {
    const cleanName = name.includes(':') ? name.split(':').pop()! : name;
    
    // Check native tools first
    const tool = this.tools.get(cleanName);
    if (tool) {
        try {
            return await tool.execute(args);
        } catch (error: any) {
            return `Error executing tool ${name}: ${error.message}`;
        }
    }

    // Check MCP tools
    const mcpTools = mcpService.getTools();
    const isMcpTool = mcpTools.some((t: any) => t.name === cleanName);
    if (isMcpTool) {
        try {
            return await mcpService.callTool(cleanName, args);
        } catch (error: any) {
            return `Error executing MCP tool ${name}: ${error.message}`;
        }
    }

    throw new Error(`Tool ${cleanName} not found`);
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
  description: 'List all files in the current workspace directory.',
  parameters: { type: SchemaType.OBJECT, properties: {} },
  execute: async () => {
    try {
      const files = await fs.readdir(process.cwd());
      return files.join('\n') || "Workspace is empty.";
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

// 4. OTHER TOOLS (YOUTUBE, BLOGGER, MAPS, NETLIFY)
const youtubeSearch: Tool = {
  name: 'youtube_search',
  description: 'Search for videos on YouTube.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      q: { type: SchemaType.STRING, description: 'Query' },
      maxResults: { type: SchemaType.NUMBER, description: 'Results' }
    },
    required: ['q']
  },
  execute: async ({ q, maxResults }: { q: string, maxResults?: number }) => {
    try {
      const youtube = await googleService.youtube();
      const res = await youtube.search.list({ part: ['snippet'], q, maxResults: maxResults || 5, type: ['video'] });
      return res.data.items?.map(i => `• ${i.snippet?.title} (https://www.youtube.com/watch?v=${i.id?.videoId})`).join('\n') || "No videos found.";
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

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

// --- Registry ---
export const registry = new ToolRegistry();
const tools = [
  writeFile, readFile, deleteFile, listFiles,
  gmailSearch, gmailSend, gmailDeleteMessage,
  driveSearch, driveDeleteFile, driveCreateFolder,
  youtubeSearch, bloggerListBlogs, bloggerCreatePost, mapsSearchPlaces,
  netlifyListSites, netlifyDeploy,
  getCurrentTime, getWebsiteContent
];
tools.forEach(t => registry.register(t));
