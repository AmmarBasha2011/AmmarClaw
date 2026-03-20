import { GoogleGenerativeAI } from '@google/generative-ai';
import { Groq } from 'groq-sdk';
import axios from 'axios';
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
  generate(history: ChatMessage[], modelOverride?: string): Promise<LLMResponse>;
}

export class GeminiProvider implements LLMProvider {
  private currentKeyIndex = 0;

  constructor() {}

  private getClient() {
    // Round-robin or simple index increment
    const key = config.GEMINI_API_KEYS[this.currentKeyIndex];
    return new GoogleGenerativeAI(key);
  }

  private rotateKey() {
    this.currentKeyIndex = (this.currentKeyIndex + 1) % config.GEMINI_API_KEYS.length;
    console.log(`[Gemini] Rotating to key index ${this.currentKeyIndex}`);
  }

  async generate(history: ChatMessage[], modelOverride?: string): Promise<LLMResponse> {
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
                              // Ensure functionCall parts have a signature for Gemini 3
                              if (part.functionCall && !part.thought_signature) {
                                  part.thought_signature = "skip_thought_signature_validator";
                              }
                              return part;
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

        const result = await chat.sendMessage(lastMsg.parts);
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

            // Before failing completely, try next key even for 429
            // This satisfies "try all 11 keys" requirement
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

export class JinaProvider implements LLMProvider {
  constructor() {}

  async generate(history: ChatMessage[], modelOverride?: string): Promise<LLMResponse> {
    if (!config.JINA_API_KEY) throw new Error("Jina API key missing");

    const messages = history.map(msg => {
      if (msg.role === 'function') {
        return {
          role: 'user', // DeepSearch might prefer user for function results or system
          content: `[Tool ${msg.name} Result]: ${msg.content}`
        };
      }

      let content = msg.content;
      try {
          const parsed = JSON.parse(content);
          if (parsed.type === 'tool_call') {
              const textPart = parsed.rawParts?.find((p: any) => p.text)?.text;
              content = textPart || "[Assistant calling tools...]";
          }
      } catch {}

      return {
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: content,
      };
    });

    const response = await axios.post('https://deepsearch.jina.ai/v1/chat/completions', {
      model: "jina-deepsearch-v1",
      messages: messages,
    }, {
      headers: {
        'Authorization': `Bearer ${config.JINA_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    return {
      text: response.data.choices[0]?.message?.content || "No response generated.",
    };
  }
}

export class GroqProvider implements LLMProvider {
  private client: Groq;

  constructor() {
    this.client = new Groq({ apiKey: config.GROQ_API_KEY });
  }

  async generate(history: ChatMessage[], modelOverride?: string): Promise<LLMResponse> {
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
      model: modelOverride || "llama-3.3-70b-versatile",
      temperature: 0.7,
      max_tokens: 1024,
    });

    return {
      text: completion.choices[0]?.message?.content || "No response generated.",
    };
  }
}

// Export singleton instances for easy usage
export const geminiProvider = new GeminiProvider();
export const jinaProvider = new JinaProvider();
export const groqProvider = new GroqProvider();
