---
title: AmmarClaw V2
emoji: 🌙
colorFrom: indigo
colorTo: blue
sdk: docker
app_port: 8000
pinned: true
---

# 🌙 AmmarClaw V2: Personal AI Assistant OS

AmmarClaw is a private, powerful, and persistent AI agent that runs on Telegram and WhatsApp. It is designed to act as a personal "Operating System" for your digital life, with native integrations for Google Workspace, GitHub (via MCP), Netlify, and more.

## 🚀 Key Features (V2.0)

*   **Multi-Platform**: Native support for **Telegram** and **WhatsApp**. Connect WhatsApp via QR code directly in Telegram.
*   **Upgraded Brain**: Uses **Google Gemini 2.0 Flash** for state-of-the-art reasoning and tool use.
*   **Persistent Memory**: Uses **Supabase** (PostgreSQL) to remember every conversation, fact, and schedule permanently.
*   **Model Context Protocol (MCP)**: Powered by **Smithery Connect** to integrate advanced tools dynamically (GitHub, Supabase, Weather, etc.).
*   **Cloud Ready**: Optimized for **Hugging Face Spaces** and **Koyeb**.

## 🛠 Commands (Telegram)

| Command | Description |
| :--- | :--- |
| `/auth` | Link your Google account |
| `/whatsapp` | **NEW**: Initialize WhatsApp connection (shows QR code) |
| `/auto [task]` | Run a task without requiring manual tool approvals |
| `/schedule every [n] [unit] [task]` | Automate a task |
| `/reload` | Reload MCP tools from Smithery Connect |
| `/status` | Check version, MCP, and WhatsApp status |
| `/clear` | Clear conversation history and local workspace |
| `/end` | Stop the current active task |

## ⚙️ Environment Variables (.env)

All configuration is now handled via environment variables. Files like `client_secret.json` and `token.json` are prioritized from ENV if present.

| Variable | Description |
| :--- | :--- |
| `TELEGRAM_BOT_TOKEN` | Your Telegram Bot Token |
| `TELEGRAM_USER_ID` | Your numeric Telegram ID |
| `GEMINI_API_KEYS` | Comma-separated Gemini API Keys |
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_KEY` | Supabase Service Role Key |
| `SMITHERY_API_KEY` | Smithery API Key |
| `WHATSAPP_ENABLED` | Set to `true` to enable WhatsApp integration |
| `GOOGLE_CREDENTIALS` | (Optional) Content of `client_secret.json` as a single-line string |
| `GOOGLE_TOKEN` | (Optional) Content of `token.json` as a single-line string |

## 📦 Deployment

### 1. Hugging Face Spaces (Recommended)
1.  Create a new **Space** on Hugging Face.
2.  Select **Docker** as the SDK.
3.  In the Space settings, add all required **Variables and Secrets**.
4.  The `app_port` is automatically set to `8000` via the `README.md` metadata.
5.  AmmarClaw will automatically clone the repo and start.

### 2. Koyeb / VPS
```bash
git clone https://github.com/AmmarBasha2011/AmmarClaw.git
cd AmmarClaw
npm install
npm run build
npm start
```

## 📜 License
Private & Confidential. Built for Ammar.
