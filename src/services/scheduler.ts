import { memory } from './memory.js';
import { agent } from '../core/agent.js';
import { bot } from '../bot.js';

export class SchedulerService {
  private interval: NodeJS.Timeout | null = null;

  start() {
    console.log("[Scheduler] Starting check loop...");
    this.interval = setInterval(() => this.checkSchedules(), 10000); // Check every 10s
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
  }

  private async checkSchedules() {
    try {
      const pending = await memory.getPendingSchedules();
      for (const schedule of pending) {
        console.log(`[Scheduler] Triggering task: ${schedule.prompt}`);
        
        // Execute the task
        const response = await agent.run(
            schedule.user_id, 
            schedule.prompt, 
            undefined, 
            true // Auto-mode for scheduled tasks
        );

        // Notify user
        try {
            await bot.api.sendMessage(
                schedule.user_id, 
                `⏰ *Scheduled Task Triggered*\n\nPrompt: \`${schedule.prompt}\`\n\n*Response*:\n${response}`,
                { parse_mode: 'Markdown' }
            );
        } catch (e) {
            console.error("[Scheduler] Failed to notify user:", e);
        }

        // Calculate and update next run
        const nextRun = this.calculateNextRun(schedule.interval_type, schedule.interval_value);
        await memory.updateScheduleRun(schedule.id, nextRun);
      }
    } catch (error) {
      console.error("[Scheduler] Check loop error:", error);
    }
  }

  calculateNextRun(type: string, value: number): string {
    const now = new Date();
    switch (type.toLowerCase()) {
      case 'second':
      case 'seconds':
        now.setSeconds(now.getSeconds() + value);
        break;
      case 'minute':
      case 'minutes':
        now.setMinutes(now.getMinutes() + value);
        break;
      case 'hour':
      case 'hours':
        now.setHours(now.getHours() + value);
        break;
      case 'day':
      case 'days':
        now.setDate(now.getDate() + value);
        break;
      case 'month':
      case 'months':
        now.setMonth(now.getMonth() + value);
        break;
      case 'year':
      case 'years':
        now.setFullYear(now.getFullYear() + value);
        break;
      default:
        now.setHours(now.getHours() + 1); // Default 1 hour
    }
    return now.toISOString().replace('T', ' ').split('.')[0]; // SQLite format
  }
}

export const scheduler = new SchedulerService();
