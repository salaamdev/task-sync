import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ProviderName } from '../model.js';

export interface MappingRecord {
  canonicalId: string;
  byProvider: Partial<Record<ProviderName, string>>;
  updatedAt: string;
}

export interface TombstoneRecord {
  provider: ProviderName;
  id: string;
  deletedAt: string;
}

export interface SyncState {
  lastSyncAt?: string;
  mappings: MappingRecord[];
  tombstones: TombstoneRecord[];
}

const DEFAULT_STATE: SyncState = {
  mappings: [],
  tombstones: [],
};

export class JsonStore {
  constructor(private dir = path.join(process.cwd(), '.task-sync')) {}

  private statePath() {
    return path.join(this.dir, 'state.json');
  }

  async load(): Promise<SyncState> {
    try {
      const raw = await readFile(this.statePath(), 'utf8');
      return { ...DEFAULT_STATE, ...JSON.parse(raw) } as SyncState;
    } catch {
      return structuredClone(DEFAULT_STATE);
    }
  }

  async save(state: SyncState): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.statePath(), JSON.stringify(state, null, 2) + '\n', 'utf8');
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
}
