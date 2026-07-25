import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchJsonWithRetryMock = vi.fn();

vi.mock("@/lib/data-sources/http", () => ({
  fetchJsonWithRetry: (...args: unknown[]) => fetchJsonWithRetryMock(...args),
}));

import { fetchTransitAccessForBbox } from "@/lib/data-sources/transit";

/**
 * There is no estimate tier for transit.
 *
 * The removed fallback returned `Math.max(1, round(area * 2.5))` stops split
 * 85/10/5 across bus/rail/ferry, with an `accessTier` classified from that
 * constant and `source: "estimate"`. Everything downstream — the accessibility
 * score, the corridor composite, the AI narrative, the exported report — took
 * it as a measurement of the place.
 */

const BBOX = { minLon: -121.8, minLat: 38.5, maxLon: -121.7, maxLat: 38.6 };

describe("fetchTransitAccessForBbox when no source answers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports unobserved with null counts, never zeros", () => {
    // fetchJsonWithRetry reports every failure as null rather than throwing.
    fetchJsonWithRetryMock.mockResolvedValue(null);

    return fetchTransitAccessForBbox(BBOX).then((summary) => {
      expect(summary.observed).toBe(false);
      expect(summary.source).toBe("unavailable");
      expect(summary.totalStops).toBeNull();
      expect(summary.busStops).toBeNull();
      expect(summary.railStations).toBeNull();
      expect(summary.ferryStops).toBeNull();
      expect(summary.stopsPerSqMile).toBeNull();
      // A tier derived from nothing is not a finding.
      expect(summary.accessTier).toBeNull();
      expect(summary.unavailableReason).toMatch(/did not respond/i);
      // The reason must not let a reader conclude the area has no transit.
      expect(summary.unavailableReason).toMatch(/not a finding/i);
    });
  });

  it("tries every configured endpoint before giving up", async () => {
    fetchJsonWithRetryMock.mockResolvedValue(null);
    await fetchTransitAccessForBbox(BBOX);
    expect(fetchJsonWithRetryMock).toHaveBeenCalledTimes(2);
  });

  it("still reports a genuine zero-stop area as observed", async () => {
    fetchJsonWithRetryMock.mockResolvedValue({ elements: [] });

    const summary = await fetchTransitAccessForBbox(BBOX);

    // "We looked and found none" is a real finding and must survive.
    expect(summary.observed).toBe(true);
    expect(summary.source).toBe("osm-overpass");
    expect(summary.totalStops).toBe(0);
    expect(summary.stopsPerSqMile).toBe(0);
    expect(summary.accessTier).toBe("low");
    expect(summary.unavailableReason).toBeNull();
  });

  it("counts and classifies a real Overpass answer", async () => {
    fetchJsonWithRetryMock.mockResolvedValue({
      elements: [
        { id: 1, tags: { highway: "bus_stop" } },
        { id: 2, tags: { public_transport: "stop_position" } },
        { id: 3, tags: { railway: "station" } },
        { id: 4, tags: { amenity: "ferry_terminal" } },
        // Ignored: matches none of the queried tags.
        { id: 5, tags: { amenity: "cafe" } },
      ],
    });

    const summary = await fetchTransitAccessForBbox(BBOX);

    expect(summary.observed).toBe(true);
    expect(summary.totalStops).toBe(4);
    expect(summary.busStops).toBe(2);
    expect(summary.railStations).toBe(1);
    expect(summary.ferryStops).toBe(1);
  });

  it("falls through to the second endpoint when the first does not answer", async () => {
    fetchJsonWithRetryMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ elements: [{ id: 1, tags: { highway: "bus_stop" } }] });

    const summary = await fetchTransitAccessForBbox(BBOX);

    expect(summary.observed).toBe(true);
    expect(summary.totalStops).toBe(1);
  });
});
