import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCrashSourceSnapshot,
  describeCrashSafety,
  fetchCrashesForBbox,
  recentCrashYears,
} from "@/lib/data-sources/crashes";
import { resolveEstimatedDomains } from "@/lib/analysis/estimated-source";
import { buildSourceTransparency } from "@/lib/analysis/source-transparency";
import { __clearFetchJsonResponseCacheForTests } from "@/lib/data-sources/http";

const NEVADA_COUNTY_BBOX = { minLon: -121.3, minLat: 39.1, maxLon: -120.0, maxLat: 39.6 };
const DETROIT_BBOX = { minLon: -83.2, minLat: 42.2, maxLon: -83.0, maxLat: 42.4 };
const BERLIN_BBOX = { minLon: 13.2, minLat: 52.4, maxLon: 13.6, maxLat: 52.6 };

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

function errorResponse(status: number) {
  return {
    ok: false,
    status,
    headers: new Headers(),
    json: async () => ({}),
    text: async () => "",
  } as unknown as Response;
}

const CCRS_PACKAGE_BODY = {
  result: {
    resources: [
      { id: "res-2025", name: "Crashes_2025" },
      { id: "res-2024", name: "Crashes_2024" },
    ],
  },
};

describe("recentCrashYears", () => {
  it("derives a rolling window instead of pinning a vintage", () => {
    // The retired implementation hardcoded 2022/2021/2020, which quietly became
    // "no crashes found" as the calendar moved on.
    expect(recentCrashYears(new Date("2026-07-23T00:00:00Z"))).toEqual([2025, 2024, 2023, 2022]);
    expect(recentCrashYears(new Date("2031-01-01T00:00:00Z"))).toEqual([2030, 2029, 2028, 2027]);
  });
});

describe("fetchCrashesForBbox — the single crash lane", () => {
  beforeEach(() => {
    __clearFetchJsonResponseCacheForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    __clearFetchJsonResponseCacheForTests();
  });

  it("reports out-of-coverage without contacting anything or inventing a figure", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await fetchCrashesForBbox(BERLIN_BBOX, { now: NOW });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.observed).toBe(false);
    expect(result.source).toBe("out-of-coverage");
    expect(result.checkedSources).toEqual(expect.arrayContaining(["ccrs-ca", "fars-national"]));
    expect(result.points).toEqual([]);
    // The retired fars-estimate tier produced fatalities from bbox area alone.
    expect(result.totalFatalities).toBe(0);
    expect(result.severeInjuryCrashes).toBeNull();
    expect(result.totalInjuryCrashes).toBeNull();
  });

  it("summarizes observed CCRS records for a California study area", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("package_show")) return jsonResponse(CCRS_PACKAGE_BODY);
      if (url.includes("count(*)")) return jsonResponse({ result: { records: [{ n: "3" }] } });
      if (url.includes("res-2025")) {
        return jsonResponse({
          result: {
            records: [
              {
                "Collision Id": 1,
                "Crash Date Time": "2025-04-01T08:00:00",
                Latitude: "39.2",
                Longitude: "-121.0",
                NumberKilled: "1",
                NumberInjured: 0,
                MotorVehicleInvolvedWithDesc: "PEDESTRIAN",
              },
              {
                "Collision Id": 2,
                "Crash Date Time": "2025-04-02T08:00:00",
                Latitude: "39.25",
                Longitude: "-121.05",
                NumberKilled: "0",
                NumberInjured: 2,
                MotorVehicleInvolvedWithDesc: "BICYCLE",
              },
              {
                "Collision Id": 3,
                "Crash Date Time": "2025-04-03T08:00:00",
                Latitude: "39.26",
                Longitude: "-121.06",
                NumberKilled: "0",
                NumberInjured: 0,
              },
            ],
          },
        });
      }
      return jsonResponse({ result: { records: [] } });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await fetchCrashesForBbox(NEVADA_COUNTY_BBOX, { now: NOW });

    expect(result.observed).toBe(true);
    expect(result.source).toBe("ccrs-ca");
    expect(result.totalFatalCrashes).toBe(1);
    expect(result.totalFatalities).toBe(1);
    expect(result.pedestrianFatalities).toBe(1);
    expect(result.totalInjuryCrashes).toBe(1);
    // CCRS Crashes_* cannot separate KABCO A, so this must be "unknown", not 0.
    expect(result.severeInjuryCrashes).toBeNull();
    expect(result.crashDensityBasis).toBe("injury_and_fatal");
    // The property-damage-only crash is counted but not plotted.
    expect(result.points.map((point) => point.properties.severityBucket)).toEqual([
      "fatal",
      "injury",
    ]);
    expect(result.points[0]?.properties.source).toBe("ccrs-ca");
  });

  it("reports an unreachable source as unavailable rather than as zero crashes", async () => {
    // The distinction this test protects: a 403/500 from data.ca.gov used to be
    // indistinguishable from "this corridor had no crashes", which reads as a
    // safe corridor and inflates the safety score.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errorResponse(403)) as unknown as typeof fetch
    );

    const result = await fetchCrashesForBbox(NEVADA_COUNTY_BBOX, { now: NOW });

    expect(result.observed).toBe(false);
    expect(result.source).toBe("source-unavailable");
    expect(result.unavailableReason).toBeTruthy();
    expect(result.totalFatalCrashes).toBe(0);
    expect(result.crashesPerSquareMile).toBe(0);
  });

  it("falls through to FARS for a US study area outside any state adapter", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (!url.includes("fromCaseYear=2023")) return jsonResponse({ Results: [] });
      return jsonResponse({
        Results: [
          [
            {
              ST_CASE: 261234,
              CaseYear: 2023,
              CRASH_DT: "2023-06-04T00:00:00",
              LATITUDE: 42.331,
              LONGITUD: -83.045,
              FATALS: 2,
              PEDS: 1,
              BICYCLISTS: 0,
            },
            {
              // Unknown-coordinate sentinels: must never be plotted.
              ST_CASE: 261235,
              CaseYear: 2023,
              LATITUDE: 77.7777,
              LONGITUD: 777.7777,
              FATALS: 1,
            },
          ],
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await fetchCrashesForBbox(DETROIT_BBOX, { now: NOW });

    expect(result.observed).toBe(true);
    expect(result.source).toBe("fars-national");
    expect(result.totalFatalCrashes).toBe(1);
    expect(result.totalFatalities).toBe(2);
    expect(result.pedestrianFatalities).toBe(1);
    // Fatal-only census: injury counts are unavailable, not zero.
    expect(result.totalInjuryCrashes).toBeNull();
    expect(result.crashDensityBasis).toBe("fatal_only");
    expect(result.reportedTotal).toBe(2);
    expect(result.mappedTotal).toBe(1);
    expect(result.points).toHaveLength(1);
    expect(result.points[0]?.properties.severityBucket).toBe("fatal");
  });

  it("reports FARS unavailable when every requested year fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errorResponse(403)) as unknown as typeof fetch
    );

    const result = await fetchCrashesForBbox(DETROIT_BBOX, { now: NOW });

    expect(result.observed).toBe(false);
    expect(result.source).toBe("source-unavailable");
    expect(result.sourceLabel).toContain("FARS");
  });
});

