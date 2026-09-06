import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchCrashesForBbox } from "@/lib/data-sources/crashes";
import { __clearFetchJsonResponseCacheForTests } from "@/lib/data-sources/http";
import { farsArchiveResponse } from "@/test/support/fars-archive";

// Reno, NV: lon ~-119.8 sits INSIDE the coarse California rectangle
// (-124.6..-114) but is entirely out of state — the exact shape that used to
// resolve to CCRS alone and read as "0 crashes, safe".
const RENO_BBOX = { minLon: -119.9, minLat: 39.4, maxLon: -119.7, maxLat: 39.6 };
// A border study area straddling the CA/NV line near Lake Tahoe.
const TAHOE_BORDER_BBOX = { minLon: -120.1, minLat: 39.0, maxLon: -119.9, maxLat: 39.2 };

const NOW = new Date("2026-07-23T00:00:00Z");

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const CCRS_PACKAGE_BODY = {
  result: { resources: [{ id: "res-2025", name: "Crashes_2025" }] },
};

function farsRecord(stCase: number, stateFips: number, lat: number, lon: number) {
  return {
    ST_CASE: stCase,
    STATE: stateFips,
    YEAR: 2024,
    LATITUDE: lat,
    LONGITUD: lon,
    FATALS: 1,
    PEDS: 0,
  };
}

/**
 * Route the stubbed fetch. `ccrsRecords` is what CCRS returns for its year query;
 * `farsRecords` is what the 2024 FARS annual file returns (empty for other years).
 */
function stubFetch(opts: {
  ccrsRecords: Array<Record<string, unknown>>;
  ccrsCount: number;
  farsRecords: Array<Record<string, unknown>>;
  ccrsFails?: boolean;
  farsFails?: boolean;
}) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("static.nhtsa.gov")) {
      if (opts.farsFails) return new Response("", { status: 403 });
      return farsArchiveResponse(url.includes("FARS2024NationalCSV.zip") ? opts.farsRecords : []);
    }
    if (opts.ccrsFails) return jsonResponse({ nope: true }); // unrecognized → CCRS throws
    if (url.includes("package_show")) return jsonResponse(CCRS_PACKAGE_BODY);
    if (url.includes("count(*)")) return jsonResponse({ result: { records: [{ n: String(opts.ccrsCount) }] } });
    if (url.includes("res-2025")) return jsonResponse({ result: { records: opts.ccrsRecords } });
    return jsonResponse({ result: { records: [] } });
  });
  vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
  return fetchMock;
}

