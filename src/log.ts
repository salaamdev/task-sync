export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

const ORDER: Record<Exclude<LogLevel, 'silent'>, number> = {
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

export interface Logger {
  error(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  info(msg: string, meta?: unknown): void;
  debug(msg: string, meta?: unknown): void;
}

function fmtMeta(meta: unknown) {
  if (meta === undefined) return '';
  if (typeof meta === 'string') return ` ${meta}`;
  try {
    return ` ${JSON.stringify(meta)}`;
  } catch {
    return ' [meta-unserializable]';
  }
}

export function createLogger(level: LogLevel = 'info'): Logger {
  if (level === 'silent') {
    return {
      error: () => {},
      warn: () => {},
      info: () => {},
      debug: () => {},
    };
  }

  const threshold = ORDER[level];
  const prefix = (lvl: string) => `${new Date().toISOString()} ${lvl.toUpperCase()} `;

  const can = (lvl: Exclude<LogLevel, 'silent'>) => ORDER[lvl] <= threshold;

  return {
    error: (msg, meta) => {
      if (can('error')) console.error(prefix('error') + msg + fmtMeta(meta));
    },
    warn: (msg, meta) => {
      if (can('warn')) console.warn(prefix('warn') + msg + fmtMeta(meta));
    },
    info: (msg, meta) => {
      if (can('info')) console.log(prefix('info') + msg + fmtMeta(meta));
    },
    debug: (msg, meta) => {
      if (can('debug')) console.log(prefix('debug') + msg + fmtMeta(meta));
    },
  };
}
