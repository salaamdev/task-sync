import type { Task, Importance } from '../model.js';
import type { TaskProvider } from './provider.js';
import { requestJson, type FetchLike } from '../http.js';
import {
  serializeRecurrence,
  deserializeRecurrence,
  extractTimeFromIso,
  combineDateAndTime,
  normalizeDateOnly,
  type GraphRecurrence,
} from '../extended-fields.js';

export interface MicrosoftTodoProviderOptions {
  /** Azure AD app client id */
  clientId: string;
  /** Tenant id (or 'common') */
  tenantId: string;
  /** OAuth refresh token */
  refreshToken: string;
  /** Client secret (required for confidential/web clients) */
  clientSecret?: string;
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

interface GraphDateTimeTimeZone {
  dateTime: string;
  timeZone: string;
}

interface GraphChecklistItem {
  id?: string;
  displayName: string;
  isChecked: boolean;
}

interface GraphTask {
  id: string;
  title: string;
  body?: GraphBody;
  dueDateTime?: GraphDateTimeTimeZone;
  completedDateTime?: GraphDateTimeTimeZone;
  /** Graph To Do supports a status field. Completed date is derived server-side. */
  status?: 'notStarted' | 'inProgress' | 'completed' | 'waitingOnOthers' | 'deferred' | string;
  lastModifiedDateTime: string;
  createdDateTime: string;

  // Extended fields
  reminderDateTime?: GraphDateTimeTimeZone;
  isReminderOn?: boolean;
  recurrence?: GraphRecurrence;
  categories?: string[];
  importance?: 'low' | 'normal' | 'high';
  startDateTime?: GraphDateTimeTimeZone;
  checklistItems?: GraphChecklistItem[];
}

interface GraphListTasksResponse {
  value: GraphTask[];
  '@odata.nextLink'?: string;
}

/**
 * Normalize fractional seconds in an ISO timestamp to 3 digits (milliseconds).
 * e.g. "2026-02-08T00:00:00.0000000Z" → "2026-02-08T00:00:00.000Z"
 */
function normalizeIsoPrecision(iso: string): string {
  return iso.replace(/\.(\d+)Z$/, (_match, frac: string) => {
    const ms = (frac + '000').slice(0, 3);
    return `.${ms}Z`;
  });
}

function normalizeGraphDate(dt?: GraphDateTimeTimeZone): string | undefined {
  if (!dt?.dateTime) return undefined;

  // Microsoft Graph To Do uses a { dateTime, timeZone } pair.
  // Often dateTime is "YYYY-MM-DDTHH:mm:ss(.sss)" with NO timezone suffix.
  // Our canonical format expects RFC3339 / ISO with timezone (prefer Z for UTC).
  let raw = dt.dateTime;

  // If already has timezone info, normalize precision and return.
  if (/[zZ]$/.test(raw) || /[+-]\d\d:\d\d$/.test(raw)) return normalizeIsoPrecision(raw);

  // Normalize UTC-like values to Z.
  if (dt.timeZone?.toUpperCase() === 'UTC') {
    raw = `${raw}Z`;
    return normalizeIsoPrecision(raw);
  }

  // Fallback: keep raw (better than guessing an offset).
  return raw;
}

function toCanonical(t: GraphTask): Task {
  const dueFull = normalizeGraphDate(t.dueDateTime);

  return {
    id: t.id,
    title: t.title,
    notes: t.body?.content,
    status: t.status === 'completed' || t.completedDateTime ? 'completed' : 'active',

    // Split due into date-only + time for cross-provider compat
    dueAt: dueFull ? normalizeDateOnly(dueFull) : undefined,
    dueTime: dueFull ? extractTimeFromIso(dueFull) : undefined,

    // Extended fields
    reminder:
      t.isReminderOn && t.reminderDateTime
        ? normalizeGraphDate(t.reminderDateTime)
        : undefined,
    recurrence: t.recurrence ? serializeRecurrence(t.recurrence) : undefined,
    categories: t.categories?.length ? t.categories : undefined,
    importance:
      t.importance && t.importance !== 'normal'
        ? (t.importance as Importance)
        : undefined,
    steps: t.checklistItems?.length
      ? t.checklistItems.map((i) => ({ text: i.displayName, checked: i.isChecked }))
      : undefined,
    startAt: normalizeGraphDate(t.startDateTime),

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

    // Confidential clients (web apps) require client_secret for token refresh.
    if (this.opts.clientSecret) body.set('client_secret', this.opts.clientSecret);

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

    // Build the initial URL. When `since` is provided, use a server-side
    // OData $filter on lastModifiedDateTime so Graph only returns changed
    // tasks instead of the full list.
    let next: string | undefined;
    const base = `/me/todo/lists/${encodeURIComponent(listId)}/tasks`;
    const expand = '$expand=checklistItems';

    if (since) {
      const filter = `lastModifiedDateTime ge ${since}`;
      next = `${base}?$top=100&${expand}&$filter=${encodeURIComponent(filter)}`;
    } else {
      next = `${base}?$top=100&${expand}`;
    }

    while (next) {
      const url = next;
      const res: GraphListTasksResponse = await this.api<GraphListTasksResponse>(url);
      for (const t of res.value ?? []) out.push(toCanonical(t));
      next = res['@odata.nextLink'];
    }

    return out;
  }

  async upsertTask(input: Omit<Task, 'updatedAt'> & { updatedAt?: string }): Promise<Task> {
    const listId = await this.getListId();
    const isCreate = !input.id;

    // Reconstruct full due datetime from date + time components
    const dueIso = input.dueAt
      ? combineDateAndTime(input.dueAt, input.dueTime)
      : undefined;

    // Core fields — always included
    const payload: Record<string, unknown> = {
      title: input.title,
      body: input.notes
        ? { contentType: 'text', content: input.notes }
        : undefined,
      dueDateTime: dueIso
        ? { dateTime: dueIso, timeZone: 'UTC' }
        : undefined,
      // Graph expects status mutations, not completedDateTime writes.
      status: input.status === 'completed' ? 'completed' : 'notStarted',
    };

    // Extended fields — only include if they have values.
    // For PATCH (updates), omitting a field means "don't change it".
    // This avoids overwriting server-managed fields like recurrence
    // with reconstructed values that may differ in startDate, etc.
    if (input.reminder) {
      payload.isReminderOn = true;
      payload.reminderDateTime = { dateTime: input.reminder, timeZone: 'UTC' };
    }
    if (input.categories?.length) {
      payload.categories = input.categories;
    }
    if (input.importance) {
      payload.importance = input.importance;
    }
    if (input.startAt) {
      payload.startDateTime = { dateTime: input.startAt, timeZone: 'UTC' };
    }

    // Recurrence: only set on CREATE. For PATCH, let Microsoft manage it
    // to avoid conflicts with server-side recurrence state.
    if (isCreate && input.recurrence) {
      const rec = deserializeRecurrence(input.recurrence);
      if (rec) payload.recurrence = rec;
    }

    // Remove undefined values (don't send to API)
    for (const k of Object.keys(payload)) {
      if (payload[k] === undefined) delete payload[k];
    }

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
