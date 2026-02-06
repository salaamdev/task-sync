import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';

export interface LockHandle {
  path: string;
  release(): Promise<void>;
}

export async function acquireLock(dir: string, filename = 'lock'): Promise<LockHandle> {
  await mkdir(dir, { recursive: true });
  const lockPath = path.join(dir, filename);

  const pid = process.pid;
  const payload = JSON.stringify({ pid, at: new Date().toISOString() }) + '\n';

  // Try create-or-fail semantics by writing only if not exists.
  // Node doesn't expose O_EXCL easily in fs/promises without handle flags in older versions,
  // so we do a small dance:
  try {
    await writeFile(lockPath, payload, { flag: 'wx' });
  } catch {
    // If it exists, check whether it's stale.
    try {
      const raw = await readFile(lockPath, 'utf8');
      const parsed = JSON.parse(raw) as { pid?: number };
      const otherPid = parsed.pid;
      if (otherPid && isProcessAlive(otherPid)) {
        throw new Error(`Another task-sync process is running (pid=${otherPid}).`);
      }
    } catch (err) {
      // If unreadable/invalid, treat as stale.
      void err;
    }

    // Stale lock: overwrite.
    await writeFile(lockPath, payload, { flag: 'w' });
  }

  return {
    path: lockPath,
    release: async () => {
      await unlink(lockPath).catch(() => undefined);
    },
  };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
