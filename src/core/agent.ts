import { registry } from '../tools/index.js';
import { LLMProvider, ChatMessage, MediaData } from '../services/llm/index.js';
import { MemoryService } from '../services/memory.js';

export class Agent {
  constructor(
    private llm: LLMProvider, 
    private secondaryLLM: LLMProvider,
    private fallbackLLM: LLMProvider,
    private memory: MemoryService
  ) {}

  async run(
    userId: string, 
    input: string, 
    onToolCall?: (name: string, args: any, status: 'executing' | 'pending' | 'completed', result?: string) => Promise<void>,
    autoMode: boolean = false,
    signal?: AbortSignal,
    media?: MediaData[],
    onFallback?: (provider: string) => Promise<void>
  ): Promise<string> {
    // 1. Save User Message (Note: media is currently not persisted in DB but used for current turn)
    await this.memory.addMessage('user', input);

    let loopCount = 0;
    while (true) {
      if (signal?.aborted) {
          console.log("[Agent] Task aborted by user.");
          return "🛑 Task was ended by user.";
      }
      loopCount++;

      // 2. Get History from DB and convert to ChatMessage[]
      const dbHistory = await this.memory.getHistory(10);
      const chatHistory: ChatMessage[] = dbHistory.map(m => ({
        role: m.role as 'user' | 'assistant' | 'function',
        content: m.content,
        name: m.name,
      }));

      // Attach media to the LAST user message if it's the first turn
      if (loopCount === 1 && media && media.length > 0) {
          const lastUserMsg = [...chatHistory].reverse().find(m => m.role === 'user');
          if (lastUserMsg) {
              lastUserMsg.media = media;
          }
      }

      // 3. Call LLM
      let response;
      try {
        console.log(`[Agent] Turn ${loopCount}: Calling Gemini (Primary)...`);
        response = await this.llm.generate(chatHistory, "gemini-2.0-flash");
      } catch (error: any) {
        console.warn("[Agent] Gemini Primary failed. Trying Gemini Lite...");
        if (onFallback) await onFallback("Switching to smaller model");

        try {
            response = await this.llm.generate(chatHistory, "gemini-1.5-flash");
        } catch (liteError: any) {
            console.error("[Agent] Gemini Lite failed. Switching to Jina secondary...");
            if (onFallback) await onFallback("Switching to Jina AI");

            try {
              response = await this.secondaryLLM.generate(chatHistory);
            } catch (secondaryError) {
                console.error("[Agent] Jina failed, switching to Groq fallback...");
                if (onFallback) await onFallback("Switching to Groq Cloud");

                try {
                  // Using openai/gpt-oss-120b as requested
                  response = await this.fallbackLLM.generate(chatHistory, "openai/gpt-oss-120b");
                } catch (fallbackError: any) {
                  console.error("[Agent] All LLMs failed.", fallbackError);
                  const delayMatch = error.message.match(/retry in (\d+)s/);
                  const delay = delayMatch ? delayMatch[1] : "some";
                  return `I'm having trouble thinking right now. Please wait ${delay} seconds to return Gemini.`;
                }
            }
        }
      }

      // 4. Handle Response
      if (response.toolCalls && response.toolCalls.length > 0) {
        // Store the full response including rawParts to preserve thought_signature and text
        const toolCallMsg = JSON.stringify({
            type: 'tool_call',
            calls: response.toolCalls,
            rawParts: response.rawParts
        });
        await this.memory.addMessage('assistant', toolCallMsg);

        // Execute Tools
        for (const call of response.toolCalls) {
          const tool = registry.get(call.name);
          
          // Check for Approval (Skip if autoMode is true)
          if (tool?.requiresApproval && !autoMode) {
              console.log(`[Agent] Tool ${call.name} requires approval. Pausing.`);
              await this.memory.setPendingAction(call.name, call.args);
              if (onToolCall) await onToolCall(call.name, call.args, 'pending');
              
              const displayArgs = JSON.stringify(call.args, null, 2);
              const truncatedArgs = displayArgs.length > 1500 
                ? displayArgs.substring(0, 1500) + "\n... [Parameters truncated for length]" 
                : displayArgs;

              return `⚠️ *Permission Required*\n\nTool: \`${call.name}\`\nParameters:\n\`\`\`json\n${truncatedArgs}\n\`\`\`\n\nReply with *Approve* or *Cancel*.`;
          }

          console.log(`[Agent] Executing tool: ${call.name}`);
          if (onToolCall) await onToolCall(call.name, call.args, 'executing');
          
          let result;
          try {
            result = await registry.execute(call.name, call.args);
          } catch (e: any) {
            result = `Error: ${e.message}`;
          }

          if (onToolCall) await onToolCall(call.name, call.args, 'completed', result);
          
          // Store Tool Result
          await this.memory.addMessage('function', result, call.name);
        }

        // After tool execution, loop back to LLM for next thought
        continue;
      }

      // 5. Final Text Response
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

      // We don'tuserId here, but for history we might need it. 
      // For now, just return text. Note: This won't trigger another AI turn automatically.
      // Usually after approval, we want the AI to see the result and give a final answer.
      // So we call run again with a dummy input or just process the history.
      return await this.run("system", "The tool was approved and executed. Please provide the final response based on the result above.");
    } catch (error: any) {
      await this.memory.clearPendingAction();
      return `Error executing tool: ${error.message}`;
    }
  }
}

// Export a singleton instance? Not really needed if we inject dependencies
// But we use it in bot.ts
import { geminiProvider, jinaProvider, groqProvider } from '../services/llm/index.js';
import { memory } from '../services/memory.js';

export const agent = new Agent(geminiProvider, jinaProvider, groqProvider, memory);
