import { bot } from './bot.js';
import { config } from './config/env.js';
import { scheduler } from './services/scheduler.js';
import { mcpService } from './services/mcp.js';
import { registry } from './tools/index.js';
import http from 'http';

console.log("Starting AmmarClaw...");

async function main() {
    // 0. Dummy HTTP server for Koyeb Health Checks
    const PORT = process.env.PORT || 8000;
    http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('AmmarClaw is Alive\n');
    }).listen(PORT, () => {
        console.log(`Health check server listening on port ${PORT}`);
    });

    // 1. Start Scheduler
    scheduler.start();

    // 1.5 Start MCP
    await mcpService.connect();

    // 2. Start Bot
    bot.start({
        onStart: async (botInfo) => {
            const keyCount = config.GEMINI_API_KEYS.length;
            const mcpStatus = mcpService.getStatus();
            const nativeToolCount = registry.getNativeToolsCount();
            const totalTools = nativeToolCount + mcpStatus.toolCount;

            console.log(`Bot @${botInfo.username} is running.`);
            console.log(`Agent: Unlimited mode enabled.`);
            console.log(`Gemini: ${keyCount} API keys loaded.`);
            console.log(`MCP: ${mcpStatus.connected ? 'Connected' : 'Disconnected'} (${mcpStatus.toolCount} tools)`);
            console.log(`Total Tools: ${totalTools}`);
            
            try {
                await bot.api.sendMessage(
                    config.TELEGRAM_USER_ID, 
                    `🌙 *AmmarClaw is awake.*\n\n` +
                    `⚙️ *Mode*: Unlimited\n` +
                    `📦 *Code Version*: V2.2.2\n` +
                    `🔑 *Gemini Keys*: ${keyCount} loaded\n` +
                    `🔌 *MCP Status*: ${mcpStatus.connected ? '✅ Connected' : '❌ Disconnected'}\n` +
                    `🛠 *MCP Tools*: ${mcpStatus.toolCount} loaded\n` +
                    `🚀 *Total Tools*: ${totalTools} available`,
                    { parse_mode: 'Markdown' }
                );
            } catch (error) {
                console.error("Failed to send startup message:", error);
            }
        }
    });
}

main().catch(console.error);

// Graceful Shutdown
process.once('SIGINT', () => {
    console.log("Shutting down...");
    bot.stop();
    process.exit(0);
});

process.once('SIGTERM', () => {
    console.log("Shutting down...");
    bot.stop();
    process.exit(0);
});
