import { Context } from 'grammy';

export async function sendChunks(ctx: Context, text: string, options: any = {}) {
    const CHUNK_SIZE = 4000; // Safe limit below 4096
    if (text.length <= CHUNK_SIZE) {
        return await ctx.reply(text, options);
    }

    const chunks = [];
    let current = text;
    while (current.length > 0) {
        if (current.length <= CHUNK_SIZE) {
            chunks.push(current);
            break;
        }

        let sliceIndex = current.lastIndexOf('\n', CHUNK_SIZE);
        if (sliceIndex === -1 || sliceIndex < CHUNK_SIZE * 0.8) {
            sliceIndex = CHUNK_SIZE;
        }

        chunks.push(current.substring(0, sliceIndex));
        current = current.substring(sliceIndex).trim();
    }

    for (const chunk of chunks) {
        try {
            await ctx.reply(chunk, options);
        } catch (error) {
            // Fallback: if Markdown fails in a chunk, try plain text
            if (options.parse_mode === 'Markdown') {
                await ctx.reply(chunk);
            } else {
                throw error;
            }
        }
    }
}
