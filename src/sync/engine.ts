import type { Task } from '../model.js';
import type { TaskProvider } from '../providers/provider.js';
import { JsonStore, type SyncState } from '../store/jsonStore.js';

export type ConflictPolicy = 'last-write-wins';

export interface SyncOptions {
  dryRun?: boolean;
  conflictPolicy?: ConflictPolicy;
}

export interface SyncReport {
  dryRun: boolean;
  providerA: string;
  providerB: string;
  lastSyncAt?: string;
  newLastSyncAt: string;
  actions: Array<{ action: string; detail: string }>;
}

function newer(a: string, b: string) {
  return Date.parse(a) > Date.parse(b);
}

export class SyncEngine {
  constructor(private store = new JsonStore()) {}

  async sync(a: TaskProvider, b: TaskProvider, opts: SyncOptions = {}): Promise<SyncReport> {
    const dryRun = !!opts.dryRun;
    const state = await this.store.load();

    const lastSyncAt = state.lastSyncAt;
    const actions: SyncReport['actions'] = [];

    const [aTasks, bTasks] = await Promise.all([a.listTasks(lastSyncAt), b.listTasks(lastSyncAt)]);

    // 1) Process tasks from A -> B
    for (const t of aTasks) {
      if (this.store.isTombstoned(state, a.name, t.id)) continue;
      await this.reconcileOne({ source: a, target: b, state, task: t, dryRun, actions });
    }

    // 2) Process tasks from B -> A
    for (const t of bTasks) {
      if (this.store.isTombstoned(state, b.name, t.id)) continue;
      await this.reconcileOne({ source: b, target: a, state, task: t, dryRun, actions });
    }

    const newLastSyncAt = new Date().toISOString();
    state.lastSyncAt = newLastSyncAt;
    if (!dryRun) await this.store.save(state);

    return {
      dryRun,
      providerA: a.name,
      providerB: b.name,
      lastSyncAt,
      newLastSyncAt,
      actions,
    };
  }

  private async reconcileOne(params: {
    source: TaskProvider;
    target: TaskProvider;
    state: SyncState;
    task: Task;
    dryRun: boolean;
    actions: Array<{ action: string; detail: string }>;
  }) {
    const { source, target, state, task, dryRun, actions } = params;

    const map = this.store.ensureMapping(state, source.name, task.id);
    const targetId = map.byProvider[target.name];

    // zombie prevention: completed/deleted tasks become tombstones
    if (task.status === 'completed' || task.status === 'deleted') {
      this.store.addTombstone(state, source.name, task.id);
      if (targetId) this.store.addTombstone(state, target.name, targetId);

      if (targetId) {
        actions.push({
          action: dryRun ? 'would-delete' : 'delete',
          detail: `${target.name}:${targetId} due to ${source.name}:${task.id} status=${task.status}`,
        });
        if (!dryRun) await target.deleteTask(targetId);
      }
      return;
    }

    if (!targetId) {
      actions.push({
        action: dryRun ? 'would-create' : 'create',
        detail: `${target.name} from ${source.name}:${task.id} "${task.title}"`,
      });

      if (!dryRun) {
        const created = await target.upsertTask({
          id: '',
          title: task.title,
          notes: task.notes,
          status: task.status,
          dueAt: task.dueAt,
          updatedAt: task.updatedAt,
        });
        this.store.upsertProviderId(state, map.canonicalId, target.name, created.id);
      }
      return;
    }

    // If both sides exist, we do simple LWW based on updatedAt
    // NOTE: This is intentionally minimal for MVP.
    // A richer approach would compare field-by-field and/or keep per-field clocks.
    const targetTasks = await target.listTasks(undefined);
    const targetTask = targetTasks.find((t) => t.id === targetId);
    if (!targetTask) {
      // mapping points to missing task -> re-create, unless tombstoned
      if (this.store.isTombstoned(state, target.name, targetId)) return;
      actions.push({
        action: dryRun ? 'would-recreate' : 'recreate',
        detail: `${target.name}:${targetId} missing; recreate from ${source.name}:${task.id}`,
      });
      if (!dryRun) {
        const created = await target.upsertTask({
          id: '',
          title: task.title,
          notes: task.notes,
          status: task.status,
          dueAt: task.dueAt,
          updatedAt: task.updatedAt,
        });
        this.store.upsertProviderId(state, map.canonicalId, target.name, created.id);
      }
      return;
    }

    if (newer(task.updatedAt, targetTask.updatedAt)) {
      actions.push({
        action: dryRun ? 'would-update' : 'update',
        detail: `${target.name}:${targetId} <= ${source.name}:${task.id} (LWW)`,
      });
      if (!dryRun) {
        await target.upsertTask({
          id: targetId,
          title: task.title,
          notes: task.notes,
          status: task.status,
          dueAt: task.dueAt,
          updatedAt: task.updatedAt,
        });
      }
    }
  }
}
