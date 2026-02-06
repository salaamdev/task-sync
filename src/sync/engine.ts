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
  providers: string[];
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

  /**
   * Back-compat: two-way sync.
   */
  async sync(a: TaskProvider, b: TaskProvider, opts: SyncOptions = {}): Promise<SyncReport> {
    return this.syncMany([a, b], opts);
  }

  /**
   * N-way sync (MVP: 2-3 providers). For every provider, reconcile its changes into every other provider.
   */
  async syncMany(providers: TaskProvider[], opts: SyncOptions = {}): Promise<SyncReport> {
    if (providers.length < 2) throw new Error('syncMany requires at least 2 providers');

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

    // Preload changes + snapshots for all providers.
    const snapshots = new Map<string, { changes: Task[]; all: Task[]; index: Map<string, Task> }>();

    await Promise.all(
      providers.map(async (p) => {
        const [changes, all] = await Promise.all([p.listTasks(lastSyncAt), p.listTasks(undefined)]);
        snapshots.set(p.name, { changes, all, index: indexById(all) });
      }),
    );

    // For each provider -> reconcile into every other.
    for (const source of providers) {
      const snap = snapshots.get(source.name)!;
      for (const task of snap.changes) {
        if (this.store.isTombstoned(state, source.name, task.id)) continue;

        for (const target of providers) {
          if (target.name === source.name) continue;

          const targetSnap = snapshots.get(target.name)!;
          await this.reconcileOne({
            source,
            target,
            targetIndex: targetSnap.index,
            state,
            task,
            dryRun,
            push,
          });
        }
      }
    }

    const newLastSyncAt = new Date().toISOString();
    state.lastSyncAt = newLastSyncAt;
    if (!dryRun) await this.store.save(state);

    return {
      dryRun,
      providers: providers.map((p) => p.name),
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
