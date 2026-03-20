import fs from 'fs/promises';
import path from 'path';

/**
 * Updates or appends a key-value pair in the .env file.
 */
export async function updateEnv(key: string, value: string) {
    const envPath = path.join(process.cwd(), '.env');
    let content = '';

    try {
        content = await fs.readFile(envPath, 'utf8');
    } catch (error: any) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }

    const lines = content.split('\n');
    let found = false;
    const newLines = lines.map(line => {
        if (line.trim().startsWith(`${key}=`)) {
            found = true;
            return `${key}=${value}`;
        }
        return line;
    });

    if (!found) {
        if (content.length > 0 && !content.endsWith('\n')) {
            newLines.push('');
        }
        newLines.push(`${key}=${value}`);
    }

    await fs.writeFile(envPath, newLines.join('\n'));
    console.log(`[Env] Updated ${key} in .env`);
}
