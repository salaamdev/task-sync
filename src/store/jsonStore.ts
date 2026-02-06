import { mkdir, readFile, writeFile, rename, copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ProviderName, Task } from '../model.js';

export interface MappingRecord {
  canonicalId: string;
  byProvider: Partial<Record<ProviderName, string>>;
  /** Last canonical snapshot we synced to (used for field-level diffing). */
  canonical?: Omit<Task, 'id'>;
  updatedAt: string;
}

export interface TombstoneRecord {
  provider: ProviderName;
  id: string;
  deletedAt: string;
}

export interface SyncState {
  /** State schema version. */
  version: 1;
  lastSyncAt?: string;
  mappings: MappingRecord[];
  tombstones: TombstoneRecord[];
}

type LegacySyncState = Partial<Omit<SyncState, 'version'>> & { version?: number };

const DEFAULT_STATE: SyncState = {
  version: 1,
  mappings: [],
  tombstones: [],
};

export class JsonStore {
  constructor(private dir = path.join(process.cwd(), '.task-sync')) {}

  getDir() {
    return this.dir;
  }

  statePath() {
    return path.join(this.dir, 'state.json');
  }

  conflictsLogPath() {
    return path.join(this.dir, 'conflicts.log');
  }

  /** Best-effort migration to the latest state schema. */
  private migrate(input: LegacySyncState): SyncState {
    const version = input.version ?? 0;
    if (version === 1) {
      // Ensure defaults
      return {
        ...DEFAULT_STATE,
        ...input,
        version: 1,
        mappings: (input.mappings ?? []) as MappingRecord[],
        tombstones: (input.tombstones ?? []) as TombstoneRecord[],
      };
    }

    // v0 -> v1
    return {
      version: 1,
      lastSyncAt: input.lastSyncAt,
      mappings: ((input.mappings ?? []) as MappingRecord[]).map((m) => ({
        canonicalId: m.canonicalId,
        byProvider: m.byProvider ?? {},
        canonical: (m as MappingRecord).canonical,
        updatedAt: m.updatedAt ?? new Date().toISOString(),
      })),
      tombstones: (input.tombstones ?? []) as TombstoneRecord[],
    };
  }

  async load(): Promise<SyncState> {
    try {
      const raw = await readFile(this.statePath(), 'utf8');
      const parsed = JSON.parse(raw) as LegacySyncState;
      return this.migrate(parsed);
    } catch {
      return structuredClone(DEFAULT_STATE);
    }
  }

  private async backupStateFile(): Promise<void> {
    try {
      await stat(this.statePath());
    } catch {
      return;
    }
    await mkdir(this.dir, { recursive: true });
    await copyFile(this.statePath(), this.statePath() + '.bak');
  }

  async save(state: SyncState): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await this.backupStateFile();
    const tmp = this.statePath() + '.tmp';
    await writeFile(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8');
    await rename(tmp, this.statePath());
  }

  findMapping(state: SyncState, provider: ProviderName, id: string): MappingRecord | undefined {
    return state.mappings.find((m) => m.byProvider[provider] === id);
  }

  ensureMapping(state: SyncState, provider: ProviderName, id: string): MappingRecord {
    const existing = this.findMapping(state, provider, id);
    if (existing) return existing;
    const rec: MappingRecord = {
      canonicalId: randomUUID(),
      byProvider: { [provider]: id },
      updatedAt: new Date().toISOString(),
    };
    state.mappings.push(rec);
    return rec;
  }

  upsertProviderId(state: SyncState, canonicalId: string, provider: ProviderName, id: string): void {
    const rec = state.mappings.find((m) => m.canonicalId === canonicalId);
    if (!rec) throw new Error(`Unknown canonicalId: ${canonicalId}`);
    rec.byProvider[provider] = id;
    rec.updatedAt = new Date().toISOString();
  }

  isTombstoned(state: SyncState, provider: ProviderName, id: string): boolean {
    return state.tombstones.some((t) => t.provider === provider && t.id === id);
  }

  addTombstone(state: SyncState, provider: ProviderName, id: string, deletedAt = new Date().toISOString()): void {
    if (this.isTombstoned(state, provider, id)) return;
    state.tombstones.push({ provider, id, deletedAt });
  }

  pruneExpiredTombstones(state: SyncState, ttlDays: number, now = Date.now()): number {
    const ttlMs = Math.max(0, ttlDays) * 24 * 60 * 60 * 1000;
    if (!ttlMs) return 0;
    const before = state.tombstones.length;
    state.tombstones = state.tombstones.filter((t) => now - Date.parse(t.deletedAt) <= ttlMs);
    return before - state.tombstones.length;
  }

  removeMapping(state: SyncState, canonicalId: string): void {
    state.mappings = state.mappings.filter((m) => m.canonicalId !== canonicalId);
  }

  upsertCanonicalSnapshot(state: SyncState, canonicalId: string, data: Omit<Task, 'id'>): void {
    const rec = state.mappings.find((m) => m.canonicalId === canonicalId);
    if (!rec) return;
    rec.canonical = data;
    rec.updatedAt = new Date().toISOString();
  }
}
