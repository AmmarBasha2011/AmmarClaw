import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { config } from '../config/env.js';
import { whatsappService } from './whatsapp.js';
import { bot } from '../bot.js';
import { mcpService } from './mcp.js';
import { agent } from '../core/agent.js';
import fs from 'fs/promises';

export class UIService {
    private app = express();
    private server = createServer(this.app);
    private io = new Server(this.server);

    constructor() {
        this.setupRoutes();
        this.setupSocket();
    }

    private setupRoutes() {
        this.app.use(express.static(path.join(process.cwd(), 'public')));
        this.app.get('/api/status', (req, res) => {
            res.json(this.getStatus());
        });
    }

    private setupSocket() {
        this.io.on('connection', (socket) => {
            console.log('[UI] New client connected');

            // Send initial status
            socket.emit('status', this.getStatus());

            // Handle WhatsApp start
            socket.on('whatsapp:start', async () => {
                await whatsappService.start();
            });

            // Handle Agent chat
            socket.on('agent:chat', async (message: string) => {
                socket.emit('debug', `AI: Processing message: ${message}`);
                try {
                    const response = await agent.run(
                        'ui_user',
                        message,
                        async (name, args, status) => {
                            socket.emit('debug', `AI: Using Tool [${name}] - ${status}`);
                        },
                        true // Auto-mode for UI chat
                    );
                    socket.emit('agent:response', response);
                } catch (error: any) {
                    socket.emit('debug', `AI Error: ${error.message}`);
                    socket.emit('agent:response', `Error: ${error.message}`);
                }
            });

            socket.on('disconnect', () => {
                console.log('[UI] Client disconnected');
            });
        });

        // Listen for WhatsApp QR
        whatsappService.onQr((qr) => {
            this.io.emit('whatsapp:qr', qr);
        });
    }

    private getStatus() {
        const mcpStatus = mcpService.getStatus();
        const waStatus = whatsappService.getStatus();
        return {
            telegram: {
                enabled: config.TELEGRAM_ENABLED,
                connected: config.TELEGRAM_ENABLED // Simple proxy for now
            },
            whatsapp: waStatus,
            mcp: mcpStatus,
            ui: {
                enabled: config.UI_ENABLED
            }
        };
    }

    start() {
        if (!config.UI_ENABLED) return;
        const PORT = process.env.PORT || 8000;
        this.server.listen(PORT, () => {
            console.log(`[UI] Dashboard running at http://localhost:${PORT}`);
        });
    }

    broadcastStatus() {
        this.io.emit('status', this.getStatus());
    }

    broadcastDebug(message: string) {
        this.io.emit('debug', message);
    }
}

export const uiService = new UIService();
