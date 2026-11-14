/**
 * The corridor scorecard picks its crash source by STATE, like a Safety
 * acquisition.
 *
 * Before 2026-11-02 the scorecard asked every adapter whose rectangle overlapped
 * the bbox and merged the answers. A Reno corridor lies inside the California
 * rectangle, so CCRS was the "primary" and the summary was labeled CCRS even
 * when FARS had no Nevada fatal crash to add. Now the state decides: Nevada gets
 * FARS alone, labeled fatal-only; California gets CCRS; an unconfirmed or
 * two-state corridor gets only the national source and says why.
 *
 * Blind category: these stub the network at `fetch`, so they check which
 * source is asked and how the summary is labeled, not the sources' real data.
 * The route that derives the state is covered in analysis-route-grounding.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchCrashesForStudyArea } from "@/lib/data-sources/crashes";
import { __clearFetchJsonResponseCacheForTests } from "@/lib/data-sources/http";
import { farsArchiveResponse } from "@/test/support/fars-archive";

// Reno, NV: lon ~-119.8 sits INSIDE the coarse California rectangle
// (-124.6..-114) but is entirely out of state.
const RENO_BBOX = { minLon: -119.9, minLat: 39.4, maxLon: -119.7, maxLat: 39.6 };
// A small area on the California side of Lake Tahoe.
const TAHOE_CA_BBOX = { minLon: -120.1, minLat: 39.0, maxLon: -120.0, maxLat: 39.2 };

const NOW = new Date("2026-07-23T00:00:00Z");
const CALIFORNIA = ["06"];
const NEVADA = ["32"];

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
  return { ST_CASE: stCase, STATE: stateFips, YEAR: 2024, LATITUDE: lat, LONGITUD: lon, FATALS: 1, PEDS: 0 };
}

/** Route the stubbed fetch and record which source hosts were contacted. */
function stubFetch(opts: {
  ccrsRecords?: Array<Record<string, unknown>>;
  farsRecords?: Array<Record<string, unknown>>;
  ccrsFails?: boolean;
}) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("static.nhtsa.gov")) {
      return farsArchiveResponse(url.includes("FARS2024NationalCSV.zip") ? (opts.farsRecords ?? []) : []);
    }
    if (opts.ccrsFails) return jsonResponse({ nope: true }); // unrecognized, so CCRS throws
    if (url.includes("package_show")) return jsonResponse(CCRS_PACKAGE_BODY);
    const records = opts.ccrsRecords ?? [];
    if (url.includes("count(*)")) return jsonResponse({ result: { records: [{ n: String(records.length) }] } });
    if (url.includes("res-2025")) return jsonResponse({ result: { records } });
    return jsonResponse({ result: { records: [] } });
  });
  vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
  const contacted = () => {
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    return {
      ccrs: urls.some((url) => url.includes("data.ca.gov")),
      fars: urls.some((url) => url.includes("static.nhtsa.gov")),
    };
  };
  return { fetchMock, contacted };
}

