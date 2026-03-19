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
  generate(history: ChatMessage[]): Promise<LLMResponse>;
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

  async generate(history: ChatMessage[]): Promise<LLMResponse> {
    const maxRetries = config.GEMINI_API_KEYS.length;
    let attempt = 0;

    // Convert internal message format to Gemini format ONCE (or per attempt if needed, but static is fine)
    // Actually, we need to rebuild the chat session each time we get a new model instance.
    const geminiHistory = history.map(msg => {
      if (msg.role === 'function') {
        return {
          role: 'function',
          parts: [{ functionResponse: { name: msg.name!, response: { content: msg.content } } }]
        };
      }
      
      if (msg.role === 'assistant') {
          try {
              const parsed = JSON.parse(msg.content);
              if (parsed.type === 'tool_call') {
                  // If we have rawParts (new format), use them exactly as they were
                  if (Array.isArray(parsed.rawParts)) {
                      return {
                          role: 'model',
                          parts: parsed.rawParts.map((part: any) => {
                              // Ensure functionCall parts have a signature for Gemini 3
                              if (part.functionCall && !part.thought_signature) {
                                  part.thought_signature = "skip_thought_signature_validator";
                              }
                              return part;
                          })
                      };
                  }
                  // Fallback for old serialized calls format
                  if (Array.isArray(parsed.calls)) {
                      return {
                          role: 'model',
                          parts: parsed.calls.map((call: any) => ({
                              functionCall: { name: call.name, args: call.args },
                              thought_signature: call.thought_signature || "skip_thought_signature_validator"
                          }))
                      };
                  }
              }
          } catch {
              // Ignore parse errors, proceed as text
          }
          return {
              role: 'model',
              parts: [{ text: msg.content }]
          };
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

      return {
        role: 'user',
        parts: parts
      };
    });

    while (attempt < maxRetries) {
      try {
        const genAI = this.getClient();
        const model = genAI.getGenerativeModel({
          model: "gemini-3-flash-preview", 
          tools: [{ functionDeclarations: registry.getFunctionDeclarations() }],
          systemInstruction: `You are AmmarClaw, a personal AI assistant for Ammar. You run locally and use Telegram as your interface. Your goal is to be helpful, precise, and secure. Always use tools when needed.

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
            const h = geminiHistory.slice(0, -1);
            const firstUserIndex = h.findIndex(m => m.role === 'user');
            return firstUserIndex !== -1 ? h.slice(firstUserIndex) : [];
          })(),
          generationConfig: {
            maxOutputTokens: 2048,
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

        // Always rotate and retry for any error to exhaust all keys
        this.rotateKey();
        attempt++;

        if (attempt < maxRetries) {
           console.log(`[Gemini] Retrying with next key... (Attempt ${attempt + 1}/${maxRetries})`);
           await new Promise(r => setTimeout(r, 500));
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

  async generate(history: ChatMessage[]): Promise<LLMResponse> {
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

  async generate(history: ChatMessage[]): Promise<LLMResponse> {
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
      model: "llama-3.3-70b-versatile",
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
