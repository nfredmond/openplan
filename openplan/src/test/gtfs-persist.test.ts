import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  GTFS_COLLAPSE_SHRINK_FRACTION,
  GTFS_CURRENT_VERSION_FILTER,
  assessFeedVersionCollapse,
  beginGtfsFeedVersion,
  countDistinctServices,
  deleteVersionRows,
  failGtfsFeedVersion,
  filterToCurrentReadyVersion,
  promoteGtfsFeedVersion,
  resolveFeedDisplayName,
  syncFeedDisplayName,
  toRouteServiceLevelRows,
  toStopServiceLevelRows,
  writeParsedFeedVersion,
} from "@/lib/gtfs/persist";
import { parseGtfsFeed } from "@/lib/gtfs/parse";
import type {
  GtfsRouteServiceLevel,
  GtfsStopServiceLevel,
  ParsedGtfsFeed,
} from "@/lib/gtfs/types";
import { LIVE_RLS, getLocalSupabaseEnv, liveClient } from "./local-supabase-env";
import { queryCatalog, resolveLocalDbContainer } from "./helpers/live-catalog";

/**
 * WHAT EACH HALF OF THIS FILE IS FOR.
 *
 * The offline half tests the pure mapping and the collapse rule, which are the
 * decisions this module makes on its own. The live half exists because the rest
 * of `persist.ts` makes almost no decisions at all — it arranges statements so
 * that the DATABASE's constraints do the deciding, and a mocked Supabase client
 * has no constraints. A fake would happily accept `status = 'ready'` with zero
 * derived rows, accept a write to a GENERATED column, and report a promotion
 * that never moved a pointer. Every one of those is a real failure mode of this
 * file, and none of them is visible without a real Postgres.
 */

/* ========================================================================== */
/* Offline — the pure decisions                                               */
/* ========================================================================== */

const BASE_LEVEL = {
  serviceDay: "wednesday",
  representativeDate: "2026-08-05",
  tripsPerDay: 20,
  firstDepartureSeconds: 6 * 3600,
  lastDepartureSeconds: 20 * 3600,
  spanSeconds: 14 * 3600,
  peakHour: 7,
  peakHourDepartures: 7,
  peakHeadwayMinutes: 60 / 7,
  peakHeadwayIsLowerBound: false,
  medianHeadwayMinutes: 30,
  medianHeadwayBasis: "hourly_average_over_span",
  servedHours: 12,
  spanHours: 14,
  frequentServiceTierMinutes: 15,
  derivationMethod: "scheduled",
  scheduledTripCount: 20,
  frequencyTripCount: 0,
  departuresBeyondBinRange: 0,
} as const;

function routeLevel(overrides: Partial<GtfsRouteServiceLevel> = {}): GtfsRouteServiceLevel {
  return { ...BASE_LEVEL, routeId: "RED", directionId: 0, stopsServed: 12, ...overrides };
}

function stopLevel(overrides: Partial<GtfsStopServiceLevel> = {}): GtfsStopServiceLevel {
  return { ...BASE_LEVEL, stopId: "S1", routeIds: ["RED"], routesServing: 1, ...overrides };
}

function feedOf(overrides: Partial<ParsedGtfsFeed> = {}): ParsedGtfsFeed {
  return {
    filesPresent: ["agency.txt", "stops.txt", "routes.txt", "trips.txt", "stop_times.txt"],
    agencies: [
      { agencyId: "AG1", name: "Example Regional Transit", url: null, timezone: null, lang: null, phone: null },
    ],
    feedInfo: null,
    routes: [
      { routeId: "RED", agencyId: "AG1", shortName: "1", longName: "Red Line", routeType: 3, color: null, textColor: null },
    ],
    stops: [
      { stopId: "S1", name: "North Terminal", lat: 44, lon: -104, locationType: 0, parentStation: null, wheelchairBoarding: null },
    ],
    serviceWindow: { startDate: "2026-08-03", endDate: "2026-08-28", source: "calendar" },
    serviceDayBases: [],
    stopServiceLevels: [stopLevel()],
    routeServiceLevels: [routeLevel()],
    derivationMethod: "scheduled",
    warnings: [],
    stats: {
      archiveBytes: 1000,
      bytesDecompressed: 4000,
      elapsedMs: 5,
      stopTimesRows: 60,
      stopTimesWithoutTime: 0,
      tripRows: 20,
      stopServicePairs: 1,
      routeServicePairs: 1,
      scheduledTrips: 20,
      frequencyTrips: 0,
      exactTimesFrequencyTrips: 0,
    },
    ...overrides,
  };
}

