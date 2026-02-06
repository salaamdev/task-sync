import type { Task } from '../model.js';
import type { TaskProvider } from './provider.js';
import { requestJson, type FetchLike } from '../http.js';

export interface MicrosoftTodoProviderOptions {
  /** Azure AD app client id */
  clientId: string;
  /** Tenant id (or 'common') */
  tenantId: string;
  /** OAuth refresh token */
  refreshToken: string;
  /** Task list id (defaults to first list) */
  listId?: string;
  /** Inject fetch for tests */
  fetcher?: FetchLike;
}

interface MsTokenResponse {
  token_type: string;
  scope: string;
  expires_in: number;
  ext_expires_in: number;
  access_token: string;
  /** Microsoft may rotate refresh tokens. If present, you must use the new one going forward. */
  refresh_token?: string;
}

interface GraphTodoList {
  id: string;
  displayName: string;
}

interface GraphListListsResponse {
  value: GraphTodoList[];
}

interface GraphBody {
  content: string;
  contentType: 'text' | 'html';
}

interface GraphTask {
  id: string;
  title: string;
  body?: GraphBody;
  dueDateTime?: { dateTime: string; timeZone: string };
  completedDateTime?: { dateTime: string; timeZone: string };
  lastModifiedDateTime: string;
  createdDateTime: string;
}

interface GraphListTasksResponse {
  value: GraphTask[];
  '@odata.nextLink'?: string;
}

function toCanonical(t: GraphTask): Task {
  return {
    id: t.id,
    title: t.title,
    notes: t.body?.content,
    status: t.completedDateTime ? 'completed' : 'active',
    dueAt: t.dueDateTime?.dateTime,
    updatedAt: t.lastModifiedDateTime,
  };
}

export class MicrosoftTodoProvider implements TaskProvider {
  readonly name = 'microsoft' as const;

  private fetcher: FetchLike;
  private accessToken?: { token: string; expMs: number };
  private resolvedListId?: string;

  constructor(private opts: MicrosoftTodoProviderOptions) {
    this.fetcher = opts.fetcher ?? fetch;
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && this.accessToken.expMs - 30_000 > now) return this.accessToken.token;

    const body = new URLSearchParams({
      client_id: this.opts.clientId,
      refresh_token: this.opts.refreshToken,
      grant_type: 'refresh_token',
      // Keep scopes aligned with initial consent. Use Graph resource scopes.
      scope: 'offline_access https://graph.microsoft.com/Tasks.ReadWrite https://graph.microsoft.com/User.Read',
    });

    const url = `https://login.microsoftonline.com/${encodeURIComponent(this.opts.tenantId)}/oauth2/v2.0/token`;
    const res = await this.fetcher(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Microsoft token refresh failed: HTTP ${res.status} ${txt}`);
    }

    const json = (await res.json()) as MsTokenResponse;

    // Microsoft can rotate refresh tokens. Keep using the latest one in-memory so polling works.
    if (json.refresh_token) this.opts.refreshToken = json.refresh_token;

    this.accessToken = { token: json.access_token, expMs: now + json.expires_in * 1000 };
    return json.access_token;
  }

  private async api<T>(pathOrUrl: string, init?: Parameters<typeof requestJson<T>>[1]): Promise<T> {
    const token = await this.getAccessToken();
    const base = `https://graph.microsoft.com/v1.0`;
    const url = pathOrUrl.startsWith('https://') ? pathOrUrl : `${base}${pathOrUrl}`;
    return requestJson<T>(url, { ...init, headers: { authorization: `Bearer ${token}`, ...(init?.headers ?? {}) } }, this.fetcher);
  }

  private async getListId(): Promise<string> {
    if (this.resolvedListId) return this.resolvedListId;
    if (this.opts.listId) {
      this.resolvedListId = this.opts.listId;
      return this.opts.listId;
    }

    const lists = await this.api<GraphListListsResponse>(`/me/todo/lists`);
    const first = lists.value?.[0];
    if (!first) throw new Error('Microsoft To Do: no lists found for this account');
    this.resolvedListId = first.id;
    return first.id;
  }

  async listTasks(since?: string): Promise<Task[]> {
    const listId = await this.getListId();

    const out: Task[] = [];
    let next: string | undefined = `/me/todo/lists/${encodeURIComponent(listId)}/tasks?$top=100`;

    while (next) {
      const url = next;
      const res: GraphListTasksResponse = await this.api<GraphListTasksResponse>(url);
      for (const t of res.value ?? []) out.push(toCanonical(t));
      next = res['@odata.nextLink'];
    }

    if (!since) return out;
    const sinceMs = Date.parse(since);
    return out.filter((t) => Date.parse(t.updatedAt) >= sinceMs);
  }

  async upsertTask(input: Omit<Task, 'updatedAt'> & { updatedAt?: string }): Promise<Task> {
    const listId = await this.getListId();
    const isCreate = !input.id;

    const payload: Partial<GraphTask> & { body?: GraphBody } = {
      title: input.title,
      body: input.notes
        ? {
            contentType: 'text',
            content: input.notes,
          }
        : undefined,
      dueDateTime: input.dueAt
        ? {
            dateTime: input.dueAt,
            timeZone: 'UTC',
          }
        : undefined,
      completedDateTime: input.status === 'completed' ? { dateTime: new Date().toISOString(), timeZone: 'UTC' } : undefined,
    };

    const res = isCreate
      ? await this.api<GraphTask>(`/me/todo/lists/${encodeURIComponent(listId)}/tasks`, {
          method: 'POST',
          body: payload,
        })
      : await this.api<GraphTask>(
          `/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(input.id)}`,
          {
            method: 'PATCH',
            body: payload,
          },
        );

    return toCanonical(res);
  }

  async deleteTask(id: string): Promise<void> {
    const listId = await this.getListId();
    await this.api<void>(`/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }
}
