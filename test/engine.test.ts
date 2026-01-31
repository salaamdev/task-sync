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
    expect(report.actions.some((x) => x.action === 'would-create')).toBe(true);
  });

  it('tombstones completed tasks and deletes on the other side (dry-run)', async () => {
    const store = new JsonStore(await mkdtemp(path.join(os.tmpdir(), 'task-sync-')));
    const engine = new SyncEngine(store);

    const a = new MockProvider({
      name: 'mockA',
      tasks: [{ id: 'a1', title: 'A', status: 'completed', updatedAt: new Date().toISOString() }],
    });
    const b = new MockProvider({
      name: 'mockB',
      tasks: [{ id: 'b1', title: 'B', status: 'active', updatedAt: new Date().toISOString() }],
    });

    // pre-create mapping by running a dry sync once for active task to establish linkage
    const s = await store.load();
    const map = store.ensureMapping(s, 'mockA', 'a1');
    store.upsertProviderId(s, map.canonicalId, 'mockB', 'b1');
    await store.save(s);

    const report = await engine.sync(a, b, { dryRun: true });
    expect(report.actions.some((x) => x.action === 'would-delete')).toBe(true);
  });
});
