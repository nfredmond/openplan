// Per-process memo of grants.gov search results. POST fetches are never
// stored in Next's data cache, so the route caches here: it protects
// grants.gov from a refresh-happy operator without persisting anything,
// and a server restart simply starts fresh.

import type { GrantsGovSearchResult } from "@/lib/grants/grants-gov";

export const GRANTS_GOV_CACHE_TTL_MS = 30 * 60 * 1000;

/** Distinct keyword searches memoized at once; oldest evicted beyond this. */
export const GRANTS_GOV_CACHE_MAX_ENTRIES = 200;

type CacheEntry = { fetchedAt: number; result: GrantsGovSearchResult };

const responseCache = new Map<string, CacheEntry>();

export function getCachedGrantsGovResult(
  cacheKey: string,
  now: number,
  ttlMs: number = GRANTS_GOV_CACHE_TTL_MS
): CacheEntry | null {
  const entry = responseCache.get(cacheKey);
  if (!entry) return null;
  if (now - entry.fetchedAt >= ttlMs) {
    responseCache.delete(cacheKey);
    return null;
  }
  return entry;
}

export function setCachedGrantsGovResult(cacheKey: string, entry: CacheEntry): void {
  // Sweep expired entries so distinct-keyword searches cannot grow the map
  // unboundedly between same-key hits.
  for (const [key, existing] of responseCache) {
    if (entry.fetchedAt - existing.fetchedAt >= GRANTS_GOV_CACHE_TTL_MS) {
      responseCache.delete(key);
    }
  }
  // Delete-then-set keeps insertion order equal to age order, so FIFO
  // eviction below always removes the oldest entry.
  responseCache.delete(cacheKey);
  responseCache.set(cacheKey, entry);
  while (responseCache.size > GRANTS_GOV_CACHE_MAX_ENTRIES) {
    const oldest = responseCache.keys().next().value;
    if (oldest === undefined) break;
    responseCache.delete(oldest);
  }
}

export function resetGrantsGovResponseCache(): void {
  responseCache.clear();
}
