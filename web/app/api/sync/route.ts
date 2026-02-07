import { NextResponse } from 'next/server';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getConfig } from '@/lib/env';
import { readTokens } from '@/lib/tokens';

/**
 * Load core engine modules at runtime from the pre-built dist/.
 *
 * We use native dynamic import (webpackIgnore) so that Next.js does not try
 * to bundle the core — it is compiled separately by tsup.
 */
async function loadCore() {
  const distDir = path.resolve(process.cwd(), '..', 'dist');
  const toUrl = (name: string) =>
    pathToFileURL(path.join(distDir, name)).href;

  const engineUrl = toUrl('sync/engine.js');
  const storeUrl = toUrl('store/jsonStore.js');
  const googleUrl = toUrl('providers/google.js');
  const microsoftUrl = toUrl('providers/microsoft.js');

  const [engine, store, google, microsoft] = await Promise.all([
    import(/* webpackIgnore: true */ engineUrl),
    import(/* webpackIgnore: true */ storeUrl),
    import(/* webpackIgnore: true */ googleUrl),
    import(/* webpackIgnore: true */ microsoftUrl),
  ]);

  return {
    SyncEngine: engine.SyncEngine,
    JsonStore: store.JsonStore,
    GoogleTasksProvider: google.GoogleTasksProvider,
    MicrosoftTodoProvider: microsoft.MicrosoftTodoProvider,
  };
}

export async function POST() {
  const config = getConfig();
  const tokens = await readTokens();

  if (!tokens.google?.refreshToken || !tokens.microsoft?.refreshToken) {
    return NextResponse.json(
      { error: 'Both providers must be connected before syncing.' },
      { status: 400 },
    );
  }

  if (!config.googleClientId || !config.googleClientSecret) {
    return NextResponse.json(
      { error: 'Google OAuth credentials not configured.' },
      { status: 400 },
    );
  }

  if (!config.msClientId) {
    return NextResponse.json(
      { error: 'Microsoft OAuth credentials not configured.' },
      { status: 400 },
    );
  }

  try {
    const { SyncEngine, JsonStore, GoogleTasksProvider, MicrosoftTodoProvider } =
      await loadCore();

    const store = new JsonStore(config.stateDir);
    const engine = new SyncEngine(store);

    const providers = [
      new GoogleTasksProvider({
        clientId: config.googleClientId,
        clientSecret: config.googleClientSecret,
        refreshToken: tokens.google.refreshToken,
        tasklistId: config.googleTasklistId,
      }),
      new MicrosoftTodoProvider({
        clientId: config.msClientId,
        tenantId: config.msTenantId,
        refreshToken: tokens.microsoft.refreshToken,
        clientSecret: config.msClientSecret || undefined,
        listId: config.msListId,
      }),
    ];

    const report = await engine.syncMany(providers, {
      mode: 'bidirectional',
      tombstoneTtlDays: 30,
    });

    return NextResponse.json(report);
  } catch (e) {
    console.error('Sync error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
