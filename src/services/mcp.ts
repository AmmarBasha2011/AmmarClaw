import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createConnection, SmitheryAuthorizationError } from "@smithery/api/mcp";
import { bot } from "../bot.js";
import { config } from "../config/env.js";

export class MCPService {
    private client: Client | null = null;
    private transport: any = null;
    private tools: any[] = [];
    private isConnected: boolean = false;

    async connect() {
        try {
            console.log("[MCP] Connecting to Smithery GitHub MCP (https://github.run.tools)...");
            
            // Smithery Connect will use process.env.SMITHERY_API_KEY by default
            const connection = await createConnection({
                mcpUrl: "https://github.run.tools",
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
            
            console.log(`[MCP] Connected successfully. Retrieved ${tools.length} tools.`);
            return true;
        } catch (error: any) {
            if (error instanceof SmitheryAuthorizationError) {
                console.warn(`[MCP] Auth required: ${error.authorizationUrl}`);
                // Notify user via Telegram if possible (this might be called before bot is fully ready, 
                // but onStart in index.ts handles the first call)
                try {
                    await bot.api.sendMessage(
                        config.TELEGRAM_USER_ID,
                        `🔗 *GitHub MCP Authorization Required*\n\nPlease visit this URL to authorize GitHub:\n${error.authorizationUrl}\n\nAfter authorizing, use /reload to refresh tools.`,
                        { parse_mode: 'Markdown' }
                    );
                } catch (_e) {
                    // Bot might not be started yet
                }
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
