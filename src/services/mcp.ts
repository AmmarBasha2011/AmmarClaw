import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createConnection, SmitheryAuthorizationError } from "@smithery/api/mcp";
import { bot } from "../bot.js";
import { config } from "../config/env.js";
import { updateEnv } from "../utils/env.js";

interface MCPInstance {
    client: Client | null;
    transport: any;
    tools: any[];
    isConnected: boolean;
    name: string;
    mcpUrl: string;
    connectionIdKey: 'GITHUB_CONNECTION_ID' | 'SUPABASE_CONNECTION_ID' | 'WEATHER_CONNECTION_ID' | 'RSS_CONNECTION_ID' | 'ICONS8_CONNECTION_ID' | 'NPM_CONNECTION_ID' | 'FLIGHT_CONNECTION_ID' | 'PYTHON_CONNECTION_ID' | 'GOOGLE_SCHOLAR_CONNECTION_ID';
}

export class MCPService {
    private instances: Map<string, MCPInstance> = new Map();

    constructor() {
        this.instances.set('github', {
            client: null,
            transport: null,
            tools: [],
            isConnected: false,
            name: 'GitHub',
            mcpUrl: 'https://github.run.tools',
            connectionIdKey: 'GITHUB_CONNECTION_ID'
        });
        this.instances.set('supabase', {
            client: null,
            transport: null,
            tools: [],
            isConnected: false,
            name: 'Supabase',
            mcpUrl: 'https://supabase.run.tools',
            connectionIdKey: 'SUPABASE_CONNECTION_ID'
        });
        this.instances.set('weather', {
            client: null,
            transport: null,
            tools: [],
            isConnected: false,
            name: 'Weather',
            mcpUrl: 'https://mcp_weather_server--isdaniel.run.tools',
            connectionIdKey: 'WEATHER_CONNECTION_ID'
        });
        this.instances.set('rss', {
            client: null,
            transport: null,
            tools: [],
            isConnected: false,
            name: 'RSS Reader',
            mcpUrl: 'https://rss-reader-mcp--kwp-lab.run.tools',
            connectionIdKey: 'RSS_CONNECTION_ID'
        });
        this.instances.set('icons8', {
            client: null,
            transport: null,
            tools: [],
            isConnected: false,
            name: 'Icons8',
            mcpUrl: 'https://icons8mpc--icons8community.run.tools',
            connectionIdKey: 'ICONS8_CONNECTION_ID'
        });
        this.instances.set('npm', {
            client: null,
            transport: null,
            tools: [],
            isConnected: false,
            name: 'NPM Sentinel',
            mcpUrl: 'https://npm-sentinel-mcp--nekzus.run.tools',
            connectionIdKey: 'NPM_CONNECTION_ID'
        });
        this.instances.set('flight', {
            client: null,
            transport: null,
            tools: [],
            isConnected: false,
            name: 'Flight Search',
            mcpUrl: 'https://flight-mcp--gvzq.run.tools',
            connectionIdKey: 'FLIGHT_CONNECTION_ID'
        });
        this.instances.set('python', {
            client: null,
            transport: null,
            tools: [],
            isConnected: false,
            name: 'Python',
            mcpUrl: 'https://py_execute_mcp--stuzhy.run.tools',
            connectionIdKey: 'PYTHON_CONNECTION_ID'
        });
        this.instances.set('google-scholar', {
            client: null,
            transport: null,
            tools: [],
            isConnected: false,
            name: 'Google Scholar',
            mcpUrl: 'https://google-scholar-mcp--mochow13.run.tools',
            connectionIdKey: 'GOOGLE_SCHOLAR_CONNECTION_ID'
        });
    }

    async connect() {
        const results = await Promise.all(
            Array.from(this.instances.keys()).map(key => this.connectInstance(key))
        );
        return results.some(r => r === true);
    }

