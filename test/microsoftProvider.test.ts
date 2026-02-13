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
    const fetcher: typeof fetch = async (url, _init) => {
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
              recurrence: {
                pattern: {
                  type: 'weekly',
                  interval: 2,
                  daysOfWeek: ['monday', 'thursday'],
                  firstDayOfWeek: 'monday',
                },
                range: {
                  type: 'numbered',
                  startDate: '2026-02-01',
                  numberOfOccurrences: 10,
                  recurrenceTimeZone: 'UTC',
                },
              },
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
      dueAt: '2026-02-10T12:00:00.000Z',
      recurrence: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;WKST=MO;DTSTART=2026-02-01;COUNT=10;TZID=UTC',
      updatedAt: '2026-02-06T00:00:00.000Z',
    });
  });

  it('sends recurrence on PATCH without startDate and with dueDateTime', async () => {
    let patchBody: Record<string, unknown> | undefined;

    const fetcher: typeof fetch = async (url, init) => {
      const u = String(url);
      const method = init?.method ?? 'GET';

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

      if (method === 'PATCH' && u === 'https://graph.microsoft.com/v1.0/me/todo/lists/L1/tasks/m1') {
        patchBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        return jsonResponse({
          id: 'm1',
          title: patchBody.title,
          body: { content: '', contentType: 'text' },
          recurrence: {
            pattern: {
              type: 'weekly',
              interval: 2,
              daysOfWeek: ['monday', 'thursday'],
              firstDayOfWeek: 'monday',
            },
            range: {
              type: 'numbered',
              startDate: '2026-02-01',
              numberOfOccurrences: 10,
              recurrenceTimeZone: 'UTC',
            },
          },
          lastModifiedDateTime: '2026-02-10T09:30:00.000Z',
          createdDateTime: '2026-02-01T00:00:00.000Z',
        });
      }

      return new Response('not found', { status: 404 });
    };

    const p = new MicrosoftTodoProvider({
      clientId: 'cid',
      tenantId: 'common',
      refreshToken: 'rtok',
      fetcher,
      listId: 'L1',
    });

    const recurrence = 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;WKST=MO;DTSTART=2026-02-01;COUNT=10;TZID=UTC';

    const updated = await p.upsertTask({
      id: 'm1',
      title: 'Recurring task',
      status: 'active',
      dueAt: '2026-02-10T12:00:00.000Z',
      recurrence,
      updatedAt: '2026-02-10T09:30:00.000Z',
    });

    const rec = patchBody?.recurrence as {
      pattern?: { type?: string; interval?: number; daysOfWeek?: string[]; firstDayOfWeek?: string };
      range?: { type?: string; startDate?: string; numberOfOccurrences?: number; recurrenceTimeZone?: string };
    } | undefined;

    expect(rec?.pattern).toMatchObject({
      type: 'weekly',
      interval: 2,
      daysOfWeek: ['monday', 'thursday'],
      firstDayOfWeek: 'monday',
    });
    expect(rec?.range).toMatchObject({
      type: 'numbered',
      numberOfOccurrences: 10,
      recurrenceTimeZone: 'UTC',
    });
    expect(rec?.range?.startDate).toBeUndefined();

    expect(patchBody?.dueDateTime).toMatchObject({
      dateTime: '2026-02-10T12:00:00.000Z',
      timeZone: 'UTC',
    });

    expect(updated.recurrence).toContain('FREQ=WEEKLY');
    expect(updated.recurrence).toContain('BYDAY=MO,TH');
    expect(updated.recurrence).toContain('COUNT=10');
  });

  it('adds fallback dueDateTime on PATCH recurrence when dueAt is missing', async () => {
    let patchBody: Record<string, unknown> | undefined;

    const fetcher: typeof fetch = async (url, init) => {
      const u = String(url);
      const method = init?.method ?? 'GET';

      if (u.includes('/oauth2/v2.0/token')) {
        return jsonResponse({
          token_type: 'Bearer',
          scope: 'Tasks.ReadWrite User.Read',
          expires_in: 3600,
          ext_expires_in: 3600,
          access_token: 'atok',
        });
      }

      if (u === 'https://graph.microsoft.com/v1.0/me/todo/lists/L1/tasks/m1' && method === 'PATCH') {
        patchBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        return jsonResponse({
          id: 'm1',
          title: 'Recurring task',
          recurrence: {
            pattern: {
              type: 'weekly',
              interval: 1,
              daysOfWeek: ['monday', 'wednesday'],
              firstDayOfWeek: 'sunday',
            },
            range: {
              type: 'noEnd',
              startDate: '2026-02-20',
              recurrenceTimeZone: 'UTC',
            },
          },
          lastModifiedDateTime: '2026-02-10T09:30:00.000Z',
          createdDateTime: '2026-02-01T00:00:00.000Z',
        });
      }

      return jsonResponse({ value: [{ id: 'L1', displayName: 'Tasks' }] });
    };

    const p = new MicrosoftTodoProvider({
      clientId: 'cid',
      tenantId: 'common',
      refreshToken: 'rtok',
      fetcher,
      listId: 'L1',
    });

    await p.upsertTask({
      id: 'm1',
      title: 'Recurring task',
      status: 'active',
      recurrence: 'FREQ=WEEKLY;BYDAY=MO,WE;DTSTART=2026-02-20;TZID=UTC',
      updatedAt: '2026-02-10T09:30:00.000Z',
    });

    expect(patchBody?.dueDateTime).toMatchObject({
      dateTime: '2026-02-20T12:00:00.000Z',
      timeZone: 'UTC',
    });

    const rec = patchBody?.recurrence as { range?: { startDate?: string } } | undefined;
    expect(rec?.range?.startDate).toBeUndefined();
  });
});
