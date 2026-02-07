import { describe, expect, it } from 'vitest';
import { SyncEngine } from '../src/sync/engine.js';
import { MockProvider } from '../src/providers/mock.js';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import { JsonStore } from '../src/store/jsonStore.js';

describe('SyncEngine', () => {
  it('creates missing tasks across providers (dry-run)', async () => {
    const store = new JsonStore(await mkdtemp(path.join(os.tmpdir(), 'task-sync-')));
    const engine = new SyncEngine(store);

    const a = new MockProvider({
      name: 'mockA',
      tasks: [{ id: 'a1', title: 'A', status: 'active', updatedAt: new Date().toISOString() }],
    });
    const b = new MockProvider({ name: 'mockB', tasks: [] });

    const report = await engine.sync(a, b, { dryRun: true });
    expect(report.actions.some((x) => x.kind === 'create' && x.executed === false)).toBe(true);
    expect(report.providers).toEqual(['mockA', 'mockB']);
  });

  it('syncs completed status to the other side via update (dry-run)', async () => {
    const store = new JsonStore(await mkdtemp(path.join(os.tmpdir(), 'task-sync-')));
    const engine = new SyncEngine(store);

    const tOld = new Date(Date.now() - 60_000).toISOString();
    const tNew = new Date().toISOString();

    const a = new MockProvider({
      name: 'mockA',
      tasks: [{ id: 'a1', title: 'A', status: 'completed', updatedAt: tNew }],
    });
    const b = new MockProvider({
      name: 'mockB',
      tasks: [{ id: 'b1', title: 'A', status: 'active', updatedAt: tOld }],
    });

    // pre-create mapping with baseline showing the task was previously active
    const s = await store.load();
    const map = store.ensureMapping(s, 'mockA', 'a1');
    store.upsertProviderId(s, map.canonicalId, 'mockB', 'b1');
    store.upsertCanonicalSnapshot(s, map.canonicalId, {
      title: 'A',
      notes: undefined,
      dueAt: undefined,
      status: 'active',
      metadata: undefined,
      updatedAt: tOld,
    });
    await store.save(s);

    const report = await engine.sync(a, b, { dryRun: true });
    // Completed status should propagate as an update, not a delete
    expect(report.actions.some((x) => x.kind === 'update' && x.executed === false)).toBe(true);
    expect(report.actions.some((x) => x.kind === 'delete')).toBe(false);
  });

  it('2-way: plans create into target (dry-run)', async () => {
    const store = new JsonStore(await mkdtemp(path.join(os.tmpdir(), 'task-sync-')));
    const engine = new SyncEngine(store);

    const now = new Date().toISOString();
    const a = new MockProvider({ name: 'mockA', tasks: [{ id: 'a1', title: 'A', status: 'active', updatedAt: now }] });
    const b = new MockProvider({ name: 'mockB', tasks: [] });

    const report = await engine.syncMany([a, b], { dryRun: true });

    const creates = report.actions.filter((x) => x.kind === 'create');
    // a1 should be created into b
    expect(creates.length).toBeGreaterThanOrEqual(1);
    expect(creates.some((x) => x.target.provider === 'mockB')).toBe(true);
  });
});
