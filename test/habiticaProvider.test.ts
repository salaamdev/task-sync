import { describe, expect, it } from 'vitest';
import { HabiticaProvider } from '../src/providers/habitica.js';

function jsonResponse(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('HabiticaProvider', () => {
  it('lists todos and maps fields', async () => {
    const fetcher: typeof fetch = async (url) => {
      const u = String(url);
      if (u.startsWith('https://habitica.com/api/v3/tasks/user')) {
        return jsonResponse({
          success: true,
          data: [
            {
              id: 'h1',
              type: 'todo',
              text: 'Do it',
              notes: 'note',
              completed: false,
              date: '2026-02-10T00:00:00.000Z',
              updatedAt: '2026-02-06T00:00:00.000Z',
            },
          ],
        });
      }
      return new Response('not found', { status: 404 });
    };

    const p = new HabiticaProvider({ userId: 'u', apiToken: 'k', fetcher });
    const tasks = await p.listTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: 'h1',
      title: 'Do it',
      notes: 'note',
      status: 'active',
      dueAt: '2026-02-10T00:00:00.000Z',
      updatedAt: '2026-02-06T00:00:00.000Z',
    });
  });
});
