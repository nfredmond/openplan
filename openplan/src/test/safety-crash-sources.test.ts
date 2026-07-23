import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CCRS_EARLIEST_YEAR,
  CCRS_SOURCE_ID,
  ccrsAdapter,
  collisionYearFromDate,
  deriveCcrsSeverity,
  deriveInvolvement,
  fetchCcrsCrashes,
  fetchCcrsResourceIds,
  overlapsCalifornia,
  toCollisionDate,
} from "@/lib/safety/sources/ccrs";
import {
  CRASH_SOURCE_ADAPTERS,
  OBSERVED_CRASH_SOURCE_IDS,
  getCrashSourceById,
  resolveCrashSource,
} from "@/lib/safety/sources/registry";
import { __clearFetchJsonResponseCacheForTests } from "@/lib/data-sources/http";

const NEVADA_COUNTY_BBOX = { minLon: -121.3, minLat: 39.1, maxLon: -120.0, maxLat: 39.6 };
const DETROIT_BBOX = { minLon: -83.2, minLat: 42.2, maxLon: -83.0, maxLat: 42.4 };

describe("CCRS severity derivation", () => {
  it("treats any fatality as a fatal crash", () => {
    expect(deriveCcrsSeverity(1, 0)).toBe("fatal");
    expect(deriveCcrsSeverity(2, 5)).toBe("fatal");
  });

  it("treats injuries without fatalities as an injury crash", () => {
    expect(deriveCcrsSeverity(0, 1)).toBe("injury");
  });

  it("treats crashes with neither as property-damage-only", () => {
    expect(deriveCcrsSeverity(0, 0)).toBe("pdo");
  });

  it("never returns severe_injury, because CCRS Crashes_* cannot separate KABCO A", () => {
    // Guards the honesty boundary: if a later slice adds the
    // ExtentOfInjuryCode join it must upgrade rows explicitly, not by
    // quietly changing this function.
    const buckets = new Set(
      [
        [0, 0],
        [0, 1],
        [0, 99],
        [1, 0],
        [3, 12],
      ].map(([killed, injured]) => deriveCcrsSeverity(killed, injured))
    );
    expect(buckets.has("severe_injury")).toBe(false);
  });

  it("advertises fatal_injury_only completeness so the UI cannot imply a KSI total", () => {
    expect(ccrsAdapter.severityCompleteness).toBe("fatal_injury_only");
  });
});

describe("CCRS involvement derivation", () => {
  it("detects pedestrian and bicycle involvement from MotorVehicleInvolvedWithDesc", () => {
    expect(deriveInvolvement("PEDESTRIAN")).toEqual({
      pedestrianInvolved: true,
      bicyclistInvolved: false,
    });
    expect(deriveInvolvement("BICYCLE")).toEqual({
      pedestrianInvolved: false,
      bicyclistInvolved: true,
    });
  });

  it("reports neither for vehicle-only and missing descriptors", () => {
    for (const value of ["OTHER MOTOR VEHICLE", "FIXED OBJECT", null, undefined, 7]) {
      expect(deriveInvolvement(value)).toEqual({
        pedestrianInvolved: false,
        bicyclistInvolved: false,
      });
    }
  });
});

describe("CCRS date parsing", () => {
  it("keeps the calendar date from a CCRS timestamp", () => {
    expect(toCollisionDate("2025-01-14T07:50:00")).toBe("2025-01-14");
    expect(collisionYearFromDate("2025-01-14")).toBe(2025);
  });

  it("returns null for unusable values rather than guessing", () => {
    for (const value of ["", "not-a-date", null, undefined, 20250114]) {
      expect(toCollisionDate(value)).toBeNull();
    }
    expect(collisionYearFromDate(null)).toBeNull();
  });
});

describe("California coverage test", () => {
  it("covers a California study area", () => {
    expect(overlapsCalifornia(NEVADA_COUNTY_BBOX)).toBe(true);
  });

  it("uses OVERLAP, not containment, so border study areas keep their CA crashes", () => {
    // The legacy SWITRS reader used containment and silently dropped
    // Truckee/Tahoe-style corridors that cross into Nevada.
    const straddlesCaNv = { minLon: -120.2, minLat: 39.2, maxLon: -119.6, maxLat: 39.5 };
    expect(overlapsCalifornia(straddlesCaNv)).toBe(true);
  });

  it("rejects a clearly out-of-state study area", () => {
    expect(overlapsCalifornia(DETROIT_BBOX)).toBe(false);
  });
});

