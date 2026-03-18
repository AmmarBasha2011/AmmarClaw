import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

async function listModels() {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // Dummy init
    // Actually, listing models is a different call
    // Currently the SDK might not expose listModels easily on the instance, 
    // let's try to just run a generation with a few likely candidates.
    
    const candidates = [
        "gemini-3.0-flash", 
        "gemini-3-flash", 
        "gemini-2.0-flash",
        "gemini-1.5-flash",
        "gemini-1.5-flash-latest",
        "gemini-1.5-flash-001"
    ];

    console.log("Testing model availability...");
    
    for (const modelName of candidates) {
        process.stdout.write(`Testing ${modelName}... `);
        try {
            const m = genAI.getGenerativeModel({ model: modelName });
            await m.generateContent("Hello");
            console.log("✅ SUCCESS");
        } catch (e: any) {
            console.log(`❌ FAILED: ${e.message.split('\n')[0]}`);
        }
    }

  } catch (error) {
    console.error("Error:", error);
  }
}

listModels();
