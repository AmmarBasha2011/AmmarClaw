# 🌙 AmmarClaw V2: Personal AI Assistant OS

AmmarClaw is a private, powerful, and persistent AI agent that runs on Telegram, WhatsApp, and a dedicated Web UI. It is designed to act as a personal "Operating System" for your digital life, with native integrations for Google Workspace, GitHub (via MCP), Netlify, and more.

## 🚀 Key Features (V2.0)

*   **Multi-Platform**: Native support for **Telegram**, **WhatsApp**, and a **Web Dashboard**.
*   **Web UI**: A deep-blue, computer-first animated dashboard to chat with the AI, monitor system status, and manage connections.
*   **Upgraded Brain**: Uses **Google Gemini 3 Flash** (Default) for state-of-the-art reasoning and tool use.
*   **Persistent Memory**: Uses **Supabase** (PostgreSQL) to remember every conversation, fact, and schedule permanently.
*   **Model Context Protocol (MCP)**: Powered by **Smithery Connect** to integrate advanced tools dynamically.

## 🛠 Interfaces

### 1. Web Dashboard (Default: http://localhost:8000)
- Real-time system monitoring.
- Integrated AI Chat.
- WhatsApp QR connection interface.
- Debug logs.

### 2. Telegram Bot
- Use `/whatsapp` to link your account.
- Use `/auth` to link Google account.
- Supports automation via `/schedule`.

### 3. WhatsApp
- Chat with your assistant directly from WhatsApp.
- Agent runs in "Auto-mode" for seamless background assistance.

## ⚙️ Environment Variables (.env)

All configuration is handled via environment variables.

| Variable | Description | Default |
| :--- | :--- | :--- |
| `TELEGRAM_ENABLED` | Enable Telegram interface | `false` |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token (Required if TG enabled) | - |
| `TELEGRAM_USER_ID` | Your numeric Telegram ID (Required if TG enabled) | - |
| `WHATSAPP_ENABLED` | Enable WhatsApp integration | `false` |
| `UI_ENABLED` | Enable Web Dashboard | `true` |
| `GEMINI_API_KEYS` | Comma-separated Gemini API Keys | - |
| `GEMINI_PRIMARY_MODEL` | Main Gemini model | `gemini-3-flash-preview` |
| `GEMINI_SECONDARY_MODEL` | Fallback Gemini model | `gemini-3.1-flash-lite-preview` |
| `GROQ_API_KEY` | Groq API Key | - |
| `GROQ_MODEL` | Final fallback model (via Groq) | `llama-3.3-70b-versatile` |
| `SUPABASE_URL` | Supabase Project URL | - |
| `SUPABASE_KEY` | Supabase Service Role Key | - |
| `NETLIFY_AUTH_TOKEN` | Netlify API Token | - |
| `SMITHERY_API_KEY` | Smithery API Key | - |
| `GOOGLE_CREDENTIALS` | Content of `client_secret.json` as JSON string | - |
| `GOOGLE_TOKEN` | Content of `token.json` as JSON string | - |

## 📦 Deployment

### Local / VPS
1.  `git clone https://github.com/AmmarBasha2011/AmmarClaw.git`
2.  `cd AmmarClaw`
3.  `npm install`
4.  `npm run build`
5.  `npm start`

## 📜 License
Private & Confidential. Built for Ammar.
