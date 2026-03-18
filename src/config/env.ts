import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, "Bot token is required"),
  TELEGRAM_USER_ID: z.string().min(1, "User ID is required"),
  GROQ_API_KEY: z.string().optional(),
  GEMINI_API_KEYS: z.string().min(1, "Gemini API keys are required").transform(s => s.split(',').map(k => k.trim())),
  NETLIFY_AUTH_TOKEN: z.string().min(1, "Netlify token is required"),
  GITHUB_TOKEN: z.string().min(1, "GitHub token is required"),
  SUPABASE_URL: z.string().min(1, "Supabase URL is required"),
  SUPABASE_KEY: z.string().min(1, "Supabase Key is required"),
  DB_PATH: z.string().default('./memory.db'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:", parsed.error.format());
  process.exit(1);
}

export const config = parsed.data;
