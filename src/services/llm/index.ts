import { GoogleGenerativeAI } from '@google/generative-ai';
import { Groq } from 'groq-sdk';
import OpenAI from 'openai';
import { puter } from '@heyputer/puter.js';
import { config } from '../../config/env.js';
import { registry } from '../../tools/index.js';

export interface MediaData {
  mimeType: string;
  data: string; // base64 encoded
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'function';
  content: string;
  name?: string; // For function calls/responses
  thought_signature?: string; // Gemini 3 Flash requirement
  media?: MediaData[];
}

export interface LLMResponse {
  text: string;
  toolCalls?: { name: string; args: any, thought_signature?: string }[];
  rawParts?: any[];
}

export interface LLMProvider {
  generate(history: ChatMessage[], modelOverride?: string, signal?: AbortSignal): Promise<LLMResponse>;
}

export class GitHubModelsProvider implements LLMProvider {
    private client: OpenAI | null = null;

    constructor() {
        if (config.GITHUB_TOKEN) {
            this.client = new OpenAI({
                apiKey: config.GITHUB_TOKEN,
                baseURL: "https://models.inference.ai.azure.com"
            });
        }
    }

    async generate(history: ChatMessage[], modelOverride?: string, signal?: AbortSignal): Promise<LLMResponse> {
        if (!this.client) throw new Error("GitHub token not provided.");
        const messages = history.map(msg => {
            if (msg.role === 'function') {
                return { role: 'system', content: `[Tool ${msg.name} Result]: ${msg.content}` };
            }
            let content = msg.content;
            try {
                const parsed = JSON.parse(content);
                if (parsed.type === 'tool_call') {
                    const textPart = parsed.rawParts?.find((p: any) => p.text)?.text;
                    content = textPart || "[Assistant calling tools...]";
                }
            } catch {}
            return { role: msg.role === 'assistant' ? 'assistant' : 'user', content };
        }) as any[];

        const response = await this.client.chat.completions.create({
            messages,
            model: modelOverride || "gpt-4o",
            temperature: 0.7,
            max_tokens: 4096,
        }, { signal });

        const content = response.choices[0]?.message?.content;
        if (!content) throw new Error("No response from GitHub Models.");
        return { text: content };
    }
}

export class RateLimiter {
    private requests: number[] = [];
    private tokens: number[] = [];
    private readonly maxRPM = 10;
    private readonly maxTPM = 250000;

    async check(tokensNeeded: number): Promise<number> {
        const now = Date.now();
        this.requests = this.requests.filter(t => now - t < 60000);
        this.tokens = this.tokens.filter(t => now - t < 60000);

        if (this.requests.length >= this.maxRPM) {
            return 60000 - (now - this.requests[0]);
        }

        const currentTokens = this.tokens.reduce((a, b) => a + b, 0);
        if (currentTokens + tokensNeeded > this.maxTPM) {
            return 60000 - (now - this.tokens[0]);
        }

        return 0;
    }

    record(tokens: number) {
        const now = Date.now();
        this.requests.push(now);
        this.tokens.push(tokens);
    }
}

export class GemmaProvider implements LLMProvider {
    private currentKeyIndex = 0;
    private rateLimiter = new RateLimiter();

    constructor() {}

    private getClient() {
        const key = config.GEMINI_API_KEYS[this.currentKeyIndex];
        return new GoogleGenerativeAI(key);
    }

    private rotateKey() {
        this.currentKeyIndex = (this.currentKeyIndex + 1) % config.GEMINI_API_KEYS.length;
    }

