import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

let loaded = false;

/** Project root directory (parent of web/) */
export function projectRoot(): string {
  return path.resolve(process.cwd(), '..');
}

/** Load .env and .env.local from the project root */
export function loadParentEnv(): void {
  if (loaded) return;
  loaded = true;

  const root = projectRoot();
  for (const name of ['.env', '.env.local']) {
    const filePath = path.join(root, name);
    if (!existsSync(filePath)) continue;

    const raw = readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (!key) continue;
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

export interface AppConfig {
  googleClientId: string;
  googleClientSecret: string;
  googleTasklistId?: string;

  msClientId: string;
  msClientSecret: string;
  msTenantId: string;
  msListId?: string;

  stateDir: string;
  logLevel: string;
}

export function getConfig(): AppConfig {
  loadParentEnv();
  const root = projectRoot();
  return {
    googleClientId: process.env.TASK_SYNC_GOOGLE_CLIENT_ID ?? '',
    googleClientSecret: process.env.TASK_SYNC_GOOGLE_CLIENT_SECRET ?? '',
    googleTasklistId: process.env.TASK_SYNC_GOOGLE_TASKLIST_ID,

    msClientId: process.env.TASK_SYNC_MS_CLIENT_ID ?? '',
    msClientSecret: process.env.TASK_SYNC_MS_CLIENT_SECRET ?? '',
    msTenantId: process.env.TASK_SYNC_MS_TENANT_ID ?? 'consumers',
    msListId: process.env.TASK_SYNC_MS_LIST_ID,

    stateDir: process.env.TASK_SYNC_STATE_DIR
      ? path.resolve(root, process.env.TASK_SYNC_STATE_DIR)
      : path.join(root, '.task-sync'),
    logLevel: process.env.TASK_SYNC_LOG_LEVEL ?? 'info',
  };
}

export function isGoogleConfigured(): boolean {
  const config = getConfig();
  return !!(config.googleClientId && config.googleClientSecret);
}

export function isMicrosoftConfigured(): boolean {
  const config = getConfig();
  return !!config.msClientId;
}
