import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchJsonWithRetryMock = vi.fn();

vi.mock("@/lib/data-sources/http", () => ({
  fetchJsonWithRetry: (...args: unknown[]) => fetchJsonWithRetryMock(...args),
}));

import { fetchTransitAccessForBbox } from "@/lib/data-sources/transit";
import { TRANSIT_SOURCE_ADAPTERS } from "@/lib/data-sources/transit/registry";
import type { TransitSourceAdapter } from "@/lib/data-sources/transit/types";
import {
  createRecordingSupabase,
  type QueryResponse,
  type RecordedQuery,
} from "./helpers/fake-supabase-query-recorder";
import { answerFromTables, type Row } from "./helpers/fake-gtfs-tables";

/**
 * THE REGISTRY, AND THE POSTURE IT INHERITED.
 *
 * There is no estimate tier for transit. The removed fallback returned
 * `Math.max(1, round(area * 2.5))` stops split 85/10/5 across bus/rail/ferry,
 * with an `accessTier` classified from that constant and `source: "estimate"`.
 * Everything downstream — the accessibility score, the corridor composite, the
 * AI narrative, the exported report — took it as a measurement of the place.
 *
 * What is new is that "no source answered" now has to survive TWO adapters
 * declining rather than one endpoint failing, and that an adapter DECLINING (it
 * has nothing to say about this study area) must never be summarized as an
 * adapter answering zero.
 */

const BBOX = { minLon: -121.8, minLat: 38.5, maxLon: -121.7, maxLat: 38.6 };
const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";

/** A workspace with no ingested feeds — the `gtfs-feed` adapter declines. */
function noFeedsClient() {
  return createRecordingSupabase((query: RecordedQuery): QueryResponse => {
    if (query.table === "gtfs_feeds") return { data: [], error: null };
    return { data: [], error: null };
  });
}

async function fetchWithNoFeeds() {
  const { client } = noFeedsClient();
  return fetchTransitAccessForBbox(BBOX, { workspaceId: WORKSPACE_ID, client });
}

/* -------------------------------------------------------------------------- */
/* A workspace where BOTH adapters can answer                                   */
/* -------------------------------------------------------------------------- */

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"] as const;

/**
 * One ingested feed whose stops sit inside the study area, so `gtfs-feed`
 * ANSWERS rather than declining.
 *
 * The whole point of the resolution-order test below is that both adapters are
 * able to answer at the same time. A fixture where only one can answer proves
 * nothing about order — whichever is asked first, the same source wins.
 */
function ingestedFeedTables(): Record<string, Row[]> {
  const stops = ["gtfs-1", "gtfs-2", "gtfs-3"].flatMap((stopId, index) =>
    WEEKDAYS.map((day) => ({
      workspace_id: WORKSPACE_ID,
      feed_version_id: "ver-1",
      stop_id: stopId,
      service_day: day,
      latitude: 38.52 + index * 0.01,
      longitude: -121.78 + index * 0.01,
      trips_per_day: 40,
      first_departure_seconds: 21_600,
      last_departure_seconds: 79_200,
      peak_headway_seconds: 720,
      peak_window_start_seconds: 28_800,
    }))
  );

  return {
    gtfs_feeds: [
      {
        id: "feed-1",
        workspace_id: WORKSPACE_ID,
        agency_name: "Regional Transit",
        city: "Somewhere",
        state: "XX",
        status: "loaded",
        source_kind: "url",
        is_active: true,
        created_at: "2026-01-01T00:00:00Z",
      },
    ],
    gtfs_feed_versions: [
      {
        id: "ver-1",
        feed_id: "feed-1",
        workspace_id: WORKSPACE_ID,
        is_current: true,
        status: "ready",
        service_start_date: "2024-08-01",
        service_end_date: "2027-04-05",
        frequency_trip_count: 0,
        parse_warnings: [],
        route_service_level_rows: 120,
        stop_service_level_rows: 15,
      },
    ],
    gtfs_stop_service_levels: stops,
  };
}

/**
 * Wrap every registered adapter's `fetch` so the ORDER OF CONSULTATION is
 * recorded, then delegate to the real one.
 *
 * WHY RECORDING RATHER THAN READING THE ARRAY. The version of this test that
 * shipped asserted `TRANSIT_SOURCE_ADAPTERS.map(a => a.id)` and nothing else —
 * it proved the CONSTANT and never the BEHAVIOUR. Mutating the resolver's loop
 * to `[...TRANSIT_SOURCE_ADAPTERS].reverse()` left every Stage 3 test green,
 * which is to say corridors would have been scored on an OpenStreetMap node
 * tally instead of the workspace's own ingested feed — the precise harm the old
 * test's comment claimed to prevent.
 */
function recordConsultationOrder() {
  const consulted: string[] = [];
  const saved = TRANSIT_SOURCE_ADAPTERS.map((adapter) => {
    const original = adapter.fetch;
    (adapter as { fetch: TransitSourceAdapter["fetch"] }).fetch = (context) => {
      consulted.push(adapter.id);
      return original.call(adapter, context);
    };
    return { adapter, original };
  });

  return {
    consulted,
    restore() {
      for (const { adapter, original } of saved) {
        (adapter as { fetch: TransitSourceAdapter["fetch"] }).fetch = original;
      }
    },
  };
}

