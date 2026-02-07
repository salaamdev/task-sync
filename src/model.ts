export type ProviderName = 'mockA' | 'mockB' | 'google' | 'microsoft';

export type TaskStatus = 'active' | 'completed' | 'deleted';

export type Importance = 'low' | 'normal' | 'high';

export interface ChecklistItem {
  text: string;
  checked: boolean;
}

export interface Task {
  /** Provider-local id (opaque). */
  id: string;
  title: string;
  notes?: string;
  status: TaskStatus;
  /** Due date (ISO, normalized to date-only for cross-provider compat). */
  dueAt?: string;
  /** Time component of due date (HH:MM, 24h). Google Tasks is date-only, so
   *  the time is preserved via a metadata block in notes. */
  dueTime?: string;
  /** Reminder datetime (ISO). Microsoft To Do only. */
  reminder?: string;
  /** Recurrence rule (RRULE-like string). Microsoft To Do only. */
  recurrence?: string;
  /** Categories / labels. Microsoft To Do only. */
  categories?: string[];
  /** Priority / importance. Microsoft To Do only. */
  importance?: Importance;
  /** Checklist items / steps. Microsoft To Do only (read-only sync). */
  steps?: ChecklistItem[];
  /** Start date/time (ISO). Microsoft To Do only. */
  startAt?: string;
  /**
   * Provider-specific extra data that should round-trip without loss.
   * Engine treats this as opaque.
   */
  metadata?: Record<string, unknown>;
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
