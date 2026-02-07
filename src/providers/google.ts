import type { Task } from '../model.js';
import type { TaskProvider } from './provider.js';
import { requestJson, type FetchLike } from '../http.js';

export interface GoogleTasksProviderOptions {
  /** OAuth client id */
  clientId: string;
  /** OAuth client secret */
  clientSecret: string;
  /** OAuth refresh token */
  refreshToken: string;
  /** Task list id (defaults to '@default' for Google Tasks) */
  tasklistId?: string;
  /** Inject fetch for tests */
  fetcher?: FetchLike;
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

interface GoogleTask {
  id: string;
  title: string;
  notes?: string;
  status: 'needsAction' | 'completed';
  due?: string;
  updated: string;
}

interface GoogleListTasksResponse {
  items?: GoogleTask[];
  nextPageToken?: string;
}

function toCanonical(t: GoogleTask): Task {
  return {
    id: t.id,
    title: t.title,
    notes: t.notes,
    status: t.status === 'completed' ? 'completed' : 'active',
    dueAt: t.due,
    updatedAt: t.updated,
  };
}

export class GoogleTasksProvider implements TaskProvider {
  readonly name = 'google' as const;

  private fetcher: FetchLike;
  private accessToken?: { token: string; expMs: number };

  constructor(private opts: GoogleTasksProviderOptions) {
    this.fetcher = opts.fetcher ?? fetch;
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && this.accessToken.expMs - 30_000 > now) return this.accessToken.token;

    const body = new URLSearchParams({
      client_id: this.opts.clientId,
      client_secret: this.opts.clientSecret,
      refresh_token: this.opts.refreshToken,
      grant_type: 'refresh_token',
    });

    const res = await this.fetcher('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Google token refresh failed: HTTP ${res.status} ${txt}`);
    }

    const json = (await res.json()) as GoogleTokenResponse;
    this.accessToken = { token: json.access_token, expMs: now + json.expires_in * 1000 };
    return json.access_token;
  }

  private async api<T>(path: string, init?: Parameters<typeof requestJson<T>>[1]): Promise<T> {
    const token = await this.getAccessToken();
    const base = `https://tasks.googleapis.com/tasks/v1`;
    return requestJson<T>(`${base}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init?.headers ?? {}) } }, this.fetcher);
  }

  async listTasks(since?: string): Promise<Task[]> {
    const tasklistId = this.opts.tasklistId ?? '@default';

    const out: Task[] = [];
    let pageToken: string | undefined;

    do {
      const res = await this.api<GoogleListTasksResponse>(`/lists/${encodeURIComponent(tasklistId)}/tasks`, {
        query: {
          maxResults: 100,
          showCompleted: true,
          showHidden: true,
          pageToken,
          // Server-side filter: Google Tasks API supports updatedMin (RFC3339,
          // returns tasks updated at-or-after the timestamp). This avoids
          // fetching the full task list when only recent changes are needed.
          ...(since ? { updatedMin: since } : {}),
        },
      });

      for (const t of res.items ?? []) out.push(toCanonical(t));
      pageToken = res.nextPageToken;
    } while (pageToken);

    return out;
  }

  async upsertTask(input: Omit<Task, 'updatedAt'> & { updatedAt?: string }): Promise<Task> {
    const tasklistId = this.opts.tasklistId ?? '@default';
    const isCreate = !input.id;

    const payload: Partial<GoogleTask> = {
      title: input.title,
      notes: input.notes,
      status: input.status === 'completed' ? 'completed' : 'needsAction',
      due: input.dueAt,
    };

    const res = isCreate
      ? await this.api<GoogleTask>(`/lists/${encodeURIComponent(tasklistId)}/tasks`, {
          method: 'POST',
          body: payload,
        })
      : await this.api<GoogleTask>(
          `/lists/${encodeURIComponent(tasklistId)}/tasks/${encodeURIComponent(input.id)}`,
          {
            method: 'PATCH',
            body: payload,
          },
        );

    // Google sets updated server-side.
    return toCanonical(res);
  }

  async deleteTask(id: string): Promise<void> {
    const tasklistId = this.opts.tasklistId ?? '@default';
    await this.api<void>(`/lists/${encodeURIComponent(tasklistId)}/tasks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }
}
