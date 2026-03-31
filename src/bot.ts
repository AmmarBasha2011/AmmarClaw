import { Bot } from 'grammy';
import { config } from './config/env.js';
import { agent } from './core/agent.js';
import { googleService } from './services/google.js';
import { memory } from './services/memory.js';
import { MediaData } from './services/llm/index.js';
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { scheduler } from './services/scheduler.js';
import { mcpService } from './services/mcp.js';
import { registry } from './tools/index.js';
import { whatsappService } from './services/whatsapp.js';

const bot = new Bot(config.TELEGRAM_BOT_TOKEN || 'dummy_token');

// Single task lock
let currentController: AbortController | null = null;

// Middleware: Security Check
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id.toString();
  if (userId !== config.TELEGRAM_USER_ID) {
    console.warn(`[Security] Unauthorized access attempt from ID: ${userId}`);
    return;
  }
  await next();
});

// Commands
bot.command('start', (ctx) => ctx.reply('🌙 AmmarClaw is online and ready. Type /help to see what I can do.'));

bot.command('help', (ctx) => {
    ctx.reply(
        "🛠 *AmmarClaw Commands*:\n\n" +
        "/auth - Link Google account\n" +
        "/auto [task] - Run without approval\n" +
        "/schedule every [n] [unit] [task] - Automate a task\n" +
        "/schedules - List active automated tasks\n" +
        "/unschedule [id] - Remove a task\n" +
        "/reload - Refresh MCP tools\n" +
        "/whatsapp - Connect to WhatsApp\n" +
        "/end - Stop current task\n" +
        "/status - Bot status\n" +
        "/clear - Clear history\n" +
        "/remove - WIPE ALL MEMORY (History, Facts, Schedules)\n\n" +
        "Examples:\n" +
        "• `/schedule every 1 hour Summarize my Gmail` \n" +
        "• `/schedule every 30 minutes Check GitHub notifications` ",
        { parse_mode: 'Markdown' }
    );
});

bot.command('schedule', async (ctx) => {
    const text = ctx.match || '';
    const regex = /every\s+(\d+)\s+(second|minute|hour|day|month|year)s?\s+(.+)/i;
    const match = text.match(regex);

    if (!match) {
        return ctx.reply("❌ Invalid format. Use: `/schedule every [n] [unit] [task]`\nExample: `/schedule every 1 hour Check my emails`", { parse_mode: 'Markdown' });
    }

    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    const prompt = match[3];
    const userId = ctx.from!.id.toString();

    const nextRun = scheduler.calculateNextRun(unit, value);
    await memory.addSchedule(userId, prompt, unit, value, nextRun);

    await ctx.reply(`✅ *Scheduled!*\n\nTask: \`${prompt}\`\nRepeat: every ${value} ${unit}(s)\nNext Run: \`${nextRun}\``, { parse_mode: 'Markdown' });
});

bot.command('schedules', async (ctx) => {
    const list = await memory.getSchedules();
    if (list.length === 0) return ctx.reply("No active schedules.");

    let response = "📂 *Active Schedules*:\n\n";
    list.forEach((s: any) => {
        response += `ID: \`${s.id}\` | \`${s.prompt}\`\nEvery ${s.interval_value} ${s.interval_type}s\nNext: ${s.next_run}\n\n`;
    });
    ctx.reply(response, { parse_mode: 'Markdown' });
});

bot.command('unschedule', async (ctx) => {
    const id = parseInt(ctx.match || '');
    if (isNaN(id)) return ctx.reply("Usage: /unschedule [id]");
    await memory.removeSchedule(id);
    ctx.reply(`✅ Schedule \`${id}\` removed.`);
});

bot.command('auth', async (ctx) => {
    try {
        const url = await googleService.getAuthUrl();
        await ctx.reply(`🔗 *Authorize AmmarClaw*\n\n1. Click the link below\n2. Sign in with Google\n3. Copy the code provided\n4. Paste the code here in the chat.\n\n[Click here to authorize](${url})`, { parse_mode: 'Markdown' });
    } catch (error: any) {
        await ctx.reply(`❌ Failed to get auth URL: ${error.message}`);
    }
});

