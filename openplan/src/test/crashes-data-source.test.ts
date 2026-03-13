import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchCrashPointFeaturesForBbox, fetchCrashesForBbox } from "@/lib/data-sources/crashes";

describe("fetchCrashesForBbox", () => {
  const originalAbortSignalTimeout = AbortSignal.timeout;
  const originalSwitrsPath = process.env.SWITRS_CSV_PATH;

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    process.env.SWITRS_CSV_PATH = originalSwitrsPath;

    Object.defineProperty(AbortSignal, "timeout", {
      configurable: true,
      writable: true,
      value: originalAbortSignalTimeout,
    });
  });

  it("supports FARS responses with a top-level Results array of crash records", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        Results: [
          {
            FATALS: 2,
            PEDS: "1",
            BICYCLISTS: "0",
          },
        ],
      }),
    });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);
    delete process.env.SWITRS_CSV_PATH;

    const result = await fetchCrashesForBbox({
      minLon: -83.2,
      maxLon: -83.0,
      minLat: 42.2,
      maxLat: 42.4,
    });

    expect(result.source).toBe("fars-api");
    expect(result.totalFatalCrashes).toBe(3);
    expect(result.totalFatalities).toBe(6);
    expect(result.pedestrianFatalities).toBe(3);
    expect(result.bicyclistFatalities).toBe(0);
    expect(result.yearsQueried).toEqual([2022, 2021, 2020]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("falls back to estimate when FARS returns an unexpected payload shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        status: "ok",
      }),
    });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);
    delete process.env.SWITRS_CSV_PATH;

    const result = await fetchCrashesForBbox({
      minLon: -83.2,
      maxLon: -83.0,
      minLat: 42.2,
      maxLat: 42.4,
    });

    expect(result.source).toBe("fars-estimate");
    expect(result.yearsQueried).toEqual([2022, 2021, 2020]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("uses a manual timeout fallback when AbortSignal.timeout is unavailable", async () => {
    Object.defineProperty(AbortSignal, "timeout", {
      configurable: true,
      writable: true,
      value: undefined,
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        Results: [
          [
            {
              FATALS: "1",
              PEDS: "0",
              BICYCLISTS: "0",
            },
          ],
        ],
      }),
    });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);
    delete process.env.SWITRS_CSV_PATH;

    const result = await fetchCrashesForBbox({
      minLon: -83.2,
      maxLon: -83.0,
      minLat: 42.2,
      maxLat: 42.4,
    });

    expect(result.source).toBe("fars-api");
    expect(result.totalFatalCrashes).toBe(3);
    expect(result.totalFatalities).toBe(3);
    expect(result.yearsQueried).toEqual([2022, 2021, 2020]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("builds SWITRS crash summaries and point features from a local CSV", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "openplan-switrs-"));
    const csvPath = join(tempDir, "switrs.csv");

    await writeFile(
      csvPath,
      [
        "LATITUDE,LONGITUDE,COLLISION_YEAR,COLLISION_SEVERITY,COUNT_FATALITY,COUNT_INJURED,PEDESTRIAN_ACCIDENT,BICYCLE_ACCIDENT",
        "39.1000,-121.6000,2023,1,1,0,Y,N",
        "39.1100,-121.6100,2023,2,0,2,N,Y",
        "39.1200,-121.6200,2022,4,0,1,N,N",
        "38.0000,-120.0000,2023,1,1,0,Y,N",
      ].join("\n"),
      "utf8"
    );

    process.env.SWITRS_CSV_PATH = csvPath;

    try {
      const bbox = {
        minLon: -121.7,
        maxLon: -121.5,
        minLat: 39.05,
        maxLat: 39.2,
      };

      const summary = await fetchCrashesForBbox(bbox);
      const features = await fetchCrashPointFeaturesForBbox(bbox);

      expect(summary.source).toBe("switrs-local");
      expect(summary.totalFatalCrashes).toBe(1);
      expect(summary.totalFatalities).toBe(1);
      expect(summary.severeInjuryCrashes).toBe(1);
      expect(summary.totalInjuryCrashes).toBe(2);
      expect(summary.pedestrianFatalities).toBe(1);
      expect(summary.bicyclistFatalities).toBe(0);
      expect(summary.yearsQueried).toEqual([2022, 2023]);

      expect(features).toHaveLength(3);
      expect(features.map((feature) => feature.properties.severityBucket)).toEqual([
        "fatal",
        "severe_injury",
        "injury",
      ]);
      expect(features[0]?.properties.pedestrianInvolved).toBe(true);
      expect(features[1]?.properties.bicyclistInvolved).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
