
process.env.TELEGRAM_BOT_TOKEN = "mock-token";
process.env.TELEGRAM_USER_ID = "12345";
process.env.GEMINI_API_KEYS = "key1,key2";
process.env.NETLIFY_AUTH_TOKEN = "mock-netlify";
process.env.GITHUB_TOKEN = "mock-github";
process.env.SUPABASE_URL = "https://mock.supabase.co";
process.env.SUPABASE_KEY = "mock-key";
process.env.SMITHERY_API_KEY = "mock-smithery";

import { Agent } from '../src/core/agent.js';
import { LLMProvider, ChatMessage, LLMResponse } from '../src/services/llm/index.js';
import { MemoryService } from '../src/services/memory.js';

// Mock LLM Provider
class MockLLM implements LLMProvider {
  async generate(history: ChatMessage[], modelOverride?: string, signal?: AbortSignal): Promise<LLMResponse> {
    return { text: "Hello from Mock LLM" };
  }
}

// Mock Memory Service
const mockMemory = {
  addMessage: async () => {},
  getHistory: async () => [],
  setPendingAction: async () => {},
  getPendingAction: async () => null,
  clearPendingAction: async () => {},
  addSchedule: async () => {},
  getSchedules: async () => [],
  getPendingSchedules: async () => [],
  updateScheduleRun: async () => {},
  removeSchedule: async () => {},
  removeAllMemory: async () => {},
  clearHistory: async () => {}
} as unknown as MemoryService;

async function testAgentRun() {
  const mockLLM = new MockLLM();
  const agent = new Agent(mockLLM, mockLLM, mockLLM, mockLLM, mockMemory);

  console.log("Testing Agent.run...");
  const result = await agent.run("user1", "Hello agent");

  if (result === "Hello from Mock LLM") {
    console.log("✅ Agent.run test passed");
  } else {
    console.error("❌ Agent.run test failed, got:", result);
    process.exit(1);
  }
}

testAgentRun().catch(err => {
  console.error("Test error:", err);
  process.exit(1);
});