describe("fetchCrashesForBbox — multi-source merge", () => {
  beforeEach(() => __clearFetchJsonResponseCacheForTests());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    __clearFetchJsonResponseCacheForTests();
  });

  it("no longer reads an out-of-CA area as safe: FARS fatals fill in where CCRS has none", async () => {
    stubFetch({
      ccrsRecords: [],
      ccrsCount: 0,
      farsRecords: [farsRecord(101, 32, 39.5, -119.8), farsRecord(102, 32, 39.52, -119.82)],
    });

    const result = await fetchCrashesForBbox(RENO_BBOX, { now: NOW });

    expect(result.observed).toBe(true);
    // The bug: this used to be 0 (CCRS-only) and read as a safe corridor.
    expect(result.totalFatalCrashes).toBe(2);
    expect(result.totalFatalities).toBe(2);
    expect(result.contributingSources?.map((s) => s.id)).toEqual(["ccrs-ca", "fars-national"]);
    expect(result.sourceSnapshot.publishedThrough).toBeUndefined();
    expect(result.sourceSnapshot.contributingSources).toMatchObject([
      { id: "ccrs-ca", resourceUpdates: { basis: "resource_updates", resources: [{ resourceId: "res-2025", year: 2025, lastModified: null }] } },
      { id: "fars-national", publishedCutoff: { publishedThrough: "2024-12-31" } },
    ]);
    // Fatal-basis density and an explicit merge disclosure.
    expect(result.crashDensityBasis).toBe("fatal_only");
    expect(result.narrativeLine).toMatch(/Fatal crashes cover the full study area/i);
    // Each merged FARS point keeps its OWN provenance — not the primary's id.
    expect(result.points.length).toBe(2);
    expect(result.points.every((p) => p.properties.source === "fars-national")).toBe(true);
  });

  it("does not double-count: a FARS fatal already in CCRS's California is dropped", async () => {
    stubFetch({
      // CCRS reports one CA fatal in the study area.
      ccrsRecords: [
        {
          "Collision Id": 1,
          "Crash Date Time": "2025-04-01T08:00:00",
          Latitude: "39.05",
          Longitude: "-120.05",
          NumberKilled: "1",
          NumberInjured: "0",
        },
      ],
      ccrsCount: 1,
      // FARS returns the SAME CA fatal (state 06) plus a NV one (state 32).
      farsRecords: [farsRecord(201, 6, 39.05, -120.05), farsRecord(202, 32, 39.05, -119.95)],
    });

    const result = await fetchCrashesForBbox(TAHOE_BORDER_BBOX, { now: NOW });

    // CCRS CA fatal (1) + FARS NV fatal (1) = 2. The FARS CA fatal is deduped out,
    // NOT added to the CCRS one.
    expect(result.totalFatalCrashes).toBe(2);
    expect(result.contributingSources?.map((s) => s.id)).toEqual(["ccrs-ca", "fars-national"]);
  });

  it("stays single-source (no merge) when FARS adds only records CCRS already covers", async () => {
    stubFetch({
      ccrsRecords: [
        {
          "Collision Id": 1,
          "Crash Date Time": "2025-04-01T08:00:00",
          Latitude: "39.05",
          Longitude: "-120.05",
          NumberKilled: "0",
          NumberInjured: "2",
        },
      ],
      ccrsCount: 1,
      // Only a California FARS fatal — fully redundant with CCRS → dropped.
      farsRecords: [farsRecord(301, 6, 39.05, -120.05)],
    });

    const result = await fetchCrashesForBbox(TAHOE_BORDER_BBOX, { now: NOW });

    expect(result.source).toBe("ccrs-ca");
    expect(result.contributingSources).toBeUndefined();
    // CCRS's injury coverage is preserved for a wholly-in-CA study area.
    expect(result.totalInjuryCrashes).toBe(1);
  });

  it("discloses when the FARS backstop is unreachable so an out-of-CA area isn't read as safe", async () => {
    // CCRS answers (0 CA crashes for Reno) but FARS — which holds the NV fatals —
    // is down. The result must NOT quietly read as a safe 0.
    stubFetch({ ccrsRecords: [], ccrsCount: 0, farsRecords: [], farsFails: true });

    const result = await fetchCrashesForBbox(RENO_BBOX, { now: NOW });

    expect(result.observed).toBe(true);
    expect(result.source).toBe("ccrs-ca");
    expect(result.unavailableBackstops?.map((s) => s.id)).toEqual(["fars-national"]);
    expect(result.narrativeLine).toMatch(/could not be reached this run/i);
    expect(result.narrativeLine).toMatch(/treat a low count with caution/i);
  });

  it("promotes FARS to primary when CCRS is down for a CA-overlapping area", async () => {
    stubFetch({
      ccrsRecords: [],
      ccrsCount: 0,
      ccrsFails: true,
      farsRecords: [farsRecord(401, 32, 39.5, -119.8)],
    });

    const result = await fetchCrashesForBbox(RENO_BBOX, { now: NOW });

    // CCRS unreachable, but FARS still gives real fatal coverage — not "unavailable".
    expect(result.observed).toBe(true);
    expect(result.source).toBe("fars-national");
    expect(result.totalFatalCrashes).toBe(1);
    expect(result.contributingSources).toBeUndefined();
  });
});
