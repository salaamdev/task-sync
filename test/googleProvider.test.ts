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

  it('exports and re-imports recurrence as machine metadata', async () => {
    let postedNotes = '';

    const fetcher: typeof fetch = async (url, init) => {
      const u = String(url);
      const method = init?.method ?? 'GET';

      if (u.startsWith('https://oauth2.googleapis.com/token')) {
        return jsonResponse({ access_token: 'atok', expires_in: 3600, token_type: 'Bearer' });
      }

      if (
        method === 'POST'
        && u.startsWith('https://tasks.googleapis.com/tasks/v1/lists/%40default/tasks')
      ) {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        postedNotes = String(body.notes ?? '');
        return jsonResponse({
          id: 'g-new',
          title: body.title,
          notes: body.notes,
          status: 'needsAction',
          updated: '2026-02-10T09:00:00.000Z',
          due: body.due,
        });
      }

      if (
        method === 'GET'
        && u.startsWith('https://tasks.googleapis.com/tasks/v1/lists/%40default/tasks')
      ) {
        return jsonResponse({
          items: [
            {
              id: 'g-new',
              title: 'Recurring task',
              notes: postedNotes,
              status: 'needsAction',
              updated: '2026-02-10T09:00:00.000Z',
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

    const recurrence = 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;WKST=MO;DTSTART=2026-02-01;COUNT=10;TZID=UTC';

    const created = await p.upsertTask({
      id: '',
      title: 'Recurring task',
      status: 'active',
      recurrence,
      updatedAt: '2026-02-10T09:00:00.000Z',
    });

    expect(postedNotes).toContain(`[task-sync]`);
    expect(postedNotes).toContain(`recurrence: ${recurrence}`);
    expect(created.recurrence).toBe(recurrence);

    const listed = await p.listTasks();
    expect(listed[0]?.recurrence).toBe(recurrence);
  });

  it('imports legacy human recurrence metadata from Google notes', async () => {
    const fetcher: typeof fetch = async (url) => {
      const u = String(url);

      if (u.startsWith('https://oauth2.googleapis.com/token')) {
        return jsonResponse({ access_token: 'atok', expires_in: 3600, token_type: 'Bearer' });
      }

      if (u.startsWith('https://tasks.googleapis.com/tasks/v1/lists/%40default/tasks')) {
        return jsonResponse({
          items: [
            {
              id: 'g-legacy',
              title: 'Legacy recurring',
              notes: '[task-sync]\nrepeat: Every 2 weeks on Mon, Thu (10 times)\n[/task-sync]',
              status: 'needsAction',
              updated: '2026-02-10T09:00:00.000Z',
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
    expect(tasks[0]?.recurrence).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;COUNT=10');
  });
});
