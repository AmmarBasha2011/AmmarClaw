import { Context } from 'grammy';

export async function sendChunks(ctx: Context, text: string, options: any = {}) {
    const CHUNK_SIZE = 4000; // Safe limit below 4096

    // Attempt the full message if it's within size
    if (text.length <= CHUNK_SIZE) {
        try {
            return await ctx.reply(text, options);
        } catch (error: any) {
            if (options.parse_mode && error.description?.includes('can\'t parse entities')) {
                console.warn(`[sendChunks] Markdown failed for short message, falling back to plain text.`);
                return await ctx.reply(text);
            }
            throw error;
        }
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
        } catch (error: any) {
            // Fallback: if Markdown fails in a chunk, try plain text
            if (options.parse_mode && error.description?.includes('can\'t parse entities')) {
                console.warn(`[sendChunks] Markdown failed for chunk, falling back to plain text.`);
                await ctx.reply(chunk);
            } else {
                throw error;
            }
        }
    }
}
