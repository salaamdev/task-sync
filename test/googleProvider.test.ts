import { describe, expect, it } from 'vitest';
import { GoogleTasksProvider } from '../src/providers/google.js';

function jsonResponse(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('GoogleTasksProvider', () => {
  it('lists tasks and maps fields', async () => {
    const calls: string[] = [];

    const fetcher: typeof fetch = async (url, init) => {
      calls.push(`${init?.method ?? 'GET'} ${url.toString()}`);

      if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
        return jsonResponse({ access_token: 'atok', expires_in: 3600, token_type: 'Bearer' });
      }

      if (String(url).includes('https://tasks.googleapis.com/tasks/v1/lists/%40default/tasks')) {
        return jsonResponse({
          items: [
            {
              id: 'g1',
              title: 'Hello',
              notes: 'N',
              status: 'needsAction',
              updated: '2026-02-06T00:00:00.000Z',
              due: '2026-02-10T00:00:00.000Z',
            },
          ],
        });
      }

      return new Response('not found', { status: 404 });
    };

    const p = new GoogleTasksProvider({
      clientId: 'cid',
      clientSecret: 'sec',
      refreshToken: 'rtok',
      fetcher,
    });

    const tasks = await p.listTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: 'g1',
      title: 'Hello',
      notes: 'N',
      status: 'active',
      dueAt: '2026-02-10T00:00:00.000Z',
      updatedAt: '2026-02-06T00:00:00.000Z',
    });

    expect(calls.some((c) => c.includes('oauth2.googleapis.com/token'))).toBe(true);
  });
});