describe("the transit registry", () => {
  it("registers the adapters strongest evidence first", () => {
    // The constant. Necessary and nowhere near sufficient — the resolver has to
    // actually walk it in this order, which is the test below.
    expect(TRANSIT_SOURCE_ADAPTERS.map((adapter) => adapter.id)).toEqual([
      "gtfs-feed",
      "osm-overpass",
    ]);
  });

  it("CONSULTS the ingested feed first when both sources could answer", async () => {
    // Overpass is primed to answer with a real element list, and the workspace
    // has an ingested feed reaching the study area. Both adapters CAN answer, so
    // which one does is decided by resolution order and by nothing else.
    fetchJsonWithRetryMock.mockResolvedValue({
      elements: [
        { id: 1, tags: { highway: "bus_stop" } },
        { id: 2, tags: { railway: "station" } },
      ],
    });

    const recorder = createRecordingSupabase(answerFromTables(ingestedFeedTables()));
    const order = recordConsultationOrder();

    try {
      const summary = await fetchTransitAccessForBbox(BBOX, {
        workspaceId: WORKSPACE_ID,
        client: recorder.client,
      });

      // Asked first…
      expect(order.consulted[0]).toBe("gtfs-feed");
      // …and answered from, so the OSM adapter was never reached at all.
      expect(order.consulted).toEqual(["gtfs-feed"]);
      expect(summary.source).toBe("gtfs-feed");
      // Proof the OSM path really was available: it would have counted 2 stops
      // and reported a mode split, and this summary does neither.
      expect(summary.totalStops).toBe(3);
      expect(summary.busStops).toBeNull();
      expect(summary.method.id).toBe("gtfs-service-levels");
    } finally {
      order.restore();
    }
  });

  it("falls through to OpenStreetMap only after the ingested feeds decline", async () => {
    // The other half of the ordering claim. Without this, a resolver that asked
    // GTFS and then stopped would satisfy the assertion above.
    fetchJsonWithRetryMock.mockResolvedValue({
      elements: [{ id: 1, tags: { highway: "bus_stop" } }],
    });

    const { client } = noFeedsClient();
    const order = recordConsultationOrder();

    try {
      const summary = await fetchTransitAccessForBbox(BBOX, {
        workspaceId: WORKSPACE_ID,
        client,
      });

      expect(order.consulted).toEqual(["gtfs-feed", "osm-overpass"]);
      expect(summary.source).toBe("osm-overpass");
    } finally {
      order.restore();
    }
  });
});

describe("fetchTransitAccessForBbox when no source answers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports unobserved with null counts, never zeros", async () => {
    // fetchJsonWithRetry reports every failure as null rather than throwing.
    fetchJsonWithRetryMock.mockResolvedValue(null);

    const summary = await fetchWithNoFeeds();

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
    expect(summary.method.id).toBe("not-measured");
  });

  it("names what declined, so a workspace can see its feeds were skipped", async () => {
    fetchJsonWithRetryMock.mockResolvedValue(null);

    const summary = await fetchWithNoFeeds();

    // A workspace whose feeds were not consulted must be able to see that from
    // the run, rather than inferring it from a score that did not move.
    expect(summary.sourceSnapshot.skippedSources).toEqual([
      { id: "gtfs-feed", reason: expect.stringMatching(/ingested no transit feed/i) },
    ]);
    expect(summary.sourceSnapshot.unavailableSources).toEqual([
      { id: "osm-overpass", reason: expect.stringMatching(/did not respond/i) },
    ]);
  });

  it("tries every configured Overpass endpoint before giving up", async () => {
    fetchJsonWithRetryMock.mockResolvedValue(null);
    await fetchWithNoFeeds();
    expect(fetchJsonWithRetryMock).toHaveBeenCalledTimes(2);
  });

  it("still reports a genuine zero-stop area as observed", async () => {
    fetchJsonWithRetryMock.mockResolvedValue({ elements: [] });

    const summary = await fetchWithNoFeeds();

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

    const summary = await fetchWithNoFeeds();

    expect(summary.observed).toBe(true);
    expect(summary.totalStops).toBe(4);
    expect(summary.busStops).toBe(2);
    expect(summary.railStations).toBe(1);
    expect(summary.ferryStops).toBe(1);
    // OpenStreetMap holds no schedule, so it has NO OPINION on frequency. Null
    // and not zero — the accessibility score reads this exact distinction.
    expect(summary.frequentServiceShare).toBeNull();
    expect(summary.method.frequencyTermApplied).toBe(false);
  });

  it("falls through to the second endpoint when the first does not answer", async () => {
    fetchJsonWithRetryMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ elements: [{ id: 1, tags: { highway: "bus_stop" } }] });

    const summary = await fetchWithNoFeeds();

    expect(summary.observed).toBe(true);
    expect(summary.totalStops).toBe(1);
  });

  it("treats an adapter that throws as unavailable, never as empty", async () => {
    fetchJsonWithRetryMock.mockResolvedValue(null);
    const { client } = createRecordingSupabase((query: RecordedQuery): QueryResponse => {
      if (query.table === "gtfs_feeds") throw new Error("connection reset");
      return { data: [], error: null };
    });

    const summary = await fetchTransitAccessForBbox(BBOX, { workspaceId: WORKSPACE_ID, client });

    // Conflating "the source could not be reached" with "the source answered
    // zero" is the single most dangerous bug this lane can have, because zero
    // stops reads as a corridor with no transit.
    expect(summary.observed).toBe(false);
    expect(summary.sourceSnapshot.unavailableSources).toEqual(
      expect.arrayContaining([{ id: "gtfs-feed", reason: "connection reset" }])
    );
  });
});
