type FetchJsonOptions = {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  cacheTtlMs?: number;
  cacheKey?: string;
  retryNonIdempotentMethods?: boolean;
};

type CacheEntry = {
  expiresAt: number;
  payload: unknown;
};

const responseCache = new Map<string, CacheEntry>();
const MAX_CACHE_ENTRIES = 500;
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_RETRIES = 1;
const MAX_RETRIES = 5;
const DEFAULT_RETRY_DELAY_MS = 250;
const MAX_RETRY_DELAY_MS = 60_000;
const MAX_BACKOFF_DELAY_MS = 60_000;
const DEFAULT_CACHE_TTL_MS = 0;
const RETRIABLE_STATUS_CODES = new Set([408, 425, 429]);
const CACHEABLE_HTTP_METHODS = new Set(["GET", "HEAD"]);
const IMPLICIT_CACHE_BLOCKED_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "x-api-key",
]);
const IMPLICIT_CACHE_BLOCKED_QUERY_PARAMS = new Set([
  "access_token",
  "api_key",
  "apikey",
  "auth",
  "authorization",
  "key",
  "sig",
  "signature",
  "token",
]);
const IDEMPOTENT_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]);

function parseRetryAfterDelayMs(retryAfterValue: string | null): number | null {
  if (!retryAfterValue) {
    return null;
  }

  const normalized = retryAfterValue.trim();
  if (!normalized) {
    return null;
  }

  const asSeconds = Number(normalized);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.min(Math.trunc(asSeconds * 1000), MAX_BACKOFF_DELAY_MS);
  }

  const asDate = Date.parse(normalized);
  if (Number.isNaN(asDate)) {
    return null;
  }

  const deltaMs = Math.max(0, asDate - Date.now());
  return Math.min(deltaMs, MAX_BACKOFF_DELAY_MS);
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<boolean> {
  if (!signal) {
    return new Promise((resolve) => setTimeout(() => resolve(true), ms));
  }

  if (signal.aborted) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(false);
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function normalizePositiveInteger(
  value: number | undefined,
  fallback: number,
  max?: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  const normalized = Math.trunc(value);
  if (normalized <= 0) {
    return fallback;
  }

  if (typeof max === "number") {
    return Math.min(normalized, max);
  }

  return normalized;
}

function normalizeNonNegativeInteger(
  value: number | undefined,
  fallback: number,
  max?: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  const normalized = Math.trunc(value);
  if (normalized < 0) {
    return 0;
  }

  if (typeof max === "number") {
    return Math.min(normalized, max);
  }

  return normalized;
}

function isRetriableStatus(status: number): boolean {
  return status >= 500 || RETRIABLE_STATUS_CODES.has(status);
}

function getRequestMethod(init?: RequestInit): string {
  return (init?.method ?? "GET").toUpperCase();
}

function hasImplicitCacheBlockedHeaders(headers?: HeadersInit): boolean {
  if (!headers) {
    return false;
  }

  const normalized = new Headers(headers);
  for (const headerName of IMPLICIT_CACHE_BLOCKED_HEADERS) {
    if (normalized.has(headerName)) {
      return true;
    }
  }

  return false;
}

function hasImplicitCacheBlockedQueryParams(url: string): boolean {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url, "http://localhost");
  } catch {
    return false;
  }

  for (const [param] of parsedUrl.searchParams) {
    if (IMPLICIT_CACHE_BLOCKED_QUERY_PARAMS.has(param.toLowerCase())) {
      return true;
    }
  }

  return false;
}

function canUseResponseCache(
  url: string,
  method: string,
  explicitCacheKey?: string,
  headers?: HeadersInit
): boolean {
  if (explicitCacheKey) {
    return true;
  }

  if (hasImplicitCacheBlockedHeaders(headers)) {
    return false;
  }

  if (hasImplicitCacheBlockedQueryParams(url)) {
    return false;
  }

  return CACHEABLE_HTTP_METHODS.has(method);
}

function canRetryMethod(method: string, options: FetchJsonOptions): boolean {
  if (options.retryNonIdempotentMethods) {
    return true;
  }

  return IDEMPOTENT_HTTP_METHODS.has(method);
}

