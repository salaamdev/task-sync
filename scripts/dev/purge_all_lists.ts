import { loadEnvFiles } from '../../src/env.js';
import { readEnv } from '../../src/config.js';

type FetchLike = typeof fetch;

type QueryValue = string | number | boolean | null | undefined;
type RequestInitWithQuery = RequestInit & { query?: Record<string, QueryValue> };

async function requestJson<T>(url: string, init: RequestInitWithQuery = {}, fetcher: FetchLike = fetch): Promise<T> {
  const u = new URL(url);
  if (init.query) {
    for (const [k, v] of Object.entries(init.query)) {
      if (v === undefined || v === null || v === '') continue;
      u.searchParams.set(k, String(v));
    }
  }
  const res = await fetcher(u.toString(), {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
    body:
      init.body && typeof init.body !== 'string' && !(init.body instanceof URLSearchParams)
        ? JSON.stringify(init.body)
        : (init.body as BodyInit | null | undefined),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} for ${u.toString()} ${txt}`);
  }
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

async function getGoogleAccessToken(env: ReturnType<typeof readEnv>, fetcher: FetchLike = fetch) {
  const body = new URLSearchParams({
    client_id: env.TASK_SYNC_GOOGLE_CLIENT_ID!,
    client_secret: env.TASK_SYNC_GOOGLE_CLIENT_SECRET!,
    refresh_token: env.TASK_SYNC_GOOGLE_REFRESH_TOKEN!,
    grant_type: 'refresh_token',
  });
  const res = await fetcher('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Google token refresh failed: HTTP ${res.status} ${txt}`);
  }
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

async function getMicrosoftAccessToken(env: ReturnType<typeof readEnv>, fetcher: FetchLike = fetch) {
  const body = new URLSearchParams({
    client_id: env.TASK_SYNC_MS_CLIENT_ID!,
    refresh_token: env.TASK_SYNC_MS_REFRESH_TOKEN!,
    grant_type: 'refresh_token',
    scope: 'offline_access https://graph.microsoft.com/Tasks.ReadWrite https://graph.microsoft.com/User.Read',
  });
  const url = `https://login.microsoftonline.com/${encodeURIComponent(env.TASK_SYNC_MS_TENANT_ID!)}/oauth2/v2.0/token`;
  const res = await fetcher(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Microsoft token refresh failed: HTTP ${res.status} ${txt}`);
  }
  const json = (await res.json()) as { access_token: string; refresh_token?: string };
  return { accessToken: json.access_token, rotatedRefreshToken: json.refresh_token };
}

async function purgeGoogleAllLists(env: ReturnType<typeof readEnv>) {
  console.log('GOOGLE: purge all tasklists');
  const token = await getGoogleAccessToken(env);
  const base = 'https://tasks.googleapis.com/tasks/v1';

  type ListResp = { items?: Array<{ id: string; title: string }>; nextPageToken?: string };
  let pageToken: string | undefined;
  const lists: Array<{ id: string; title: string }> = [];
  do {
    const r = await requestJson<ListResp>(`${base}/users/@me/lists`, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
      query: { maxResults: 100, pageToken },
    });
    for (const it of r.items ?? []) lists.push({ id: it.id, title: it.title });
    pageToken = r.nextPageToken;
  } while (pageToken);

  console.log(`GOOGLE: found ${lists.length} tasklists`);

  let totalDeleted = 0;
  for (const l of lists) {
    type TasksResp = { items?: Array<{ id: string; title: string }>; nextPageToken?: string };
    let tPage: string | undefined;
    const taskIds: string[] = [];
    do {
      const r = await requestJson<TasksResp>(`${base}/lists/${encodeURIComponent(l.id)}/tasks`, {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
        query: { maxResults: 100, showCompleted: true, showHidden: true, pageToken: tPage },
      });
      for (const t of r.items ?? []) taskIds.push(t.id);
      tPage = r.nextPageToken;
    } while (tPage);

    console.log(`GOOGLE: list=${JSON.stringify(l.title)} id=${l.id} tasks=${taskIds.length}`);

    for (const id of taskIds) {
      await requestJson<void>(`${base}/lists/${encodeURIComponent(l.id)}/tasks/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      });
      totalDeleted++;
    }
  }

  console.log(`GOOGLE: deleted ${totalDeleted} tasks across all lists`);
}

async function purgeMicrosoftAllLists(env: ReturnType<typeof readEnv>) {
  console.log('MICROSOFT: purge all To Do lists');
  const { accessToken } = await getMicrosoftAccessToken(env);
  const base = 'https://graph.microsoft.com/v1.0';

  type ListsResp = { value: Array<{ id: string; displayName: string }> };
  const lists = await requestJson<ListsResp>(`${base}/me/todo/lists`, {
    method: 'GET',
    headers: { authorization: `Bearer ${accessToken}` },
  });

  console.log(`MICROSOFT: found ${lists.value.length} lists`);

  let totalDeleted = 0;
  for (const l of lists.value) {
    type TasksResp = { value: Array<{ id: string; title: string }>; '@odata.nextLink'?: string };
    let next: string | undefined = `${base}/me/todo/lists/${encodeURIComponent(l.id)}/tasks?$top=100`;
    const taskIds: string[] = [];
    while (next) {
      const r = await requestJson<TasksResp>(next, {
        method: 'GET',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      for (const t of r.value ?? []) taskIds.push(t.id);
      next = r['@odata.nextLink'];
    }

    console.log(`MICROSOFT: list=${JSON.stringify(l.displayName)} id=${l.id} tasks=${taskIds.length}`);

    for (const id of taskIds) {
      await requestJson<void>(`${base}/me/todo/lists/${encodeURIComponent(l.id)}/tasks/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      totalDeleted++;
    }
  }

  console.log(`MICROSOFT: deleted ${totalDeleted} tasks across all lists`);
}

async function purgeHabiticaAllTodos(env: ReturnType<typeof readEnv>) {
  console.log('HABITICA: purge all todos');
  const base = 'https://habitica.com/api/v3';
  const headers = {
    'x-api-user': env.TASK_SYNC_HABITICA_USER_ID!,
    'x-api-key': env.TASK_SYNC_HABITICA_API_TOKEN!,
    'x-client': 'task-sync (salaamdev)',
  };

  const res = await requestJson<{ success: boolean; data: Array<{ id: string; text: string; type: string }> }>(`${base}/tasks/user`, {
    method: 'GET',
    headers,
    query: { type: 'todos' },
  });

  const todos = (res.data ?? []).filter((t) => t.type === 'todo');
  console.log(`HABITICA: found ${todos.length} todos`);

  let ok = 0;
  for (const t of todos) {
    await requestJson<void>(`${base}/tasks/${encodeURIComponent(t.id)}`, { method: 'DELETE', headers });
    ok++;
  }
  console.log(`HABITICA: deleted ${ok} todos`);
}

async function main() {
  loadEnvFiles();
  const env = readEnv();

  console.log('PURGE ALL LISTS: deleting tasks across ALL lists in Google Tasks + Microsoft To Do, and all Habitica todos.');

  await purgeGoogleAllLists(env);
  await purgeMicrosoftAllLists(env);
  await purgeHabiticaAllTodos(env);

  console.log('PURGE ALL LISTS DONE');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