const SCOPE = { versionId: "11111111-1111-1111-1111-111111111111", workspaceId: "ws-1" };

describe("the reader's predicate is written once", () => {
  it("applies BOTH halves — is_current and status=ready", () => {
    const applied: Array<[string, unknown]> = [];
    const builder = {
      eq(column: string, value: unknown) {
        applied.push([column, value]);
        return this;
      },
    };

    filterToCurrentReadyVersion(builder);

    // Sorted, because the object's key order is not the contract — the PAIR is.
    expect([...applied].sort()).toEqual([
      ["is_current", true],
      ["status", "ready"],
    ]);
  });

  it("names the two columns a reader must never filter on separately", () => {
    expect(GTFS_CURRENT_VERSION_FILTER).toEqual({ is_current: true, status: "ready" });
  });
});

describe("mapping a derived row", () => {
  it("rounds a headway toward the WEAKER claim, so a feed never reads more frequent than it is", () => {
    // 7 departures in the peak hour is 3600/7 = 514.285… seconds. Rounding down
    // would publish 514 — a bus marginally more often than the schedule says.
    const [row] = toRouteServiceLevelRows(feedOf(), SCOPE);
    expect(row.peak_headway_seconds).toBe(515);
  });

  it("never writes the GENERATED columns, which Postgres would reject", () => {
    const [route] = toRouteServiceLevelRows(feedOf(), SCOPE);
    const { rows } = toStopServiceLevelRows(feedOf(), SCOPE);

    expect(Object.keys(route)).not.toContain("span_seconds");
    expect(Object.keys(rows[0])).not.toContain("span_seconds");
    expect(Object.keys(rows[0])).not.toContain("geom");
  });

  it("always carries the honesty columns, because forgetting one under-claims silently", () => {
    const [route] = toRouteServiceLevelRows(feedOf(), SCOPE);
    const { rows } = toStopServiceLevelRows(feedOf(), SCOPE);

    for (const row of [route, rows[0]]) {
      expect(row).toHaveProperty("peak_headway_is_lower_bound");
      expect(row).toHaveProperty("median_headway_basis");
      expect(row).toHaveProperty("representative_date");
      expect(row).toHaveProperty("served_hours");
      expect(row).toHaveProperty("span_hours");
      expect(row).toHaveProperty("departures_beyond_bin_range");
    }
  });

  it("copies the claim tier off the parser and offers no way to supply one", () => {
    const withRefusal = feedOf({
      routeServiceLevels: [routeLevel({ medianHeadwayMinutes: null, medianHeadwayBasis: "not_determined_span_mostly_unserved" })],
    });
    const [row] = toRouteServiceLevelRows(withRefusal, SCOPE);

    expect(row.median_headway_basis).toBe("not_determined_span_mostly_unserved");
    expect(row.median_headway_seconds).toBeNull();
  });

  it("derives the peak window from the data rather than an assumed morning commute", () => {
    const afternoonPeak = feedOf({ routeServiceLevels: [routeLevel({ peakHour: 14 })] });
    const [row] = toRouteServiceLevelRows(afternoonPeak, SCOPE);
    expect(row.peak_window_start_seconds).toBe(14 * 3600);
  });

  it("keeps a departure past midnight on the day it belongs to", () => {
    // GTFS expresses 01:10 belonging to Tuesday's service as 25:10:00. Hour 25
    // is legitimate and must survive into the stored window.
    const lateNight = feedOf({ routeServiceLevels: [routeLevel({ peakHour: 25 })] });
    const [row] = toRouteServiceLevelRows(lateNight, SCOPE);
    expect(row.peak_window_start_seconds).toBe(25 * 3600);
  });

  it("leaves route_type null rather than inventing a mode the feed does not state", () => {
    const unknownRoute = feedOf({ routes: [], routeServiceLevels: [routeLevel()] });
    const [row] = toRouteServiceLevelRows(unknownRoute, SCOPE);
    expect(row.route_type).toBeNull();
    expect(row.route_short_name).toBeNull();
  });

  it("DROPS a stop it cannot place and COUNTS it, rather than putting a bus stop at 0,0", () => {
    const dangling = feedOf({
      stops: [],
      stopServiceLevels: [stopLevel({ stopId: "GHOST" })],
    });
    const result = toStopServiceLevelRows(dangling, SCOPE);

    expect(result.rows).toEqual([]);
    expect(result.droppedForMissingCoordinates).toBe(1);
  });

  it("takes coordinates from stops.txt, not from the service level", () => {
    const { rows } = toStopServiceLevelRows(feedOf(), SCOPE);
    expect(rows[0].latitude).toBe(44);
    expect(rows[0].longitude).toBe(-104);
    expect(rows[0].stop_name).toBe("North Terminal");
  });
});

