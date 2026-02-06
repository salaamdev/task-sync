export type FetchLike = typeof fetch;

export interface JsonRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Retries for transient errors (default: 3). */
  retries?: number;
  /** Base delay for exponential backoff in ms (default: 200). */
  backoffMs?: number;
  /** Optional request-per-second cap for this call (best-effort). */
  rps?: number;
}

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly url: string,
    public readonly responseText?: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

function withQuery(url: string, query?: JsonRequestOptions['query']) {
  if (!query) return url;
  const u = new URL(url);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Simple global limiter keyed by origin.
const lastRequestAt = new Map<string, number>();

function originOf(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return 'unknown';
  }
}

async function throttle(url: string, rps?: number) {
  if (!rps || rps <= 0) return;
  const minGap = 1000 / rps;
  const key = originOf(url);
  const last = lastRequestAt.get(key) ?? 0;
  const now = Date.now();
  const wait = last + minGap - now;
  if (wait > 0) await sleep(wait);
  lastRequestAt.set(key, Date.now());
}

function parseRetryAfterMs(v: string | null): number | undefined {
  if (!v) return undefined;
  const sec = Number(v);
  if (Number.isFinite(sec) && sec >= 0) return sec * 1000;
  const at = Date.parse(v);
  if (Number.isFinite(at)) return Math.max(0, at - Date.now());
  return undefined;
}

function isTransientStatus(status: number) {
  return status === 429 || status >= 500;
}

export async function requestJson<T>(
  url: string,
  opts: JsonRequestOptions = {},
  fetcher: FetchLike = fetch,
): Promise<T> {
  const finalUrl = withQuery(url, opts.query);
  const retries = opts.retries ?? 3;
  const backoffMs = opts.backoffMs ?? 200;

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt++;
    try {
      const envRps = process.env.TASK_SYNC_HTTP_RPS ? Number(process.env.TASK_SYNC_HTTP_RPS) : undefined;
      await throttle(finalUrl, opts.rps ?? envRps);

      const res = await fetcher(finalUrl, {
        method: opts.method ?? 'GET',
        headers: {
          accept: 'application/json',
          ...(opts.body ? { 'content-type': 'application/json' } : {}),
          ...(opts.headers ?? {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => undefined);
        const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after'));
        const err = new HttpError(`HTTP ${res.status} for ${finalUrl}`, res.status, finalUrl, txt, retryAfterMs);
        if (attempt <= retries && isTransientStatus(res.status)) {
          const wait = retryAfterMs ?? backoffMs * 2 ** (attempt - 1);
          await sleep(wait);
          continue;
        }
        throw err;
      }

      // empty body
      if (res.status === 204) return undefined as T;

      const text = await res.text();
      if (!text) return undefined as T;
      return JSON.parse(text) as T;
    } catch (e) {
      // network/parse errors
      if (attempt <= retries) {
        const wait = backoffMs * 2 ** (attempt - 1);
        await sleep(wait);
        continue;
      }
      throw e;
    }
  }
}
