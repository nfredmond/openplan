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
  ["NAME", "B01003_001E", "state", "county"],
  ["Nevada County, California", "102241", "06", "057"],
  ["Franklin County, Ohio", "1323807", "39", "049"],
];

/**
 * Every county named "Franklin", smallest first, so an alphabetical or
 * insertion-order tiebreak cannot accidentally produce the right answer. Ohio's
 * is by far the largest and is deliberately NOT first in either ordering.
 */
const FRANKLIN_COLLISION_RESPONSE = [
  ["NAME", "B01003_001E", "state", "county"],
  ["Franklin County, Alabama", "31362", "01", "059"],
  ["Franklin County, Arkansas", "17097", "05", "047"],
  ["Franklin County, Idaho", "14194", "16", "041"],
  ["Franklin County, Illinois", "37804", "17", "055"],
  ["Franklin County, Ohio", "1323807", "39", "049"],
  ["Franklin County, Pennsylvania", "155932", "42", "055"],
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

  /**
   * The reported defect. ~25 US counties are named "Franklin"; they all match
   * "Franklin County" equally well, so the ranking was decided entirely by an
   * alphabetical tiebreak and then cut at 8. Ohio's — the largest by an order of
   * magnitude — fell off the end, and no amount of downstream re-ranking could
   * recover a row that had already been discarded.
   */
  it("ranks same-named counties by population, largest first", async () => {
    fetchJsonWithRetryMock.mockResolvedValue(FRANKLIN_COLLISION_RESPONSE);

    const outcome = await searchUsCounties("Franklin County");

    expect(outcome.items[0].geographyId).toBe("39049");
    expect(outcome.items[1].geographyId).toBe("42055");
  });

  it("still surfaces the largest match when the caller asks for fewer results than there are matches", async () => {
    fetchJsonWithRetryMock.mockResolvedValue(FRANKLIN_COLLISION_RESPONSE);

    const outcome = await searchUsCounties("Franklin County", 2);

    // Alphabetically this would have been Alabama and Arkansas.
    expect(outcome.items.map((item) => item.geographyId)).toEqual(["39049", "42055"]);
  });

  it("narrows to one state when the query names one, by abbreviation or by name", async () => {
    fetchJsonWithRetryMock.mockResolvedValue(FRANKLIN_COLLISION_RESPONSE);

    const abbreviated = await searchUsCounties("Franklin County, ID");
    expect(abbreviated.items.map((item) => item.geographyId)).toEqual(["16041"]);

    const spelledOut = await searchUsCounties("Franklin County, Idaho");
    expect(spelledOut.items.map((item) => item.geographyId)).toEqual(["16041"]);
  });

  /**
   * Population ranks ties; it must never be load-bearing. A deployment pointed
   * at a vintage without the column has to keep working.
   */
  it("still searches when the catalog carries no population column", async () => {
    fetchJsonWithRetryMock.mockResolvedValue([
      ["NAME", "state", "county"],
      ["Franklin County, Ohio", "39", "049"],
      ["Franklin County, Idaho", "16", "041"],
    ]);

    const outcome = await searchUsCounties("Franklin County");

    expect(outcome.availability).toBe("ok");
    // Falls back to the previous alphabetical ordering rather than failing.
    expect(outcome.items.map((item) => item.geographyId)).toEqual(["16041", "39049"]);
  });

  it("treats a suppressed or null population estimate as unknown, not as zero", async () => {
    fetchJsonWithRetryMock.mockResolvedValue([
      ["NAME", "B01003_001E", "state", "county"],
      ["Franklin County, Alabama", null, "01", "059"],
      ["Franklin County, Idaho", "-666666666", "16", "041"],
      ["Franklin County, Ohio", "1323807", "39", "049"],
    ]);

    const outcome = await searchUsCounties("Franklin County");

    expect(outcome.items[0].geographyId).toBe("39049");
    expect(outcome.items[0].population).toBe(1323807);
    // Unknown sorts after known, then alphabetically — deterministically.
    expect(outcome.items.slice(1).map((item) => item.population)).toEqual([null, null]);
  });
});
