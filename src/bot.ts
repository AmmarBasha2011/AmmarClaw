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
import { sendChunks } from './utils/telegram.js';

const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

// Single task lock
let currentController: AbortController | null = null;

// Message buffer for /run command
interface BufferedMessage {
    text?: string;
    media?: MediaData[];
    timestamp: number;
}
const messageBuffer: Map<string, BufferedMessage[]> = new Map();

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
        "🛠 *AmmarClaw V2.3.1 OS Commands*:\n\n" +
        "/auth - Link accounts (Google/YouTube/GitHub)\n" +
        "/auto [task] - Run without manual tool approvals\n" +
        "/mode [plan|thinking|normal] - Switch reasoning mode\n" +
        "/model [Gemma|Gemini|GeminiLite|GitHub|OpenRouter|SiliconFlow|Groq|Puter] - Select specific model\n" +
        "/schedule every [n] [unit] [task] - Automate a task\n" +
        "/schedules - List active automated tasks\n" +
        "/unschedule [id] - Remove a task\n" +
        "/reload - Refresh all authorized MCP connections\n" +
        "/status - System health, tool counts, and version\n" +
        "/clear - Clear history & AI workspace files\n" +
        "/end - Stop current active task\n" +
        "/notreturn - Run task fully autonomously (AI will not ask questions)\n" +
        "/run - Process all buffered messages and files as a single prompt\n" +
        "/remove - WIPE ALL DATABASE MEMORY\n\n" +
        "*Agent Modes*:\n" +
        "• *Plan Mode*: Visual checklist with sub-task progress.\n" +
        "• *Thinking Mode*: Shows AI's raw internal reasoning.\n" +
        "• *Normal Mode*: Balanced speed and precision.\n\n" +
        "Examples:\n" +
        "• `/mode plan build a react landing page` \n" +
        "• `/auto /mode thinking fetch my github stars` \n" +
        "• `/schedule every 1 hour Summarize my Gmail` ",
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
    const nativeCount = registry.getNativeToolsCount();
    const total = nativeCount + status.toolCount;
    ctx.reply(
        `✅ AmmarClaw is running in *Unlimited* mode.\n\n` +
        `📦 *Code Version*: V2.3.1\n` +
        `🔌 *MCP Status*: ${status.connected ? '✅ Connected' : '❌ Disconnected'}\n` +
        `🛠 *MCP Tools*: ${status.toolCount} loaded\n` +
        `🚀 *Total Tools*: ${total} available`,
        { parse_mode: 'Markdown' }
    );
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
    currentController = null; // Re-enabled for immediate task termination feedback and to allow immediate restart
    ctx.reply("🛑 Task has been stopped.");
});

bot.command('run', async (ctx) => {
    const userId = ctx.from!.id.toString();
    const buffer = messageBuffer.get(userId);

    if (!buffer || buffer.length === 0) {
        return ctx.reply("📥 Buffer is empty. Send messages or files first.");
    }

    if (currentController) {
        return ctx.reply("⏳ A task is already running. Please wait or use /end.");
    }

    await ctx.reply("🚀 Processing buffered messages...");

    // Combine all buffered messages
    let combinedText = "";
    const combinedMedia: MediaData[] = [];
    const startTime = buffer[0].timestamp;

    for (const msg of buffer) {
        if (msg.text) combinedText += msg.text + "\n\n";
        if (msg.media) combinedMedia.push(...msg.media);
    }

    messageBuffer.delete(userId);
    await handleAgentRun(ctx, combinedText.trim(), combinedMedia, startTime);
});

