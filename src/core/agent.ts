import { registry } from '../tools/index.js';
import { LLMProvider, ChatMessage, MediaData, geminiProvider, gemmaProvider, githubModelsProvider, openRouterWebProvider, siliconFlowProvider, puterProvider, groqProvider } from '../services/llm/index.js';
import { MemoryService, memory } from '../services/memory.js';

export type AgentMode = 'normal' | 'plan' | 'thinking';

export class Agent {
  constructor(
    private gemmaLLM: LLMProvider,
    private llm: LLMProvider, 
    private githubLLM: LLMProvider,
    private openRouterLLM: LLMProvider,
    private siliconFlowLLM: LLMProvider,
    private fallbackLLM: LLMProvider,
    private puterLLM: LLMProvider,
    private memory: MemoryService
  ) {}

  async run(
    userId: string, 
    input: string, 
    onToolCall?: (name: string, args: any, status: 'executing' | 'pending' | 'completed', result?: string) => Promise<void>,
    autoMode: boolean = false,
    signal?: AbortSignal,
    media?: MediaData[],
    onFallback?: (provider: string) => Promise<void>,
    mode: AgentMode = 'normal',
    onThinking?: (thoughts: string) => Promise<void>,
    modelOverride?: 'Gemma' | 'Gemini' | 'GeminiLite' | 'GitHub' | 'OpenRouter' | 'SiliconFlow' | 'Groq' | 'Puter',
    notReturn?: boolean
  ): Promise<string> {
    let currentPlan: { task: string, completed: boolean }[] = [];

    const now = new Date().toLocaleString('en-US', { timeZone: 'UTC' });
    let processedInput = `[System Time: ${now} UTC]\n\n${input}`;

    if (mode === 'plan') {
        processedInput = `SYSTEM: You are in PLAN MODE. First, analyze the task and create a numbered list of sub-tasks needed to complete it. Then start executing them one by one.\n\nUSER INPUT: ${processedInput}`;
    } else if (mode === 'thinking') {
        processedInput = `SYSTEM: You are in THINKING MODE. Before taking any action or giving a final response, share your detailed step-by-step internal reasoning.\n\nUSER INPUT: ${processedInput}`;
    }

    if (notReturn) {
        processedInput = `SYSTEM: [NOT RETURN MODE ENABLED] You are in a fully autonomous mode. You MUST NOT ask the user any questions, seek clarification, or wait for input until you have fully completed the entire task. If you encounter an obstacle, use your tools to solve it or find an alternative route. Your only response should be the final completed result or a terminal failure report if all tools/attempts failed. DO NOT ASK ANYTHING. JUST DO.\n\n${processedInput}`;
    }

    // 1. Save User Message
    await this.memory.addMessage('user', processedInput);

    let loopCount = 0;
    while (true) {
      loopCount++;
      if (signal?.aborted) {
          console.log("[Agent] Task aborted by user.");
          return "🛑 Task was ended by user.";
      }

      // 2. Get History from DB
      const historyDepth = 40;
      const dbHistory = await this.memory.getHistory(historyDepth);
      const chatHistory: ChatMessage[] = dbHistory.map(m => ({
        role: m.role as 'user' | 'assistant' | 'function',
        content: m.content,
        name: m.name,
      }));

      // Helper to trim history for non-Gemini models
      const getFallbackHistory = async (limit: number = 15) => {
          const fallbackDb = await this.memory.getHistory(limit);
          return fallbackDb.map(m => ({
              role: m.role as 'user' | 'assistant' | 'function',
              content: m.content,
              name: m.name,
          }));
      };

      // Attach media to the LAST user message if it's the first turn
      if (loopCount === 1 && media && media.length > 0) {
          const lastUserMsg = [...chatHistory].reverse().find(m => m.role === 'user');
          if (lastUserMsg) {
              lastUserMsg.media = media;
          }
      }

      // 3. Call LLM
      let response: any;
      try {
        if (modelOverride) {
            console.log(`[Agent] Turn ${loopCount}: Calling ${modelOverride} (Override)...`);
            let targetModel = "";
            let provider = this.llm;
            let targetHistory = chatHistory;

            if (modelOverride === 'Gemma') {
                provider = this.gemmaLLM; targetModel = 'gemma-4-31b-it';
                targetHistory = chatHistory.length > 20 ? chatHistory.slice(-20) : chatHistory;
            }
            else if (modelOverride === 'Gemini') targetModel = 'gemini-3-flash-preview';
            else if (modelOverride === 'GeminiLite') targetModel = 'gemini-3.1-flash-lite-preview';
            else if (modelOverride === 'GitHub') {
                provider = this.githubLLM; targetModel = 'gpt-4o';
                targetHistory = await getFallbackHistory(15);
            }
            else if (modelOverride === 'OpenRouter') {
                provider = this.openRouterLLM; targetModel = 'minimax/minimax-m2.5:free';
                targetHistory = await getFallbackHistory(15);
            }
            else if (modelOverride === 'SiliconFlow') {
                provider = this.siliconFlowLLM; targetModel = 'deepseek-ai/DeepSeek-R1';
                targetHistory = await getFallbackHistory(15);
            }
            else if (modelOverride === 'Groq') {
                provider = this.fallbackLLM; targetModel = 'openai/gpt-oss-120b';
                targetHistory = await getFallbackHistory(10);
            }
            else if (modelOverride === 'Puter') {
                provider = this.puterLLM; targetModel = 'anthropic/claude-3.5-sonnet';
                targetHistory = await getFallbackHistory(10);
            }

            response = await provider.generate(targetHistory, targetModel, signal);
        } else {
            console.log(`[Agent] Turn ${loopCount}: Calling Gemma (Initial)...`);

            if (mode === 'plan' && loopCount > 1 && currentPlan.length > 0) {
                const planStr = currentPlan.map((t, i) => `${i+1}. ${t.task} [${t.completed ? '✅' : '⏳'}]`).join('\n');
                const planMsg = `SYSTEM: Current Plan progress:\n${planStr}\n\nContinue executing the plan.`;
                chatHistory.push({ role: 'user', content: planMsg });
            }

            try {
                const gemmaHistory = chatHistory.length > 20 ? chatHistory.slice(-20) : chatHistory;
                response = await this.gemmaLLM.generate(gemmaHistory, "gemma-4-31b-it", signal);
            } catch (gemmaError: any) {
                console.warn("[Agent] Gemma failed. Trying Gemini Primary...");
                response = await this.llm.generate(chatHistory, "gemini-3-flash-preview", signal);
            }
        }
      } catch (error: any) {
        if (modelOverride) throw error;
        console.warn("[Agent] Gemini Primary failed. Trying Gemini Lite...");
        if (onFallback) await onFallback("Switching to smaller model");

        try {
            // Optimize Gemini Lite history to stay within free tier limits (250k tokens/min)
            const liteHistory = chatHistory.length > 20 ? chatHistory.slice(-20) : chatHistory;
            response = await this.llm.generate(liteHistory, "gemini-3.1-flash-lite-preview", signal);
        } catch (liteError: any) {
            console.error("[Agent] Gemini Lite failed. Switching to GitHub Models...");
            if (onFallback) await onFallback("Switching to GitHub Models (GPT-4o)");

            try {
                const fallbackHistory = await getFallbackHistory(15);
                response = await this.githubLLM.generate(fallbackHistory, "gpt-4o", signal);
            } catch (githubError: any) {
                console.error("[Agent] GitHub Models failed. Switching to OpenRouter...");
                if (onFallback) await onFallback("Switching to OpenRouter (MiniMax)");

                try {
                    const fallbackHistory = await getFallbackHistory(15);
                    response = await this.openRouterLLM.generate(fallbackHistory, "minimax/minimax-m2.5:free", signal);
                } catch (orError: any) {
                    console.error("[Agent] OpenRouter failed. Switching to SiliconFlow...");
                    if (onFallback) await onFallback("Switching to SiliconFlow (DeepSeek-R1)");

                    try {
                        const fallbackHistory = await getFallbackHistory(15);
                        response = await this.siliconFlowLLM.generate(fallbackHistory, "deepseek-ai/DeepSeek-R1", signal);
                    } catch (sfError: any) {
                        console.error("[Agent] SiliconFlow failed. Switching to Groq fallback...");
                        if (onFallback) await onFallback("Switching to Groq Cloud");

                        try {
                            const fallbackHistory = await getFallbackHistory(10);
                            response = await this.fallbackLLM.generate(fallbackHistory, "openai/gpt-oss-120b", signal);
                        } catch (fallbackError: any) {
                            console.error("[Agent] Groq failed. Switching to Puter final fallback...");
                            if (onFallback) await onFallback("Switching to Puter.js (Claude)");

                            try {
                                const fallbackHistory = await getFallbackHistory(10);
                                response = await this.puterLLM.generate(fallbackHistory, "anthropic/claude-3.5-sonnet", signal);
                            } catch (puterError: any) {
                                console.error("[Agent] All LLMs failed.", puterError);
                        let delayStr = "some";
                        let delayNum = 60;
                                if (error.message.startsWith('QUOTA_EXCEEDED:')) {
                            delayStr = error.message.split(':')[1];
                            delayNum = parseInt(delayStr);
                                } else {
                                    const delayMatch = error.message.match(/retry in (\d+)s/);
                            if (delayMatch) {
                                delayStr = delayMatch[1];
                                delayNum = parseInt(delayStr);
                            }
                                }

                        if (onFallback) await onFallback(`Quota reached. Please Wait ${delayStr} seconds...`);
                        await new Promise(resolve => setTimeout(resolve, delayNum * 1000));
                        loopCount--; // Retry the same turn
                        continue;
                            }
                        }
                    }
                }
            }
        }
      }

      // Mode Specific logic
      if (response.rawParts) {
          const thoughts = response.rawParts.find((p: any) => (p as any).thought)?.thought || response.text;

          if (mode === 'thinking' && onThinking) {
              await onThinking(thoughts);
          }

          if (mode === 'plan' && currentPlan.length === 0) {
              const planSource = `${response.text}\n${thoughts}`;
              const lines = planSource.split('\n');
              const planLines = lines.filter((l: string) => /^\d+\./.test(l.trim()));

              if (planLines.length > 0) {
                  currentPlan = planLines.map((l: string) => ({ task: l.replace(/^\d+\.\s*/, '').trim(), completed: false }));
                  if (onThinking) await onThinking(`📋 *Plan Created*:\n\n` + currentPlan.map((t, i) => `${i+1}. ${t.task} ⏳`).join('\n'));
              }
          }
      }

      // 4. Handle Response
      if (response.toolCalls && response.toolCalls.length > 0) {
        const toolCallMsg = JSON.stringify({
            type: 'tool_call',
            calls: response.toolCalls,
            rawParts: response.rawParts
        });
        await this.memory.addMessage('assistant', toolCallMsg);

        for (const call of response.toolCalls) {
          if (signal?.aborted) break;
          const tool = registry.get(call.name);
          
          if (tool?.requiresApproval && !autoMode) {
              await this.memory.setPendingAction(call.name, call.args);
              if (onToolCall) await onToolCall(call.name, call.args, 'pending');
              const displayArgs = JSON.stringify(call.args, null, 2);
              const truncatedArgs = displayArgs.length > 1500 ? displayArgs.substring(0, 1500) + "\n... [Truncated]" : displayArgs;
              return `⚠️ *Permission Required*\n\nTool: \`${call.name}\`\nParameters:\n\`\`\`json\n${truncatedArgs}\n\`\`\`\n\nReply with *Approve* or *Cancel*.`;
          }

          if (onToolCall) await onToolCall(call.name, call.args, 'executing');
          let result;
          try {
            result = await registry.execute(call.name, call.args);
          } catch (e: any) {
            result = `Error: ${e.message}`;
          }
          if (onToolCall) await onToolCall(call.name, call.args, 'completed', result);
          await this.memory.addMessage('function', result, call.name);

          if (mode === 'plan' && currentPlan.length > 0) {
              const uncompleted = currentPlan.find(t => !t.completed);
              if (uncompleted) {
                  uncompleted.completed = true;
                  if (onThinking) {
                      const planStr = currentPlan.map((t, i) => `${i+1}. ${t.task} ${t.completed ? '✅' : '⏳'}`).join('\n');
                      await onThinking(planStr);
                  }
              }
          }
        }
        continue;
      }

      if (!response.text) {
          console.error("[Agent] LLM returned empty text. Skipping memory save for assistant message.");
          throw new Error("Received empty response from AI provider.");
      }
      await this.memory.addMessage('assistant', response.text);
      return response.text;
    }
  }

  async executePendingAction(onToolCall?: (name: string, args: any, status: 'executing' | 'completed', result?: string) => Promise<void>): Promise<string> {
    const pending = await this.memory.getPendingAction();
    if (!pending) return "No pending action to execute.";

    const tool = registry.get(pending.name);
    if (!tool) return `Tool ${pending.name} not found.`;

    try {
      if (onToolCall) await onToolCall(pending.name, pending.args, 'executing');
      const result = await tool.execute(pending.args);
      if (onToolCall) await onToolCall(pending.name, pending.args, 'completed', result);

      await this.memory.addMessage('function', result, pending.name);
      await this.memory.clearPendingAction();

      return await this.run("system", "The tool was approved and executed. Please provide the final response based on the result above.");
    } catch (error: any) {
      await this.memory.clearPendingAction();
      return `Error executing tool: ${error.message}`;
    }
  }
}

export const agent = new Agent(gemmaProvider, geminiProvider, githubModelsProvider, openRouterWebProvider, siliconFlowProvider, groqProvider, puterProvider, memory);
