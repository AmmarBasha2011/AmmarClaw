
process.env.TELEGRAM_BOT_TOKEN = "mock-token";
process.env.TELEGRAM_USER_ID = "12345";
process.env.GEMINI_API_KEYS = "key1,key2";
process.env.NETLIFY_AUTH_TOKEN = "mock-netlify";
process.env.GITHUB_TOKEN = "mock-github";
process.env.SUPABASE_URL = "https://mock.supabase.co";
process.env.SUPABASE_KEY = "mock-key";
process.env.SMITHERY_API_KEY = "mock-smithery";

import { ToolRegistry, Tool } from '../src/tools/index.js';
import { SchemaType } from '@google/generative-ai';

const testTool: Tool = {
  name: 'test_tool',
  description: 'A tool for testing',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      input: { type: SchemaType.STRING, description: 'Some input' }
    },
    required: ['input']
  },
  execute: async ({ input }: { input: string }) => `Echo: ${input}`
};

async function testToolRegistry() {
  const registry = new ToolRegistry();
  registry.register(testTool);

  console.log("Testing ToolRegistry.register...");
  const retrieved = registry.get('test_tool');
  if (retrieved && retrieved.name === 'test_tool') {
    console.log("✅ ToolRegistry.register test passed");
  } else {
    console.error("❌ ToolRegistry.register test failed");
    process.exit(1);
  }

  console.log("Testing ToolRegistry.execute...");
  const result = await registry.execute('native__test_tool', { input: 'hello' });
  if (result === 'Echo: hello') {
    console.log("✅ ToolRegistry.execute test passed");
  } else {
    console.error("❌ ToolRegistry.execute test failed, got:", result);
    process.exit(1);
  }
}

testToolRegistry().catch(err => {
    console.error("Test error:", err);
    process.exit(1);
});