async function downloadFile(fileId: string): Promise<{ data: string, mimeType: string, isText: boolean, textContent?: string }> {
    const file = await bot.api.getFile(fileId);
    const url = `https://api.telegram.org/file/bot${config.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);

    let mimeType = 'application/octet-stream';
    let isText = false;
    let textContent: string | undefined;

    const ext = file.file_path?.split('.').pop()?.toLowerCase();
    const textExts = ['txt', 'js', 'ts', 'py', 'json', 'md', 'html', 'css', 'mjs', 'cjs', 'xml', 'yaml', 'yml', 'env'];

    if (['jpg', 'jpeg'].includes(ext!)) mimeType = 'image/jpeg';
    else if (ext === 'png') mimeType = 'image/png';
    else if (ext === 'webp') mimeType = 'image/webp';
    else if (ext === 'mp4') mimeType = 'video/mp4';
    else if (ext === 'mpeg') mimeType = 'video/mpeg';
    else if (ext === 'mp3') mimeType = 'audio/mpeg';
    else if (ext === 'wav') mimeType = 'audio/wav';
    else if (ext === 'pdf') mimeType = 'application/pdf';
    else if (textExts.includes(ext!) || !ext) {
        // Fallback to text if extension is known text type or missing
        isText = true;
        textContent = buffer.toString('utf8');
        mimeType = 'text/plain';
    }

    return {
        data: buffer.toString('base64'),
        mimeType,
        isText,
        textContent
    };
}

async function handleAgentRun(ctx: any, text: string, media?: MediaData[], startTimeOverride?: number) {
    const userId = ctx.from.id.toString();
    const startTime = startTimeOverride || Date.now();

    // 1. Task Lock Logic
    if (currentController) {
        // If a task is already running, we save the message so the active agent can see it in history
        await memory.addMessage('user', text);
        return;
    }

    currentController = new AbortController();
    await ctx.replyWithChatAction('typing');

    let processedText = text;
    let autoMode = false;
    let notReturn = false;
    let mode: 'normal' | 'plan' | 'thinking' = 'normal';
    let modelOverride: 'Gemma' | 'Gemini' | 'GeminiLite' | 'GitHub' | 'OpenRouter' | 'SiliconFlow' | 'Groq' | 'Puter' | undefined;

    // Flexible parsing for /auto, /notreturn, /mode, and /model at start or end
    const autoRegex = /\/auto\b/gi;
    if (autoRegex.test(processedText)) {
        autoMode = true;
        processedText = processedText.replace(autoRegex, '').trim();
    }

    const notReturnRegex = /\/notreturn\b/gi;
    if (notReturnRegex.test(processedText)) {
        notReturn = true;
        autoMode = true; // /notreturn implies autoMode
        processedText = processedText.replace(notReturnRegex, '').trim();
    }

    const modeRegex = /\/mode\s+(normal|plan|thinking)\b/gi;
    const modeMatches = [...processedText.matchAll(modeRegex)];
    if (modeMatches.length > 0) {
        // Take the first valid mode match
        mode = modeMatches[0][1] as any;
        // Remove all occurrences of /mode [mode]
        processedText = processedText.replace(modeRegex, '').trim();
    }

    const modelRegex = /\/model\s+(Gemma|Gemini|GeminiLite|GitHub|OpenRouter|SiliconFlow|Groq|Puter)\b/gi;
    const modelMatches = [...processedText.matchAll(modelRegex)];
    if (modelMatches.length > 0) {
        modelOverride = modelMatches[0][1] as any;
        processedText = processedText.replace(modelRegex, '').trim();
    }

    try {
        // agent.run already adds to memory, so we pass the original text
        // But since we added it manually above, we should adjust agent.run or here.
        // Actually, let's keep agent.run as the source of truth for the START of a task.
        const response = await agent.run(userId, processedText, async (name, args, status) => {
            if (status === 'executing') await ctx.reply(`🛠 AI Using Tool [${name}]`);
            if (status === 'completed') await ctx.reply(`✅ AI Used Tool [${name}]`);
            await ctx.replyWithChatAction('typing');
        }, autoMode, currentController.signal, media, async (msg) => {
            await ctx.reply(`🔄 *${msg}*...`, { parse_mode: 'Markdown' });
        }, mode, async (thoughts) => {
            await sendChunks(ctx, `💡 *AI Thinking*:\n${thoughts}`, { parse_mode: 'Markdown' });
        }, modelOverride, notReturn);

        if (response && response.trim().length > 0) {
            const duration = Math.floor((Date.now() - startTime) / 1000);
            const finalMsg = `${response}\n\n⏱ *Task duration*: ${duration} seconds`;
            await sendChunks(ctx, finalMsg, { parse_mode: 'Markdown' });
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
    const userId = ctx.from!.id.toString();

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
            await sendChunks(ctx, response, { parse_mode: 'Markdown' });
            return;
        }
    }

    if (text.toLowerCase() === 'cancel') {
        const pending = await memory.getPendingAction();
        if (pending) { await memory.clearPendingAction(); await ctx.reply("❌ Action cancelled."); return; }
    }

    // Buffer if not a command and if task not running, or if we want to support multi-part prompts
    if (!text.startsWith('/') && !currentController) {
        const userBuffer = messageBuffer.get(userId) || [];
        userBuffer.push({ text, timestamp: Date.now() });
        messageBuffer.set(userId, userBuffer);
        return ctx.reply("📥 Message buffered. Send more or use /run to start.", { reply_to_message_id: ctx.message.message_id });
    }

    await handleAgentRun(ctx, text);
});

bot.on(['message:photo', 'message:video', 'message:audio', 'message:document'], async (ctx) => {
    let fileId: string | undefined;
    let fileName: string | undefined;
    let text = ctx.message.caption || "Please analyze this file.";

    if (ctx.message.photo) {
        fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    } else if (ctx.message.video) {
        fileId = ctx.message.video.file_id;
    } else if (ctx.message.audio) {
        fileId = ctx.message.audio.file_id;
    } else if (ctx.message.document) {
        fileId = ctx.message.document.file_id;
        fileName = ctx.message.document.file_name;
    }

    if (fileId) {
        try {
            const userId = ctx.from!.id.toString();
            await ctx.replyWithChatAction('typing');
            const download = await downloadFile(fileId);

            let finalPromptText = text;
            let finalMedia: MediaData[] | undefined;

            if (download.isText) {
                finalPromptText = `[File: ${fileName || 'unnamed'}]\n\n${download.textContent}\n\n${text}`;
            } else {
                finalMedia = [{ data: download.data, mimeType: download.mimeType }];
            }

            if (!currentController) {
                const userBuffer = messageBuffer.get(userId) || [];
                userBuffer.push({
                    text: finalPromptText,
                    media: finalMedia,
                    timestamp: Date.now()
                });
                messageBuffer.set(userId, userBuffer);
                return ctx.reply("📥 File buffered. Send more or use /run to start.", { reply_to_message_id: ctx.message.message_id });
            }

            await handleAgentRun(ctx, finalPromptText, finalMedia);
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