describe("counting services and naming a feed", () => {
  it("counts DISTINCT services across day names rather than summing them", () => {
    const feed = feedOf({
      serviceDayBases: [
        { serviceDay: "monday", representativeDate: "2026-08-03", serviceIds: ["WEEKDAY"], tripCount: 20, candidateDateCount: 4 },
        { serviceDay: "tuesday", representativeDate: "2026-08-04", serviceIds: ["WEEKDAY"], tripCount: 20, candidateDateCount: 4 },
        { serviceDay: "saturday", representativeDate: "2026-08-08", serviceIds: ["SATURDAY"], tripCount: 5, candidateDateCount: 4 },
      ],
    });
    // Summing would give 3. WEEKDAY is one service that runs on many days.
    expect(countDistinctServices(feed)).toBe(2);
  });

  it("prefers the publisher's own name for itself", () => {
    const feed = feedOf({
      feedInfo: { publisherName: "Regional Transit Publisher", publisherUrl: null, lang: null, startDate: null, endDate: null, version: null },
    });
    expect(resolveFeedDisplayName(feed)).toBe("Regional Transit Publisher");
  });

  it("falls back to the first agency, and to null when there is nothing to use", () => {
    expect(resolveFeedDisplayName(feedOf())).toBe("Example Regional Transit");
    expect(resolveFeedDisplayName(feedOf({ agencies: [] }))).toBeNull();
  });
});

describe("a refetch that collapses is not adopted on its own", () => {
  it("cannot collapse on a feed's first ingest", () => {
    expect(assessFeedVersionCollapse(null, { routeCount: 1, stopCount: 1 })).toEqual({ collapsed: false });
  });

  it("treats ordinary timetable churn as a real service change, not a broken download", () => {
    // A 10% reduction is an agency cutting service, and hiding it would be the
    // opposite of what this product is for.
    const verdict = assessFeedVersionCollapse(
      { routeCount: 100, stopCount: 1000 },
      { routeCount: 90, stopCount: 900 }
    );
    expect(verdict.collapsed).toBe(false);
  });

  it("withholds promotion when routes fall past the named threshold", () => {
    const verdict = assessFeedVersionCollapse(
      { routeCount: 100, stopCount: 1000 },
      { routeCount: 50, stopCount: 1000 }
    );
    expect(verdict.collapsed).toBe(true);
    if (!verdict.collapsed) return;
    // The sentence must state BOTH numbers: a verdict nobody can check is a
    // verdict a planner has to take on faith.
    expect(verdict.detail).toContain("50 routes");
    expect(verdict.detail).toContain("100");
  });

  it("withholds promotion when stops fall past it, even if routes hold steady", () => {
    const verdict = assessFeedVersionCollapse(
      { routeCount: 100, stopCount: 1000 },
      { routeCount: 100, stopCount: 400 }
    );
    expect(verdict.collapsed).toBe(true);
  });

  it("puts the threshold exactly where the constant says, in both directions", () => {
    const previous = { routeCount: 100, stopCount: 100 };
    const floor = 100 * (1 - GTFS_COLLAPSE_SHRINK_FRACTION);

    // Exactly at the floor is NOT a collapse; a hair under it is.
    expect(assessFeedVersionCollapse(previous, { routeCount: floor, stopCount: 100 }).collapsed).toBe(false);
    expect(assessFeedVersionCollapse(previous, { routeCount: floor - 1, stopCount: 100 }).collapsed).toBe(true);
  });

  it("does not divide by a zero baseline", () => {
    expect(assessFeedVersionCollapse({ routeCount: 0, stopCount: 0 }, { routeCount: 5, stopCount: 5 }).collapsed).toBe(false);
  });
});

/* ========================================================================== */
/* Live — everything the database decides                                     */
/* ========================================================================== */

const liveDescribe = LIVE_RLS ? describe : describe.skip;

