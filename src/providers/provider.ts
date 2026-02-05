import type { ProviderName, Task } from '../model.js';

export interface TaskProvider {
  readonly name: ProviderName;

  /**
   * List tasks that changed since `since` (inclusive). If `since` is undefined,
   * provider should return all tasks.
   */
  listTasks(since?: string): Promise<Task[]>;

  /** Create or update a task by provider id (if known). Returns the stored task. */
  upsertTask(input: Omit<Task, 'updatedAt'> & { updatedAt?: string }): Promise<Task>;

  /** Mark a task deleted (or hard delete if provider supports). */
  deleteTask(id: string): Promise<void>;
}
