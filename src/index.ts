import { bot } from './bot.js';
import { config } from './config/env.js';
import { scheduler } from './services/scheduler.js';
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

    // 2. Start Bot
    bot.start({
        onStart: async (botInfo) => {
            const keyCount = config.GEMINI_API_KEYS.length;
            console.log(`Bot @${botInfo.username} is running.`);
            console.log(`Agent: Unlimited mode enabled.`);
            console.log(`Gemini: ${keyCount} API keys loaded.`);
            
            try {
                await bot.api.sendMessage(
                    config.TELEGRAM_USER_ID, 
                    `🌙 *AmmarClaw is awake.*\n\n` +
                    `⚙️ *Mode*: Unlimited\n` +
                    `🔑 *Gemini Keys*: ${keyCount} loaded`,
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
