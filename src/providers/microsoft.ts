import type { Task } from '../model.js';
import type { TaskProvider } from './provider.js';

export interface MicrosoftTodoProviderOptions {
  /** Azure AD app client id */
  clientId: string;
  /** Tenant id (or 'common') */
  tenantId: string;
  /** OAuth refresh token (or other credential, TBD) */
  refreshToken: string;
  /** Task list id (defaults TBD) */
  listId?: string;
}

/**
 * Scaffold for a real Microsoft To Do provider via Microsoft Graph.
 *
 * MVP NOTE: Not implemented yet.
 *
 * TODO(next):
 * - Implement OAuth2 refresh flow (MSAL or raw token endpoint)
 * - Call Graph endpoints for To Do tasks
 * - Map fields into canonical Task
 */
export class MicrosoftTodoProvider implements TaskProvider {
  readonly name = 'microsoft' as const;

  constructor(private _opts: MicrosoftTodoProviderOptions) {
    // Intentionally empty for MVP
  }

  async listTasks(_since?: string): Promise<Task[]> {
    throw new Error(
      'MicrosoftTodoProvider not implemented in MVP. Use `task-sync sync --dry-run` or implement provider.'
    );
  }

  async upsertTask(_input: Omit<Task, 'updatedAt'> & { updatedAt?: string }): Promise<Task> {
    throw new Error(
      'MicrosoftTodoProvider not implemented in MVP. Use `task-sync sync --dry-run` or implement provider.'
    );
  }

  async deleteTask(_id: string): Promise<void> {
    throw new Error(
      'MicrosoftTodoProvider not implemented in MVP. Use `task-sync sync --dry-run` or implement provider.'
    );
  }
}
