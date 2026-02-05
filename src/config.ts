import { z } from 'zod';

const str = z.string().min(1);

export const EnvSchema = z.object({
  TASK_SYNC_PROVIDER_A: z.enum(['google', 'microsoft']).optional(),
  TASK_SYNC_PROVIDER_B: z.enum(['google', 'microsoft']).optional(),

  // behavior
  TASK_SYNC_LOG_LEVEL: z.enum(['silent', 'error', 'warn', 'info', 'debug']).optional(),
  TASK_SYNC_STATE_DIR: str.optional(),

  // Google Tasks (scaffold)
  TASK_SYNC_GOOGLE_CLIENT_ID: str.optional(),
  TASK_SYNC_GOOGLE_CLIENT_SECRET: str.optional(),
  TASK_SYNC_GOOGLE_REFRESH_TOKEN: str.optional(),
  TASK_SYNC_GOOGLE_TASKLIST_ID: str.optional(),

  // Microsoft Graph (scaffold)
  TASK_SYNC_MS_CLIENT_ID: str.optional(),
  TASK_SYNC_MS_TENANT_ID: str.optional(),
  TASK_SYNC_MS_REFRESH_TOKEN: str.optional(),
  TASK_SYNC_MS_LIST_ID: str.optional(),
});

export type EnvConfig = z.infer<typeof EnvSchema>;

export function readEnv(env = process.env): EnvConfig {
  return EnvSchema.parse(env);
}

export function doctorReport(env = readEnv()) {
  const providerA = env.TASK_SYNC_PROVIDER_A;
  const providerB = env.TASK_SYNC_PROVIDER_B;

  const missing: string[] = [];
  const notes: string[] = [];

  if (!providerA || !providerB) {
    notes.push('Set TASK_SYNC_PROVIDER_A and TASK_SYNC_PROVIDER_B to choose providers (google|microsoft).');
  }

  for (const p of [providerA, providerB].filter(Boolean) as Array<'google' | 'microsoft'>) {
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
      notes.push('Microsoft: TASK_SYNC_MS_LIST_ID optional (defaults TBD).');
    }
  }

  return {
    providers: { a: providerA, b: providerB },
    missing,
    notes,
  };
}