function feedFiles(): Record<string, string> {
  return {
    "agency.txt":
      "agency_id,agency_name,agency_url,agency_timezone\n" +
      "AG1,Persist Probe Transit,https://example.org,America/Denver\n",
    "stops.txt":
      "stop_id,stop_name,stop_lat,stop_lon\n" +
      "S1,North Terminal,44.0,-104.0\nS2,Main and First,44.01,-104.01\nS3,South Terminal,44.02,-104.02\n",
    "routes.txt":
      "route_id,route_short_name,route_long_name,route_type\nRED,1,Red Line,3\nBLUE,2,Blue Line,3\n",
    "calendar.txt":
      "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n" +
      "WEEKDAY,1,1,1,1,1,0,0,20260803,20260828\n",
    "trips.txt":
      "trip_id,route_id,service_id,direction_id\nR1,RED,WEEKDAY,0\nR2,RED,WEEKDAY,0\nB1,BLUE,WEEKDAY,0\n",
    "stop_times.txt":
      "trip_id,stop_id,arrival_time,departure_time,stop_sequence\n" +
      "R1,S1,07:00:00,07:00:00,1\nR1,S2,07:05:00,07:05:00,2\nR1,S3,07:12:00,07:12:00,3\n" +
      "R2,S1,07:30:00,07:30:00,1\nR2,S2,07:35:00,07:35:00,2\nR2,S3,07:42:00,07:42:00,3\n" +
      "B1,S1,09:00:00,09:00:00,1\nB1,S2,09:10:00,09:10:00,2\n",
  };
}

/** A deliberately smaller agency — one route, one stop — to trigger the collapse rule. */
function collapsedFeedFiles(): Record<string, string> {
  return {
    ...feedFiles(),
    "routes.txt": "route_id,route_short_name,route_long_name,route_type\nRED,1,Red Line,3\n",
    "stops.txt": "stop_id,stop_name,stop_lat,stop_lon\nS1,North Terminal,44.0,-104.0\n",
    "trips.txt": "trip_id,route_id,service_id,direction_id\nR1,RED,WEEKDAY,0\n",
    "stop_times.txt":
      "trip_id,stop_id,arrival_time,departure_time,stop_sequence\nR1,S1,07:00:00,07:00:00,1\n",
  };
}

async function parsedFeedOf(files: Record<string, string>): Promise<ParsedGtfsFeed> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  const result = await parseGtfsFeed(await zip.generateAsync({ type: "uint8array" }));
  if (!result.ok) throw new Error(`fixture feed did not parse: ${result.code} ${result.detail}`);
  return result.feed;
}