bot.command('status', (ctx) => {
    const status = mcpService.getStatus();
    const waStatus = whatsappService.getStatus();
    const nativeCount = registry.getNativeToolsCount();
    const total = nativeCount + status.toolCount;
    ctx.reply(
        `✅ AmmarClaw is running in *Unlimited* mode.\n\n` +
        `📦 *Code Version*: V2.0\n` +
        `🔌 *MCP Status*: ${status.connected ? '✅ Connected' : '❌ Disconnected'} (${status.toolCount} tools)\n` +
        `📱 *WhatsApp*: ${waStatus.enabled ? (waStatus.ready ? '✅ Connected' : '⏳ Waiting/Disconnected') : '❌ Disabled'}\n` +
        `🛠 *Native Tools*: ${nativeCount}\n` +
        `🚀 *Total Tools*: ${total} available`,
        { parse_mode: 'Markdown' }
    );
});

bot.command('whatsapp', async (ctx) => {
    if (!config.WHATSAPP_ENABLED) {
        return ctx.reply("❌ WhatsApp is disabled in your environment configuration.");
    }
    await ctx.reply("⏳ Initializing WhatsApp client... Please wait for the QR code.");
    await whatsappService.start();
});

bot.command('reload', async (ctx) => {
    await ctx.reply("♻️ Reloading MCP tools...");
    const success = await mcpService.reload();
    const status = mcpService.getStatus();
    if (success) {
        await ctx.reply(`✅ MCP Reloaded! ${status.toolCount} tools available.`, { parse_mode: 'Markdown' });
    } else {
        await ctx.reply("❌ MCP Reload failed. Check logs.", { parse_mode: 'Markdown' });
    }
});

bot.command('clear', async (ctx) => {
    await memory.clearHistory();

    try {
        const entries = await fs.readdir(process.cwd(), { withFileTypes: true });
        const keepFiles = [
            'src', 'dist', 'node_modules', 'package.json', 'package-lock.json',
            'tsconfig.json', '.env', '.gitignore', 'README.md', 'SKILL.md',
            'auth.ts', 'client_secret.json', 'token.json', 'memory.db',
            'index.html', 'eslint.config.mjs'
        ];

        for (const entry of entries) {
            if (!keepFiles.includes(entry.name) && !entry.name.startsWith('.')) {
                const fullPath = path.join(process.cwd(), entry.name);
                await fs.rm(fullPath, { recursive: true, force: true });
            }
        }
        await ctx.reply("✨ Conversation history and workspace files have been cleared.");
    } catch (error: any) {
        await ctx.reply(`✨ History cleared, but failed to clean some files: ${error.message}`);
    }
});

bot.command('remove', async (ctx) => {
    await memory.removeAllMemory();
    ctx.reply("⚠️ *CRITICAL RESET COMPLETE*: All messages, facts, and schedules have been wiped from Supabase.", { parse_mode: 'Markdown' });
});


bot.command('end', (ctx) => {
    if (!currentController) {
        return ctx.reply("No task is currently running.");
    }
    currentController.abort();
    currentController = null;
    ctx.reply("🛑 Task has been stopped.");
});

