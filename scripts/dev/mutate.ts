import { loadEnvFiles } from '../../src/env.js';
import { readEnv } from '../../src/config.js';
import type { Task } from '../../src/model.js';
import type { TaskProvider } from '../../src/providers/provider.js';
import { GoogleTasksProvider } from '../../src/providers/google.js';
import { MicrosoftTodoProvider } from '../../src/providers/microsoft.js';

/**
 * Dev helper: mutate a single task by exact title match.
 *
 * Usage:
 *   tsx scripts/dev/mutate.ts <google|microsoft> <delete|complete|activate|note> <title> [noteText]
 */

type ProviderKey = 'google' | 'microsoft';
type Action = 'delete' | 'complete' | 'activate' | 'note';

function usage(): never {
  console.error('Usage: tsx scripts/dev/mutate.ts <google|microsoft> <delete|complete|activate|note> <title> [noteText]');
  process.exit(2);
}

async function main() {
  loadEnvFiles();
  const env = readEnv();

  const providerName = process.argv[2] as ProviderKey | undefined;
  const action = process.argv[3] as Action | undefined;
  const title = process.argv.slice(4).join(' ').trim();

  if (!providerName || !action || !title) usage();

  const google = new GoogleTasksProvider({
    clientId: env.TASK_SYNC_GOOGLE_CLIENT_ID!,
    clientSecret: env.TASK_SYNC_GOOGLE_CLIENT_SECRET!,
    refreshToken: env.TASK_SYNC_GOOGLE_REFRESH_TOKEN!,
    tasklistId: env.TASK_SYNC_GOOGLE_TASKLIST_ID,
  });
  const microsoft = new MicrosoftTodoProvider({
    clientId: env.TASK_SYNC_MS_CLIENT_ID!,
    tenantId: env.TASK_SYNC_MS_TENANT_ID!,
    refreshToken: env.TASK_SYNC_MS_REFRESH_TOKEN!,
    listId: env.TASK_SYNC_MS_LIST_ID,
  });

  const map: Record<ProviderKey, TaskProvider> = { google, microsoft };
  const p = map[providerName];

  const tasks: Task[] = await p.listTasks();
  const matches = tasks.filter((t) => t.title === title);
  if (!matches.length) {
    console.error(`No match for title=${JSON.stringify(title)} in ${providerName}`);
    process.exit(2);
  }

  const t = matches[0];
  console.log(`${providerName}: matched ${matches.length} tasks; using id=${t.id}`);

  if (action === 'delete') {
    await p.deleteTask(t.id);
    console.log('deleted');
    return;
  }

  if (action === 'complete') {
    await p.upsertTask({ ...t, status: 'completed' });
    console.log('completed');
    return;
  }

  if (action === 'activate') {
    await p.upsertTask({ ...t, status: 'active' });
    console.log('activated');
    return;
  }

  if (action === 'note') {
    const noteText = process.argv.slice(5).join(' ').trim();
    if (!noteText) {
      console.error('note action requires noteText');
      process.exit(2);
    }
    await p.upsertTask({ ...t, notes: noteText });
    console.log('noted');
    return;
  }

  console.error(`Unknown action: ${String(action)}`);
  process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