    async generate(history: ChatMessage[], modelOverride?: string, signal?: AbortSignal): Promise<LLMResponse> {
        // Simple context caching logic placeholder as exact SDK support for implicit caching
        // usually involves placing repeated data (tools) in the system instruction
        // which Google AI Studio (Gemma 4) caches automatically if > 4k tokens.
        const maxRetries = config.GEMINI_API_KEYS.length;
        let attempt = 0;

        const geminiHistory: any[] = [];
        let i = 0;
        while (i < history.length) {
            const msg = history[i];
            if (msg.role === 'function') {
                const functionParts = [];
                while (i < history.length && history[i].role === 'function') {
                    functionParts.push({ functionResponse: { name: history[i].name!, response: { content: history[i].content } } });
                    i++;
                }
                geminiHistory.push({ role: 'function', parts: functionParts });
                continue;
            }
            if (msg.role === 'assistant') {
                geminiHistory.push({ role: 'model', parts: [{ text: msg.content }] });
                i++;
                continue;
            }
            const parts: any[] = [{ text: msg.content }];
            if (msg.media && msg.media.length > 0) {
                msg.media.forEach(m => parts.push({ inlineData: { mimeType: m.mimeType, data: m.data } }));
            }
            geminiHistory.push({ role: 'user', parts: parts });
            i++;
        }

        while (attempt < maxRetries) {
            try {
                const waitTime = await this.rateLimiter.check(20000); // Estimating 20k tokens per prompt with tools
                if (waitTime > 0) {
                    throw new Error(`QUOTA_EXCEEDED:${Math.ceil(waitTime / 1000)}`);
                }

                const genAI = this.getClient();
                const model = genAI.getGenerativeModel({
                    model: "gemma-4-31b-it",
                    systemInstruction: {
                        role: "system",
                        parts: [{ text: "System definitions and tools are implicitly cached by the provider if they exceed 4096 tokens. Definitions follow:" }]
                    },
                    tools: [{ functionDeclarations: registry.getFunctionDeclarations() }],
                });

                const result = await model.generateContent({
                    contents: geminiHistory,
                    generationConfig: {
                        responseMimeType: "application/json",
                        maxOutputTokens: 100000,
                    }
                }, { signal });

                const response = result.response;
                this.rateLimiter.record(response.usageMetadata?.totalTokenCount || 20000);
                const text = response.text() || "";
                const rawParts = response.candidates?.[0]?.content?.parts || [];
                const toolCalls: any[] = [];
                for (const part of rawParts) {
                    if (part.functionCall) {
                        toolCalls.push({ name: part.functionCall.name, args: part.functionCall.args });
                    }
                }
                return { text, toolCalls, rawParts };
            } catch (error: any) {
                if (error.status === 429) {
                   const delayMatch = error.message.match(/retry in (\d+)s/);
                   const delay = delayMatch ? parseInt(delayMatch[1]) : 60;
                   throw new Error(`QUOTA_EXCEEDED:${delay}`);
                }
                this.rotateKey();
                attempt++;
                if (attempt >= maxRetries) throw error;
            }
        }
        throw new Error("Gemma 4 keys exhausted.");
    }
}

export class OpenRouterWebProvider implements LLMProvider {
    async generate(history: ChatMessage[], modelOverride?: string, signal?: AbortSignal): Promise<LLMResponse> {
        const messages = history.map(msg => {
            if (msg.role === 'function') {
                return { role: 'system', content: `[Tool ${msg.name} Result]: ${msg.content}` };
            }
            let content = msg.content;
            try {
                const parsed = JSON.parse(content);
                if (parsed.type === 'tool_call') {
                    const textPart = parsed.rawParts?.find((p: any) => p.text)?.text;
                    content = textPart || "[Assistant calling tools...]";
                }
            } catch {}
            return { role: msg.role === 'assistant' ? 'assistant' : 'user', content };
        }) as any[];

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${config.OPENROUTER_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: modelOverride || "minimax/minimax-m2.5:free",
                messages
            }),
            signal
        });

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        if (!content) throw new Error("No response from OpenRouter.");
        return { text: content };
    }
}

export class GeminiProvider implements LLMProvider {
  private currentKeyIndex = 0;
  private keyCooldowns: Map<number, number> = new Map();

  constructor() {}

  private getClient() {
    // Round-robin or simple index increment
    let attempts = 0;
    while (attempts < config.GEMINI_API_KEYS.length) {
        const keyIndex = this.currentKeyIndex;
        const cooldownUntil = this.keyCooldowns.get(keyIndex) || 0;

        if (Date.now() > cooldownUntil) {
            const key = config.GEMINI_API_KEYS[keyIndex];
            return new GoogleGenerativeAI(key);
        }

        console.log(`[Gemini] Key ${keyIndex} is on cooldown. Skipping...`);
        this.rotateKey();
        attempts++;
    }

    // If all on cooldown, use current anyway (let it fail/retry)
    const key = config.GEMINI_API_KEYS[this.currentKeyIndex];
    return new GoogleGenerativeAI(key);
  }

  private rotateKey() {
    this.currentKeyIndex = (this.currentKeyIndex + 1) % config.GEMINI_API_KEYS.length;
    console.log(`[Gemini] Rotating to key index ${this.currentKeyIndex}`);
  }