async function downloadFile(fileId: string): Promise<{ data: string, mimeType: string }> {
    const file = await bot.api.getFile(fileId);
    const url = `https://api.telegram.org/file/bot${config.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);

    let mimeType = 'application/octet-stream';
    const ext = file.file_path?.split('.').pop()?.toLowerCase();
    if (['jpg', 'jpeg'].includes(ext!)) mimeType = 'image/jpeg';
    else if (ext === 'png') mimeType = 'image/png';
    else if (ext === 'webp') mimeType = 'image/webp';
    else if (ext === 'mp4') mimeType = 'video/mp4';
    else if (ext === 'mpeg') mimeType = 'video/mpeg';
    else if (ext === 'mp3') mimeType = 'audio/mpeg';
    else if (ext === 'wav') mimeType = 'audio/wav';
    else if (ext === 'pdf') mimeType = 'application/pdf';

    return {
        data: buffer.toString('base64'),
        mimeType
    };
}

async function handleAgentRun(ctx: any, text: string, media?: MediaData[]) {
    const userId = ctx.from.id.toString();

    // 1. Regular Task Logic
    if (currentController) {
        try {
            await ctx.reply("⚠️ Another task is already running. Use /end to stop it first.");
        } catch {}
        return;
    }

    currentController = new AbortController();
    await ctx.replyWithChatAction('typing');

    let processedText = text;
    let autoMode = false;
    if (text.toLowerCase().startsWith('/auto ')) {
        processedText = text.substring(6).trim();
        autoMode = true;
    }

    try {
        const response = await agent.run(userId, processedText, async (name, args, status) => {
            if (status === 'executing') await ctx.reply(`🛠 AI Using Tool [${name}]`);
            if (status === 'completed') await ctx.reply(`✅ AI Used Tool [${name}]`);
            await ctx.replyWithChatAction('typing');
        }, autoMode, currentController.signal, media, async (msg) => {
            await ctx.reply(`🔄 *${msg}*...`, { parse_mode: 'Markdown' });
        });

        if (response && response.trim().length > 0) {
            try {
                await ctx.reply(response, { parse_mode: 'Markdown' });
            } catch {
                await ctx.reply(response); // Fallback to plain text
            }
        }
    } catch (error: any) {
        if (error.name === 'AbortError' || currentController?.signal.aborted) {
            console.log("[Agent] Task aborted.");
        } else {
            console.error("Agent Error:", error);
            await ctx.reply("⚠️ An error occurred while processing your request.");
        }
    } finally {
        currentController = null;
    }
}

// Message Handler
bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;

    // 1. Auth & Approval Commands
    let authCode = '';
    if (text.startsWith('4/') && text.length > 20) {
        authCode = text;
    } else if (text.includes('code=4/')) {
        try { const url = new URL(text); authCode = url.searchParams.get('code') || ''; } catch (_err) { /* ignore */ }
    }

    if (authCode) {
        await ctx.replyWithChatAction('typing');
        try {
            await googleService.exchangeCode(authCode);
            await ctx.reply("✅ *Success!* Google account linked.");
            return;
        } catch (error: any) {
            await ctx.reply(`❌ *Auth Failed*: ${error.message}`);
            return;
        }
    }

    if (text.toLowerCase() === 'approve') {
        const pending = await memory.getPendingAction();
        if (pending) {
            await ctx.reply(`🚀 Executing approved tool: [${pending.name}]...`);
            const response = await agent.executePendingAction(async (name: string, args: any, status: string) => {
                if (status === 'completed') await ctx.reply(`🛠 AI finished tool: [${name}]`);
                await ctx.replyWithChatAction('typing');
            });
            try {
                await ctx.reply(response, { parse_mode: 'Markdown' });
            } catch {
                await ctx.reply(response); // Fallback
            }
            return;
        }
    }

    if (text.toLowerCase() === 'cancel') {
        const pending = await memory.getPendingAction();
        if (pending) { await memory.clearPendingAction(); await ctx.reply("❌ Action cancelled."); return; }
    }

    await handleAgentRun(ctx, text);
});

bot.on(['message:photo', 'message:video', 'message:audio', 'message:document'], async (ctx) => {
    let fileId: string | undefined;
    let text = ctx.message.caption || "Please analyze this file.";

    if (ctx.message.photo) {
        fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    } else if (ctx.message.video) {
        fileId = ctx.message.video.file_id;
    } else if (ctx.message.audio) {
        fileId = ctx.message.audio.file_id;
    } else if (ctx.message.document) {
        fileId = ctx.message.document.file_id;
    }

    if (fileId) {
        try {
            await ctx.replyWithChatAction('typing');
            const media = await downloadFile(fileId);
            await handleAgentRun(ctx, text, [media]);
        } catch (error: any) {
            console.error("Media processing error:", error);
            await ctx.reply(`❌ Failed to process media: ${error.message}`);
        }
    }
});

// Error Handling
bot.catch((err) => {
  console.error("Telegram Bot Error:", err);
});

export { bot };
