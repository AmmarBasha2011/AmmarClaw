import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_USER_ID: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  GEMINI_API_KEYS: z.string().min(1, "Gemini API keys are required").transform(s => s.split(',').map(k => k.trim())),
  NETLIFY_AUTH_TOKEN: z.string().min(1, "Netlify token is required"),
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
  JINA_API_KEY: z.string().optional(),
  GOOGLE_CREDENTIALS: z.string().optional(),
  GOOGLE_TOKEN: z.string().optional(),
  WHATSAPP_ENABLED: z.string().optional().transform(v => v === 'true'),
  TELEGRAM_ENABLED: z.string().optional().transform(v => v === 'true').default(false),
  UI_ENABLED: z.string().optional().transform(v => v !== 'false').default(true),
  GEMINI_PRIMARY_MODEL: z.string().default('gemini-3-flash-preview'),
  GEMINI_SECONDARY_MODEL: z.string().default('gemini-3.1-flash-lite-preview'),
  GROQ_MODEL: z.string().default('llama-3.3-70b-versatile'),
}).refine(data => {
  // Ensure at least one way of access is enabled
  return data.TELEGRAM_ENABLED || data.WHATSAPP_ENABLED || data.UI_ENABLED;
}, {
  message: "❌ At least one interface (Telegram, WhatsApp, or UI) must be enabled."
}).refine(data => {
    // If Telegram is enabled, credentials are required
    if (data.TELEGRAM_ENABLED) {
        return !!data.TELEGRAM_BOT_TOKEN && !!data.TELEGRAM_USER_ID;
    }
    return true;
}, {
    message: "❌ TELEGRAM_BOT_TOKEN and TELEGRAM_USER_ID are required when TELEGRAM_ENABLED is true."
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
