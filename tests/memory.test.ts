import { MemoryService } from '../src/services/memory.js';

// Mock config for tests
process.env.SUPABASE_URL = "https://mock.supabase.co";
process.env.SUPABASE_KEY = "mock-key";
process.env.TELEGRAM_BOT_TOKEN = "mock-token";
process.env.TELEGRAM_USER_ID = "12345";
process.env.GEMINI_API_KEYS = "key1,key2";
process.env.NETLIFY_AUTH_TOKEN = "mock-netlify";
process.env.GITHUB_TOKEN = "mock-github";
process.env.SMITHERY_API_KEY = "mock-smithery";

async function testMemoryService() {
  console.log("Testing MemoryService (Initialization only, requires Supabase for logic)...");

  try {
    const memory = new MemoryService();
    if (memory) {
      console.log("✅ MemoryService initialized successfully.");
    }
  } catch (error: any) {
    console.error("❌ MemoryService initialization failed:", error.message);
    process.exit(1);
  }
}

testMemoryService().catch(err => {
    console.error("Test error:", err);
    process.exit(1);
});
