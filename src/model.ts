export type ProviderName = 'mockA' | 'mockB' | 'google' | 'microsoft' | 'habitica';

export type TaskStatus = 'active' | 'completed' | 'deleted';

export interface Task {
  /** Provider-local id (opaque). */
  id: string;
  title: string;
  notes?: string;
  status: TaskStatus;
  dueAt?: string; // ISO
  updatedAt: string; // ISO
}

export interface TaskRef {
  provider: ProviderName;
  id: string;
}

export interface CanonicalTask {
  /** Stable internal id we assign (uuid). */
  canonicalId: string;
  data: Omit<Task, 'id'>;
}