describe("fetchCrashesForStudyArea picks the corridor's source by state", () => {
  beforeEach(() => __clearFetchJsonResponseCacheForTests());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    __clearFetchJsonResponseCacheForTests();
  });

  it("labels a Nevada corridor FARS and fatal-only even when FARS has no fatal crash there", async () => {
    // The reported defect: no Nevada fatal crashes meant nothing to merge, so the
    // summary kept the CCRS label from a rectangle overlap.
    const { contacted } = stubFetch({ farsRecords: [] });

    const result = await fetchCrashesForStudyArea({ bbox: RENO_BBOX, stateFips: NEVADA }, { now: NOW });

    expect(result.observed).toBe(true);
    expect(result.source).toBe("fars-national");
    expect(result.severityCompleteness).toBe("fatal_only");
    expect(result.crashDensityBasis).toBe("fatal_only");
    expect(result.totalFatalCrashes).toBe(0);
    expect(result.narrativeLine).not.toMatch(/CCRS/);
    expect(contacted()).toEqual({ ccrs: false, fars: true });
  });

  it("counts a Nevada corridor's FARS fatal crashes, each point carrying FARS provenance", async () => {
    stubFetch({ farsRecords: [farsRecord(101, 32, 39.5, -119.8), farsRecord(102, 32, 39.52, -119.82)] });

    const result = await fetchCrashesForStudyArea({ bbox: RENO_BBOX, stateFips: NEVADA }, { now: NOW });

    expect(result.source).toBe("fars-national");
    expect(result.totalFatalCrashes).toBe(2);
    expect(result.points.map((point) => point.properties.source)).toEqual(["fars-national", "fars-national"]);
    expect(result.sourceSnapshot.studyAreaStates).toEqual(NEVADA);
  });

  it("reads CCRS alone for a California corridor and never adds national records", async () => {
    const { contacted } = stubFetch({
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
      farsRecords: [farsRecord(301, 32, 39.05, -119.95)],
    });

    const result = await fetchCrashesForStudyArea({ bbox: TAHOE_CA_BBOX, stateFips: CALIFORNIA }, { now: NOW });

    expect(result.source).toBe("ccrs-ca");
    expect(result.totalInjuryCrashes).toBe(1);
    expect(result.totalFatalCrashes).toBe(0);
    expect(result.unavailableSources).toBeUndefined();
    expect(contacted()).toEqual({ ccrs: true, fars: false });
  });

  it("falls back to FARS when CCRS is down for a California corridor, and names CCRS", async () => {
    const { contacted } = stubFetch({ ccrsFails: true, farsRecords: [farsRecord(401, 6, 39.05, -120.05)] });

    const result = await fetchCrashesForStudyArea({ bbox: TAHOE_CA_BBOX, stateFips: CALIFORNIA }, { now: NOW });

    expect(result.observed).toBe(true);
    expect(result.source).toBe("fars-national");
    expect(result.totalFatalCrashes).toBe(1);
    expect(result.unavailableSources?.map((source) => source.id)).toEqual(["ccrs-ca"]);
    expect(result.narrativeLine).toMatch(/could not be reached this run, so these figures come from/);
    expect(result.sourceSnapshot.unavailableSources).toEqual([expect.objectContaining({ id: "ccrs-ca" })]);
    expect(contacted()).toEqual({ ccrs: true, fars: true });
  });

  it("reads only FARS for a corridor that spans two states", async () => {
    const { contacted } = stubFetch({ farsRecords: [] });

    const result = await fetchCrashesForStudyArea(
      { bbox: { minLon: -120.1, minLat: 39.0, maxLon: -119.9, maxLat: 39.2 }, stateFips: [...CALIFORNIA, ...NEVADA] },
      { now: NOW }
    );

    expect(result.source).toBe("fars-national");
    expect(result.severityCompleteness).toBe("fatal_only");
    expect(contacted()).toEqual({ ccrs: false, fars: true });
  });

  it("reads only FARS for a corridor with no confirmed state, and says the state was not confirmed", async () => {
    const { contacted } = stubFetch({ farsRecords: [] });

    const result = await fetchCrashesForStudyArea({ bbox: RENO_BBOX, stateFips: null }, { now: NOW });

    expect(result.source).toBe("fars-national");
    expect(result.studyAreaStates).toBeNull();
    expect(result.narrativeLine).toMatch(/state was not confirmed from a picked place/);
    expect(String(result.sourceSnapshot.note)).toMatch(/state was not confirmed from a picked place/);
    expect(result.sourceSnapshot.studyAreaStates).toBeNull();
    expect(contacted()).toEqual({ ccrs: false, fars: true });
  });

  it("does not add the unconfirmed-state sentence when the state was confirmed", async () => {
    stubFetch({ farsRecords: [] });

    const result = await fetchCrashesForStudyArea({ bbox: RENO_BBOX, stateFips: NEVADA }, { now: NOW });

    expect(result.narrativeLine).not.toMatch(/not confirmed/);
    expect(String(result.sourceSnapshot.note)).not.toMatch(/not confirmed/);
  });
});
