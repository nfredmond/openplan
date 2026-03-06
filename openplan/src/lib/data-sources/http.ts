type FetchJsonOptions = {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  cacheTtlMs?: number;
  cacheKey?: string;
};

type CacheEntry = {
  expiresAt: number;
  payload: unknown;
};

const responseCache = new Map<string, CacheEntry>();
const MAX_CACHE_ENTRIES = 500;
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_RETRIES = 1;
const DEFAULT_RETRY_DELAY_MS = 250;
const DEFAULT_CACHE_TTL_MS = 0;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  const normalized = Math.trunc(value);
  if (normalized <= 0) {
    return fallback;
  }

  return normalized;
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  const normalized = Math.trunc(value);
  if (normalized < 0) {
    return 0;
  }

  return normalized;
}

function buildCacheKey(url: string, init?: RequestInit, explicit?: string): string {
  if (explicit) return explicit;
  const method = (init?.method ?? "GET").toUpperCase();
  const body = typeof init?.body === "string" ? init.body : "";
  return `${method}:${url}:${body}`;
}

function pruneExpiredCacheEntries(now = Date.now()) {
  for (const [key, entry] of responseCache.entries()) {
    if (entry.expiresAt <= now) {
      responseCache.delete(key);
    }
  }
}

function enforceCacheLimit() {
  if (responseCache.size <= MAX_CACHE_ENTRIES) {
    return;
  }

  const overflow = responseCache.size - MAX_CACHE_ENTRIES;
  let removed = 0;
  for (const key of responseCache.keys()) {
    responseCache.delete(key);
    removed += 1;
    if (removed >= overflow) {
      break;
    }
  }
}

function withTimeoutSignal(timeoutMs: number, upstream?: AbortSignal | null): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);

  if (!upstream) {
    return timeoutSignal;
  }

  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([upstream, timeoutSignal]);
  }

  if (upstream.aborted) {
    return upstream;
  }

  return timeoutSignal;
}

export function __clearFetchJsonResponseCacheForTests() {
  responseCache.clear();
}

export function __fetchJsonResponseCacheSizeForTests() {
  return responseCache.size;
}

export async function fetchJsonWithRetry<T>(
  url: string,
  init?: RequestInit,
  options: FetchJsonOptions = {}
): Promise<T | null> {
  const timeoutMs = normalizePositiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const retries = normalizeNonNegativeInteger(options.retries, DEFAULT_RETRIES);
  const retryDelayMs = normalizeNonNegativeInteger(
    options.retryDelayMs,
    DEFAULT_RETRY_DELAY_MS
  );
  const cacheTtlMs = normalizeNonNegativeInteger(options.cacheTtlMs, DEFAULT_CACHE_TTL_MS);
  const key = buildCacheKey(url, init, options.cacheKey);

  if (cacheTtlMs > 0) {
    pruneExpiredCacheEntries();

    const cached = responseCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.payload as T;
    }
  }

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (init?.signal?.aborted) {
      return null;
    }

    try {
      const response = await fetch(url, {
        ...init,
        signal: withTimeoutSignal(timeoutMs, init?.signal),
      });

      if (!response.ok) {
        const retriable = response.status >= 500 || response.status === 429;
        if (!retriable || attempt === retries) {
          return null;
        }
      } else {
        const payload = (await response.json()) as T;
        if (cacheTtlMs > 0) {
          responseCache.set(key, { payload, expiresAt: Date.now() + cacheTtlMs });
          enforceCacheLimit();
        }
        return payload;
      }
    } catch {
      if (init?.signal?.aborted || attempt === retries) {
        return null;
      }
    }

    if (init?.signal?.aborted) {
      return null;
    }

    await sleep(retryDelayMs * Math.pow(2, attempt));
  }

  return null;
}
