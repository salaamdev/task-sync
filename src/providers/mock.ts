import { randomUUID } from 'node:crypto';
import type { ProviderName, Task } from '../model.js';
import type { TaskProvider } from './provider.js';

/**
 * Deterministic-ish provider for local dev/tests.
 *
 * - Stores tasks in memory.
 * - Uses ISO timestamps.
 * - Supports delete (tombstone via status='deleted').
 */
export class MockProvider implements TaskProvider {
  readonly name: ProviderName;
  private tasks = new Map<string, Task>();

  constructor(opts?: { name?: ProviderName; tasks?: Task[] }) {
    this.name = opts?.name ?? 'mockA';
    for (const t of opts?.tasks ?? []) this.tasks.set(t.id, t);
  }

  async listTasks(since?: string): Promise<Task[]> {
    const all = [...this.tasks.values()];
    if (!since) return all;
    const sinceMs = Date.parse(since);
    return all.filter((t) => Date.parse(t.updatedAt) >= sinceMs);
  }

  async upsertTask(input: Omit<Task, 'updatedAt'> & { updatedAt?: string }): Promise<Task> {
    const now = input.updatedAt ?? new Date().toISOString();
    const id = input.id || randomUUID();
    const task: Task = { ...input, id, updatedAt: now };
    this.tasks.set(id, task);
    return task;
  }

  async deleteTask(id: string): Promise<void> {
    const existing = this.tasks.get(id);
    const updatedAt = new Date().toISOString();
    if (!existing) {
      this.tasks.set(id, { id, title: '(deleted)', status: 'deleted', updatedAt });
      return;
    }
    this.tasks.set(id, { ...existing, status: 'deleted', updatedAt });
  }
}
