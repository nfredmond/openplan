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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const {
    timeoutMs = 12000,
    retries = 1,
    retryDelayMs = 250,
    cacheTtlMs = 0,
    cacheKey,
  } = options;

  const key = buildCacheKey(url, init, cacheKey);

  if (cacheTtlMs > 0) {
    pruneExpiredCacheEntries();

    const cached = responseCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.payload as T;
    }
  }

  for (let attempt = 0; attempt <= retries; attempt += 1) {
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
      if (attempt === retries) {
        return null;
      }
    }

    await sleep(retryDelayMs * Math.pow(2, attempt));
  }

  return null;
}