function buildCacheKey(
  url: string,
  method: string,
  init?: RequestInit,
  explicit?: string
): string {
  if (explicit) return explicit;
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

type TimeoutSignalResult = {
  signal: AbortSignal;
  cleanup: () => void;
};

function buildTimeoutSignal(timeoutMs: number): TimeoutSignalResult {
  if (typeof AbortSignal.timeout === "function") {
    return {
      signal: AbortSignal.timeout(timeoutMs),
      cleanup: () => {},
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error("Request timed out"));
  }, timeoutMs);

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    clearTimeout(timeoutId);
    controller.signal.removeEventListener("abort", cleanup);
  };

  controller.signal.addEventListener("abort", cleanup, { once: true });

  return {
    signal: controller.signal,
    cleanup,
  };
}

function withTimeoutSignal(timeoutMs: number, upstream?: AbortSignal | null): TimeoutSignalResult {
  const timeoutResult = buildTimeoutSignal(timeoutMs);
  const timeoutSignal = timeoutResult.signal;

  if (!upstream) {
    return timeoutResult;
  }

  if (typeof AbortSignal.any === "function") {
    return {
      signal: AbortSignal.any([upstream, timeoutSignal]),
      cleanup: timeoutResult.cleanup,
    };
  }

  if (upstream.aborted) {
    timeoutResult.cleanup();
    return {
      signal: upstream,
      cleanup: () => {},
    };
  }

  if (timeoutSignal.aborted) {
    return timeoutResult;
  }

  const controller = new AbortController();
  let cleanedUp = false;

  const cleanup = () => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    upstream.removeEventListener("abort", onUpstreamAbort);
    timeoutSignal.removeEventListener("abort", onTimeoutAbort);
    timeoutResult.cleanup();
  };

  const abortFrom = (source: AbortSignal) => {
    if (!controller.signal.aborted) {
      controller.abort((source as AbortSignal & { reason?: unknown }).reason);
    }

    cleanup();
  };

  const onUpstreamAbort = () => {
    abortFrom(upstream);
  };

  const onTimeoutAbort = () => {
    abortFrom(timeoutSignal);
  };

  upstream.addEventListener("abort", onUpstreamAbort, { once: true });
  timeoutSignal.addEventListener("abort", onTimeoutAbort, { once: true });

  return {
    signal: controller.signal,
    cleanup,
  };
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
  const retries = normalizeNonNegativeInteger(options.retries, DEFAULT_RETRIES, MAX_RETRIES);
  const retryDelayMs = normalizeNonNegativeInteger(
    options.retryDelayMs,
    DEFAULT_RETRY_DELAY_MS,
    MAX_RETRY_DELAY_MS
  );
  const cacheTtlMs = normalizeNonNegativeInteger(options.cacheTtlMs, DEFAULT_CACHE_TTL_MS);
  const method = getRequestMethod(init);
  const shouldUseResponseCache =
    cacheTtlMs > 0 && canUseResponseCache(url, method, options.cacheKey, init?.headers);
  const shouldRetryMethod = canRetryMethod(method, options);
  const key = shouldUseResponseCache
    ? buildCacheKey(url, method, init, options.cacheKey)
    : null;

  if (shouldUseResponseCache && key) {
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

    let retryAfterHintMs: number | null = null;

    const requestTimeout = withTimeoutSignal(timeoutMs, init?.signal);

    try {
      const response = await fetch(url, {
        ...init,
        signal: requestTimeout.signal,
      });

      if (!response.ok) {
        const retriable = isRetriableStatus(response.status);
        if (!retriable || !shouldRetryMethod || attempt === retries) {
          return null;
        }

        retryAfterHintMs = parseRetryAfterDelayMs(
          response.headers?.get?.("retry-after") ?? null
        );
      } else {
        let payload: T;

        try {
          payload = (await response.json()) as T;
        } catch {
          return null;
        }

        if (shouldUseResponseCache && key) {
          responseCache.set(key, { payload, expiresAt: Date.now() + cacheTtlMs });
          enforceCacheLimit();
        }
        return payload;
      }
    } catch {
      if (init?.signal?.aborted || !shouldRetryMethod || attempt === retries) {
        return null;
      }
    } finally {
      requestTimeout.cleanup();
    }

    if (init?.signal?.aborted) {
      return null;
    }

    const baseBackoffDelayMs = Math.min(
      retryDelayMs * Math.pow(2, attempt),
      MAX_BACKOFF_DELAY_MS
    );
    const backoffDelayMs =
      retryAfterHintMs === null
        ? baseBackoffDelayMs
        : Math.max(baseBackoffDelayMs, retryAfterHintMs);

    const continueRetrying = await sleep(backoffDelayMs, init?.signal);
    if (!continueRetrying) {
      return null;
    }
  }

  return null;
}
