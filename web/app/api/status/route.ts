import { NextResponse } from 'next/server';
import { getConfig, isGoogleConfigured, isMicrosoftConfigured } from '@/lib/env';
import { readTokens } from '@/lib/tokens';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const dynamic = 'force-dynamic';

export async function GET() {
  const config = getConfig();
  const tokens = await readTokens();

  // Read last sync state
  let lastSync: { at: string; mappings: number } | null = null;
  try {
    const statePath = path.join(config.stateDir, 'state.json');
    const raw = await readFile(statePath, 'utf8');
    const state = JSON.parse(raw) as { lastSyncAt?: string; mappings?: unknown[] };
    if (state.lastSyncAt) {
      lastSync = {
        at: state.lastSyncAt,
        mappings: Array.isArray(state.mappings) ? state.mappings.length : 0,
      };
    }
  } catch {
    // No state file yet — first run
  }

  return NextResponse.json({
    configured: {
      google: isGoogleConfigured(),
      microsoft: isMicrosoftConfigured(),
    },
    connected: {
      google: !!tokens.google?.refreshToken,
      microsoft: !!tokens.microsoft?.refreshToken,
    },
    lastSync,
  });
}