  async generate(history: ChatMessage[], modelOverride?: string, signal?: AbortSignal): Promise<LLMResponse> {
    const maxRetries = config.GEMINI_API_KEYS.length;
    let attempt = 0;

    // Convert internal message format to Gemini format.
    // We must group consecutive 'function' responses into a single turn for Gemini.
    const geminiHistory: any[] = [];
    let i = 0;
    while (i < history.length) {
      const msg = history[i];

      if (msg.role === 'function') {
        const functionParts = [];
        // Group all consecutive function results
        while (i < history.length && history[i].role === 'function') {
          functionParts.push({
            functionResponse: {
              name: history[i].name!,
              response: { content: history[i].content }
            }
          });
          i++;
        }
        geminiHistory.push({
          role: 'function',
          parts: functionParts
        });
        continue;
      }

      if (msg.role === 'assistant') {
          try {
              const parsed = JSON.parse(msg.content);
              if (parsed.type === 'tool_call') {
                  // If we have rawParts (new format), use them exactly as they were
                  if (Array.isArray(parsed.rawParts)) {
                      geminiHistory.push({
                          role: 'model',
                          parts: parsed.rawParts.map((part: any) => {
                              const newPart = { ...part };
                              // Ensure functionCall parts have a signature for Gemini 3
                              if (newPart.functionCall && !newPart.thought_signature) {
                                  (newPart as any).thought_signature = "skip_thought_signature_validator";
                              }
                              return newPart;
                          })
                      });
                      i++;
                      continue;
                  }
                  // Fallback for old serialized calls format
                  if (Array.isArray(parsed.calls)) {
                      geminiHistory.push({
                          role: 'model',
                          parts: parsed.calls.map((call: any) => ({
                              functionCall: { name: call.name, args: call.args },
                              thought_signature: call.thought_signature || "skip_thought_signature_validator"
                          }))
                      });
                      i++;
                      continue;
                  }
              }
          } catch {
              // Ignore parse errors, proceed as text
          }
          geminiHistory.push({
              role: 'model',
              parts: [{ text: msg.content }]
          });
          i++;
          continue;
      }

      const parts: any[] = [{ text: msg.content }];
      if (msg.media && msg.media.length > 0) {
        msg.media.forEach(m => {
          parts.push({
            inlineData: {
              mimeType: m.mimeType,
              data: m.data
            }
          });
        });
      }

      geminiHistory.push({
        role: 'user',
        parts: parts
      });
      i++;
    }

    while (attempt < maxRetries) {
      try {
        const genAI = this.getClient();
        const model = genAI.getGenerativeModel({
          model: modelOverride || "gemini-3-flash-preview",
          tools: [{ functionDeclarations: registry.getFunctionDeclarations() }],
          systemInstruction: `You are AmmarClaw, Ammar's Personal AI OS Agent. You run locally and use Telegram as your primary interface to manage his digital world. You are powerful, proactive, and secure. You have deep access to files, cloud services, and specialized tools. Your goal is to execute tasks with high precision and provide a seamless "AI OS" experience. Always use tools when needed to interact with the environment.

FORMATTING RULES (CRITICAL):
1. Use ONLY these Telegram-compatible Markdown elements: *bold*, _italic_, \`inline code\`, and \`\`\`code blocks\`\`\`.
2. NEVER use Markdown headers (e.g., #, ##, ###). Use *BOLD ALL CAPS* for section titles instead.
3. Use simple bullet points (•) for lists. Do NOT use nested bullet points or complex tables.
4. Ensure all opening symbols like * and _ have a matching closing symbol. If you use them inside text as literal characters, escape them with a backslash (\\* or \\_).
5. Avoid excessive vertical space; keep responses concise and well-structured.
`
        });

        const chat = model.startChat({
          history: (() => {
            const historyToInclude = geminiHistory.slice(0, -1);
            const firstUserIndex = historyToInclude.findIndex(m => m.role === 'user');
            return firstUserIndex !== -1 ? historyToInclude.slice(firstUserIndex) : [];
          })(),
          generationConfig: {
            maxOutputTokens: 100000,
          },
        });

        const lastMsg = geminiHistory[geminiHistory.length - 1];
        if (!lastMsg || !lastMsg.parts || lastMsg.parts.length === 0) {
             return { text: "Error: Empty message context." };
        }

        const result = await chat.sendMessage(lastMsg.parts, { signal });
        const response = result.response;
        const text = response.text() || "";
        
        const candidate = response.candidates?.[0];
        const rawParts = candidate?.content?.parts || [];
        
        // Extract tool calls for the agent loop
        const toolCalls: any[] = [];
        for (const part of rawParts) {
            if (part.functionCall) {
                toolCalls.push({
                    name: part.functionCall.name,
                    args: part.functionCall.args,
                    thought_signature: (part as any).thought_signature
                });
            }
        }

        return { text, toolCalls, rawParts };

      } catch (error: any) {
        console.error(`[Gemini] Key ${this.currentKeyIndex} failed: ${error.message}`);

        if (error.status === 429) {
            // Extract wait time
            const delayMatch = error.message.match(/retry in (\d+)s/);
            const delay = delayMatch ? parseInt(delayMatch[1]) : 60;

            // Mark key as cooled down for the duration
            this.keyCooldowns.set(this.currentKeyIndex, Date.now() + (delay * 1000));

            // Before failing completely, try next key even for 429
            this.rotateKey();
            attempt++;

            if (attempt < maxRetries) {
                console.warn(`[Gemini] Key 429'd. Trying next key... (${attempt + 1}/${maxRetries})`);
                // Increased delay to 2 seconds between keys on 429 to avoid cascade
                await new Promise(r => setTimeout(r, 2000));
                continue; // Retry with next key
            }

            // If all keys 429'd, then throw
            throw new Error(`QUOTA_EXCEEDED:${delay}`);
        }

        // Always rotate and retry for other errors to exhaust all keys
        this.rotateKey();
        attempt++;

        if (attempt < maxRetries) {
           console.log(`[Gemini] Retrying with next key... (Attempt ${attempt + 1}/${maxRetries})`);
           // Increase delay slightly for rate limits
           await new Promise(r => setTimeout(r, 1000));
        } else {
           console.error("[Gemini] All keys failed.");
           throw error;
        }
      }
    }
    throw new Error("All Gemini API keys exhausted.");
  }
}