    private async connectInstance(key: string) {
        const instance = this.instances.get(key)!;
        const connectionId = config[instance.connectionIdKey];

        try {
            console.log(`[MCP] Connecting to ${instance.name} MCP (${instance.mcpUrl})...`);
            if (connectionId) {
                console.log(`[MCP] Reusing connection for ${instance.name}: ${connectionId}`);
            }

            const options: any = {
                mcpUrl: instance.mcpUrl,
                connectionId: connectionId,
            };


            const connection = await createConnection(options);

            instance.transport = connection.transport;
            instance.client = new Client(
                { name: "AmmarClaw", version: "1.0.0" },
                { capabilities: {} }
            );

            await instance.client.connect(instance.transport);
            instance.isConnected = true;

            const { tools } = await instance.client.listTools();
            instance.tools = tools;

            console.log(`[MCP] ${instance.name} connected successfully. Connection ID: ${connection.connectionId}. Retrieved ${tools.length} tools.`);

            // Auto-save connection ID if changed or new
            if (connectionId !== connection.connectionId) {
                await updateEnv(instance.connectionIdKey, connection.connectionId);
                // Update in-memory config for immediate /reload support
                (config as any)[instance.connectionIdKey] = connection.connectionId;
            }

            // Provide connection status and connection ID
            try {
                await bot.api.sendMessage(
                    config.TELEGRAM_USER_ID,
                    `✅ *${instance.name} MCP Connected*\n\nConnection ID: \`${connection.connectionId}\`\n\n_ID has been automatically saved to your .env file._`,
                    { parse_mode: 'Markdown' }
                );
            } catch (_e) {}

            return true;
        } catch (error: any) {
            if (error instanceof SmitheryAuthorizationError) {
                console.warn(`[MCP] Auth required for ${instance.name} connection ${error.connectionId}: ${error.authorizationUrl}`);
                await updateEnv(instance.connectionIdKey, error.connectionId);
                // Update in-memory config for immediate /reload support
                (config as any)[instance.connectionIdKey] = error.connectionId;
                try {
                    await bot.api.sendMessage(
                        config.TELEGRAM_USER_ID,
                        `🔗 *${instance.name} MCP Authorization Required*\n\nPlease visit this URL to authorize:\n${error.authorizationUrl}\n\n*Important*: After authorizing, use /reload to refresh tools.\n\n_Connection ID has been automatically saved to your .env file._`,
                        { parse_mode: 'Markdown' }
                    );
                } catch (_e) {}
            } else {
                console.error(`[MCP] ${instance.name} Connection Error:`, error.message);
            }
            instance.isConnected = false;
            return false;
        }
    }

    async reload() {
        for (const instance of this.instances.values()) {
            if (instance.client) {
                try {
                    await instance.client.close();
                } catch (_e) {}
            }
        }
        return await this.connect();
    }

    getTools() {
        // Flat list of all tools from all connected instances
        // We'll add a metadata property to each tool to help with routing
        const allTools: any[] = [];
        for (const [key, instance] of this.instances.entries()) {
            if (instance.isConnected) {
                allTools.push(...instance.tools.map(t => ({ ...t, _mcp_instance: key })));
            }
        }
        return allTools;
    }

    getStatus() {
        let connectedCount = 0;
        let toolCount = 0;
        for (const instance of this.instances.values()) {
            if (instance.isConnected) {
                connectedCount++;
                toolCount += instance.tools.length;
            }
        }
        return {
            connected: connectedCount > 0,
            connectedCount,
            totalInstances: this.instances.size,
            toolCount
        };
    }

    async callTool(name: string, args: any, instanceKey?: string) {
        // Find which instance has this tool
        let targetInstance: MCPInstance | null = null;

        if (instanceKey && this.instances.has(instanceKey)) {
            targetInstance = this.instances.get(instanceKey)!;
        } else {
            // Search all instances if key not provided
            for (const instance of this.instances.values()) {
                if (instance.tools.some(t => t.name === name)) {
                    targetInstance = instance;
                    break;
                }
            }
        }

        if (!targetInstance || !targetInstance.client || !targetInstance.isConnected) {
            throw new Error(`MCP tool ${name} not found in ${instanceKey || 'any'} instance or not connected`);
        }

        const result = await targetInstance.client.callTool({
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
