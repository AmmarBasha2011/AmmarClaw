import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../config/env.js';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/blogger'
];

const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'client_secret.json');

export class GoogleService {
  private auth: any = null;

  private async getCredentials() {
    if (config.GOOGLE_CREDENTIALS) {
      return JSON.parse(config.GOOGLE_CREDENTIALS);
    }
    const content = await fs.readFile(CREDENTIALS_PATH, 'utf8');
    return JSON.parse(content);
  }

  private async getTokens() {
    if (config.GOOGLE_TOKEN) {
        return JSON.parse(config.GOOGLE_TOKEN);
    }
    const content = await fs.readFile(TOKEN_PATH, 'utf8');
    return JSON.parse(content);
  }

  async getAuthUrl(): Promise<string> {
    const credentials = await this.getCredentials();
    const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    return oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
    });
  }

  async exchangeCode(code: string): Promise<void> {
    const credentials = await this.getCredentials();
    const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    const { tokens } = await oAuth2Client.getToken(code);
    await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens));
    this.auth = oAuth2Client;
    oAuth2Client.setCredentials(tokens);
  }

  private async getAuthorizedClient(): Promise<any> {
    if (this.auth) return this.auth;

    try {
      const tokens = await this.getTokens();
      const credentials = await this.getCredentials();
      const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;

      const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
      oAuth2Client.setCredentials(tokens);
      this.auth = oAuth2Client;
      return this.auth;
    } catch (_error) {
      console.warn("Google Auth token not found or invalid. Please run /auth.");
      return null;
    }
  }

  async gmail() {
    const auth = await this.getAuthorizedClient();
    if (!auth) throw new Error("Google not authorized. Use /auth");
    return google.gmail({ version: 'v1', auth });
  }

  async drive() {
    const auth = await this.getAuthorizedClient();
    if (!auth) throw new Error("Google not authorized. Use /auth");
    return google.drive({ version: 'v3', auth });
  }

  async youtube() {
    const auth = await this.getAuthorizedClient();
    if (!auth) throw new Error("Google not authorized. Use /auth");
    return google.youtube({ version: 'v3', auth });
  }

  async blogger() {
    const auth = await this.getAuthorizedClient();
    if (!auth) throw new Error("Google not authorized. Use /auth");
    return google.blogger({ version: 'v3', auth });
  }
}

export const googleService = new GoogleService();
