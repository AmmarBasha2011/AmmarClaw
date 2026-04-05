# 🌙 AmmarClaw V2.3.2: Personal AI Assistant OS Agent

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
*   **V2.1.0**: Expanded Orchestration. Added UptimeRobot and Inex Docs MCP integrations. Streamlined fallback chain (purged GitHub/OpenRouter).
*   **V2.2.0**: Multi-Brain Evolution. Added SiliconFlow (DeepSeek-R1) and upgraded Groq fallback (GPT-OSS-120B).
*   **V2.2.1**: Quota Optimization. Reduced fallback history depth to mitigate Gemini Lite rate limits.
*   **V2.2.2**: Maximum Intelligence. Restored GitHub and OpenRouter providers. Complete 7-tier sequential fallback chain.
*   **V2.3.1**: Advanced Orchestration. Added Gemma 4 31B with automated rate limiting, context caching, and 8-tier fallback.
*   **V2.3.2 (Latest)**: Quota Resiliency. Enhanced global rate limiting, automated 429 recovery logic, and refined MCP authentication.

## ✨ Key Capabilities

*   **🧠 High-Capacity Reasoning**: Advanced sequential fallback architecture across 8 tiers of intelligence.
*   **🗄️ Multi-Modal Memory**: Persistent history and file recall across all sessions, powered by Supabase.
*   **🛠️ Massive Toolset**: 250+ tools available via native integration and 25+ MCP servers.
*   **📈 Smart Rate Limiting**: Intelligent RPM/TPM management and automated retry-on-quota logic.
*   **🚀 Autonomous Dev**: Build, test, zip, and deploy entire projects to Netlify/Koyeb.
*   **⚡ Context Caching**: Automatic optimization for long prompts and tool definitions to save tokens.

## 🔄 Sequential Intelligence Fallback (8 Tiers)

AmmarClaw employs a unique cascading fallback system to ensure 100% uptime and bypass rate limits. If a provider fails or hits a quota, the agent instantly switches to the next level:

1.  **Tier 1: Gemma 4 31B**
    *   *Role*: Primary Orchestrator.
    *   *Specs*: 31B parameters, 256k context window.
    *   *Limits*: 10 RPM / 250k TPM (Strictly enforced by local RateLimiter).
2.  **Tier 2: Gemini 3 Flash**
    *   *Role*: High-Speed Performance.
    *   *Logic*: Round-robin rotation across 28+ API keys with intelligent cooldowns.
3.  **Tier 3: Gemini 3.1 Flash Lite**
    *   *Role*: Efficiency Fallback.
    *   *Optimization*: Automatically truncates history to 20 messages for quota safety.
4.  **Tier 4: GitHub Models (GPT-4o)**
    *   *Role*: Precision Reasoning.
    *   *Usage*: Azure Inference endpoint for stable GPT-4o access.
5.  **Tier 5: OpenRouter (MiniMax M2.5)**
    *   *Role*: Global Fallback.
    *   *Access*: Unified endpoint for diverse model routing.
6.  **Tier 6: SiliconFlow (DeepSeek-R1)**
    *   *Role*: Specialized Deep Reasoning.
    *   *Model*: DeepSeek-R1 for complex logical chains.
7.  **Tier 7: Groq Cloud (GPT-OSS-120B)**
    *   *Role*: Ultra-Fast Execution.
    *   *Speed*: Sub-second response times for final contingencies.
8.  **Final Tier: Puter.js (Claude 3.5 Sonnet)**
    *   *Role*: Terminal Fail-safe.
    *   *Reliability*: Provides a reliable end-of-chain response.

## 🛠 Commands deep Dive

### Core Interaction
*   `/run`: The most powerful command. Send multiple messages, upload files (PDF, Code, Images), and then use `/run` to process everything as a single complex task.
*   `/auto [task]`: Enables autonomous mode. The AI will not ask for permission to use sensitive tools (like writing files or deploying).
*   `/notreturn`: Fully silent mode. The AI will execute the entire task without any intermediate messages, only reporting the final result.

### Reasoning Modes
*   `/mode plan`: The AI generates a visual checklist of sub-tasks and updates their status (✅/⏳) as it works.
*   `/mode thinking`: Displays the AI's "Chain of Thought" and internal reasoning process.
*   `/mode normal`: Standard conversational interface for direct tasks.

### System Management
*   `/status`: Comprehensive health report. Shows connectivity for all 25+ MCPs, total tool count (250+), and active version.
*   `/reload`: Refresh all Smithery session IDs and hot-reload tool definitions without restarting the bot.
*   `/clear`: Clean up the workspace. Deletes all AI-generated files and clears conversation history.

## 🔌 Integrated MCP Ecosystem

AmmarClaw acts as a central hub for the Model Context Protocol (MCP), integrating:
*   **Infrastructure**: `UptimeRobot` for site monitoring and incident management.
*   **Knowledge**: `Inex Docs`, `DevDocs`, `Wikipedia`, `Google Scholar`, and `PubMed`.
*   **Development**: `GitHub` (Full repo access), `Supabase` (DB management), `Koyeb` (Deployments), `Netlify` (Web hosting).
*   **Productivity**: `Gmail`, `Google Maps`, `Canva`, `PayPal`, `Notion`, `Slack`, and `Excel`.
*   **Utilities**: `Python` (Data analysis/Matplotlib), `RSS Reader`, `DuckDuckGo`, and `Brave Search`.

## 📈 Quota & Rate Limit Resiliency

V2.3.2 introduces a project-wide **Resiliency Engine**:
1.  **Global RateLimiter**: Tracks RPM/TPM across all models to stay within free-tier boundaries.
2.  **Smart 429 Recovery**: If all providers hit a quota, AmmarClaw notifies the user ("Please Wait minute..."), pauses for 60 seconds, and automatically resumes the task.
3.  **Implicit Caching**: Tool definitions are injected via `systemInstruction` to leverage Google's automatic context caching for payloads > 4,096 tokens, reducing token costs by up to 90%.

## 📦 Tech Stack & Infrastructure

*   **Core**: TypeScript, Node.js 22.
*   **Deployment**: Koyeb (Nixpacks) with system-level Chromium.
*   **Database**: Supabase (Postgres) + Better-SQLite3.
*   **Intelligence**: Google AI SDK, OpenAI SDK, Groq SDK, SiliconFlow API.
*   **Verification**: Comprehensive Playwright screenshotting and automated test suite.

## ⚙️ Deployment & Setup

1.  **Environment**: Populate `.env` with `GEMINI_API_KEYS` (comma-separated), `TELEGRAM_BOT_TOKEN`, `SUPABASE_URL`, `SUPABASE_KEY`, and `SMITHERY_API_KEY`.
2.  **Infrastructure**: Deploy on Koyeb using the provided `nixpacks.toml` for automatic dependency management.
3.  **Authentication**: Run `/auth` to link your Google workspace.

---
Private & Confidential. Built for Ammar.
