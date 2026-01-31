import { describe, expect, it } from 'vitest';
import { JsonStore } from '../src/store/jsonStore.js';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';

describe('JsonStore', () => {
  it('creates and re-loads state', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'task-sync-'));
    const store = new JsonStore(dir);

    const s1 = await store.load();
    expect(s1.lastSyncAt).toBeUndefined();
    expect(s1.mappings).toHaveLength(0);

    const map = store.ensureMapping(s1, 'mockA', 'a1');
    store.upsertProviderId(s1, map.canonicalId, 'mockA', 'a1');
    store.addTombstone(s1, 'mockA', 'x1');
    s1.lastSyncAt = new Date().toISOString();

    await store.save(s1);

    const s2 = await store.load();
    expect(s2.lastSyncAt).toBeTruthy();
    expect(s2.mappings.length).toBe(1);
    expect(s2.tombstones.length).toBe(1);
  });
});
