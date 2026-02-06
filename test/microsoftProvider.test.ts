import { describe, expect, it } from 'vitest';
import { MicrosoftTodoProvider } from '../src/providers/microsoft.js';

function jsonResponse(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('MicrosoftTodoProvider', () => {
  it('lists tasks from first list and maps fields', async () => {
    const fetcher: typeof fetch = async (url, init) => {
      const u = String(url);

      if (u.includes('/oauth2/v2.0/token')) {
        return jsonResponse({
          token_type: 'Bearer',
          scope: 'Tasks.ReadWrite User.Read',
          expires_in: 3600,
          ext_expires_in: 3600,
          access_token: 'atok',
        });
      }

      if (u === 'https://graph.microsoft.com/v1.0/me/todo/lists') {
        return jsonResponse({ value: [{ id: 'L1', displayName: 'Tasks' }] });
      }

      if (u.startsWith('https://graph.microsoft.com/v1.0/me/todo/lists/L1/tasks')) {
        return jsonResponse({
          value: [
            {
              id: 'm1',
              title: 'Hi',
              body: { content: 'B', contentType: 'text' },
              dueDateTime: { dateTime: '2026-02-10T00:00:00.000Z', timeZone: 'UTC' },
              lastModifiedDateTime: '2026-02-06T00:00:00.000Z',
              createdDateTime: '2026-02-01T00:00:00.000Z',
            },
          ],
        });
      }

      return new Response('not found', { status: 404 });
    };

    const p = new MicrosoftTodoProvider({
      clientId: 'cid',
      tenantId: 'common',
      refreshToken: 'rtok',
      fetcher,
    });

    const tasks = await p.listTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: 'm1',
      title: 'Hi',
      notes: 'B',
      status: 'active',
      dueAt: '2026-02-10T00:00:00.000Z',
      updatedAt: '2026-02-06T00:00:00.000Z',
    });
  });
});
