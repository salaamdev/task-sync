import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Minimal .env loader (no external deps).
 *
 * - Reads KEY=VALUE lines
 * - Ignores comments and empty lines
 * - Does not override existing process.env keys
 */
export function loadEnvFiles(
  filenames: string[] = ['.env', '.env.local'],
  cwd: string = process.cwd(),
): { loaded: string[] } {
  const loaded: string[] = [];

  for (const name of filenames) {
    const filePath = path.join(cwd, name);
    if (!existsSync(filePath)) continue;

    const raw = readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();

      // strip surrounding quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (!key) continue;
      if (process.env[key] === undefined) process.env[key] = value;
    }

    loaded.push(name);
  }

  return { loaded };
}
