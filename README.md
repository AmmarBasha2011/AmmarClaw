# 🌙 AmmarClaw V2.1.0: Personal AI Assistant OS Agent

AmmarClaw is a private, powerful, and persistent AI agent that acts as a personal "Operating System" for your digital life. Built for high-capacity reasoning and advanced system orchestration, it runs on Telegram and leverages the multimodal power of Google Gemini.

## 🚀 Evolution & Versions

*   **V1.0**: Initial release with Supabase memory, GitHub MCP, and basic Google Workspace tools.
*   **V1.1**: Added round-robin Gemini API key support and exhaustive retry logic.
*   **V1.11**: Multi-modal support (Photos/Video/Audio), integrated Supabase/Weather/RSS/Icons8/NPM/Flights MCPs, and native Context7 CLI.
*   **V1.2**: Advanced File Management (Recursive/Dirs), ZIP-based Netlify deployments, and Jina AI DeepSearch fallback.
*   **V1.21**: AI OS Persona, 100k output tokens, 2M input context window, and enhanced workspace cleanup.
*   **V1.3**: Integrated 20+ MCP servers (Gmail, Canva, Maps, PayPal, etc.), fixed duplicate tool errors, added Jules/Stitch/Koyeb native toolsets, and multi-modal file extraction loop.
*   **V1.31**: Website Screenshots tool (Playwright) and Autonomous "/notreturn" Mode for silent task completion.
*   **V1.321**: Fixed Koyeb API endpoint (switched to app.koyeb.com), and unified version across all system strings.
*   **V1.4.3**: Massive Intelligence Upgrade. Sequential LLM fallback chain (Gemini -> GitHub GPT-4o -> OpenRouter -> Puter Claude -> Groq). Added Image (Imagen 3) and Audio generation tools.
*   **V2.0.0**: Core Refactor. Solved Gemini API Errors (Thought Signature & Function Grouping), improved Koyeb stability, and added a comprehensive test suite.
*   **V2.1.0 (Latest)**: Expanded Orchestration. Added UptimeRobot and Inex Docs MCP integrations. Streamlined fallback chain (purged GitHub/OpenRouter).

## ✨ Key Capabilities

*   **Persistent Multi-Modal Memory**: Remembers every conversation and can process images, videos, audio clips, and documents.
*   **25+ Integrated MCP Servers**: Native access to UptimeRobot, Inex Docs, Gmail, Canva, GitHub, Supabase, YouTube, Google Maps, PayPal, PubMed, DuckDuckGo, Weather, RSS, NPM, Flights, and more via Smithery Connect.
*   **Specialized Reasoning Modes**:
    *   **Normal Mode**: Fast and precise task execution.
    *   **Thinking Mode**: AI shares its raw internal reasoning and "Chain of Thought".
    *   **Plan Mode**: AI creates a visual checklist and tracks sub-tasks with progress indicators.
*   **Autonomous Project Orchestration**: Build entire project structures locally, zip/unzip them, and deploy instantly to Netlify as a directory-level ZIP.
*   **Self-Healing Environment**: Automatically captures and persists Smithery session IDs to `.env` and manages workspace cleanup.
*   **Sequential Intelligence Fallback**:
    1.  **Primary**: Gemini 3 Flash (Exhaustive retry across all keys).
    2.  **Secondary**: Gemini 3.1 Flash Lite.
    3.  **Third**: Puter.js (Claude 3.5 Sonnet).
    4.  **Final**: Groq (`llama-3.3-70b-versatile` or `openai/gpt-oss-120b`).

## 🛠 Commands

| Command | Description |
| :--- | :--- |
| `/auth` | Link Google and other OAuth services |
| `/auto [task]` | Run without manual tool approvals |
| `/mode [plan\|thinking\|normal]` | Switch agent reasoning mode for the current task |
| `/schedule every [n] [unit] [task]` | Automate a task |
| `/status` | System report, tool counts, and version info |
| `/clear` | Clear history AND wipe AI-created workspace files |
| `/reload` | Refresh all authorized MCP connections |
| `/end` | Stop the current active task |
| `/notreturn` | Fully autonomous mode (silent task completion) |
| `/run` | Process all buffered messages/files as a single task |

## 📦 Tech Stack

*   **Brain**: Google Gemini 3 Flash, Gemini 3.1 Flash Lite, Groq Cloud.
*   **Memory**: Supabase (Postgres) + local file persistence.
*   **Interface**: Telegram Bot API via `grammy`.
*   **Tools**: Smithery Connect (MCP), Python 3.12 (Data analysis/Charts/QR), `ctx7` CLI.

## ⚙️ Setup

Refer to the source code for the full list of required environment variables. Key requirements include `TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEYS`, and `SMITHERY_API_KEY`.

---
Private & Confidential. Built for Ammar.
