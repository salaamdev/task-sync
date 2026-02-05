import type { Task } from '../model.js';
import type { TaskProvider } from './provider.js';

export interface GoogleTasksProviderOptions {
  /** OAuth client id */
  clientId: string;
  /** OAuth client secret */
  clientSecret: string;
  /** OAuth refresh token */
  refreshToken: string;
  /** Task list id (defaults to '@default' for Google Tasks) */
  tasklistId?: string;
}

/**
 * Scaffold for a real Google Tasks provider.
 *
 * MVP NOTE: Not implemented yet.
 *
 * TODO(next):
 * - Implement OAuth2 refresh flow
 * - Call Google Tasks API (tasks.list/tasks.insert/tasks.update/tasks.delete)
 * - Map fields into canonical Task
 */
export class GoogleTasksProvider implements TaskProvider {
  readonly name = 'google' as const;

  constructor(private _opts: GoogleTasksProviderOptions) {
    // Intentionally empty for MVP
  }

  async listTasks(_since?: string): Promise<Task[]> {
    throw new Error(
      'GoogleTasksProvider not implemented in MVP. Use `task-sync sync --dry-run` or implement provider.'
    );
  }

  async upsertTask(_input: Omit<Task, 'updatedAt'> & { updatedAt?: string }): Promise<Task> {
    throw new Error(
      'GoogleTasksProvider not implemented in MVP. Use `task-sync sync --dry-run` or implement provider.'
    );
  }

  async deleteTask(_id: string): Promise<void> {
    throw new Error(
      'GoogleTasksProvider not implemented in MVP. Use `task-sync sync --dry-run` or implement provider.'
    );
  }
}