export class PuterProvider implements LLMProvider {
    async generate(history: ChatMessage[], modelOverride?: string, signal?: AbortSignal): Promise<LLMResponse> {
        const lastMsg = history[history.length - 1].content;
        // Simplified for Puter.js as it often handles single prompt or we join
        const prompt = history.map(m => `${m.role}: ${m.content}`).join('\n');

        try {
            const response = await (puter.ai as any).chat(prompt, {
                model: modelOverride || "anthropic/claude-3.5-sonnet"
            });
            const content = response.message.content;
            if (!content) throw new Error("No response from Puter.");
            return { text: content };
        } catch (err: any) {
            throw new Error(`Puter Error: ${err.message}`);
        }
    }
}

export class SiliconFlowProvider implements LLMProvider {
    async generate(history: ChatMessage[], modelOverride?: string, signal?: AbortSignal): Promise<LLMResponse> {
        const messages = history.map(msg => {
            if (msg.role === 'function') {
                return { role: 'system', content: `[Tool ${msg.name} Result]: ${msg.content}` };
            }
            let content = msg.content;
            try {
                const parsed = JSON.parse(content);
                if (parsed.type === 'tool_call') {
                    const textPart = parsed.rawParts?.find((p: any) => p.text)?.text;
                    content = textPart || "[Assistant calling tools...]";
                }
            } catch {}
            return { role: msg.role === 'assistant' ? 'assistant' : 'user', content };
        }) as any[];

        const response = await fetch("https://api.siliconflow.cn/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${config.SILICONFLOW_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: modelOverride || "deepseek-ai/DeepSeek-R1",
                messages
            }),
            signal
        });

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        if (!content) throw new Error("No response from SiliconFlow.");
        return { text: content };
    }
}

export class GroqProvider implements LLMProvider {
  private client: Groq | null = null;

  constructor() {
    if (config.GROQ_API_KEY) {
      this.client = new Groq({ apiKey: config.GROQ_API_KEY });
    }
  }

  async generate(history: ChatMessage[], modelOverride?: string, signal?: AbortSignal): Promise<LLMResponse> {
    if (!this.client) throw new Error("Groq API key not provided.");
    const messages = history.map(msg => {
      if (msg.role === 'function') {
        return {
          role: 'system',
          content: `[Tool ${msg.name} Result]: ${msg.content}`
        };
      }
      
      let content = msg.content;
      try {
          const parsed = JSON.parse(content);
          if (parsed.type === 'tool_call') {
              // Extract text if present in rawParts, otherwise use a placeholder
              const textPart = parsed.rawParts?.find((p: any) => p.text)?.text;
              content = textPart || "[Assistant calling tools...]";
          }
      } catch {
          // Not JSON, use as is
      }

      return {
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: content,
      };
    }) as any[];

    const completion = await this.client.chat.completions.create({
      messages: messages,
      model: modelOverride || "openai/gpt-oss-120b",
      temperature: 0.7,
      max_tokens: 1024,
    }, { signal });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error("No response from Groq.");
    return { text: content };
  }
}

// Export singleton instances for easy usage
export const geminiProvider = new GeminiProvider();
export const gemmaProvider = new GemmaProvider();
export const githubModelsProvider = new GitHubModelsProvider();
export const openRouterWebProvider = new OpenRouterWebProvider();
export const siliconFlowProvider = new SiliconFlowProvider();
export const puterProvider = new PuterProvider();
export const groqProvider = new GroqProvider();