describe("crash source registry", () => {
  it("resolves CCRS for a California study area", () => {
    const resolution = resolveCrashSource(NEVADA_COUNTY_BBOX);
    expect(resolution.kind).toBe("resolved");
    if (resolution.kind === "resolved") {
      expect(resolution.adapter.id).toBe(CCRS_SOURCE_ID);
    }
  });

  it("returns an explicit out_of_coverage result instead of falling back to an estimate", () => {
    const resolution = resolveCrashSource(DETROIT_BBOX);
    expect(resolution.kind).toBe("out_of_coverage");
    if (resolution.kind === "out_of_coverage") {
      expect(resolution.checked.map((c) => c.id)).toContain(CCRS_SOURCE_ID);
    }
  });

  it("only registers observed sources — no estimate tier is reachable", () => {
    for (const adapter of CRASH_SOURCE_ADAPTERS) {
      expect(OBSERVED_CRASH_SOURCE_IDS).toContain(adapter.id);
      expect(adapter.id).not.toMatch(/estimate/i);
      expect(adapter.coverageState).not.toBe("out_of_coverage");
    }
  });

  it("requires every registered adapter to carry attribution and a license", () => {
    for (const adapter of CRASH_SOURCE_ADAPTERS) {
      expect(adapter.attribution.length).toBeGreaterThan(0);
      expect(adapter.license.length).toBeGreaterThan(0);
    }
  });

  it("looks adapters up by id", () => {
    expect(getCrashSourceById(CCRS_SOURCE_ID)?.id).toBe(CCRS_SOURCE_ID);
    expect(getCrashSourceById("nope")).toBeNull();
  });
});

