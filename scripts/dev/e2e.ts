import { loadEnvFiles } from '../../src/env.js';
import { readEnv } from '../../src/config.js';
import { GoogleTasksProvider } from '../../src/providers/google.js';
import { MicrosoftTodoProvider } from '../../src/providers/microsoft.js';
import type { Task } from '../../src/model.js';

const PREFIX = '[task-sync e2e]';

type ProviderKey = 'google' | 'microsoft';

function usage(): never {
  console.error('Usage: tsx scripts/dev/e2e.ts <seed|list|cleanup> [provider]');
  console.error('  provider optional: google|microsoft (default: all configured)');
  process.exit(2);
}

function makeProviders(env: ReturnType<typeof readEnv>) {
  const providers = new Map<ProviderKey, { name: ProviderKey; p: { listTasks(): Promise<Task[]>; upsertTask(i: Omit<Task, 'updatedAt'> & { updatedAt?: string }): Promise<Task>; deleteTask(id: string): Promise<void> } }>();

  providers.set('google', {
    name: 'google',
    p: new GoogleTasksProvider({
      clientId: env.TASK_SYNC_GOOGLE_CLIENT_ID!,
      clientSecret: env.TASK_SYNC_GOOGLE_CLIENT_SECRET!,
      refreshToken: env.TASK_SYNC_GOOGLE_REFRESH_TOKEN!,
      tasklistId: env.TASK_SYNC_GOOGLE_TASKLIST_ID,
    }),
  });

  providers.set('microsoft', {
    name: 'microsoft',
    p: new MicrosoftTodoProvider({
      clientId: env.TASK_SYNC_MS_CLIENT_ID!,
      tenantId: env.TASK_SYNC_MS_TENANT_ID!,
      refreshToken: env.TASK_SYNC_MS_REFRESH_TOKEN!,
      listId: env.TASK_SYNC_MS_LIST_ID,
    }),
  });

  return providers;
}

function configuredProviders(env: ReturnType<typeof readEnv>): ProviderKey[] {
  const list = [env.TASK_SYNC_PROVIDER_A, env.TASK_SYNC_PROVIDER_B].filter(Boolean) as ProviderKey[];
  return [...new Set(list)];
}

async function seedOne(p: { upsertTask(i: Omit<Task, 'updatedAt'> & { updatedAt?: string }): Promise<Task> }, title: string) {
  const t = await p.upsertTask({
    id: '',
    title,
    notes: 'e2e seed',
    status: 'active',
    dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });
  return t;
}

async function listTagged(p: { listTasks(): Promise<Task[]> }): Promise<Task[]> {
  const tasks = await p.listTasks();
  return tasks.filter((t) => t.title.startsWith(PREFIX));
}

async function cleanupTagged(p: { listTasks(): Promise<Task[]>; deleteTask(id: string): Promise<void> }) {
  const tagged = await listTagged(p);
  for (const t of tagged) await p.deleteTask(t.id);
  return tagged.length;
}

async function main() {
  loadEnvFiles();
  const env = readEnv();

  const cmd = (process.argv[2] as string | undefined) ?? '';
  const providerArg = process.argv[3] as ProviderKey | undefined;

  const configured = providerArg ? [providerArg] : configuredProviders(env);
  if (!configured.length) {
    console.error('No providers configured. Set TASK_SYNC_PROVIDER_A/B.');
    process.exit(2);
  }

  const providers = makeProviders(env);

  if (cmd === 'seed') {
    const now = new Date().toISOString();
    for (const k of configured) {
      const entry = providers.get(k);
      if (!entry) continue;
      const title = `${PREFIX} ${k} seed ${now}`;
      const t = await seedOne(entry.p, title);
      console.log(`${k}: seeded id=${t.id} title=${JSON.stringify(t.title)}`);
    }
    return;
  }

  if (cmd === 'list') {
    for (const k of configured) {
      const entry = providers.get(k);
      if (!entry) continue;
      const tagged = await listTagged(entry.p);
      console.log(`${k}: tagged=${tagged.length}`);
      for (const t of tagged) console.log(`- ${t.id} ${t.status} ${JSON.stringify(t.title)}`);
    }
    return;
  }

  if (cmd === 'cleanup') {
    for (const k of configured) {
      const entry = providers.get(k);
      if (!entry) continue;
      const n = await cleanupTagged(entry.p);
      console.log(`${k}: deleted=${n}`);
    }
    return;
  }

  usage();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