describe("crash disclosure reaches the existing Explore seam", () => {
  const unobserved = {
    observed: false as const,
    source: "out-of-coverage" as const,
    sourceLabel: "No covering crash source",
    attribution: null,
    severityCompleteness: null,
    totalFatalCrashes: 0,
    totalFatalities: 0,
    pedestrianFatalities: 0,
    bicyclistFatalities: 0,
    severeInjuryCrashes: null,
    totalInjuryCrashes: null,
    yearsQueried: [],
    crashesPerSquareMile: 0,
    crashDensityBasis: "none" as const,
    reportedTotal: 0,
    mappedTotal: 0,
    truncated: false,
    points: [],
    checkedSources: ["ccrs-ca", "fars-national"],
    unavailableReason: null,
  };

  it("omits the snapshot source when nothing was observed, so nothing renders 'Live'", () => {
    const snapshot = buildCrashSourceSnapshot(unobserved, "2026-07-23T00:00:00.000Z");

    // A source token here would satisfy `crashProvenanceKnown` AND fail
    // `isEstimatedSource`, which is precisely how a run with no crash data ends
    // up advertised as live crash coverage.
    expect(snapshot.source).toBeUndefined();
    expect(snapshot.state).toBe("out-of-coverage");
    expect(String(snapshot.note)).toContain("No crash source covers this study area");
    expect(String(snapshot.note)).toContain("were not estimated");

    const metrics = {
      sourceSnapshots: { crashes: snapshot },
      dataQuality: { censusAvailable: true, crashDataAvailable: false },
    };

    expect(resolveEstimatedDomains(metrics).crashes).toBe(true);
    const crashItem = buildSourceTransparency(metrics).find((item) => item.key === "crashes");
    expect(crashItem?.status).not.toBe("Live");
  });

  it("carries the adapter id and its severity limits when a source did answer", () => {
    const snapshot = buildCrashSourceSnapshot(
      {
        ...unobserved,
        observed: true,
        source: "fars-national",
        sourceLabel: "NHTSA Fatality Analysis Reporting System (FARS)",
        severityCompleteness: "fatal_only",
        crashDensityBasis: "fatal_only",
        reportedTotal: 9,
        mappedTotal: 7,
        yearsQueried: [2023],
      },
      "2026-07-23T00:00:00.000Z"
    );

    expect(snapshot.source).toBe("fars-national");
    expect(String(snapshot.note)).toContain("Fatal crashes only");
    // Ungeocoded crashes stay visible instead of quietly shrinking the total.
    expect(String(snapshot.note)).toContain("9 crashes matched, 7 carried coordinates");

    const metrics = {
      sourceSnapshots: { crashes: snapshot },
      dataQuality: { censusAvailable: true, crashDataAvailable: true },
    };
    expect(resolveEstimatedDomains(metrics).crashes).toBe(false);
  });

  it("narrates an unobserved study area without stating a crash count", () => {
    const line = describeCrashSafety(unobserved);
    expect(line).toContain("not available");
    expect(line).not.toMatch(/\b0 fatal crashes\b/);
  });
});
