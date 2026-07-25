import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchJsonWithRetryMock = vi.fn();

vi.mock("@/lib/data-sources/http", () => ({
  fetchJsonWithRetry: (...args: unknown[]) => fetchJsonWithRetryMock(...args),
}));

import { __resetCountyCatalogForTests, searchUsCounties } from "@/lib/geographies/us-counties";

/**
 * The Census county catalog is the source behind county search everywhere in
 * the app. Its failure mode is emptiness, not an error: api.census.gov answers
 * an unauthenticated request with a 302 to an HTML page, and
 * `fetchJsonWithRetry` reports every failure as `null` rather than throwing.
 *
 * These tests pin the two properties that keep that from reading as "your
 * county does not exist": an unreadable catalog is reported as unavailable, and
 * a failure is never memoized.
 */

const CATALOG_RESPONSE = [
  ["NAME", "state", "county"],
  ["Nevada County, California", "06", "057"],
  ["Franklin County, Ohio", "39", "049"],
];

describe("searchUsCounties", () => {
  const originalKey = process.env.CENSUS_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetCountyCatalogForTests();
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.CENSUS_API_KEY;
    else process.env.CENSUS_API_KEY = originalKey;
    __resetCountyCatalogForTests();
  });

  it("returns matches with an available catalog", async () => {
    fetchJsonWithRetryMock.mockResolvedValue(CATALOG_RESPONSE);

    const outcome = await searchUsCounties("franklin");

    expect(outcome.availability).toBe("ok");
    expect(outcome.unavailableReason).toBeNull();
    expect(outcome.items.map((item) => item.geographyId)).toEqual(["39049"]);
  });

  it("reports a genuine non-match as available with no items", async () => {
    fetchJsonWithRetryMock.mockResolvedValue(CATALOG_RESPONSE);

    const outcome = await searchUsCounties("zzzznotacounty");

    expect(outcome.availability).toBe("ok");
    expect(outcome.items).toEqual([]);
  });

  it("names the missing Census key when there is no key and the catalog will not load", async () => {
    delete process.env.CENSUS_API_KEY;
    // What a 302 -> missing_key.html actually produces downstream.
    fetchJsonWithRetryMock.mockResolvedValue(null);

    const outcome = await searchUsCounties("franklin");

    expect(outcome.availability).toBe("unavailable");
    expect(outcome.items).toEqual([]);
    expect(outcome.unavailableReason).toMatch(/Census API key/i);
    // The reason must never carry the key itself.
    expect(outcome.unavailableReason).not.toMatch(/CENSUS_API_KEY=/);
  });

  it("reports an outage rather than a key problem when a key IS configured", async () => {
    process.env.CENSUS_API_KEY = "test-key";
    fetchJsonWithRetryMock.mockResolvedValue(null);

    const outcome = await searchUsCounties("franklin");

    expect(outcome.availability).toBe("unavailable");
    expect(outcome.unavailableReason).toMatch(/did not respond/i);
    expect(outcome.unavailableReason).not.toMatch(/API key/i);
  });

  it("treats a well-formed-looking response with the wrong columns as unavailable, not empty", async () => {
    fetchJsonWithRetryMock.mockResolvedValue([
      ["SOMETHING_ELSE", "x", "y"],
      ["a", "b", "c"],
    ]);

    const outcome = await searchUsCounties("franklin");

    expect(outcome.availability).toBe("unavailable");
  });

  /**
   * The bug this replaces: the catalog promise was memoized unconditionally, so
   * one outage — or a key that had not been set when the process started —
   * pinned "no US county exists" for the lifetime of the instance.
   */
  it("does not memoize a failure — the next search retries", async () => {
    fetchJsonWithRetryMock.mockResolvedValueOnce(null).mockResolvedValueOnce(CATALOG_RESPONSE);

    const first = await searchUsCounties("franklin");
    expect(first.availability).toBe("unavailable");

    const second = await searchUsCounties("franklin");
    expect(second.availability).toBe("ok");
    expect(second.items.map((item) => item.geographyId)).toEqual(["39049"]);
    expect(fetchJsonWithRetryMock).toHaveBeenCalledTimes(2);
  });

  it("memoizes a success — a second search does not refetch the catalog", async () => {
    fetchJsonWithRetryMock.mockResolvedValue(CATALOG_RESPONSE);

    await searchUsCounties("franklin");
    await searchUsCounties("nevada");

    expect(fetchJsonWithRetryMock).toHaveBeenCalledTimes(1);
  });

  it("does not consult the catalog for a query too short to search", async () => {
    const outcome = await searchUsCounties("f");

    expect(outcome.availability).toBe("ok");
    expect(outcome.items).toEqual([]);
    expect(fetchJsonWithRetryMock).not.toHaveBeenCalled();
  });
});
