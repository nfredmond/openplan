import { beforeEach, describe, expect, it } from "vitest";
import {
  GRANTS_GOV_CACHE_MAX_ENTRIES,
  GRANTS_GOV_CACHE_TTL_MS,
  getCachedGrantsGovResult,
  resetGrantsGovResponseCache,
  setCachedGrantsGovResult,
} from "@/lib/grants/grants-gov-cache";

const RESULT = { hitCount: 1, opportunities: [] };

describe("grants.gov response cache", () => {
  beforeEach(() => {
    resetGrantsGovResponseCache();
  });

  it("returns entries within the TTL and expires them after", () => {
    setCachedGrantsGovResult("k", { fetchedAt: 1_000, result: RESULT });
    expect(getCachedGrantsGovResult("k", 1_000 + GRANTS_GOV_CACHE_TTL_MS - 1)).not.toBeNull();
    expect(getCachedGrantsGovResult("k", 1_000 + GRANTS_GOV_CACHE_TTL_MS)).toBeNull();
  });

  it("evicts the oldest entry beyond the size cap", () => {
    for (let index = 0; index <= GRANTS_GOV_CACHE_MAX_ENTRIES; index += 1) {
      setCachedGrantsGovResult(`key-${index}`, { fetchedAt: 1_000 + index, result: RESULT });
    }
    expect(getCachedGrantsGovResult("key-0", 2_000)).toBeNull();
    expect(getCachedGrantsGovResult(`key-${GRANTS_GOV_CACHE_MAX_ENTRIES}`, 2_000)).not.toBeNull();
  });

  it("sweeps expired entries on write so distinct keywords cannot grow the map unboundedly", () => {
    setCachedGrantsGovResult("stale", { fetchedAt: 1_000, result: RESULT });
    setCachedGrantsGovResult("fresh", {
      fetchedAt: 1_000 + GRANTS_GOV_CACHE_TTL_MS,
      result: RESULT,
    });
    // The stale entry is gone even when probed with a permissive TTL.
    expect(getCachedGrantsGovResult("stale", 1_000, Number.MAX_SAFE_INTEGER)).toBeNull();
    expect(
      getCachedGrantsGovResult("fresh", 1_000 + GRANTS_GOV_CACHE_TTL_MS)
    ).not.toBeNull();
  });

  it("refreshing a key moves it to the back of the eviction order", () => {
    setCachedGrantsGovResult("a", { fetchedAt: 1_000, result: RESULT });
    setCachedGrantsGovResult("b", { fetchedAt: 1_001, result: RESULT });
    setCachedGrantsGovResult("a", { fetchedAt: 1_002, result: RESULT });
    for (let index = 0; index < GRANTS_GOV_CACHE_MAX_ENTRIES - 1; index += 1) {
      setCachedGrantsGovResult(`fill-${index}`, { fetchedAt: 1_003 + index, result: RESULT });
    }
    // Cap is now exceeded by one: "b" (oldest position) is evicted, "a" survives.
    expect(getCachedGrantsGovResult("b", 2_000)).toBeNull();
    expect(getCachedGrantsGovResult("a", 2_000)).not.toBeNull();
  });
});
