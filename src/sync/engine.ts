import type { Task } from '../model.js';
import type { TaskProvider } from '../providers/provider.js';
import { JsonStore, type SyncState } from '../store/jsonStore.js';

export type ConflictPolicy = 'last-write-wins';

export interface SyncOptions {
  dryRun?: boolean;
  conflictPolicy?: ConflictPolicy;
}

export type SyncActionKind = 'create' | 'update' | 'delete' | 'recreate' | 'noop';

export interface SyncAction {
  kind: SyncActionKind;
  executed: boolean;
  source: { provider: string; id: string };
  target: { provider: string; id?: string };
  title?: string;
  detail: string;
}

export interface SyncReport {
  dryRun: boolean;
  providerA: string;
  providerB: string;
  lastSyncAt?: string;
  newLastSyncAt: string;
  counts: Record<SyncActionKind, number>;
  actions: SyncAction[];
}

function newer(a: string, b: string) {
  return Date.parse(a) > Date.parse(b);
}

function indexById(tasks: Task[]) {
  return new Map(tasks.map((t) => [t.id, t] as const));
}

export class SyncEngine {
  constructor(private store = new JsonStore()) {}

  async sync(a: TaskProvider, b: TaskProvider, opts: SyncOptions = {}): Promise<SyncReport> {
    const dryRun = !!opts.dryRun;
    const state = await this.store.load();

    const lastSyncAt = state.lastSyncAt;
    const actions: SyncAction[] = [];

    const counts: SyncReport['counts'] = {
      create: 0,
      update: 0,
      delete: 0,
      recreate: 0,
      noop: 0,
    };

    const push = (a: SyncAction) => {
      actions.push(a);
      counts[a.kind]++;
    };

    // For MVP simplicity: pull incremental changes for deciding what to reconcile,
    // plus a full snapshot to cheaply lookup any target task by id.
    const [aChanges, bChanges, aAll, bAll] = await Promise.all([
      a.listTasks(lastSyncAt),
      b.listTasks(lastSyncAt),
      a.listTasks(undefined),
      b.listTasks(undefined),
    ]);

    const aIndex = indexById(aAll);
    const bIndex = indexById(bAll);

    // 1) Process tasks from A -> B
    for (const t of aChanges) {
      if (this.store.isTombstoned(state, a.name, t.id)) continue;
      await this.reconcileOne({
        source: a,
        target: b,
        targetIndex: bIndex,
        state,
        task: t,
        dryRun,
        push,
      });
    }

    // 2) Process tasks from B -> A
    for (const t of bChanges) {
      if (this.store.isTombstoned(state, b.name, t.id)) continue;
      await this.reconcileOne({
        source: b,
        target: a,
        targetIndex: aIndex,
        state,
        task: t,
        dryRun,
        push,
      });
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
      counts,
      actions,
    };
  }

  private async reconcileOne(params: {
    source: TaskProvider;
    target: TaskProvider;
    targetIndex: Map<string, Task>;
    state: SyncState;
    task: Task;
    dryRun: boolean;
    push: (a: SyncAction) => void;
  }) {
    const { source, target, targetIndex, state, task, dryRun, push } = params;

    const map = this.store.ensureMapping(state, source.name, task.id);
    const targetId = map.byProvider[target.name];

    // zombie prevention: completed/deleted tasks become tombstones
    if (task.status === 'completed' || task.status === 'deleted') {
      this.store.addTombstone(state, source.name, task.id);
      if (targetId) this.store.addTombstone(state, target.name, targetId);

      if (targetId) {
        push({
          kind: 'delete',
          executed: !dryRun,
          source: { provider: source.name, id: task.id },
          target: { provider: target.name, id: targetId },
          title: task.title,
          detail: `${target.name}:${targetId} due to ${source.name}:${task.id} status=${task.status}`,
        });
        if (!dryRun) await target.deleteTask(targetId);
      } else {
        push({
          kind: 'noop',
          executed: false,
          source: { provider: source.name, id: task.id },
          target: { provider: target.name },
          title: task.title,
          detail: `tombstoned ${source.name}:${task.id} status=${task.status} (no mapped target)`,
        });
      }
      return;
    }

    if (!targetId) {
      push({
        kind: 'create',
        executed: !dryRun,
        source: { provider: source.name, id: task.id },
        target: { provider: target.name },
        title: task.title,
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

    const targetTask = targetIndex.get(targetId);
    if (!targetTask) {
      // mapping points to missing task -> re-create, unless tombstoned
      if (this.store.isTombstoned(state, target.name, targetId)) return;
      push({
        kind: 'recreate',
        executed: !dryRun,
        source: { provider: source.name, id: task.id },
        target: { provider: target.name, id: targetId },
        title: task.title,
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

    // If both sides exist, we do simple LWW based on updatedAt.
    if (newer(task.updatedAt, targetTask.updatedAt)) {
      push({
        kind: 'update',
        executed: !dryRun,
        source: { provider: source.name, id: task.id },
        target: { provider: target.name, id: targetId },
        title: task.title,
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
    } else {
      push({
        kind: 'noop',
        executed: false,
        source: { provider: source.name, id: task.id },
        target: { provider: target.name, id: targetId },
        title: task.title,
        detail: `no-op: ${source.name}:${task.id} not newer than ${target.name}:${targetId}`,
      });
    }
  }
}
