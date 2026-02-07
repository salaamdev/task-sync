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
  .description('Sync tasks between Google Tasks and Microsoft To Do')
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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

program
  .command('sync')
  .description('Run sync engine (2-3 providers)')
  .option('--dry-run', 'Do not perform writes/deletes (still uses configured providers)')
  .option('--state-dir <dir>', 'Override state dir (default: .task-sync or TASK_SYNC_STATE_DIR)')
  .option('--format <format>', 'Output format: pretty|json', 'pretty')
  .option('--poll <minutes>', 'Polling mode: run sync every N minutes (or use TASK_SYNC_POLL_INTERVAL_MINUTES)')
  .action(async (opts: { dryRun?: boolean; stateDir?: string; format?: string; poll?: string }) => {
    const env = readEnv();
    const logger = createLogger(env.TASK_SYNC_LOG_LEVEL ?? 'info');

    const store = new JsonStore(opts.stateDir ?? env.TASK_SYNC_STATE_DIR);
    const engine = new SyncEngine(store);

    const dryRun = !!opts.dryRun;

    const providers = [env.TASK_SYNC_PROVIDER_A, env.TASK_SYNC_PROVIDER_B].filter(
      Boolean,
    ) as Array<'google' | 'microsoft'>;

    if (providers.length < 2) {
      console.error('Need at least 2 providers. Set TASK_SYNC_PROVIDER_A=google + TASK_SYNC_PROVIDER_B=microsoft.');
      process.exitCode = 2;
      return;
    }

    const dr = doctorReport(env);
    if (!dryRun && dr.missing.length) {
      console.error('Configuration incomplete. Run: task-sync doctor');
      process.exitCode = 2;
      return;
    }

    const makeProvider = (p: 'google' | 'microsoft') => {
      if (p === 'google') {
        return new GoogleTasksProvider({
          clientId: env.TASK_SYNC_GOOGLE_CLIENT_ID!,
          clientSecret: env.TASK_SYNC_GOOGLE_CLIENT_SECRET!,
          refreshToken: env.TASK_SYNC_GOOGLE_REFRESH_TOKEN!,
          tasklistId: env.TASK_SYNC_GOOGLE_TASKLIST_ID,
        });
      }
      return new MicrosoftTodoProvider({
        clientId: env.TASK_SYNC_MS_CLIENT_ID!,
        tenantId: env.TASK_SYNC_MS_TENANT_ID!,
        refreshToken: env.TASK_SYNC_MS_REFRESH_TOKEN!,
        // CLI uses public client flow (Mobile/Desktop platform) — no secret needed.
        // The web UI uses confidential client flow (Web platform) with its own secret.
        listId: env.TASK_SYNC_MS_LIST_ID,
      });
    };

    const providerInstances = providers.map(makeProvider);

    const pollMinutes = opts.poll ? Number(opts.poll) : env.TASK_SYNC_POLL_INTERVAL_MINUTES;
    const polling = Number.isFinite(pollMinutes) && (pollMinutes ?? 0) > 0;

    let runCount = 0;
    while (true) {
      runCount++;
      logger.info(`sync start (dryRun=${dryRun}, run=${runCount})`, { providers });

      const report = await engine.syncMany(providerInstances, {
      dryRun,
      mode: env.TASK_SYNC_MODE ?? 'bidirectional',
      tombstoneTtlDays: env.TASK_SYNC_TOMBSTONE_TTL_DAYS ?? 30,
    });

      if ((opts.format ?? 'pretty') === 'json') {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(`task-sync report`);
        console.log(`providers: ${report.providers.join(' <-> ')}`);
        console.log(`lastSyncAt: ${report.lastSyncAt ?? '(none)'}`);
        console.log(`newLastSyncAt: ${report.newLastSyncAt}`);
        console.log(`dryRun: ${report.dryRun}`);
        console.log(`durationMs: ${report.durationMs}`);

        console.log('\ncounts:');
        for (const k of Object.keys(report.counts) as Array<keyof typeof report.counts>) {
          console.log(`- ${k}: ${report.counts[k]}`);
        }

        if (report.errors.length) {
          console.log('\nerrors:');
          for (const e of report.errors) console.log(`- ${e.provider} (${e.stage}): ${e.error}`);
        }

        if (report.conflicts.length) {
          console.log(`\nconflicts: ${report.conflicts.length} (see conflicts.log in state dir)`);
        }

        console.log('\nactions:');
        for (const a of report.actions) {
          const exec = a.executed ? 'exec' : 'plan';
          const tgt = a.target.id ? `${a.target.provider}:${a.target.id}` : a.target.provider;
          console.log(
            `- [${exec}] ${a.kind} ${tgt} <= ${a.source.provider}:${a.source.id} ${a.title ? `"${a.title}"` : ''} :: ${a.detail}`,
          );
        }
      }

      if (!polling) break;

      const waitMs = Math.max(1, pollMinutes!) * 60_000;
      logger.info(`poll sleep ${pollMinutes}m`);
      await sleep(waitMs);
    }
  });

program
  .command('mock')
  .description('Run a 2-provider dry-run using in-memory mock providers (for demos/tests)')
  .option('--format <format>', 'Output format: pretty|json', 'pretty')
  .action(async (opts: { format?: string }) => {
    const logger = createLogger('info');
    const engine = new SyncEngine(new JsonStore());

    const a = new MockProvider({
      name: 'mockA',
      tasks: [
        {
          id: 'a1',
          title: 'Mock A task',
          status: 'active',
          updatedAt: new Date(Date.now() - 60_000).toISOString(),
        },
      ],
    });
    const b = new MockProvider({ name: 'mockB', tasks: [] });

    logger.info('mock sync start', { providers: [a.name, b.name] });
    const report = await engine.syncMany([a, b], { dryRun: true });

    if ((opts.format ?? 'pretty') === 'json') {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(`task-sync report`);
    console.log(`providers: ${report.providers.join(' <-> ')}`);
    console.log(`newLastSyncAt: ${report.newLastSyncAt}`);
    console.log(`dryRun: ${report.dryRun}`);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
