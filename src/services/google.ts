import fs from 'fs/promises';
import path from 'path';
import { google } from 'googleapis';
import { authenticate } from '@google-cloud/local-auth';
import { OAuth2Client } from 'google-auth-library';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/blogger'
];

const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'client_secret.json');

export class GoogleService {
  private authClient: OAuth2Client | null = null;

  async getClient(): Promise<OAuth2Client> {
    if (this.authClient) return this.authClient;

    try {
      const credentialsContent = await fs.readFile(CREDENTIALS_PATH, 'utf8');
      const credentials = JSON.parse(credentialsContent);
      const key = credentials.web || credentials.installed;

      if (!key) throw new Error('Invalid client_secret.json format');

      this.authClient = new google.auth.OAuth2(
        key.client_id,
        key.client_secret,
        key.redirect_uris?.[0]
      );

      const tokenContent = await fs.readFile(TOKEN_PATH, 'utf8');
      const tokens = JSON.parse(tokenContent);
      this.authClient.setCredentials(tokens);

      return this.authClient;
    } catch (err: any) {
      console.error('❌ Google Auth Error:', err.message);
      throw new Error(`Google Auth Failed: ${err.message}. Please ensure token.json exists and is valid.`, { cause: err });
    }
  }

  async gmail() {
    const auth = await this.getClient();
    return google.gmail({ version: 'v1', auth });
  }

  async drive() {
    const auth = await this.getClient();
    return google.drive({ version: 'v3', auth });
  }

  async youtube() {
    const auth = await this.getClient();
    return google.youtube({ version: 'v3', auth });
  }

  async blogger() {
    const auth = await this.getClient();
    return google.blogger({ version: 'v3', auth });
  }

  // Manual Auth Flow for Bot
  async getAuthUrl() {
    const credentialsContent = await fs.readFile(CREDENTIALS_PATH, 'utf8');
    const credentials = JSON.parse(credentialsContent);
    const key = credentials.web || credentials.installed;

    this.authClient = new google.auth.OAuth2(
      key.client_id,
      key.client_secret,
      key.redirect_uris?.[0] || 'urn:ietf:wg:oauth:2.0:oob'
    );

    return this.authClient.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent'
    });
  }

  async exchangeCode(code: string) {
    if (!this.authClient) {
        // Re-init client if needed
        const credentialsContent = await fs.readFile(CREDENTIALS_PATH, 'utf8');
        const credentials = JSON.parse(credentialsContent);
        const key = credentials.web || credentials.installed;
        this.authClient = new google.auth.OAuth2(key.client_id, key.client_secret, key.redirect_uris?.[0]);
    }

    try {
      const { tokens } = await this.authClient.getToken(code);
      this.authClient.setCredentials(tokens);
      await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens));
      return tokens;
    } catch (e: any) {
      throw new Error("Failed to exchange code", { cause: e });
    }
  }

  // Initial Auth Flow (keeping for backward compatibility or terminal use)
  async runAuth() {
    const client = await authenticate({
      scopes: SCOPES,
      keyfilePath: CREDENTIALS_PATH,
    });
    if (client.credentials) {
      await fs.writeFile(TOKEN_PATH, JSON.stringify(client.credentials));
      console.log('Token saved to token.json');
    }
    return client;
  }
}

export const googleService = new GoogleService();
