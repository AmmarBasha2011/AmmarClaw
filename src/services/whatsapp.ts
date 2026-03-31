import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode';
import { InputFile } from 'grammy';
import { bot } from '../bot.js';
import { config } from '../config/env.js';
import { agent } from '../core/agent.js';
import { memory } from './memory.js';
import fs from 'fs/promises';
import path from 'path';

export class WhatsAppService {
    private client: any;
    private isReady: boolean = false;

    constructor() {
        this.client = new Client({
            authStrategy: new LocalAuth({
                dataPath: path.join(process.cwd(), '.wwebjs_auth')
            }),
            puppeteer: {
                headless: true,
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-gpu'
                ],
            }
        });

        this.client.on('qr', async (qr: string) => {
            console.log('[WhatsApp] QR Received');
            try {
                const qrBuffer = await qrcode.toBuffer(qr);
                const qrPath = path.join(process.cwd(), 'whatsapp_qr.png');
                await fs.writeFile(qrPath, qrBuffer);

                await bot.api.sendPhoto(config.TELEGRAM_USER_ID, new InputFile(qrPath), {
                    caption: "📱 *WhatsApp Connection Required*\n\nScan this QR code with your WhatsApp to link AmmarClaw.",
                    parse_mode: 'Markdown'
                });

                await fs.unlink(qrPath);
            } catch (error) {
                console.error('[WhatsApp] QR Error:', error);
            }
        });

        this.client.on('ready', () => {
            console.log('[WhatsApp] Client is ready!');
            this.isReady = true;
            bot.api.sendMessage(config.TELEGRAM_USER_ID, "✅ *WhatsApp Connected!* AmmarClaw is now monitoring your WhatsApp messages.", { parse_mode: 'Markdown' });
        });

        this.client.on('message', async (msg: any) => {
            // Only process messages from individual chats (not groups, for now)
            if (msg.from.includes('@g.us')) return;

            console.log(`[WhatsApp] Message from ${msg.from}: ${msg.body}`);

            // We use the agent to process the message.
            // We'll treat the WhatsApp sender as a unique session/user ID if needed,
            // but for AmmarClaw, it's Ammar's personal assistant, so we process it as Ammar.

            const sender = await msg.getContact();
            const senderName = sender.pushname || sender.name || msg.from;

            try {
                const response = await agent.run(
                    `wa_${msg.from}`,
                    `[WhatsApp message from ${senderName}]: ${msg.body}`,
                    async (name, args, status) => {
                        // Optional: notify Telegram when WhatsApp agent is using tools
                        // if (status === 'executing') await bot.api.sendMessage(config.TELEGRAM_USER_ID, `🛠 WA Agent using [${name}]`);
                    },
                    true // Auto-mode for WhatsApp messages? Or maybe not? Let's stick to true for background tasks.
                );

                if (response && response.trim().length > 0) {
                    await msg.reply(response);
                }
            } catch (error) {
                console.error('[WhatsApp] Processing Error:', error);
            }
        });

        this.client.on('auth_failure', (msg: string) => {
            console.error('[WhatsApp] Auth failure:', msg);
            bot.api.sendMessage(config.TELEGRAM_USER_ID, `❌ *WhatsApp Auth Failed*: ${msg}`, { parse_mode: 'Markdown' });
        });

        this.client.on('disconnected', (reason: string) => {
            console.log('[WhatsApp] Client disconnected:', reason);
            this.isReady = false;
            bot.api.sendMessage(config.TELEGRAM_USER_ID, `⚠️ *WhatsApp Disconnected*: ${reason}`, { parse_mode: 'Markdown' });
        });
    }

    async start() {
        if (!config.WHATSAPP_ENABLED) return;
        console.log('[WhatsApp] Starting client...');
        try {
            await this.client.initialize();
        } catch (error) {
            console.error('[WhatsApp] Initialization Error:', error);
        }
    }

    async sendMessage(to: string, message: string) {
        if (!this.isReady) throw new Error("WhatsApp client not ready");
        await this.client.sendMessage(to, message);
    }

    getStatus() {
        return {
            ready: this.isReady,
            enabled: config.WHATSAPP_ENABLED
        };
    }
}

export const whatsappService = new WhatsAppService();
