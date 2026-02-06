import type { Task } from '../model.js';
import type { TaskProvider } from './provider.js';
import { requestJson, type FetchLike } from '../http.js';

export interface HabiticaProviderOptions {
  userId: string;
  apiToken: string;
  /** Inject fetch for tests */
  fetcher?: FetchLike;
}

// Habitica API shape (subset)
interface HabiticaTask {
  id: string;
  type: 'todo' | string;
  text: string;
  notes?: string;
  completed: boolean;
  date?: string; // due
  updatedAt: string;
  priority?: number;
  tags?: string[];
}

interface HabiticaApiResponse<T> {
  success: boolean;
  data: T;
}

function packNotes(humanNotes: string | undefined, extra: Record<string, unknown>) {
  const meta = JSON.stringify(extra);
  const block = `\n\n--- task-sync ---\n${meta}\n--- /task-sync ---\n`;
  const base = (humanNotes ?? '').trim();
  if (!base) return block.trimStart();

  // avoid duplicating our own block
  if (base.includes('--- task-sync ---')) return base;
  return base + block;
}

function unpackNotes(notes?: string): { human?: string; meta?: Record<string, unknown> } {
  if (!notes) return {};
  const start = notes.indexOf('--- task-sync ---');
  const end = notes.indexOf('--- /task-sync ---');
  if (start === -1 || end === -1 || end < start) return { human: notes };

  const human = notes.slice(0, start).trim() || undefined;
  const metaRaw = notes.slice(start + '--- task-sync ---'.length, end).trim();
  try {
    const meta = JSON.parse(metaRaw) as Record<string, unknown>;
    return { human, meta };
  } catch {
    return { human: notes };
  }
}

function toCanonical(t: HabiticaTask): Task {
  const unpacked = unpackNotes(t.notes);
  return {
    id: t.id,
    title: t.text,
    notes: unpacked.human,
    status: t.completed ? 'completed' : 'active',
    dueAt: t.date,
    updatedAt: t.updatedAt,
  };
}

/**
 * Habitica provider (Todos).
 *
 * Auth: X-API-User + X-API-Key headers.
 *
 * Notes packing:
 * - We keep human notes in Task.notes.
 * - We store extra Habitica-only fields (priority/tags) inside the Habitica task notes
 *   in a JSON block to preserve data round-trips.
 */
export class HabiticaProvider implements TaskProvider {
  readonly name = 'habitica' as const;
  private fetcher: FetchLike;

  constructor(private opts: HabiticaProviderOptions) {
    this.fetcher = opts.fetcher ?? fetch;
  }

  private headers() {
    return {
      'x-api-user': this.opts.userId,
      'x-api-key': this.opts.apiToken,
    };
  }

  private async api<T>(path: string, init?: Parameters<typeof requestJson<HabiticaApiResponse<T>>>[1]): Promise<T> {
    const base = 'https://habitica.com/api/v3';
    const res = await requestJson<HabiticaApiResponse<T>>(
      `${base}${path}`,
      { ...init, headers: { ...this.headers(), ...(init?.headers ?? {}) } },
      this.fetcher,
    );
    return res.data;
  }

  async listTasks(since?: string): Promise<Task[]> {
    const todos = await this.api<HabiticaTask[]>(`/tasks/user`, {
      query: { type: 'todos' },
    });

    const out = todos.filter((t) => t.type === 'todo').map(toCanonical);
    if (!since) return out;

    const sinceMs = Date.parse(since);
    return out.filter((t) => Date.parse(t.updatedAt) >= sinceMs);
  }

  async upsertTask(input: Omit<Task, 'updatedAt'> & { updatedAt?: string }): Promise<Task> {
    const isCreate = !input.id;

    // Preserve habitica-specific fields if they exist in existing notes meta.
    // (If caller provides packed notes already, we just pass it through.)
    const { human, meta } = unpackNotes(input.notes);
    const packed = packNotes(human, meta ?? {});

    const body: Partial<HabiticaTask> & { type?: string } = {
      type: 'todo',
      text: input.title,
      notes: packed,
      date: input.dueAt,
      completed: input.status === 'completed',
    };

    const task = isCreate
      ? await this.api<HabiticaTask>(`/tasks/user`, { method: 'POST', body })
      : await this.api<HabiticaTask>(`/tasks/${encodeURIComponent(input.id)}`, { method: 'PUT', body });

    return toCanonical(task);
  }

  async deleteTask(id: string): Promise<void> {
    await this.api<void>(`/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
}
