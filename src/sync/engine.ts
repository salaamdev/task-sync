import { appendFile } from 'node:fs/promises';
import type { ProviderName, Task } from '../model.js';
import type { TaskProvider } from '../providers/provider.js';
import { JsonStore, type MappingRecord } from '../store/jsonStore.js';
import { acquireLock } from '../store/lock.js';

export type ConflictPolicy = 'last-write-wins';

export type SyncMode = 'bidirectional' | 'a-to-b-only' | 'mirror';

export interface SyncOptions {
  dryRun?: boolean;
  conflictPolicy?: ConflictPolicy;
  /** Sync mode. Default: bidirectional. */
  mode?: SyncMode;
  /** Tombstone TTL in days. Default: 30. */
  tombstoneTtlDays?: number;
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

export interface SyncConflict {
  canonicalId: string;
  field: 'title' | 'notes' | 'dueAt' | 'status';
  providers: Array<{ provider: string; id: string; updatedAt: string; value: unknown }>;
  winner: { provider: string; id: string; updatedAt: string };
  overwritten: Array<{ provider: string; id: string }>;
}

export interface SyncReport {
  dryRun: boolean;
  providers: string[];
  lastSyncAt?: string;
  newLastSyncAt: string;
  counts: Record<SyncActionKind, number>;
  actions: SyncAction[];
  conflicts: SyncConflict[];
  errors: Array<{ provider: string; stage: 'listChanges' | 'listAll' | 'write'; error: string }>;
  durationMs: number;
}

function newer(a: string, b: string) {
  return Date.parse(a) > Date.parse(b);
}

function indexById(tasks: Task[]) {
  return new Map(tasks.map((t) => [t.id, t] as const));
}

function norm(s?: string) {
  return (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function matchKey(t: Task) {
  return `${norm(t.title)}\n${norm(t.notes)}`;
}

function pickProvidersByMode(mode: SyncMode, providers: TaskProvider[]) {
  if (mode === 'bidirectional') return { sources: providers, targets: providers };
  if (providers.length < 2) return { sources: providers, targets: providers };

  const a = providers[0];
  const rest = providers.slice(1);
  if (mode === 'a-to-b-only') return { sources: [a], targets: rest };
  // mirror: A is source of truth, so only apply A -> others, and never write back to A
  return { sources: [a], targets: rest };
}

type Snapshot = { changes: Task[]; all: Task[]; index: Map<string, Task>; changeIndex: Map<string, Task> };

export class SyncEngine {
  constructor(private store = new JsonStore()) {}

  /** Back-compat: two-way sync. */
  async sync(a: TaskProvider, b: TaskProvider, opts: SyncOptions = {}): Promise<SyncReport> {
    return this.syncMany([a, b], opts);
  }

  /** N-way sync. */
  async syncMany(providers: TaskProvider[], opts: SyncOptions = {}): Promise<SyncReport> {
    const started = Date.now();
    if (providers.length < 2) throw new Error('syncMany requires at least 2 providers');

    const dryRun = !!opts.dryRun;
    const mode: SyncMode = opts.mode ?? 'bidirectional';
    const tombstoneTtlDays = opts.tombstoneTtlDays ?? 30;

    const lock = await acquireLock(this.store.getDir());
    try {
      const state = await this.store.load();
      const lastSyncAt = state.lastSyncAt;

      const actions: SyncAction[] = [];
      const conflicts: SyncConflict[] = [];
      const errors: SyncReport['errors'] = [];

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

      // 1) Prune expired tombstones
      this.store.pruneExpiredTombstones(state, tombstoneTtlDays);

      // 2) Preload snapshots for all providers (best-effort)
      const snapshots = new Map<string, Snapshot>();
      const listAllFailed = new Set<string>();

      await Promise.all(
        providers.map(async (p) => {
          let changes: Task[] = [];
          let all: Task[] = [];
          try {
            changes = await p.listTasks(lastSyncAt);
          } catch (e) {
            errors.push({
              provider: p.name,
              stage: 'listChanges',
              error: e instanceof Error ? e.message : String(e),
            });
          }
          try {
            all = await p.listTasks(undefined);
          } catch (e) {
            listAllFailed.add(p.name);
            errors.push({
              provider: p.name,
              stage: 'listAll',
              error: e instanceof Error ? e.message : String(e),
            });
          }
          snapshots.set(p.name, {
            changes,
            all,
            index: indexById(all),
            changeIndex: indexById(changes),
          });
        }),
      );

      // Only reconcile among providers we can at least read a full snapshot for.
      const healthyProviders = providers.filter((p) => !listAllFailed.has(p.name));

      // 3) Cold start: if no state, match tasks by title+notes across providers to avoid dupes.
      if (!state.lastSyncAt && state.mappings.length === 0) {
        const buckets = new Map<string, Array<{ provider: ProviderName; task: Task }>>();
        for (const p of healthyProviders) {
          const snap = snapshots.get(p.name)!;
          for (const t of snap.all) {
            if (t.status === 'deleted') continue;
            const k = matchKey(t);
            if (!buckets.has(k)) buckets.set(k, []);
            buckets.get(k)!.push({ provider: p.name, task: t });
          }
        }

        for (const group of buckets.values()) {
          if (group.length < 2) continue;
          // create a single mapping across all matching tasks
          const first = group[0]!;
          const rec = this.store.ensureMapping(state, first.provider, first.task.id);
          for (const g of group.slice(1)) {
            rec.byProvider[g.provider] = g.task.id;
          }
          rec.canonical = {
            title: first.task.title,
            notes: first.task.notes,
            dueAt: first.task.dueAt,
            status: first.task.status,
            metadata: first.task.metadata,
            updatedAt: first.task.updatedAt,
          };
        }
      }

      // Helper: get mapping record for a provider task id.
      const mappingFor = (provider: ProviderName, id: string): MappingRecord => this.store.ensureMapping(state, provider, id);

      // 4) Zombie prevention (delete-wins): process deletions/completions first.
      const isTerminal = (t: Task) => t.status === 'deleted' || t.status === 'completed';

      const tombstoneCanonicalIds = new Set<string>();

      for (const p of healthyProviders) {
        const snap = snapshots.get(p.name)!;
        for (const t of snap.changes) {
          if (!isTerminal(t)) continue;
          const map = mappingFor(p.name, t.id);
          tombstoneCanonicalIds.add(map.canonicalId);

          // Tombstone all known provider ids for this canonical task.
          for (const [prov, pid] of Object.entries(map.byProvider) as Array<[ProviderName, string]>) {
            if (!pid) continue;
            this.store.addTombstone(state, prov, pid);
          }
        }
      }

      // Propagate deletes for tombstoned canonical tasks to all providers.
      for (const canonicalId of tombstoneCanonicalIds) {
        const map = state.mappings.find((m) => m.canonicalId === canonicalId);
        if (!map) continue;

        for (const p of healthyProviders) {
          const pid = map.byProvider[p.name];
          if (!pid) continue;
          if (this.store.isTombstoned(state, p.name, pid)) {
            push({
              kind: 'delete',
              executed: !dryRun,
              source: { provider: 'tombstone', id: canonicalId },
              target: { provider: p.name, id: pid },
              title: map.canonical?.title,
              detail: `delete-wins: canonical=${canonicalId}`,
            });
            if (!dryRun) {
              try {
                await p.deleteTask(pid);
              } catch (e) {
                errors.push({
                  provider: p.name,
                  stage: 'write',
                  error: e instanceof Error ? e.message : String(e),
                });
              }
            }
          }
        }
      }

      // 5) Orphan detection: mappings that point to tasks missing in ALL providers.
      for (const m of [...state.mappings]) {
        const existsSomewhere = (Object.entries(m.byProvider) as Array<[ProviderName, string]>).some(([prov, pid]) => {
          if (!pid) return false;
          return snapshots.get(prov)?.index.has(pid) ?? false;
        });

        if (!existsSomewhere && Object.keys(m.byProvider).length) {
          // Tombstone the mapped ids (defensive), then remove mapping.
          for (const [prov, pid] of Object.entries(m.byProvider) as Array<[ProviderName, string]>) {
            if (!pid) continue;
            this.store.addTombstone(state, prov, pid);
          }
          this.store.removeMapping(state, m.canonicalId);
        }
      }

      // 6) Main reconciliation: compute canonical per mapping and fan out (true N-way).
      const { sources, targets } = pickProvidersByMode(mode, healthyProviders);
      const targetSet = new Set(targets.map((t) => t.name));
      const sourceSet = new Set(sources.map((t) => t.name));

      // Ensure every task we can see is mapped (so brand-new tasks propagate).
      for (const p of healthyProviders) {
        const snap = snapshots.get(p.name)!;
        for (const t of snap.all) {
          mappingFor(p.name, t.id);
        }
      }

      for (const m of state.mappings) {
        // If any provider id is tombstoned, skip updates and let delete-wins handle it.
        const tombstoned = (Object.entries(m.byProvider) as Array<[ProviderName, string]>).some(
          ([prov, pid]) => !!pid && this.store.isTombstoned(state, prov, pid),
        );
        if (tombstoned) continue;

        const baseline = m.canonical;

        // Build per-provider task snapshots for this mapping.
        const byProvTask = new Map<ProviderName, Task>();
        for (const [prov, pid] of Object.entries(m.byProvider) as Array<[ProviderName, string]>) {
          if (!pid) continue;
          const t = snapshots.get(prov)?.index.get(pid);
          if (t) byProvTask.set(prov, t);
        }

        if (byProvTask.size === 0) continue;

        type CanonicalData = Omit<Task, 'id'>;
        const fields = ['title', 'notes', 'dueAt', 'status'] as const;
        type Field = (typeof fields)[number];

        const firstTask = [...byProvTask.values()][0]!;

        const canonical: CanonicalData = {
          title: baseline?.title ?? firstTask.title,
          notes: baseline?.notes,
          dueAt: baseline?.dueAt,
          status: baseline?.status ?? firstTask.status,
          metadata: baseline?.metadata,
          updatedAt: baseline?.updatedAt ?? firstTask.updatedAt,
        };

        const changedBy = new Map<ProviderName, Set<Field>>();

        for (const [prov, t] of byProvTask.entries()) {
          const set = new Set<Field>();
          for (const f of fields) {
            const baseVal = baseline ? baseline[f] : undefined;
            const val = t[f];
            if (baseVal !== val) set.add(f);
          }
          if (set.size) changedBy.set(prov, set);
        }

        // Field-level resolve
        for (const f of fields) {
          const contenders: Array<{ prov: ProviderName; t: Task }> = [];
          for (const [prov, set] of changedBy.entries()) {
            if (set.has(f)) contenders.push({ prov, t: byProvTask.get(prov)! });
          }

          const assign = (field: Field, val: Task[Field]) => {
            switch (field) {
              case 'title':
                canonical.title = val as Task['title'];
                break;
              case 'notes':
                canonical.notes = val as Task['notes'];
                break;
              case 'dueAt':
                canonical.dueAt = val as Task['dueAt'];
                break;
              case 'status':
                canonical.status = val as Task['status'];
                break;
            }
          };

          if (contenders.length === 0) continue;
          if (contenders.length === 1) {
            assign(f, contenders[0]!.t[f]);
            canonical.updatedAt = contenders[0]!.t.updatedAt;
            continue;
          }

          // Conflict: multiple providers changed the same field since baseline. Pick per-field LWW.
          contenders.sort((a, b) => (newer(a.t.updatedAt, b.t.updatedAt) ? -1 : 1));
          const winner = contenders[0]!;
          assign(f, winner.t[f]);

          conflicts.push({
            canonicalId: m.canonicalId,
            field: f,
            providers: contenders.map((c) => ({
              provider: c.prov,
              id: c.t.id,
              updatedAt: c.t.updatedAt,
              value: c.t[f],
            })),
            winner: { provider: winner.prov, id: winner.t.id, updatedAt: winner.t.updatedAt },
            overwritten: contenders.slice(1).map((c) => ({ provider: c.prov, id: c.t.id })),
          });
        }

        // Update canonical snapshot in state.
        this.store.upsertCanonicalSnapshot(state, m.canonicalId, canonical);

        // Fan out canonical to all targets.
        for (const target of healthyProviders) {
          const targetId = m.byProvider[target.name];
          const canWrite = targetSet.has(target.name) && (mode !== 'mirror' || target.name !== providers[0]!.name);
          const isSourceAllowed = sourceSet.has(target.name);
          void isSourceAllowed; // kept for future refinement

          if (!canWrite) continue;

          const existing = targetId ? snapshots.get(target.name)!.index.get(targetId) : undefined;

          if (!targetId) {
            push({
              kind: 'create',
              executed: !dryRun,
              source: { provider: 'canonical', id: m.canonicalId },
              target: { provider: target.name },
              title: canonical.title,
              detail: `create from canonical ${m.canonicalId}`,
            });
            if (!dryRun) {
              try {
                const created = await target.upsertTask({
                  id: '',
                  title: canonical.title,
                  notes: canonical.notes,
                  dueAt: canonical.dueAt,
                  status: canonical.status,
                  metadata: canonical.metadata,
                  updatedAt: canonical.updatedAt,
                });
                this.store.upsertProviderId(state, m.canonicalId, target.name, created.id);
              } catch (e) {
                errors.push({
                  provider: target.name,
                  stage: 'write',
                  error: e instanceof Error ? e.message : String(e),
                });
              }
            }
            continue;
          }

          if (!existing) {
            // Missing task: recreate unless tombstoned.
            if (this.store.isTombstoned(state, target.name, targetId)) continue;
            push({
              kind: 'recreate',
              executed: !dryRun,
              source: { provider: 'canonical', id: m.canonicalId },
              target: { provider: target.name, id: targetId },
              title: canonical.title,
              detail: `${target.name}:${targetId} missing; recreate`,
            });
            if (!dryRun) {
              try {
                const created = await target.upsertTask({
                  id: '',
                  title: canonical.title,
                  notes: canonical.notes,
                  dueAt: canonical.dueAt,
                  status: canonical.status,
                  metadata: canonical.metadata,
                  updatedAt: canonical.updatedAt,
                });
                this.store.upsertProviderId(state, m.canonicalId, target.name, created.id);
              } catch (e) {
                errors.push({
                  provider: target.name,
                  stage: 'write',
                  error: e instanceof Error ? e.message : String(e),
                });
              }
            }
            continue;
          }

          // Update only if any field differs.
          const differs =
            existing.title !== canonical.title ||
            existing.notes !== canonical.notes ||
            existing.dueAt !== canonical.dueAt ||
            existing.status !== canonical.status;

          if (!differs) {
            push({
              kind: 'noop',
              executed: false,
              source: { provider: 'canonical', id: m.canonicalId },
              target: { provider: target.name, id: targetId },
              title: canonical.title,
              detail: 'already in sync',
            });
            continue;
          }

          push({
            kind: 'update',
            executed: !dryRun,
            source: { provider: 'canonical', id: m.canonicalId },
            target: { provider: target.name, id: targetId },
            title: canonical.title,
            detail: `field-level update (title/notes/status/dueAt)`,
          });

          if (!dryRun) {
            try {
              await target.upsertTask({
                id: targetId,
                title: canonical.title,
                notes: canonical.notes,
                dueAt: canonical.dueAt,
                status: canonical.status,
                metadata: canonical.metadata ?? existing.metadata,
                updatedAt: canonical.updatedAt,
              });
            } catch (e) {
              errors.push({
                provider: target.name,
                stage: 'write',
                error: e instanceof Error ? e.message : String(e),
              });
            }
          }
        }
      }

      const newLastSyncAt = new Date().toISOString();
      state.lastSyncAt = newLastSyncAt;

      // Persist conflicts log (even for dry-run, we keep it in-memory only)
      if (conflicts.length && !dryRun) {
        const lines = conflicts
          .map((c) =>
            JSON.stringify(
              {
                at: new Date().toISOString(),
                ...c,
              },
              null,
              0,
            ),
          )
          .join('\n');
        await appendFile(this.store.conflictsLogPath(), lines + '\n', 'utf8').catch(() => undefined);
      }

      if (!dryRun) await this.store.save(state);

      return {
        dryRun,
        providers: healthyProviders.map((p) => p.name),
        lastSyncAt,
        newLastSyncAt,
        counts,
        actions,
        conflicts,
        errors,
        durationMs: Date.now() - started,
      };
    } finally {
      await lock.release();
    }
  }
}
