import { Command } from 'commander';
import { doctorReport, readEnv } from './config.js';
import { loadEnvFiles } from './env.js';
import { createLogger } from './log.js';
import { MockProvider } from './providers/mock.js';
import { GoogleTasksProvider } from './providers/google.js';
import { MicrosoftTodoProvider } from './providers/microsoft.js';
import { SyncEngine } from './sync/engine.js';
import { JsonStore } from './store/jsonStore.js';

loadEnvFiles();

const program = new Command();

program
  .name('task-sync')
  .description('Sync tasks between providers (MVP: dry-run with mock providers)')
  .version('0.1.0');

program
  .command('doctor')
  .description('Check environment/config and print what is missing')
  .action(() => {
    const report = doctorReport();
    console.log('task-sync doctor');
    console.log('providers:', report.providers);
    if (report.missing.length) {
      console.log('\nMissing env vars:');
      for (const k of report.missing) console.log(`- ${k}`);
    } else {
      console.log('\nNo missing env vars detected for selected providers.');
    }

    if (report.notes.length) {
      console.log('\nNotes:');
      for (const n of report.notes) console.log(`- ${n}`);
    }

    if (!report.providers.a || !report.providers.b) process.exitCode = 2;
    else if (report.missing.length) process.exitCode = 2;
  });

program
  .command('sync')
  .description('Run sync engine')
  .option('--dry-run', 'Use mock providers and do not persist state')
  .option('--state-dir <dir>', 'Override state dir (default: .task-sync or TASK_SYNC_STATE_DIR)')
  .option('--format <format>', 'Output format: pretty|json', 'pretty')
  .action(async (opts: { dryRun?: boolean; stateDir?: string; format?: string }) => {
    const env = readEnv();
    const logger = createLogger(env.TASK_SYNC_LOG_LEVEL ?? 'info');

    const engine = new SyncEngine(new JsonStore(opts.stateDir ?? env.TASK_SYNC_STATE_DIR));

    const dryRun = !!opts.dryRun;

    if (!dryRun) {
      const dr = doctorReport(env);
      if (!dr.providers.a || !dr.providers.b || dr.missing.length) {
        console.error('Configuration incomplete. Run: task-sync doctor');
        process.exitCode = 2;
        return;
      }
    }

    const providerA = dryRun
      ? new MockProvider({
          name: 'mockA',
          tasks: [
            {
              id: 'a1',
              title: 'Mock A task',
              status: 'active',
              updatedAt: new Date(Date.now() - 60_000).toISOString(),
            },
          ],
        })
      : env.TASK_SYNC_PROVIDER_A === 'google'
        ? new GoogleTasksProvider({
            clientId: env.TASK_SYNC_GOOGLE_CLIENT_ID!,
            clientSecret: env.TASK_SYNC_GOOGLE_CLIENT_SECRET!,
            refreshToken: env.TASK_SYNC_GOOGLE_REFRESH_TOKEN!,
            tasklistId: env.TASK_SYNC_GOOGLE_TASKLIST_ID,
          })
        : new MicrosoftTodoProvider({
            clientId: env.TASK_SYNC_MS_CLIENT_ID!,
            tenantId: env.TASK_SYNC_MS_TENANT_ID!,
            refreshToken: env.TASK_SYNC_MS_REFRESH_TOKEN!,
            listId: env.TASK_SYNC_MS_LIST_ID,
          });

    const providerB = dryRun
      ? new MockProvider({
          name: 'mockB',
          tasks: [
            {
              id: 'b1',
              title: 'Mock B task',
              status: 'active',
              updatedAt: new Date(Date.now() - 120_000).toISOString(),
            },
          ],
        })
      : env.TASK_SYNC_PROVIDER_B === 'google'
        ? new GoogleTasksProvider({
            clientId: env.TASK_SYNC_GOOGLE_CLIENT_ID!,
            clientSecret: env.TASK_SYNC_GOOGLE_CLIENT_SECRET!,
            refreshToken: env.TASK_SYNC_GOOGLE_REFRESH_TOKEN!,
            tasklistId: env.TASK_SYNC_GOOGLE_TASKLIST_ID,
          })
        : new MicrosoftTodoProvider({
            clientId: env.TASK_SYNC_MS_CLIENT_ID!,
            tenantId: env.TASK_SYNC_MS_TENANT_ID!,
            refreshToken: env.TASK_SYNC_MS_REFRESH_TOKEN!,
            listId: env.TASK_SYNC_MS_LIST_ID,
          });

    logger.info(`sync start (dryRun=${dryRun})`, { a: providerA.name, b: providerB.name });

    const report = await engine.sync(providerA, providerB, { dryRun });

    if ((opts.format ?? 'pretty') === 'json') {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(`task-sync report`);
    console.log(`providers: ${report.providerA} <-> ${report.providerB}`);
    console.log(`lastSyncAt: ${report.lastSyncAt ?? '(none)'}`);
    console.log(`newLastSyncAt: ${report.newLastSyncAt}`);
    console.log(`dryRun: ${report.dryRun}`);

    console.log('\ncounts:');
    for (const k of Object.keys(report.counts) as Array<keyof typeof report.counts>) {
      console.log(`- ${k}: ${report.counts[k]}`);
    }

    console.log('\nactions:');
    for (const a of report.actions) {
      const exec = a.executed ? 'exec' : 'plan';
      const tgt = a.target.id ? `${a.target.provider}:${a.target.id}` : a.target.provider;
      console.log(`- [${exec}] ${a.kind} ${tgt} <= ${a.source.provider}:${a.source.id} ${a.title ? `"${a.title}"` : ''}`);
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
