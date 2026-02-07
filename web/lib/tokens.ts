import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { getConfig } from './env';

export interface TokenSet {
  refreshToken: string;
  accessToken?: string;
  expiresAt?: number;
}

export interface StoredTokens {
  google?: TokenSet;
  microsoft?: TokenSet;
}

function tokensPath(): string {
  return path.join(getConfig().stateDir, 'tokens.json');
}

export async function readTokens(): Promise<StoredTokens> {
  try {
    const raw = await readFile(tokensPath(), 'utf8');
    return JSON.parse(raw) as StoredTokens;
  } catch {
    return {};
  }
}

export async function saveTokens(tokens: StoredTokens): Promise<void> {
  const p = tokensPath();
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(tokens, null, 2) + '\n', 'utf8');
}

export async function saveProviderToken(
  provider: 'google' | 'microsoft',
  token: TokenSet,
): Promise<void> {
  const tokens = await readTokens();
  tokens[provider] = token;
  await saveTokens(tokens);
}

export async function deleteProviderToken(
  provider: 'google' | 'microsoft',
): Promise<void> {
  const tokens = await readTokens();
  delete tokens[provider];
  await saveTokens(tokens);
}
