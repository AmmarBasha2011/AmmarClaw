import dotenv from 'dotenv';
import { z } from 'zod';

const envPath = process.env.DOTENV_CONFIG_PATH || '.env';
dotenv.config({ path: envPath });

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, "Bot token is required"),
  TELEGRAM_USER_ID: z.string().min(1, "User ID is required"),
  GROQ_API_KEY: z.string().optional(),
  GEMINI_API_KEYS: z.string().min(1, "Gemini API keys are required").transform(s => s.split(',').map(k => k.trim())),
  NETLIFY_AUTH_TOKEN: z.string().min(1, "Netlify token is required"),
  GITHUB_TOKEN: z.string().optional(),
  SUPABASE_URL: z.string().min(1, "Supabase URL is required"),
  SUPABASE_KEY: z.string().min(1, "Supabase Key is required"),
  DB_PATH: z.string().default('./memory.db'),
  SMITHERY_API_KEY: z.string().min(1, "Smithery API Key is required"),
  GITHUB_CONNECTION_ID: z.string().optional(),
  CONTEXT7_API_KEY: z.string().optional(),
  SUPABASE_CONNECTION_ID: z.string().optional(),
  WEATHER_CONNECTION_ID: z.string().optional(),
  RSS_CONNECTION_ID: z.string().optional(),
  ICONS8_CONNECTION_ID: z.string().optional(),
  NPM_CONNECTION_ID: z.string().optional(),
  FLIGHT_CONNECTION_ID: z.string().optional(),
  PYTHON_CONNECTION_ID: z.string().optional(),
  GOOGLE_SCHOLAR_CONNECTION_ID: z.string().optional(),
  YOUTUBE_CONNECTION_ID: z.string().optional(),
  PUBMED_CONNECTION_ID: z.string().optional(),
  DDG_CONNECTION_ID: z.string().optional(),
  WIKI_CONNECTION_ID: z.string().optional(),
  GMAIL_CONNECTION_ID: z.string().optional(),
  EXCALIDRAW_CONNECTION_ID: z.string().optional(),
  CANVA_CONNECTION_ID: z.string().optional(),
  MAPS_CONNECTION_ID: z.string().optional(),
  CHARTS_CONNECTION_ID: z.string().optional(),
  PAYPAL_CONNECTION_ID: z.string().optional(),
  EXCEL_CONNECTION_ID: z.string().optional(),
  JULES_API_KEY: z.string().optional(),
  STITCH_API_KEY: z.string().optional(),
  KOYEB_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  BRAVE_CONNECTION_ID: z.string().optional(),
  NOTION_CONNECTION_ID: z.string().optional(),
  SLACK_CONNECTION_ID: z.string().optional(),
  UPTIMEROBOT_API_KEY: z.string().optional(),
  UPTIMEROBOT_CONNECTION_ID: z.string().optional(),
  INEX_CONNECTION_ID: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:", parsed.error.format());
  process.exit(1);
}

export const config = parsed.data;
