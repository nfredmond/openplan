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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildCacheKey(url: string, init?: RequestInit, explicit?: string): string {
  if (explicit) return explicit;
  const method = (init?.method ?? "GET").toUpperCase();
  const body = typeof init?.body === "string" ? init.body : "";
  return `${method}:${url}:${body}`;
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
    const cached = responseCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.payload as T;
    }
  }

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
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
