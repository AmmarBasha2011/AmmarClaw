# 🌙 AmmarClaw V1.25: Personal AI Assistant OS Agent

AmmarClaw is a private, powerful, and persistent AI agent that acts as a personal "Operating System" for your digital life. Built for high-capacity reasoning and advanced system orchestration, it runs on Telegram and leverages the multimodal power of Google Gemini.

## 🚀 Evolution & Versions

*   **V1.0**: Initial release with Supabase memory, GitHub MCP, and basic Google Workspace tools.
*   **V1.1**: Added round-robin Gemini API key support and exhaustive retry logic.
*   **V1.11**: Multi-modal support (Photos/Video/Audio), integrated Supabase/Weather/RSS/Icons8/NPM/Flights MCPs, and native Context7 CLI.
*   **V1.2**: Advanced File Management (Recursive/Dirs), ZIP-based Netlify deployments, and Jina AI DeepSearch fallback.
*   **V1.21**: AI OS Persona, 100k output tokens, 2M input context window, and enhanced workspace cleanup.
*   **V1.25 (Latest)**: Multi-Mode reasoning (Plan/Thinking), 13+ MCP servers, native advanced tools (Calculator, QR, DDG, Wikipedia), and refined sequential fallback logic.

## ✨ Key Capabilities

*   **Persistent Multi-Modal Memory**: Remembers every conversation and can process images, videos, audio clips, and documents.
*   **13+ Integrated MCP Servers**: Native access to GitHub, Supabase, YouTube, PubMed, DuckDuckGo, Weather, RSS, NPM, Flights, and more via Smithery Connect.
*   **Specialized Reasoning Modes**:
    *   **Normal Mode**: Fast and precise task execution.
    *   **Thinking Mode**: AI shares its raw internal reasoning and "Chain of Thought".
    *   **Plan Mode**: AI creates a visual checklist and tracks sub-tasks with progress indicators.
*   **Autonomous Project Orchestration**: Build entire project structures locally and deploy them instantly to Netlify as a directory-level ZIP.
*   **Self-Healing Environment**: Automatically captures and persists Smithery session IDs to `.env` and manages workspace cleanup.
*   **Sequential Intelligence Fallback**:
    1.  **Primary**: Primary Gemini 3 Flash (Exhaustive retry across all 11+ keys).
    2.  **Secondary**: Gemini 3.1 Flash Lite (High efficiency).
    3.  **Tertiary**: Jina AI DeepSearch (Advanced web grounding).
    4.  **Final**: Groq (Llama-based models like `gpt-oss-120b`).

## 🛠 Commands

| Command | Description |
| :--- | :--- |
| `/auth` | Link Google and other Oauth services |
| `/auto [task]` | Run without manual tool approvals |
| `/mode [plan\|thinking\|normal]` | Switch agent reasoning mode for the current task |
| `/schedule every [n] [unit] [task]` | Automate a task |
| `/status` | System report, total tool count (Native + MCP), and version info |
| `/clear` | Clear history AND wipe AI-created workspace files |
| `/reload` | Refresh all authorized MCP connections |
| `/end` | Stop the current active task |

## 📦 Tech Stack

*   **Brain**: Google Gemini 3 Flash (Primary), Jina DeepSearch, Groq (Llama 3.3).
*   **Memory**: Supabase (Postgres) + local file persistence.
*   **Interface**: Telegram Bot API via `grammy`.
*   **Tools**: Smithery Connect (MCP), Python 3.12 (Data analysis/Charts), `ctx7` CLI.

## ⚙️ Setup

Refer to the source code for the full list of required environment variables. Key requirements include `TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEYS`, `SMITHERY_API_KEY`, and `JINA_API_KEY`.

---
Private & Confidential. Built for Ammar.
