import { z } from 'zod';

const str = z.string().min(1);

export const ProviderSchema = z.enum(['google', 'microsoft']);

export const EnvSchema = z.object({
  // providers
  TASK_SYNC_PROVIDER_A: ProviderSchema.optional(),
  TASK_SYNC_PROVIDER_B: ProviderSchema.optional(),

  // behavior
  TASK_SYNC_LOG_LEVEL: z.enum(['silent', 'error', 'warn', 'info', 'debug']).optional(),
  TASK_SYNC_STATE_DIR: str.optional(),
  TASK_SYNC_POLL_INTERVAL_MINUTES: z.coerce.number().int().positive().optional(),
  TASK_SYNC_MODE: z.enum(['bidirectional', 'a-to-b-only', 'mirror']).optional(),
  TASK_SYNC_TOMBSTONE_TTL_DAYS: z.coerce.number().int().positive().optional(),
  TASK_SYNC_HTTP_RPS: z.coerce.number().positive().optional(),

  // Google Tasks
  TASK_SYNC_GOOGLE_CLIENT_ID: str.optional(),
  TASK_SYNC_GOOGLE_CLIENT_SECRET: str.optional(),
  TASK_SYNC_GOOGLE_REFRESH_TOKEN: str.optional(),
  TASK_SYNC_GOOGLE_TASKLIST_ID: str.optional(),

  // Microsoft Graph
  TASK_SYNC_MS_CLIENT_ID: str.optional(),
  TASK_SYNC_MS_CLIENT_SECRET: str.optional(),
  TASK_SYNC_MS_TENANT_ID: str.optional(),
  TASK_SYNC_MS_REFRESH_TOKEN: str.optional(),
  TASK_SYNC_MS_LIST_ID: str.optional(),

});

export type EnvConfig = z.infer<typeof EnvSchema>;

export function readEnv(env = process.env): EnvConfig {
  return EnvSchema.parse(env);
}

export function doctorReport(env = readEnv()) {
  const providers = [env.TASK_SYNC_PROVIDER_A, env.TASK_SYNC_PROVIDER_B].filter(
    Boolean,
  ) as Array<z.infer<typeof ProviderSchema>>;

  const missing: string[] = [];
  const notes: string[] = [];

  if (providers.length < 2) {
    notes.push('Set TASK_SYNC_PROVIDER_A + TASK_SYNC_PROVIDER_B to choose providers (google|microsoft).');
  }

  for (const p of providers) {
    if (p === 'google') {
      if (!env.TASK_SYNC_GOOGLE_CLIENT_ID) missing.push('TASK_SYNC_GOOGLE_CLIENT_ID');
      if (!env.TASK_SYNC_GOOGLE_CLIENT_SECRET) missing.push('TASK_SYNC_GOOGLE_CLIENT_SECRET');
      if (!env.TASK_SYNC_GOOGLE_REFRESH_TOKEN) missing.push('TASK_SYNC_GOOGLE_REFRESH_TOKEN');
      notes.push('Google: TASK_SYNC_GOOGLE_TASKLIST_ID optional (defaults to @default).');
    }
    if (p === 'microsoft') {
      if (!env.TASK_SYNC_MS_CLIENT_ID) missing.push('TASK_SYNC_MS_CLIENT_ID');
      if (!env.TASK_SYNC_MS_TENANT_ID) missing.push('TASK_SYNC_MS_TENANT_ID');
      if (!env.TASK_SYNC_MS_REFRESH_TOKEN) missing.push('TASK_SYNC_MS_REFRESH_TOKEN');
      notes.push('Microsoft: TASK_SYNC_MS_LIST_ID optional (defaults to first list).');
    }
  }

  return {
    providers: {
      a: env.TASK_SYNC_PROVIDER_A,
      b: env.TASK_SYNC_PROVIDER_B,
    },
    missing: [...new Set(missing)],
    notes: [...new Set(notes)],
  };
}
