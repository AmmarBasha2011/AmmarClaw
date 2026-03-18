import { Bot } from 'grammy';
import { config } from './config/env.js';
import { agent } from './core/agent.js';
import { googleService } from './services/google.js';
import { memory } from './services/memory.js';
import { scheduler } from './services/scheduler.js';

const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

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
    memory.addSchedule(userId, prompt, unit, value, nextRun);

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

bot.command('unschedule', (ctx) => {
    const id = parseInt(ctx.match || '');
    if (isNaN(id)) return ctx.reply("Usage: /unschedule [id]");
    memory.removeSchedule(id);
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
    ctx.reply("✅ AmmarClaw is running in *Unlimited* mode.", { parse_mode: 'Markdown' });
});

bot.command('clear', async (ctx) => {
    await memory.clearHistory();
    ctx.reply("✨ Conversation history has been cleared.");
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

// Message Handler
bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    const userId = ctx.from.id.toString();

    // 1. Auth & Approval Commands
    let authCode = '';
    if (text.startsWith('4/') && text.length > 20) {
        authCode = text;
    } else if (text.includes('code=4/')) {
        try { const url = new URL(text); authCode = url.searchParams.get('code') || ''; } catch (err) { /* ignore */ }
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

    // 2. Regular Task Logic
    if (currentController) {
        return ctx.reply("⚠️ Another task is already running. Use /end to stop it first.");
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
            if (status === 'executing') await ctx.reply(`🛠 AI using tool: [${name}]`);
            await ctx.replyWithChatAction('typing');
        }, autoMode, currentController.signal);
        
        try {
            await ctx.reply(response, { parse_mode: 'Markdown' });
        } catch {
            await ctx.reply(response); // Fallback to plain text
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
});

// Error Handling
bot.catch((err) => {
  console.error("Telegram Bot Error:", err);
});

export { bot };
