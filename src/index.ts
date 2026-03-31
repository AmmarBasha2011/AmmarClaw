import { bot } from './bot.js';
import { config } from './config/env.js';
import { scheduler } from './services/scheduler.js';
import { mcpService } from './services/mcp.js';
import { registry } from './tools/index.js';
import { whatsappService } from './services/whatsapp.js';
import { uiService } from './services/ui.js';

console.log("Starting AmmarClaw V2.0...");

async function main() {
    // 1. Start Scheduler
    scheduler.start();

    // 2. Start MCP
    await mcpService.connect();

    // 3. Start UI if enabled
    if (config.UI_ENABLED) {
        uiService.start();
    }

    // 4. Start WhatsApp if enabled in .env
    if (config.WHATSAPP_ENABLED) {
        await whatsappService.start();
    }

    // 5. Start Telegram Bot if enabled
    if (config.TELEGRAM_ENABLED) {
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

                if (config.TELEGRAM_USER_ID) {
                    try {
                        await bot.api.sendMessage(
                            config.TELEGRAM_USER_ID,
                            `🌙 *AmmarClaw V2.0 is awake.*\n\n` +
                            `⚙️ *Mode*: Unlimited\n` +
                            `📦 *Code Version*: V2.0\n` +
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
            }
        });
    } else {
        console.log("Telegram Bot is disabled.");
    }
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
