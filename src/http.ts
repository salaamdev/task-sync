export type FetchLike = typeof fetch;

export interface JsonRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly url: string,
    public readonly responseText?: string,
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

export async function requestJson<T>(
  url: string,
  opts: JsonRequestOptions = {},
  fetcher: FetchLike = fetch,
): Promise<T> {
  const finalUrl = withQuery(url, opts.query);
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
    throw new HttpError(`HTTP ${res.status} for ${finalUrl}`, res.status, finalUrl, txt);
  }

  // empty body
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}
