import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CCRS_SERIOUS_INJURY_CODES,
  chunk,
  fetchSeriousInjuryCollisionIds,
} from "@/lib/safety/sources/ccrs-injury";
import { applySeriousInjuryUpgrade } from "@/lib/safety/ingest";
import { __clearFetchJsonResponseCacheForTests } from "@/lib/data-sources/http";
import type { CrashRecord } from "@/lib/safety/sources/types";

function record(over: Partial<CrashRecord> = {}): CrashRecord {
  return {
    externalId: "c1",
    collisionDate: "2025-01-12",
    collisionYear: 2025,
    severity: "injury",
    killedCount: 0,
    injuredCount: 1,
    pedestrianInvolved: false,
    bicyclistInvolved: false,
    latitude: 39.2,
    longitude: -121.0,
    ...over,
  };
}

const PACKAGE_BODY = {
  result: {
    resources: [
      { id: "ivp-2025", name: "InjuredWitnessPassengers_2025" },
      { id: "res-2025", name: "Crashes_2025" },
    ],
  },
};

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("chunk", () => {
  it("splits ids into bounded batches", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 10)).toEqual([]);
  });
});

describe("serious-injury codes", () => {
  it("treats both the current and retired KABCO A spellings as serious", () => {
    // Dropping the retired code would silently undercount older years.
    expect(CCRS_SERIOUS_INJURY_CODES).toContain("SuspectSerious");
    expect(CCRS_SERIOUS_INJURY_CODES).toContain("SevereInactive");
  });

  it("does not treat minor or possible injury as serious", () => {
    for (const code of ["SuspectMinor", "PossibleInjury", "ComplaintOfPainInactive", "OtherVisibleInactive"]) {
      expect(CCRS_SERIOUS_INJURY_CODES as readonly string[]).not.toContain(code);
    }
  });
});

describe("fetchSeriousInjuryCollisionIds", () => {
  beforeEach(() => __clearFetchJsonResponseCacheForTests());
  afterEach(() => {
    vi.unstubAllGlobals();
    __clearFetchJsonResponseCacheForTests();
  });

  it("returns the collision ids with a suspected serious injury", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("package_show")) return jsonResponse(PACKAGE_BODY);
      return jsonResponse({ result: { records: [{ CollisionId: "c2" }, { CollisionId: 4546547 }] } });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const serious = await fetchSeriousInjuryCollisionIds({
      year: 2025,
      collisionIds: ["c1", "c2", "4546547"],
    });

    expect(serious.has("c2")).toBe(true);
    // Numeric ids from the API are normalized to strings for set membership.
    expect(serious.has("4546547")).toBe(true);
    expect(serious.has("c1")).toBe(false);
  });

  it("queries only the KABCO A codes", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("package_show")) return jsonResponse(PACKAGE_BODY);
      return jsonResponse({ result: { records: [] } });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    await fetchSeriousInjuryCollisionIds({ year: 2025, collisionIds: ["c1"] });

    const sqlCalls = fetchMock.mock.calls
      .map((call) => decodeURIComponent(String(call[0])))
      .filter((url) => url.includes("datastore_search_sql"));
    expect(sqlCalls.length).toBeGreaterThan(0);
    expect(sqlCalls[0]).toContain("'SuspectSerious','SevereInactive'");
    expect(sqlCalls[0]).not.toContain("SuspectMinor");
  });

  it("returns nothing for a year with no injured-person table, rather than guessing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(PACKAGE_BODY)) as unknown as typeof fetch
    );
    const serious = await fetchSeriousInjuryCollisionIds({ year: 1999, collisionIds: ["c1"] });
    expect(serious.size).toBe(0);
  });

  it("short-circuits on an empty id list without calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const serious = await fetchSeriousInjuryCollisionIds({ year: 2025, collisionIds: [] });
    expect(serious.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("applySeriousInjuryUpgrade", () => {
  beforeEach(() => __clearFetchJsonResponseCacheForTests());
  afterEach(() => {
    vi.unstubAllGlobals();
    __clearFetchJsonResponseCacheForTests();
  });

  function stubSerious(ids: string[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes("package_show")) return jsonResponse(PACKAGE_BODY);
        return jsonResponse({ result: { records: ids.map((id) => ({ CollisionId: id })) } });
      }) as unknown as typeof fetch
    );
  }

  it("upgrades only the injury crashes that had a serious injury", async () => {
    stubSerious(["c2"]);

    const result = await applySeriousInjuryUpgrade([
      record({ externalId: "c1" }),
      record({ externalId: "c2" }),
    ]);

    expect(result.upgraded).toBe(1);
    expect(result.records.find((r) => r.externalId === "c2")?.severity).toBe("severe_injury");
    expect(result.records.find((r) => r.externalId === "c1")?.severity).toBe("injury");
  });

  it("never downgrades a fatal crash or promotes a PDO crash", async () => {
    // A fatal crash already outranks serious injury; a PDO crash injured nobody.
    stubSerious(["fatal-1", "pdo-1"]);

    const result = await applySeriousInjuryUpgrade([
      record({ externalId: "fatal-1", severity: "fatal", killedCount: 1 }),
      record({ externalId: "pdo-1", severity: "pdo", injuredCount: 0 }),
    ]);

    expect(result.upgraded).toBe(0);
    expect(result.records[0].severity).toBe("fatal");
    expect(result.records[1].severity).toBe("pdo");
  });

  it("skips records with no collision year rather than querying the wrong table", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await applySeriousInjuryUpgrade([
      record({ externalId: "c1", collisionYear: null }),
    ]);

    expect(result.upgraded).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
