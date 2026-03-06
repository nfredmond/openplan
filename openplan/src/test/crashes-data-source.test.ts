import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCrashesForBbox } from "@/lib/data-sources/crashes";

describe("fetchCrashesForBbox", () => {
  const originalAbortSignalTimeout = AbortSignal.timeout;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();

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
});