liveDescribe("persisting a feed against a real database", () => {
  let container = "";
  let service: ReturnType<typeof liveClient>;
  let workspaceId = "";
  let feedId = "";
  let firstVersionId = "";

  const exec = (sql: string) => queryCatalog(container, sql);

  beforeAll(async () => {
    container = resolveLocalDbContainer();
    const env = getLocalSupabaseEnv();
    service = liveClient(env.API_URL, env.SERVICE_ROLE_KEY, "gtfs-persist");

    workspaceId = randomUUID();
    const suffix = workspaceId.replace(/-/g, "").slice(0, 10);
    exec(
      `INSERT INTO public.workspaces (id, name, slug) VALUES ` +
        `('${workspaceId}', 'GTFS persist probe ${suffix}', 'gtfs-persist-probe-${suffix}')`
    );
  }, 120_000);

  afterAll(() => {
    if (!container || !workspaceId) return;
    // Feeds, versions and every derived row cascade from the workspace.
    exec(`DELETE FROM public.workspaces WHERE id = '${workspaceId}'`);
  }, 120_000);

  it("records the ingest as pending BEFORE any network work could have happened", async () => {
    const begun = await beginGtfsFeedVersion({
      service,
      workspaceId,
      sourceKind: "url",
      sourceUrl: "https://example.org/gtfs.zip",
      provisionalName: "example.org",
    });

    expect(begun.ok, begun.ok ? "" : begun.detail).toBe(true);
    if (!begun.ok) return;
    feedId = begun.feedId;
    firstVersionId = begun.versionId;
    expect(begun.createdFeed).toBe(true);

    const [row] = exec(
      `SELECT status || '|' || coalesce(failure_code, '-') FROM public.gtfs_feed_versions WHERE id = '${firstVersionId}'`
    );
    expect(row).toBe("pending|-");

    // And the feed it created is pending too, with no current version to
    // disagree with.
    const [feed] = exec(
      `SELECT status || '|' || coalesce(current_version_id::text, '-') FROM public.gtfs_feeds WHERE id = '${feedId}'`
    );
    expect(feed).toBe("pending|-");
  });

  it("writes the derived rows and marks ready with the counts in one statement", async () => {
    const feed = await parsedFeedOf(feedFiles());
    const written = await writeParsedFeedVersion({
      service,
      versionId: firstVersionId,
      workspaceId,
      feed,
      checksumSha256: "a".repeat(64),
      byteSize: 1234,
    });

    expect(written.ok, written.ok ? "" : written.detail).toBe(true);
    if (!written.ok) return;
    expect(written.stopServiceLevelRows).toBeGreaterThan(0);
    expect(written.droppedForMissingCoordinates).toBe(0);

    const [row] = exec(
      `SELECT status || '|' || route_count || '|' || stop_count || '|' || ` +
        `route_service_level_rows || '|' || stop_service_level_rows || '|' || shapes_status ` +
        `FROM public.gtfs_feed_versions WHERE id = '${firstVersionId}'`
    );
    expect(row).toBe(`ready|2|3|${written.routeServiceLevelRows}|${written.stopServiceLevelRows}|not_ingested`);

    // The counts on the row must equal what is actually in the tables — the
    // whole point of counting written rows rather than derived ones.
    const [actual] = exec(
      `SELECT (SELECT count(*) FROM public.gtfs_route_service_levels WHERE feed_version_id = '${firstVersionId}')::text ` +
        `|| '|' || (SELECT count(*) FROM public.gtfs_stop_service_levels WHERE feed_version_id = '${firstVersionId}')::text`
    );
    expect(actual).toBe(`${written.routeServiceLevelRows}|${written.stopServiceLevelRows}`);
  });

  /**
   * WHY THIS TEST IS HAND-BUILT RATHER THAN PARSED FROM A ZIP.
   *
   * `stop_service_level_rows` must be the number of rows actually WRITTEN, not
   * the number the parser derived, or the `ready`-is-not-empty CHECK is
   * satisfied by a count that overstates what is stored. Today's parser never
   * produces a stop service level for a stop it cannot place — a dangling
   * stop reference is excluded at the source — so no real feed makes the two
   * numbers differ, and a mutation swapping one for the other SURVIVED every
   * other test in this file when it was tried.
   *
   * So the divergence is constructed directly against `writeParsedFeedVersion`'s
   * own contract, which is the thing under test. A future parser change that
   * starts emitting unplaceable stops must not silently make this column a lie.
   */
  it("reports the rows it WROTE, not the rows it was handed", async () => {
    const begun = await beginGtfsFeedVersion({
      service,
      workspaceId,
      feedId,
      sourceKind: "url",
      provisionalName: "example.org",
    });
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;

    const withGhost = feedOf({
      stopServiceLevels: [stopLevel({ stopId: "S1" }), stopLevel({ stopId: "GHOST" })],
    });
    expect(withGhost.stopServiceLevels).toHaveLength(2);

    const written = await writeParsedFeedVersion({
      service,
      versionId: begun.versionId,
      workspaceId,
      feed: withGhost,
    });
    expect(written.ok, written.ok ? "" : written.detail).toBe(true);
    if (!written.ok) return;

    expect(written.droppedForMissingCoordinates).toBe(1);
    expect(written.stopServiceLevelRows).toBe(1);

    const [row] = exec(
      `SELECT stop_service_level_rows::text || '|' || ` +
        `(SELECT count(*)::text FROM public.gtfs_stop_service_levels WHERE feed_version_id = '${begun.versionId}') ` +
        `FROM public.gtfs_feed_versions WHERE id = '${begun.versionId}'`
    );
    // Both halves must be 1. Reporting the derived 2 here would mean the row
    // count on the version row describes a stop that is not in the database.
    expect(row).toBe("1|1");
  });

  it("computes the generated columns the row builders deliberately do not write", () => {
    const [row] = exec(
      `SELECT (span_seconds IS NOT NULL)::text || '|' || (geom IS NOT NULL)::text || '|' || ` +
        `round(ST_X(geom)::numeric, 2)::text ` +
        `FROM public.gtfs_stop_service_levels WHERE feed_version_id = '${firstVersionId}' ` +
        `AND stop_id = 'S1' LIMIT 1`
    );
    // ST_X is longitude. If the row builder had swapped the arguments this reads 44.
    expect(row).toBe("true|true|-104.00");
  });

  it("refuses to store `ready` over an empty feed — the constraint, not a convention", async () => {
    const emptyVersion = randomUUID();
    exec(
      `INSERT INTO public.gtfs_feed_versions (id, workspace_id, feed_id, source_kind, status) ` +
        `VALUES ('${emptyVersion}', '${workspaceId}', '${feedId}', 'url', 'parsing')`
    );

    // Through the real client, because that is the path a route takes and
    // because a CHECK violation has to arrive as something code can act on.
    const { error } = await service
      .from("gtfs_feed_versions")
      .update({ status: "ready" })
      .eq("id", emptyVersion);

    const [stillParsing] = exec(
      `SELECT status FROM public.gtfs_feed_versions WHERE id = '${emptyVersion}'`
    );
    exec(`DELETE FROM public.gtfs_feed_versions WHERE id = '${emptyVersion}'`);

    expect(error, "an empty feed must not be storable as ready").not.toBeNull();
    expect(error?.message ?? "").toContain("gtfs_feed_versions_ready_is_not_empty");
    expect(stillParsing).toBe("parsing");
  });

  it("adopts the version and moves all three halves of the mirror together", async () => {
    const promoted = await promoteGtfsFeedVersion({ service, feedId, versionId: firstVersionId });
    expect(promoted.ok, promoted.ok ? "" : promoted.detail).toBe(true);
    if (!promoted.ok) return;
    expect(promoted.promoted).toBe(true);

    await syncFeedDisplayName(service, feedId, "Persist Probe Transit");

    const [row] = exec(
      `SELECT v.is_current::text || '|' || f.status || '|' || (f.current_version_id = v.id)::text ` +
        `|| '|' || (f.loaded_at IS NOT NULL)::text || '|' || f.agency_name ` +
        `FROM public.gtfs_feed_versions v JOIN public.gtfs_feeds f ON f.id = v.feed_id ` +
        `WHERE v.id = '${firstVersionId}'`
    );
    expect(row).toBe("true|ready|true|true|Persist Probe Transit");
  });

  it("withholds a refetch that derives materially less, and leaves the feed in use alone", async () => {
    const begun = await beginGtfsFeedVersion({
      service,
      workspaceId,
      feedId,
      sourceKind: "url",
      sourceUrl: "https://example.org/gtfs.zip",
      provisionalName: "example.org",
    });
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;

    const written = await writeParsedFeedVersion({
      service,
      versionId: begun.versionId,
      workspaceId,
      feed: await parsedFeedOf(collapsedFeedFiles()),
    });
    expect(written.ok, written.ok ? "" : written.detail).toBe(true);

    const promoted = await promoteGtfsFeedVersion({ service, feedId, versionId: begun.versionId });
    expect(promoted.ok).toBe(true);
    if (!promoted.ok) return;
    expect(promoted.promoted).toBe(false);
    if (promoted.promoted) return;
    expect(promoted.withheld.detail).toContain("has NOT replaced");

    // The version is stored and readable; it simply is not the one in use.
    const [row] = exec(
      `SELECT (SELECT status FROM public.gtfs_feed_versions WHERE id = '${begun.versionId}') || '|' || ` +
        `(SELECT current_version_id::text FROM public.gtfs_feeds WHERE id = '${feedId}')`
    );
    expect(row).toBe(`ready|${firstVersionId}`);

    // And an explicit human decision can still adopt it.
    const adopted = await promoteGtfsFeedVersion({
      service,
      feedId,
      versionId: begun.versionId,
      adoptDespiteCollapse: true,
    });
    expect(adopted.ok && adopted.promoted).toBe(true);

    // Put the fuller feed back so the rest of the file reasons about a sane state.
    await promoteGtfsFeedVersion({ service, feedId, versionId: firstVersionId, adoptDespiteCollapse: true });
  });

  it("never leaves the three mirrored facts disagreeing", () => {
    const disagreements = exec(
      "SELECT f.id::text FROM public.gtfs_feeds f " +
        "JOIN public.gtfs_feed_versions v ON v.feed_id = f.id AND v.is_current " +
        "WHERE f.status IS DISTINCT FROM v.status"
    );
    const dangling = exec(
      "SELECT f.id::text FROM public.gtfs_feeds f " +
        "LEFT JOIN public.gtfs_feed_versions v ON v.id = f.current_version_id " +
        "WHERE f.current_version_id IS NOT NULL AND (v.id IS NULL OR v.feed_id <> f.id OR NOT v.is_current)"
    );
    const unpointed = exec(
      "SELECT v.id::text FROM public.gtfs_feed_versions v JOIN public.gtfs_feeds f ON f.id = v.feed_id " +
        "WHERE v.is_current AND f.current_version_id IS DISTINCT FROM v.id"
    );

    expect({ disagreements, dangling, unpointed }).toEqual({ disagreements: [], dangling: [], unpointed: [] });
  });

  it("refuses to adopt a version that is not ready, in the database itself", async () => {
    const pendingVersion = randomUUID();
    // `failure_code` is supplied in the INSERT itself, not by a follow-up
    // UPDATE: `gtfs_feed_versions_failure_names_itself` refuses a `failed` row
    // that cannot say why, so the two-step version of this fixture is not
    // storable. That constraint caught this test while it was being written.
    exec(
      `INSERT INTO public.gtfs_feed_versions (id, workspace_id, feed_id, source_kind, status, failure_code) ` +
        `VALUES ('${pendingVersion}', '${workspaceId}', '${feedId}', 'url', 'failed', 'fetch_failed'), ` +
        `('${randomUUID()}', '${workspaceId}', '${feedId}', 'url', 'pending', NULL)`
    );

    const result = await promoteGtfsFeedVersion({ service, feedId, versionId: pendingVersion });
    expect(result.ok).toBe(false);

    // AND THE DATABASE REFUSES IT INDEPENDENTLY. Without this the TypeScript
    // check above is the only thing standing between a failed ingest and the
    // feed a workspace analyses with, and a future route that calls the RPC
    // directly would bypass it with nothing to say so.
    const { error } = await service.rpc("promote_gtfs_feed_version", {
      p_version_id: pendingVersion,
    });
    expect(error, "promote_gtfs_feed_version must refuse a version that is not ready").not.toBeNull();
    expect(error?.message ?? "").toContain("not ready");

    // The feed in use did not move.
    const [current] = exec(
      `SELECT current_version_id::text FROM public.gtfs_feeds WHERE id = '${feedId}'`
    );
    expect(current).toBe(firstVersionId);
  });

  it("clears a failed ingest's derived rows and leaves the working feed's card alone", async () => {
    const begun = await beginGtfsFeedVersion({
      service,
      workspaceId,
      feedId,
      sourceKind: "url",
      sourceUrl: "https://example.org/gtfs.zip",
      provisionalName: "example.org",
    });
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;

    await writeParsedFeedVersion({ service, versionId: begun.versionId, workspaceId, feed: await parsedFeedOf(feedFiles()) });
    const [before] = exec(
      `SELECT count(*)::text FROM public.gtfs_stop_service_levels WHERE feed_version_id = '${begun.versionId}'`
    );
    expect(Number(before)).toBeGreaterThan(0);

    await failGtfsFeedVersion({
      service,
      versionId: begun.versionId,
      feedId,
      code: "partial_write",
      detail: "probe",
    });

    const [after] = exec(
      `SELECT (SELECT count(*)::text FROM public.gtfs_stop_service_levels WHERE feed_version_id = '${begun.versionId}') ` +
        `|| '|' || (SELECT status FROM public.gtfs_feed_versions WHERE id = '${begun.versionId}') ` +
        `|| '|' || (SELECT status FROM public.gtfs_feeds WHERE id = '${feedId}')`
    );
    // The feed's own card still says ready, because the version IN USE is still
    // ready. A failed refresh does not break a working feed.
    expect(after).toBe("0|failed|ready");
  });

  it("deletes derived rows only for the version it was given", async () => {
    const [before] = exec(
      `SELECT count(*)::text FROM public.gtfs_stop_service_levels WHERE feed_version_id = '${firstVersionId}'`
    );
    expect(Number(before)).toBeGreaterThan(0);

    const other = randomUUID();
    const cleared = await deleteVersionRows(service, other);
    expect(cleared.ok).toBe(true);

    const [after] = exec(
      `SELECT count(*)::text FROM public.gtfs_stop_service_levels WHERE feed_version_id = '${firstVersionId}'`
    );
    expect(after).toBe(before);
  });
});