describe("CCRS fetch", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    __clearFetchJsonResponseCacheForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
    __clearFetchJsonResponseCacheForTests();
  });

  function jsonResponse(body: unknown) {
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  }

  const PACKAGE_BODY = {
    result: {
      resources: [
        { id: "res-2025", name: "Crashes_2025" },
        { id: "res-2024", name: "Crashes_2024" },
        { id: "ivp-2025", name: "InjuredWitnessPassengers_2025" },
      ],
    },
  };

  it("resolves per-year resource ids from the live package manifest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(PACKAGE_BODY)) as unknown as typeof fetch
    );

    const ids = await fetchCcrsResourceIds();
    expect(ids.get(2025)).toBe("res-2025");
    expect(ids.get(2024)).toBe("res-2024");
    // Only Crashes_* resources are crash tables.
    expect(ids.size).toBe(2);
  });

  it("maps CCRS rows into crash records, coercing the TEXT NumberKilled column", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("package_show")) return jsonResponse(PACKAGE_BODY);
      if (url.includes("count(*)")) return jsonResponse({ result: { records: [{ n: "1" }] } });
      return jsonResponse({
        result: {
          records: [
            {
              "Collision Id": 4540442,
              "Crash Date Time": "2025-01-12T16:00:00",
              Latitude: "39.215961",
              Longitude: "-121.061591",
              // TEXT in the DataStore — must not become NaN.
              NumberKilled: "1",
              NumberInjured: 2,
              MotorVehicleInvolvedWithDesc: "PEDESTRIAN",
            },
          ],
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await fetchCcrsCrashes({ bbox: NEVADA_COUNTY_BBOX, years: [2025] });

    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      externalId: "4540442",
      collisionDate: "2025-01-12",
      collisionYear: 2025,
      severity: "fatal",
      killedCount: 1,
      injuredCount: 2,
      pedestrianInvolved: true,
      bicyclistInvolved: false,
      latitude: 39.215961,
      longitude: -121.061591,
    });
    expect(result.yearsCovered).toEqual([2025]);
  });

  it("drops rows without usable coordinates rather than storing them half-formed", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("package_show")) return jsonResponse(PACKAGE_BODY);
      if (url.includes("count(*)")) return jsonResponse({ result: { records: [{ n: "2" }] } });
      return jsonResponse({
        result: {
          records: [
            {
              "Collision Id": 1,
              "Crash Date Time": "2025-03-01T00:00:00",
              Latitude: null,
              Longitude: null,
              NumberKilled: "0",
              NumberInjured: 0,
            },
            {
              "Collision Id": 2,
              "Crash Date Time": "2025-03-02T00:00:00",
              Latitude: "39.3",
              Longitude: "-121.0",
              NumberKilled: "0",
              NumberInjured: 1,
            },
          ],
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await fetchCcrsCrashes({ bbox: NEVADA_COUNTY_BBOX, years: [2025] });
    expect(result.records.map((r) => r.externalId)).toEqual(["2"]);
  });

  it("keeps matchedTotal equal to geocodedTotal without a county filter, since an ungeocoded crash cannot be placed in a bbox", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("package_show")) return jsonResponse(PACKAGE_BODY);
      if (url.includes("count(*)")) return jsonResponse({ result: { records: [{ n: "5" }] } });
      return jsonResponse({ result: { records: [] } });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await fetchCcrsCrashes({ bbox: NEVADA_COUNTY_BBOX, years: [2025] });
    expect(result.matchedTotal).toBe(5);
    expect(result.geocodedTotal).toBe(5);
  });

  it("reports matchedTotal above geocodedTotal on the lossless county path", async () => {
    // The county filter is what makes the ungeocoded share visible: the
    // coordinate-free count is larger than the mappable count.
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("package_show")) return jsonResponse(PACKAGE_BODY);
      if (url.includes("count(*)")) {
        const geocoded = url.includes("Latitude");
        return jsonResponse({ result: { records: [{ n: geocoded ? "78" : "100" }] } });
      }
      return jsonResponse({ result: { records: [] } });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await fetchCcrsCrashes({
      bbox: NEVADA_COUNTY_BBOX,
      years: [2025],
      countyCode: 29,
    });
    expect(result.geocodedTotal).toBe(78);
    expect(result.matchedTotal).toBe(100);
  });

  it("clamps requested years to those CCRS actually holds", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("package_show")) return jsonResponse(PACKAGE_BODY);
      if (url.includes("count(*)")) return jsonResponse({ result: { records: [{ n: "0" }] } });
      return jsonResponse({ result: { records: [] } });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    // 1999 predates CCRS entirely; 2023 has no resource in this manifest.
    await fetchCcrsCrashes({ bbox: NEVADA_COUNTY_BBOX, years: [1999, 2023, 2024, 2025] });

    const queried = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(queried.some((u) => u.includes("res-2025"))).toBe(true);
    expect(queried.some((u) => u.includes("res-2024"))).toBe(true);
    expect(queried.some((u) => u.includes("1999"))).toBe(false);
    expect(CCRS_EARLIEST_YEAR).toBe(2016);
  });

  it("marks the result truncated when the caller's cap stops paging", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("package_show")) return jsonResponse(PACKAGE_BODY);
      if (url.includes("count(*)")) return jsonResponse({ result: { records: [{ n: "9999" }] } });
      return jsonResponse({
        result: {
          records: [
            {
              "Collision Id": 11,
              "Crash Date Time": "2025-02-02T00:00:00",
              Latitude: "39.3",
              Longitude: "-121.0",
              NumberKilled: "0",
              NumberInjured: 0,
            },
          ],
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await fetchCcrsCrashes({
      bbox: NEVADA_COUNTY_BBOX,
      years: [2025],
      maxRecords: 1,
    });
    expect(result.records).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });

  it("always excludes retracted (IsDeleted) reports", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("package_show")) return jsonResponse(PACKAGE_BODY);
      if (url.includes("count(*)")) return jsonResponse({ result: { records: [{ n: "0" }] } });
      return jsonResponse({ result: { records: [] } });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    await fetchCcrsCrashes({ bbox: NEVADA_COUNTY_BBOX, years: [2025] });

    const dataQueries = fetchMock.mock.calls
      .map((call) => decodeURIComponent(String(call[0])))
      .filter((u) => u.includes("datastore_search_sql"));
    expect(dataQueries.length).toBeGreaterThan(0);
    for (const query of dataQueries) {
      expect(query).toContain(`"IsDeleted" = 'False'`);
    }
  });
});
