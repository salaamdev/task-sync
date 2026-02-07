import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ChildProcess, spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { writeFile, mkdir, rm, readFile, stat } from 'node:fs/promises';

const WEB_DIR = path.resolve(import.meta.dirname, '..', 'web');
const STATE_DIR = path.resolve(import.meta.dirname, '..', '.task-sync-test-web');
const PORT = 3099;
const BASE = `http://localhost:${PORT}`;

let server: ChildProcess;

/**
 * End-to-end tests for the web UI API routes.
 *
 * These tests start a Next.js production server and exercise the API
 * without real OAuth credentials — they validate routing, error handling,
 * token storage, and status reporting.
 */

async function waitForServer(url: string, timeoutMs = 180_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return;
    } catch {
      // server not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

beforeAll(async () => {
  // Create test state directory
  await mkdir(STATE_DIR, { recursive: true });

  // Create a minimal .env.local for testing (no real credentials)
  const envContent = [
    'TASK_SYNC_GOOGLE_CLIENT_ID=test-google-id',
    'TASK_SYNC_GOOGLE_CLIENT_SECRET=test-google-secret',
    'TASK_SYNC_MS_CLIENT_ID=test-ms-id',
    'TASK_SYNC_MS_TENANT_ID=consumers',
    `TASK_SYNC_STATE_DIR=${STATE_DIR}`,
  ].join('\n');

  // Write to project root .env (the web app reads from parent)
  await writeFile(path.resolve(import.meta.dirname, '..', '.env.test'), envContent);

  // Ensure web dependencies exist in CI (root npm ci does not install ./web)
  const webNodeModules = path.join(WEB_DIR, 'node_modules');
  const hasWebDeps = await stat(webNodeModules).then(() => true).catch(() => false);

  // In GitHub Actions, the workflow does `npm ci` at repo root only.
  // These E2E tests need ./web dependencies, so we install them here.
  if (process.env.CI && !hasWebDeps) {
    const res = spawnSync('npm', ['ci'], { cwd: WEB_DIR, stdio: 'inherit' });
    if (res.status !== 0) throw new Error(`web npm ci failed: ${res.status}`);
  }

  // Start a Next.js dev server (avoids requiring a pre-built .next directory in CI)
  server = spawn('npx', ['next', 'dev', '-p', String(PORT)], {
    cwd: WEB_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      TASK_SYNC_GOOGLE_CLIENT_ID: 'test-google-id',
      TASK_SYNC_GOOGLE_CLIENT_SECRET: 'test-google-secret',
      TASK_SYNC_MS_CLIENT_ID: 'test-ms-id',
      TASK_SYNC_MS_TENANT_ID: 'consumers',
      TASK_SYNC_STATE_DIR: STATE_DIR,
    },
    stdio: 'pipe',
  });

  server.stdout?.on('data', (d) => process.stdout.write(String(d)));
  server.stderr?.on('data', (d) => process.stderr.write(String(d)));

  await waitForServer(`${BASE}/api/status`, 180_000);
}, 180_000);

afterAll(async () => {
  server?.kill('SIGTERM');
  // Wait for process to exit
  await new Promise((r) => setTimeout(r, 1000));
  // Cleanup
  await rm(STATE_DIR, { recursive: true, force: true }).catch(() => {});
  await rm(path.resolve(import.meta.dirname, '..', '.env.test'), { force: true }).catch(
    () => {},
  );
});

describe('Web API — /api/status', () => {
  it('returns configuration and connection status', async () => {
    const res = await fetch(`${BASE}/api/status`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as { configured: { google: boolean; microsoft: boolean }; connected: { google: boolean; microsoft: boolean }; lastSync: unknown };
    expect(data).toHaveProperty('configured');
    expect(data).toHaveProperty('connected');
    expect(data.configured.google).toBe(true);
    expect(data.configured.microsoft).toBe(true);
    expect(data.connected.google).toBe(false);
    expect(data.connected.microsoft).toBe(false);
    expect(data.lastSync).toBeNull();
  });
});

describe('Web API — /api/auth', () => {
  it('GET /api/auth/google redirects to Google consent', async () => {
    const res = await fetch(`${BASE}/api/auth/google`, { redirect: 'manual' });
    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('accounts.google.com');
    expect(location).toContain('client_id=test-google-id');
    expect(location).toContain('scope=');
  });

  it('GET /api/auth/microsoft redirects to Microsoft consent', async () => {
    const res = await fetch(`${BASE}/api/auth/microsoft`, { redirect: 'manual' });
    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('login.microsoftonline.com');
    expect(location).toContain('client_id=test-ms-id');
  });

  it('GET /api/auth/google/callback with error param redirects with error', async () => {
    const res = await fetch(`${BASE}/api/auth/google/callback?error=access_denied`, {
      redirect: 'manual',
    });
    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('error=google_access_denied');
  });

  it('GET /api/auth/microsoft/callback with error param redirects with error', async () => {
    const res = await fetch(
      `${BASE}/api/auth/microsoft/callback?error=access_denied`,
      { redirect: 'manual' },
    );
    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('error=microsoft_access_denied');
  });
});

describe('Web API — /api/sync', () => {
  it('returns error when providers are not connected', async () => {
    const res = await fetch(`${BASE}/api/sync`, { method: 'POST' });
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain('connected');
  });
});

describe('Web API — /api/disconnect', () => {
  it('DELETE /api/disconnect/google succeeds even with no token', async () => {
    const res = await fetch(`${BASE}/api/disconnect/google`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean };
    expect(data.ok).toBe(true);
  });

  it('DELETE /api/disconnect/invalid returns 400', async () => {
    const res = await fetch(`${BASE}/api/disconnect/invalid`, { method: 'DELETE' });
    expect(res.status).toBe(400);
  });

  it('token storage round-trip works', async () => {
    // Simulate saving a token by writing directly
    const tokensPath = path.join(STATE_DIR, 'tokens.json');
    await writeFile(
      tokensPath,
      JSON.stringify({ google: { refreshToken: 'test-token' } }),
    );

    // Status should now show google as connected
    const statusRes = await fetch(`${BASE}/api/status`);
    const status = (await statusRes.json()) as { connected: { google: boolean } };
    expect(status.connected.google).toBe(true);

    // Disconnect
    await fetch(`${BASE}/api/disconnect/google`, { method: 'DELETE' });

    // Verify token was removed
    const raw = await readFile(tokensPath, 'utf8');
    const tokens = JSON.parse(raw);
    expect(tokens.google).toBeUndefined();
  });
});

describe('Web UI — page', () => {
  it('serves the dashboard HTML', async () => {
    const res = await fetch(BASE);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Task Sync');
  });
});
