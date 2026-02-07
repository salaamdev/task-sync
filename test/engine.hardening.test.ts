import { describe, expect, it } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { SyncEngine } from '../src/sync/engine.js';
import { MockProvider } from '../src/providers/mock.js';
import { JsonStore } from '../src/store/jsonStore.js';
import type { Task } from '../src/model.js';
import type { TaskProvider } from '../src/providers/provider.js';

describe('SyncEngine hardening', () => {
  it('completed status propagates via field-level update (not delete)', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'task-sync-'));
    const store = new JsonStore(dir);
    const engine = new SyncEngine(store);

    const t0 = new Date(Date.now() - 60_000).toISOString();
    const t1 = new Date().toISOString();

    const a = new MockProvider({
      name: 'mockA',
      tasks: [{ id: 'a1', title: 'A', status: 'completed', updatedAt: t1 }],
    });

    const b = new MockProvider({
      name: 'mockB',
      tasks: [{ id: 'b1', title: 'A', status: 'active', updatedAt: t0 }],
    });

    // Establish mapping
    const s = await store.load();
    const map = store.ensureMapping(s, 'mockA', 'a1');
    store.upsertProviderId(s, map.canonicalId, 'mockB', 'b1');
    // baseline canonical
    store.upsertCanonicalSnapshot(s, map.canonicalId, {
      title: 'A',
      notes: undefined,
      dueAt: undefined,
      status: 'active',
      metadata: undefined,
      updatedAt: t0,
    });
    await store.save(s);

    // Simulate B attempting a title update (but A's completed status should also propagate)
    await b.upsertTask({ id: 'b1', title: 'A updated', status: 'active', updatedAt: t1 });

    const report = await engine.syncMany([a, b], { dryRun: false });
    // Completed status should propagate as an update, not trigger a delete
    expect(report.actions.some((x) => x.kind === 'update')).toBe(true);
    expect(report.actions.some((x) => x.kind === 'delete')).toBe(false);

    const bAll = await b.listTasks();
    const bTask = bAll.find((t) => t.id === 'b1')!;
    // B should now be completed (status synced from A), with title from B's update
    expect(bTask.status).toBe('completed');
    expect(bTask.title).toBe('A updated');
  });

  it('tombstone expiry prunes old tombstones', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'task-sync-'));
    const store = new JsonStore(dir);
    const engine = new SyncEngine(store);

    const s = await store.load();
    s.tombstones.push({ provider: 'mockA', id: 'x', deletedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString() });
    await store.save(s);

    const a = new MockProvider({ name: 'mockA', tasks: [] });
    const b = new MockProvider({ name: 'mockB', tasks: [] });

    await engine.syncMany([a, b], { dryRun: false, tombstoneTtlDays: 30 });

    const s2 = await store.load();
    expect(s2.tombstones.some((t) => t.id === 'x')).toBe(false);
  });

  it('orphan cleanup removes mappings that do not exist in any provider', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'task-sync-'));
    const store = new JsonStore(dir);
    const engine = new SyncEngine(store);

    const s = await store.load();
    const map = store.ensureMapping(s, 'mockA', 'ghostA');
    store.upsertProviderId(s, map.canonicalId, 'mockB', 'ghostB');
    await store.save(s);

    const a = new MockProvider({ name: 'mockA', tasks: [] });
    const b = new MockProvider({ name: 'mockB', tasks: [] });

    await engine.syncMany([a, b], { dryRun: false });
    const s2 = await store.load();
    expect(s2.mappings.find((m) => m.canonicalId === map.canonicalId)).toBeUndefined();
  });

  it('field-level conflict resolution preserves independent edits', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'task-sync-'));
    const store = new JsonStore(dir);
    const engine = new SyncEngine(store);

    const baseAt = new Date(Date.now() - 120_000).toISOString();
    const notesAt = new Date(Date.now() - 60_000).toISOString();
    const titleAt = new Date().toISOString();

    const a = new MockProvider({
      name: 'mockA',
      tasks: [{ id: 'a1', title: 'Title v2', notes: 'n0', status: 'active', updatedAt: titleAt }],
    });

    const b = new MockProvider({
      name: 'mockB',
      tasks: [{ id: 'b1', title: 'Title', notes: 'n1', status: 'active', updatedAt: notesAt }],
    });

    // Setup mapping + baseline canonical snapshot
    const s = await store.load();
    s.lastSyncAt = new Date(Date.now() - 30_000).toISOString();
    const map = store.ensureMapping(s, 'mockA', 'a1');
    store.upsertProviderId(s, map.canonicalId, 'mockB', 'b1');
    store.upsertCanonicalSnapshot(s, map.canonicalId, {
      title: 'Title',
      notes: 'n0',
      dueAt: undefined,
      status: 'active',
      metadata: undefined,
      updatedAt: baseAt,
    });
    await store.save(s);

    await engine.syncMany([a, b], { dryRun: false });

    const aTask = (await a.listTasks()).find((t) => t.id === 'a1')!;
    const bTask = (await b.listTasks()).find((t) => t.id === 'b1')!;

    expect(aTask.title).toBe('Title v2');
    expect(bTask.title).toBe('Title v2');
    expect(aTask.notes).toBe('n1');
    expect(bTask.notes).toBe('n1');
  });

  it('graceful degradation: if a provider is down, still sync healthy providers', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'task-sync-'));
    const store = new JsonStore(dir);
    const engine = new SyncEngine(store);

    const now = new Date().toISOString();
    const a = new MockProvider({ name: 'mockA', tasks: [{ id: 'a1', title: 'A', status: 'active', updatedAt: now }] });

    const down: TaskProvider = {
      name: 'mockB',
      listTasks: async () => {
        throw new Error('Provider down');
      },
      upsertTask: async (_input: unknown): Promise<Task> => {
        throw new Error('Provider down');
      },
      deleteTask: async () => {
        throw new Error('Provider down');
      },
    };

    const report = await engine.syncMany([a, down], { dryRun: true });
    expect(report.providers).toEqual(['mockA']);
    expect(report.errors.some((e) => e.provider === 'mockB')).toBe(true);
  });
});
