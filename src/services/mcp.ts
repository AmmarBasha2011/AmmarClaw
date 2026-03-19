import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createConnection, SmitheryAuthorizationError } from "@smithery/api/mcp";
import { bot } from "../bot.js";
import { config } from "../config/env.js";
import { updateEnv } from "../utils/env.js";

export class MCPService {
    private client: Client | null = null;
    private transport: any = null;
    private tools: any[] = [];
    private isConnected: boolean = false;

    async connect() {
        try {
            console.log(`[MCP] Connecting to Smithery GitHub MCP (https://github.run.tools)...`);
            if (config.GITHUB_CONNECTION_ID) {
                console.log(`[MCP] Reusing connection: ${config.GITHUB_CONNECTION_ID}`);
            }
            
            // Smithery Connect will use process.env.SMITHERY_API_KEY by default
            const connection = await createConnection({
                mcpUrl: "https://github.run.tools",
                connectionId: config.GITHUB_CONNECTION_ID,
                // handshake: true // Enable if we need server version
            });

            this.transport = connection.transport;

            this.client = new Client(
                { name: "AmmarClaw", version: "1.0.0" },
                { capabilities: {} }
            );

            await this.client.connect(this.transport);
            this.isConnected = true;

            const { tools } = await this.client.listTools();
            this.tools = tools;
            
            console.log(`[MCP] Connected successfully. Connection ID: ${connection.connectionId}. Retrieved ${tools.length} tools.`);
            
            // If it's a new connection or re-connected, auto-save it
            if (!config.GITHUB_CONNECTION_ID || config.GITHUB_CONNECTION_ID !== connection.connectionId) {
                await updateEnv('GITHUB_CONNECTION_ID', connection.connectionId);
                try {
                    await bot.api.sendMessage(
                        config.TELEGRAM_USER_ID,
                        `✅ *GitHub MCP Connected*\n\nConnection ID: \`${connection.connectionId}\`\n\n_ID has been automatically saved to your .env file._`,
                        { parse_mode: 'Markdown' }
                    );
                } catch (_e) {}
            }

            return true;
        } catch (error: any) {
            if (error instanceof SmitheryAuthorizationError) {
                console.warn(`[MCP] Auth required for connection ${error.connectionId}: ${error.authorizationUrl}`);
                await updateEnv('GITHUB_CONNECTION_ID', error.connectionId);
                try {
                    await bot.api.sendMessage(
                        config.TELEGRAM_USER_ID,
                        `🔗 *GitHub MCP Authorization Required*\n\nPlease visit this URL to authorize GitHub:\n${error.authorizationUrl}\n\n*Important*: After authorizing, use /reload to refresh tools.\n\n_Connection ID has been automatically saved to your .env file._`,
                        { parse_mode: 'Markdown' }
                    );
                } catch (_e) {}
            } else {
                console.error("[MCP] Connection Error:", error.message);
            }
            this.isConnected = false;
            return false;
        }
    }

    async reload() {
        if (this.client) {
            try {
                await this.client.close();
            } catch (_e) {
                // Ignore close errors
            }
        }
        return await this.connect();
    }

    getTools() {
        return this.tools;
    }

    getStatus() {
        return {
            connected: this.isConnected,
            toolCount: this.tools.length
        };
    }

    async callTool(name: string, args: any) {
        if (!this.client || !this.isConnected) {
            throw new Error("MCP Client not connected");
        }
        const result = await this.client.callTool({
            name,
            arguments: args
        });
        
        if (result.content && Array.isArray(result.content)) {
            return result.content.map((c: any) => {
                if (c.type === 'text') return c.text;
                return JSON.stringify(c);
            }).join("\n");
        }
        return JSON.stringify(result);
    }
}

export const mcpService = new MCPService();
