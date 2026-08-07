/**
 * WRITING A PARSED FEED DOWN, WITHOUT EVER LETTING A PARTIAL WRITE LOOK LIKE A
 * WHOLE ONE.
 *
 * `parse.ts` turns a zip into service levels in memory and cannot fail
 * halfway — it either returns a feed or a named refusal. This module is where
 * that guarantee stops holding on its own: a feed is tens of thousands of rows
 * across two tables plus a version row plus a pointer on a third table, and the
 * process can die between any two of them. Every design choice below exists to
 * make the states a crash can leave behind DISTINGUISHABLE from success, rather
 * than merely unlikely.
 *
 * THE SEQUENCE, AND WHY IT IS THIS ORDER.
 *
 *   1. The version row is inserted `pending` BEFORE ANY NETWORK WORK. It is the
 *      job row and the provenance row at once (see 20260805000006's header for
 *      why those are deliberately one table). Writing it first means a fetch
 *      that hangs, a process that is killed, or a deploy that lands mid-ingest
 *      leaves a row that says `pending` — something the reaper can find and a
 *      planner can be told about. Fetching first and recording afterwards would
 *      leave nothing at all, and "no row" is indistinguishable from "never
 *      started".
 *   2. Derived rows are written next, in batches, while the version still says
 *      `parsing`. Nothing reads them, because every reader filters on
 *      `is_current AND status = 'ready'` (see `filterToCurrentReadyVersion`
 *      below — there is exactly one expression of that predicate in the
 *      codebase, on purpose).
 *   3. `ready` is set IN THE SAME STATEMENT as the counts. Not before, not
 *      after. `gtfs_feed_versions_ready_is_not_empty` refuses `ready` unless
 *      routes, stops and both derived-row counts are non-zero, so a version
 *      that claims success while holding nothing is not merely caught by a test
 *      — it cannot be stored. Splitting the status and the counts into two
 *      statements would open a window in which that CHECK is satisfied by stale
 *      values.
 *   4. `is_current` is flipped LAST, and only through
 *      `promote_gtfs_feed_version` (migration 20260805000008), because the
 *      three-way mirror between the version flag, the feed pointer and the feed
 *      status cannot be moved atomically by any ordering of separate
 *      statements. That function also refuses to promote anything that is not
 *      `ready`.
 *
 * AND WHEN IT GOES WRONG: `failGtfsFeedVersion` writes a failure code, deletes
 * the derived rows by `feed_version_id`, and removes the uploaded object. The
 * rows are deleted rather than left because a half-written feed that is never
 * promoted is invisible to readers but still answers `count(*)` — and the next
 * refresh of the same feed would then be comparing its own counts against
 * garbage.
 *
 * WHAT THIS MODULE REFUSES TO DECIDE. It never invents a value it was not
 * given. `median_headway_basis` and `peak_headway_is_lower_bound` are copied
 * from the parser's own derivation and there is no parameter anywhere in this
 * file through which a caller — a route, a planner, or an assistant action —
 * could supply either. That is deliberate and structural: both are claims about
 * how strong a number is, and a claim tier must be decided by the evidence, not
 * by whoever is asking.
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeMatchedNoRows } from "@/lib/http/write-outcome";
import type {
  GtfsFailureCode,
  GtfsRouteServiceLevel,
  GtfsStopServiceLevel,
  ParsedGtfsFeed,
} from "./types";

/* -------------------------------------------------------------------------- */
/* The one expression of "the feed a workspace actually analyses with"          */
/* -------------------------------------------------------------------------- */

/**
 * THE READER'S PREDICATE, WRITTEN ONCE.
 *
 * A feed can have many versions and at most one of them is the one in use. Both
 * halves of that sentence are load-bearing and both are easy to half-remember:
 * filter on `is_current` alone and a version that failed after being promoted
 * would be read as service data; filter on `status = 'ready'` alone and a
 * workspace with three successful ingests gets triple the stops.
 *
 * Typing the pair at each call site is how the two halves drift apart, so they
 * are expressed here and applied through `filterToCurrentReadyVersion`. A guard
 * can then assert that every reader goes through this function, which is a
 * thing a test can check; "remember to filter on both" is not.
 */
export const GTFS_CURRENT_VERSION_FILTER = Object.freeze({
  is_current: true,
  status: "ready",
} as const);

/** The status a version must hold before anything may read or promote it. */
export const GTFS_VERSION_STATUS_READY = "ready";

/** Minimal shape of a PostgREST filter builder — enough to chain `.eq()`. */
type EqFilterable = { eq: (column: string, value: never) => unknown };

/**
 * Apply `GTFS_CURRENT_VERSION_FILTER` to a query. Generic over the builder so
 * it composes with the rest of a PostgREST chain instead of terminating it.
 */
export function filterToCurrentReadyVersion<T extends EqFilterable>(query: T): T {
  let next: T = query;
  for (const [column, value] of Object.entries(GTFS_CURRENT_VERSION_FILTER)) {
    next = (next as EqFilterable).eq(column, value as never) as T;
  }
  return next;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                    */
/* -------------------------------------------------------------------------- */

/** The private bucket a `.zip` door writes to (20260219000006, raised to 200 MiB). */
export const GTFS_UPLOADS_BUCKET = "gtfs-uploads";

/**
 * Derived rows per PostgREST call.
 *
 * MEASURED, not guessed: Sacramento Regional Transit's real published feed —
 * 2.7 MB, 65 routes, 2,821 stops — derives **18,141 stop rows and 749 route
 * rows**, because the grain is (stop, service day) and most stops have service
 * on six or seven days. A large agency is several times that. So the batch size
 * is a real decision and not a formality: at 500 it is 37 round trips for one
 * mid-size agency, at 5,000 the request bodies get large enough that a single
 * failure re-sends a lot of work.
 *
 * 1,000 sits between the two batch sizes this repository already uses for the
 * same job — `safety/ingest.ts` uses 500 for crash rows, `equity-designation/
 * db.ts` uses 5,000 for narrow tract rows — and these rows are wider than the
 * first and narrower than the second. A stop row carries a `route_ids` array,
 * which is what keeps it off the higher number.
 */
const DERIVED_ROW_BATCH_SIZE = 1000;

/**
 * How much smaller a refetch may be before it stops being promoted on its own.
 *
 * THE FAILURE THIS PREVENTS. A refresh that fetches a truncated, half-published
 * or wrongly-scoped feed derives fewer routes and stops than the version in
 * use. Promoting it automatically would replace an agency's real service data
 * with a smaller one, silently, and every downstream number — corridor
 * accessibility, a transit element, an equity finding — would move for a reason
 * nobody could see. The refetch is a fact and is stored as `ready`; whether it
 * should REPLACE what is in use is a judgement, and this is where the product
 * declines to make it quietly.
 *
 * WHY IT IS NOT ZERO. Agencies really do cut service, and a schedule with 20%
 * fewer routes after a budget cut is exactly the thing a planner needs OpenPlan
 * to show them. A threshold of "any shrinkage at all" would make every genuine
 * service reduction look like a broken download, and planners would learn to
 * click past the warning — which is worse than not having one.
 *
 * 20% IS A JUDGEMENT AND IS NAMED AS ONE. It is not derived from anything; it
 * is a round number chosen to sit above ordinary seasonal timetable churn and
 * below the kind of collapse a truncated file produces. It is a constant rather
 * than a literal so that a deployment which finds it wrong changes one line.
 */
export const GTFS_COLLAPSE_SHRINK_FRACTION = 0.2;

/* -------------------------------------------------------------------------- */
/* Rounding                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Minutes to whole seconds, ROUNDING TOWARD THE WEAKER CLAIM.
 *
 * A headway is 3600/n over the busiest clock hour and is not an integer for
 * most n — 3600/7 is 514.28… — so something has to choose 514 or 515, and
 * 20260805000007's header is explicit that an implicit cast must not be what
 * chooses. The direction is the whole point: a SMALLER headway means buses come
 * MORE often, so rounding down would make every feed's service marginally
 * better than its own schedule. Rounding up can only ever understate frequency,
 * which is the same direction `peak_headway_is_lower_bound` defaults to and the
 * same direction the rest of this lane leans.
 *
 * It cannot cost a feed a frequent-service tier, because the tiers are 15 and
 * 30 minutes and 3600/n is exact at every n that lands on them (n=4 → 900,
 * n=2 → 1800). Rounding up only moves values that were already between tiers.
 */
function headwaySecondsFromMinutes(minutes: number | null): number | null {
  if (minutes === null || !Number.isFinite(minutes)) return null;
  return Math.ceil(minutes * 60);
}

/* -------------------------------------------------------------------------- */
/* Row mapping — pure, so it can be tested without a database                   */
/* -------------------------------------------------------------------------- */

type DerivedRowScope = {
  versionId: string;
  workspaceId: string | null;
};

/**
 * `span_seconds` and `geom` are GENERATED ALWAYS columns and are absent from
 * every row builder below. Writing them is an error Postgres rejects, and the
 * reason they are generated is that a stored copy could drift from the values
 * it was computed from.
 */
export function toRouteServiceLevelRows(
  feed: ParsedGtfsFeed,
  scope: DerivedRowScope
): Record<string, unknown>[] {
  const routesById = new Map(feed.routes.map((route) => [route.routeId, route]));

  return feed.routeServiceLevels.map((level: GtfsRouteServiceLevel) => {
    const route = routesById.get(level.routeId);
    return {
      workspace_id: scope.workspaceId,
      feed_version_id: scope.versionId,
      route_id: level.routeId,
      direction_id: level.directionId,
      route_short_name: route?.shortName ?? null,
      route_long_name: route?.longName ?? null,
      // Nullable since 20260805000007: route_type is legitimately unparseable
      // in real feeds, and NOT NULL here would have forced this line to invent
      // a mode for a route whose own feed does not state one.
      route_type: route?.routeType ?? null,
      service_day: level.serviceDay,
      representative_date: level.representativeDate,
      trips_per_day: level.tripsPerDay,
      first_departure_seconds: level.firstDepartureSeconds,
      last_departure_seconds: level.lastDepartureSeconds,
      peak_headway_seconds: headwaySecondsFromMinutes(level.peakHeadwayMinutes),
      peak_headway_is_lower_bound: level.peakHeadwayIsLowerBound,
      peak_window_start_seconds: level.peakHour === null ? null : level.peakHour * 3600,
      median_headway_seconds: headwaySecondsFromMinutes(level.medianHeadwayMinutes),
      median_headway_basis: level.medianHeadwayBasis,
      served_hours: level.servedHours,
      span_hours: level.spanHours,
      departures_beyond_bin_range: level.departuresBeyondBinRange,
      stops_served: level.stopsServed,
      derivation_method: level.derivationMethod,
      scheduled_trips: level.scheduledTripCount,
      frequency_trips: level.frequencyTripCount,
    };
  });
}

export type StopRowMappingResult = {
  rows: Record<string, unknown>[];
  /**
   * Derived stop levels dropped because `stops.txt` never defined the stop, so
   * there are no coordinates to write and `latitude`/`longitude` are NOT NULL.
   *
   * COUNTED RATHER THAN IGNORED, and the count is what the version row's
   * `stop_service_level_rows` is taken from — never the length of the input.
   * Reporting the derived count while writing fewer rows would satisfy the
   * `ready`-is-not-empty CHECK with a number that overstates what is actually
   * stored, which is precisely the class of lie that CHECK exists to stop.
   */
  droppedForMissingCoordinates: number;
};

export function toStopServiceLevelRows(
  feed: ParsedGtfsFeed,
  scope: DerivedRowScope
): StopRowMappingResult {
  const stopsById = new Map(feed.stops.map((stop) => [stop.stopId, stop]));
  const rows: Record<string, unknown>[] = [];
  let droppedForMissingCoordinates = 0;

  for (const level of feed.stopServiceLevels as GtfsStopServiceLevel[]) {
    const stop = stopsById.get(level.stopId);
    // The parser already declines to attribute a departure to a stop it cannot
    // place, so this should not fire — but "should not" is not "cannot", and
    // fabricating a coordinate to satisfy NOT NULL would put a bus stop at
    // 0°N 0°E in the Gulf of Guinea, on a map, indistinguishable from a real one.
    if (!stop) {
      droppedForMissingCoordinates += 1;
      continue;
    }

    rows.push({
      workspace_id: scope.workspaceId,
      feed_version_id: scope.versionId,
      stop_id: level.stopId,
      stop_name: stop.name,
      latitude: stop.lat,
      longitude: stop.lon,
      service_day: level.serviceDay,
      representative_date: level.representativeDate,
      trips_per_day: level.tripsPerDay,
      first_departure_seconds: level.firstDepartureSeconds,
      last_departure_seconds: level.lastDepartureSeconds,
      peak_headway_seconds: headwaySecondsFromMinutes(level.peakHeadwayMinutes),
      peak_headway_is_lower_bound: level.peakHeadwayIsLowerBound,
      peak_window_start_seconds: level.peakHour === null ? null : level.peakHour * 3600,
      median_headway_seconds: headwaySecondsFromMinutes(level.medianHeadwayMinutes),
      median_headway_basis: level.medianHeadwayBasis,
      served_hours: level.servedHours,
      span_hours: level.spanHours,
      departures_beyond_bin_range: level.departuresBeyondBinRange,
      routes_serving: level.routesServing,
      route_ids: level.routeIds,
      derivation_method: level.derivationMethod,
      scheduled_trips: level.scheduledTripCount,
      frequency_trips: level.frequencyTripCount,
    });
  }

  return { rows, droppedForMissingCoordinates };
}

/**
 * Distinct service_ids behind the derived rows.
 *
 * NOT the number of rows in calendar.txt — the parser never counts those, and
 * `calendar_service_count`'s column comment in 20260805000008 says so, because
 * a column whose meaning is only in one file's head is a column the next reader
 * gets wrong.
 */
export function countDistinctServices(feed: ParsedGtfsFeed): number {
  const services = new Set<string>();
  for (const basis of feed.serviceDayBases) {
    for (const serviceId of basis.serviceIds) services.add(serviceId);
  }
  return services.size;
}

/**
 * The feed's own name for itself.
 *
 * `gtfs_feeds.agency_name` is NOT NULL and is what the Data Hub card renders.
 * A feed may carry several agencies (a regional publisher aggregating its
 * members), so the publisher's name is preferred when `feed_info.txt` states
 * one, and the first agency is the fallback. The COUNT is stored separately on
 * the version row, so a surface can say "and three others" without this string
 * having to encode it.
 */
export function resolveFeedDisplayName(feed: ParsedGtfsFeed): string | null {
  const publisher = feed.feedInfo?.publisherName?.trim();
  if (publisher) return publisher;
  const agency = feed.agencies.find((entry) => entry.name.trim().length > 0);
  return agency ? agency.name.trim() : null;
}

/* -------------------------------------------------------------------------- */
/* Beginning an ingest                                                          */
/* -------------------------------------------------------------------------- */

export type GtfsSourceKind = "catalog" | "url" | "upload";

export type BeginGtfsFeedVersionParams = {
  service: SupabaseClient;
  workspaceId: string;
  /** An existing feed to add a version to (a refresh), or null to create one. */
  feedId?: string | null;
  sourceKind: GtfsSourceKind;
  sourceUrl?: string | null;
  normalizedSourceUrl?: string | null;
  catalogProvider?: string | null;
  catalogSourceId?: string | null;
  /** Whatever the catalog said about the entry, verbatim. Never interpreted here. */
  catalogRowStatus?: string | null;
  /**
   * What to call the feed until the parse names it. Something the planner
   * actually chose or supplied — a catalog provider, a hostname, a filename —
   * never a guess at an agency. Replaced by `resolveFeedDisplayName` on success.
   */
  provisionalName: string;
  requestedBy?: string | null;
};

export type BeginGtfsFeedVersionResult =
  | { ok: true; feedId: string; versionId: string; createdFeed: boolean }
  | { ok: false; detail: string };

export async function beginGtfsFeedVersion(
  params: BeginGtfsFeedVersionParams
): Promise<BeginGtfsFeedVersionResult> {
  const { service, workspaceId } = params;
  let feedId = params.feedId ?? null;
  let createdFeed = false;

  if (!feedId) {
    const insertFeed = await service
      .from("gtfs_feeds")
      .insert({
        workspace_id: workspaceId,
        agency_name: params.provisionalName,
        // `pending` is honest for a feed whose first ingest has not finished.
        // It cannot disagree with a current version because there is not one
        // yet — the mirror guard joins on `is_current`, so it has nothing to
        // compare until `promote_gtfs_feed_version` runs.
        status: "pending",
        source_kind: params.sourceKind,
        feed_url: params.sourceUrl ?? null,
        normalized_source_url: params.normalizedSourceUrl ?? null,
        catalog_provider: params.catalogProvider ?? null,
        catalog_source_id: params.catalogSourceId ?? null,
        created_by: params.requestedBy ?? null,
        // city/state are LEFT NULL on purpose. The obvious place to get them is
        // the feed catalog's own location columns, and those are wrong often
        // enough to matter: Mobility Database row 75, El Dorado Transit, is a
        // California operator whose subdivision_name reads "Colorado" while its
        // bounding box sits in California. Displaying a place OpenPlan did not
        // establish, next to an agency name, is how a planner comes to distrust
        // everything else on the card.
      })
      .select("id")
      .maybeSingle();

    if (insertFeed.error) {
      return { ok: false, detail: `Could not register the feed: ${insertFeed.error.message}` };
    }
    const created = insertFeed.data as { id: string } | null;
    if (!created?.id) {
      return { ok: false, detail: "The feed was registered but could not be read back." };
    }
    feedId = created.id;
    createdFeed = true;
  }

  const versionId = randomUUID();
  const insertVersion = await service.from("gtfs_feed_versions").insert({
    id: versionId,
    workspace_id: workspaceId,
    feed_id: feedId,
    source_kind: params.sourceKind,
    source_url: params.sourceUrl ?? null,
    catalog_provider: params.catalogProvider ?? null,
    catalog_source_id: params.catalogSourceId ?? null,
    catalog_row_status: params.catalogRowStatus ?? null,
    requested_by: params.requestedBy ?? null,
    status: "pending",
  });

  if (insertVersion.error) {
    return { ok: false, detail: `Could not record the ingest: ${insertVersion.error.message}` };
  }

  return { ok: true, feedId, versionId, createdFeed };
}

/** The non-terminal stages, so a stuck ingest says which step it is stuck on. */
export type GtfsIngestStage = "fetching" | "parsing";

export async function markGtfsFeedVersionStage(
  service: SupabaseClient,
  versionId: string,
  stage: GtfsIngestStage
): Promise<boolean> {
  // Deliberately not surfaced as a FAILURE. This is progress reporting: if it
  // does not land, the reaper still sees a non-terminal row and the ingest
  // still runs. Turning a bookkeeping miss into a refused ingest would trade a
  // cosmetic problem for a real one.
  //
  // But "not a failure" is not the same as "not worth knowing". The row count
  // is read and returned rather than discarded, because a zero here means the
  // version row is GONE — reaped, or deleted under a running ingest — and a
  // caller that wants to stop early can. Discarding it is how an UPDATE over
  // zero rows becomes indistinguishable from success, which is the defect this
  // repository has now found on four separate tables.
  const result = await service
    .from("gtfs_feed_versions")
    .update({ status: stage })
    .eq("id", versionId)
    .select("id")
    .maybeSingle();

  return !writeMatchedNoRows(result);
}

/* -------------------------------------------------------------------------- */
/* Writing the parsed feed                                                      */
/* -------------------------------------------------------------------------- */

export type WriteParsedFeedVersionParams = {
  service: SupabaseClient;
  versionId: string;
  workspaceId: string | null;
  feed: ParsedGtfsFeed;
  /** Where the bytes were stored, when a door stored them. */
  storagePath?: string | null;
  checksumSha256?: string | null;
  byteSize?: number | null;
  fetchedAt?: Date | null;
};

export type WriteParsedFeedVersionResult =
  | {
      ok: true;
      routeServiceLevelRows: number;
      stopServiceLevelRows: number;
      droppedForMissingCoordinates: number;
      displayName: string | null;
      /** Whether the tract-service join ran, and what it wrote. */
      tractService: TractServiceComputation;
    }
  | { ok: false; code: GtfsFailureCode; detail: string };

/**
 * Batched insert, with the TABLE NAME PASSED TO `.from()` AS A LITERAL BY THE
 * CALLER rather than as a parameter here.
 *
 * That shape is not an accident and it is worth the extra argument. This
 * repository's guards read the write surface with an AST — `supabase-call-sites
 * .ts` resolves `.from("literal")` and records `table: null` for anything
 * computed, and `reachable-write-surface.ts` walks out of a route into the
 * libraries it calls looking for written columns. A helper that did
 * `service.from(table)` would make every write through it INVISIBLE to both:
 * `the-timetable-is-not-persisted.test.ts` could not see which table was
 * written, and the claim-tier guard could not see that `median_headway_basis`
 * is written here. A guard that cannot see a write is a guard that reports the
 * absence of a problem it never looked for.
 *
 * Returning `null` for success is deliberate: the only thing a caller does with
 * the result is return it, so a value means "stop".
 */
async function insertInBatches(
  rows: Record<string, unknown>[],
  table: string,
  insert: (batch: Record<string, unknown>[]) => PromiseLike<{ error: { message: string } | null }>
): Promise<{ ok: false; code: GtfsFailureCode; detail: string } | null> {
  for (let offset = 0; offset < rows.length; offset += DERIVED_ROW_BATCH_SIZE) {
    const batch = rows.slice(offset, offset + DERIVED_ROW_BATCH_SIZE);
    const { error } = await insert(batch);
    if (error) {
      return {
        ok: false,
        code: "partial_write",
        detail:
          `Storing this feed's service levels stopped part-way (${table}, rows ` +
          `${offset + 1}-${offset + batch.length}): ${error.message}`,
      };
    }
  }
  return null;
}

export type TractServiceComputation =
  | { computed: true; rows: number }
  /**
   * The join did not run. `computed_at` stays NULL, and a service-equity
   * analysis reading this version must REFUSE rather than report absence — an
   * empty tract-service table is otherwise indistinguishable from a real
   * finding that no tract in the area has any transit service.
   */
  | { computed: false; reason: string };

/**
 * Join this version's stops to census tracts, once, here.
 *
 * WHY IT DOES NOT FAIL THE INGEST. The feed itself is complete and useful
 * without the tract join — the map draws, the corridor score works, the travel
 * model can consume it. Failing a good ingest because a downstream equity join
 * could not run would trade a working feed for nothing. But the failure is
 * RECORDED rather than swallowed: `tract_service_computed_at` stays NULL, which
 * is the discriminator the analysis refuses on.
 *
 * A count of 0 with the timestamp SET is a different and honest state: the join
 * ran and no census tracts are loaded for this agency's area, which the
 * analysis reports as an actionable gap naming the load step.
 */
async function computeTractServiceForVersion(
  service: SupabaseClient,
  versionId: string
): Promise<TractServiceComputation> {
  const { data, error } = await service.rpc("compute_gtfs_tract_service", {
    p_feed_version_id: versionId,
  });

  if (error) {
    return { computed: false, reason: error.message };
  }
  // The function returns INTEGER. Anything else means the deployment's function
  // is not the one this code expects, which must not be recorded as a run.
  if (typeof data !== "number" || !Number.isFinite(data)) {
    return {
      computed: false,
      reason: `compute_gtfs_tract_service returned ${JSON.stringify(data)} rather than a row count`,
    };
  }
  return { computed: true, rows: data };
}

export async function writeParsedFeedVersion(
  params: WriteParsedFeedVersionParams
): Promise<WriteParsedFeedVersionResult> {
  const { service, versionId, feed } = params;
  const scope: DerivedRowScope = { versionId, workspaceId: params.workspaceId };

  const routeRows = toRouteServiceLevelRows(feed, scope);
  const stopMapping = toStopServiceLevelRows(feed, scope);

  // THE COUNTS THAT REACH THE VERSION ROW ARE THE ROWS THAT WILL BE WRITTEN,
  // not the ones the parser derived. See `droppedForMissingCoordinates`.
  if (routeRows.length === 0 || stopMapping.rows.length === 0) {
    return {
      ok: false,
      code: "no_usable_service",
      detail:
        "This feed parsed, but produced no service levels that could be stored — it has no " +
        "departures that can be attributed to a route and a placed stop on any day. A feed " +
        "whose calendar has expired entirely, or whose stop_times reference stops that " +
        "stops.txt never defines, reads this way.",
    };
  }

  const routeWrite = await insertInBatches(routeRows, "gtfs_route_service_levels", (batch) =>
    service.from("gtfs_route_service_levels").insert(batch)
  );
  if (routeWrite) return routeWrite;

  const stopWrite = await insertInBatches(stopMapping.rows, "gtfs_stop_service_levels", (batch) =>
    service.from("gtfs_stop_service_levels").insert(batch)
  );
  if (stopWrite) return stopWrite;

  const tractService = await computeTractServiceForVersion(service, versionId);

  const displayName = resolveFeedDisplayName(feed);

  // `ready` AND THE COUNTS IN ONE STATEMENT. The database's
  // `gtfs_feed_versions_ready_is_not_empty` CHECK reads both halves of this
  // update together; setting the status first would let it pass against the
  // zeroes the row was inserted with.
  const finalize = await service
    .from("gtfs_feed_versions")
    .update({
      status: GTFS_VERSION_STATUS_READY,
      failure_code: null,
      failure_detail: null,
      agency_count: feed.agencies.length,
      route_count: feed.routes.length,
      stop_count: feed.stops.length,
      trip_count: feed.stats.tripRows,
      stop_time_row_count: feed.stats.stopTimesRows,
      calendar_service_count: countDistinctServices(feed),
      route_service_level_rows: routeRows.length,
      stop_service_level_rows: stopMapping.rows.length,
      // NULL timestamp when the join did not run. See computeTractServiceForVersion.
      tract_service_rows: tractService.computed ? tractService.rows : null,
      tract_service_computed_at: tractService.computed ? new Date().toISOString() : null,
      frequency_trip_count: feed.stats.frequencyTrips,
      scheduled_trip_count: feed.stats.scheduledTrips,
      // The parser reads no shapes at all; see 20260805000008's header for why
      // none of the other three values in this vocabulary would be true.
      shape_count: 0,
      shapes_status: "not_ingested",
      service_start_date: feed.serviceWindow.startDate,
      service_end_date: feed.serviceWindow.endDate,
      feed_info_version: feed.feedInfo?.version ?? null,
      feed_info_publisher_name: feed.feedInfo?.publisherName ?? null,
      feed_info_start_date: feed.feedInfo?.startDate ?? null,
      feed_info_end_date: feed.feedInfo?.endDate ?? null,
      parse_warnings: feed.warnings,
      storage_path: params.storagePath ?? null,
      checksum_sha256: params.checksumSha256 ?? null,
      byte_size: params.byteSize ?? null,
      fetched_at: (params.fetchedAt ?? new Date()).toISOString(),
      last_checked_at: new Date().toISOString(),
    })
    .eq("id", versionId)
    .select("id")
    .maybeSingle();

  if (finalize.error) {
    return {
      ok: false,
      code: "partial_write",
      detail: `The feed's service levels were written but the ingest could not be completed: ${finalize.error.message}`,
    };
  }
  // Zero matched rows on an UPDATE is reported by PostgREST as success with no
  // data. Here it means the version row is gone — deleted under us, or never
  // committed — and the derived rows above are orphans. That is a failure, and
  // reporting it as one is what lets the caller clean up.
  if (writeMatchedNoRows(finalize)) {
    return {
      ok: false,
      code: "partial_write",
      detail:
        "The feed's service levels were written but the ingest record could no longer be found, " +
        "so this ingest cannot be marked complete.",
    };
  }

  return {
    ok: true,
    routeServiceLevelRows: routeRows.length,
    stopServiceLevelRows: stopMapping.rows.length,
    droppedForMissingCoordinates: stopMapping.droppedForMissingCoordinates,
    displayName,
    tractService,
  };
}

/* -------------------------------------------------------------------------- */
/* Promotion, and the collapse it refuses to wave through                       */
/* -------------------------------------------------------------------------- */

export type FeedVersionScale = { routeCount: number; stopCount: number };

export type CollapseAssessment =
  | { collapsed: false }
  | {
      collapsed: true;
      /** Rendered by the caller; states both numbers so nobody has to trust a verdict. */
      detail: string;
      routeCount: number;
      stopCount: number;
      previousRouteCount: number;
      previousStopCount: number;
    };

/**
 * Would adopting `next` in place of `previous` shrink this feed materially?
 *
 * Pure and exported so the rule can be tested without a database and read
 * without tracing a route. `previous` is null for a feed's first ingest, which
 * can never be a collapse — there is nothing to collapse from.
 */
export function assessFeedVersionCollapse(
  previous: FeedVersionScale | null,
  next: FeedVersionScale
): CollapseAssessment {
  if (!previous) return { collapsed: false };
  if (previous.routeCount <= 0 && previous.stopCount <= 0) return { collapsed: false };

  const floor = 1 - GTFS_COLLAPSE_SHRINK_FRACTION;
  const routesCollapsed = previous.routeCount > 0 && next.routeCount < previous.routeCount * floor;
  const stopsCollapsed = previous.stopCount > 0 && next.stopCount < previous.stopCount * floor;
  if (!routesCollapsed && !stopsCollapsed) return { collapsed: false };

  const parts: string[] = [];
  if (routesCollapsed) parts.push(`${next.routeCount} routes where the feed in use has ${previous.routeCount}`);
  if (stopsCollapsed) parts.push(`${next.stopCount} stops where the feed in use has ${previous.stopCount}`);

  return {
    collapsed: true,
    detail:
      `This refetch derived ${parts.join(", and ")}. It has been stored, but it has NOT replaced ` +
      `the feed this workspace analyses with, because a drop that size is as likely to be a ` +
      `truncated download as a real service cut — and adopting it would move every number that ` +
      `reads transit service without anything on screen changing.`,
    routeCount: next.routeCount,
    stopCount: next.stopCount,
    previousRouteCount: previous.routeCount,
    previousStopCount: previous.stopCount,
  };
}

export type PromoteGtfsFeedVersionParams = {
  service: SupabaseClient;
  feedId: string;
  versionId: string;
  /**
   * Adopt the version even if it is materially smaller than the one in use.
   *
   * Reserved for a person who has been shown `CollapseAssessment.detail` and
   * said yes anyway. It is not a parameter any assistant action may reach: an
   * agent optimising for "the refresh completed" would set it every time, which
   * is exactly the incentive the collapse rule exists to defeat.
   */
  adoptDespiteCollapse?: boolean;
};

export type PromoteGtfsFeedVersionResult =
  | { ok: true; promoted: true }
  | { ok: true; promoted: false; withheld: CollapseAssessment & { collapsed: true } }
  | { ok: false; detail: string };

export async function promoteGtfsFeedVersion(
  params: PromoteGtfsFeedVersionParams
): Promise<PromoteGtfsFeedVersionResult> {
  const { service, feedId, versionId } = params;

  const incoming = await service
    .from("gtfs_feed_versions")
    .select("id, status, route_count, stop_count")
    .eq("id", versionId)
    .eq("feed_id", feedId)
    .maybeSingle();

  if (incoming.error) {
    return { ok: false, detail: `Could not read the ingest to promote: ${incoming.error.message}` };
  }
  const next = incoming.data as
    | { status: string; route_count: number; stop_count: number }
    | null;
  if (!next) {
    return { ok: false, detail: "That ingest does not belong to this feed." };
  }
  if (next.status !== GTFS_VERSION_STATUS_READY) {
    // The database refuses this too. Checking here as well means the caller
    // gets a sentence rather than a raised exception.
    return { ok: false, detail: `An ingest with status "${next.status}" cannot become the feed in use.` };
  }

  if (!params.adoptDespiteCollapse) {
    const current = await service
      .from("gtfs_feed_versions")
      .select("id, route_count, stop_count")
      .eq("feed_id", feedId)
      .eq("is_current", true)
      .maybeSingle();

    if (current.error) {
      return {
        ok: false,
        detail: `Could not read the feed currently in use: ${current.error.message}`,
      };
    }

    const previous = current.data as { route_count: number; stop_count: number } | null;
    const assessment = assessFeedVersionCollapse(
      previous ? { routeCount: previous.route_count, stopCount: previous.stop_count } : null,
      { routeCount: next.route_count, stopCount: next.stop_count }
    );
    if (assessment.collapsed) {
      return { ok: true, promoted: false, withheld: assessment };
    }
  }

  const { error } = await service.rpc("promote_gtfs_feed_version", { p_version_id: versionId });
  if (error) {
    return { ok: false, detail: `Could not adopt this ingest: ${error.message}` };
  }

  // The display name is the parsed agency's, and it is only true of the version
  // that is now current — so it moves with the promotion rather than at write
  // time, where it would rename a feed on the strength of an ingest that was
  // never adopted.
  return { ok: true, promoted: true };
}

/**
 * Rename the feed to what the adopted version says it is.
 *
 * Separate from `promoteGtfsFeedVersion` because it is presentation and that
 * function is an invariant: a failure here must not make a correct promotion
 * look like a failed one.
 */
export async function syncFeedDisplayName(
  service: SupabaseClient,
  feedId: string,
  displayName: string | null
): Promise<boolean> {
  if (!displayName) return false;

  const result = await service
    .from("gtfs_feeds")
    .update({ agency_name: displayName })
    .eq("id", feedId)
    .select("id")
    .maybeSingle();

  return !writeMatchedNoRows(result);
}

/* -------------------------------------------------------------------------- */
/* Failure and cleanup                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Delete a version's derived rows.
 *
 * By `feed_version_id` and nothing else, which is the whole safety property:
 * every derived row belongs to exactly one version, so this can never reach
 * another version's data, another workspace's, or the rows currently in use.
 */
export async function deleteVersionRows(
  service: SupabaseClient,
  versionId: string
): Promise<
  { ok: true; routeRowsDeleted: number; stopRowsDeleted: number } | { ok: false; detail: string }
> {
  // Written out rather than looped for the reason given on `insertInBatches`:
  // a `.from(variable)` is invisible to the AST guards that read this repo's
  // write surface, and this lane's whole point is that its writes are legible.
  // `.select("id")` on both, so the delete can SEE how many rows it removed.
  // Zero is a legitimate outcome here — a version that failed before writing
  // anything has nothing to clear — so the count is REPORTED rather than
  // treated as an error. What it must never be is unobservable: a delete that
  // cannot count its own rows is how "cleanup ran" and "cleanup matched
  // nothing because the filter was wrong" become the same log line.
  const routes = await service
    .from("gtfs_route_service_levels")
    .delete()
    .eq("feed_version_id", versionId)
    .select("id");
  if (routes.error) {
    return { ok: false, detail: `Could not clear gtfs_route_service_levels: ${routes.error.message}` };
  }

  const stops = await service
    .from("gtfs_stop_service_levels")
    .delete()
    .eq("feed_version_id", versionId)
    .select("id");
  if (stops.error) {
    return { ok: false, detail: `Could not clear gtfs_stop_service_levels: ${stops.error.message}` };
  }

  return {
    ok: true,
    routeRowsDeleted: (routes.data ?? []).length,
    stopRowsDeleted: (stops.data ?? []).length,
  };
}

/**
 * How long an ingest may sit in a non-terminal state before it is certainly not
 * running any more.
 *
 * DERIVED FROM THE PLATFORM CEILING RATHER THAN CHOSEN. The ingest routes
 * declare `maxDuration = 300`, so no ingest can still be executing five minutes
 * after its last write; a serverless function is killed at that boundary
 * whether or not it finished. Three times that is the margin for clock skew,
 * cold starts and a platform that queued the invocation, and past it "still
 * working" is not a possible explanation — only "died without saying so" is.
 *
 * The cost of setting this too LOW is the one that matters: a live ingest
 * marked `failed` under itself, which would then write its derived rows against
 * a version the reaper had already cleaned. Too high merely leaves an honest
 * `parsing` row on a card for longer.
 */
export const GTFS_INGEST_ABANDONED_AFTER_MS = 15 * 60 * 1000;

/** The states an ingest can be stuck in. Everything else is terminal. */
const GTFS_NON_TERMINAL_STATUSES = ["pending", "fetching", "parsing"] as const;

export type ReapAbandonedGtfsIngestsResult = {
  scanned: number;
  reaped: string[];
};

/**
 * Flip ingests that stopped moving to a truthful `failed`.
 *
 * The counterpart of inserting the version row before any network work: that
 * decision is what makes a dead ingest DISCOVERABLE, and this is what stops it
 * sitting on a planner's screen saying `parsing` forever. Without it, the honest
 * bookkeeping in `beginGtfsFeedVersion` would produce rows nobody ever resolves.
 */
export async function reapAbandonedGtfsIngests(
  service: SupabaseClient,
  now: number = Date.now()
): Promise<ReapAbandonedGtfsIngestsResult> {
  const cutoff = new Date(now - GTFS_INGEST_ABANDONED_AFTER_MS).toISOString();

  const { data, error } = await service
    .from("gtfs_feed_versions")
    .select("id, feed_id, storage_path, status, updated_at")
    .in("status", GTFS_NON_TERMINAL_STATUSES as unknown as string[])
    .lt("updated_at", cutoff)
    .order("updated_at", { ascending: true })
    .limit(200);

  if (error) throw new Error(`Could not scan for abandoned ingests: ${error.message}`);

  const rows = (data ?? []) as Array<{ id: string; feed_id: string; storage_path: string | null }>;
  const reaped: string[] = [];

  for (const row of rows) {
    await failGtfsFeedVersion({
      service,
      versionId: row.id,
      feedId: row.feed_id,
      storagePath: row.storage_path,
      code: "abandoned",
      detail:
        "This ingest stopped responding and was closed by the scheduled sweep. Nothing was stored " +
        "from it. Bringing the feed in again is safe — it does not affect the feed currently in use.",
    });
    reaped.push(row.id);
  }

  return { scanned: rows.length, reaped };
}

export type FailGtfsFeedVersionParams = {
  service: SupabaseClient;
  versionId: string;
  code: GtfsFailureCode;
  detail: string;
  /** Set when this ingest created the feed row and no version ever succeeded. */
  feedId?: string | null;
  storagePath?: string | null;
};

/**
 * Record a failed ingest and leave nothing half-written behind it.
 *
 * ORDER: derived rows first, then the object, then the status. The status is
 * last because it is the thing a surface reads — a row that says `failed` while
 * its derived rows are still there would invite the next refresh to compare
 * itself against them.
 */
export async function failGtfsFeedVersion(
  params: FailGtfsFeedVersionParams
): Promise<{ recorded: boolean; feedStatusChanged: boolean }> {
  const { service, versionId } = params;

  await deleteVersionRows(service, versionId);

  if (params.storagePath) {
    // Fire and forget, exactly as the Knowledge Base upload path does: a stray
    // object in a private bucket is a housekeeping problem, and letting it
    // prevent the failure from being RECORDED would turn a small mess into an
    // ingest that never explains itself.
    await service.storage
      .from(GTFS_UPLOADS_BUCKET)
      .remove([params.storagePath])
      .catch(() => undefined);
  }

  // `.select().maybeSingle()` so this can tell "recorded the failure" from
  // "the version row was not there to record it on". The second case means the
  // derived rows deleted above were orphans and nothing now explains the
  // failure to anyone — worth knowing, and unknowable without asking.
  const recorded = await service
    .from("gtfs_feed_versions")
    .update({
      status: "failed",
      failure_code: params.code,
      failure_detail: params.detail,
      // Zeroed so the next refresh cannot mistake a failed ingest's leftovers
      // for a baseline to compare against.
      route_service_level_rows: 0,
      stop_service_level_rows: 0,
      last_checked_at: new Date().toISOString(),
    })
    .eq("id", versionId)
    .select("id")
    .maybeSingle();

  if (writeMatchedNoRows(recorded)) return { recorded: false, feedStatusChanged: false };

  // Only when this feed has never had a working version. If one is current, the
  // feed's status mirrors THAT version and must not be moved — a refresh that
  // fails does not stop the feed in use from being ready, and overwriting the
  // mirror here is exactly the disagreement
  // `gtfs-feed-status-mirrors-its-current-version.test.ts` fails on.
  if (params.feedId) {
    const current = await service
      .from("gtfs_feeds")
      .select("id, current_version_id")
      .eq("id", params.feedId)
      .maybeSingle();
    const feed = current.data as { current_version_id: string | null } | null;
    if (!current.error && feed && !feed.current_version_id) {
      const marked = await service
        .from("gtfs_feeds")
        .update({ status: "failed" })
        .eq("id", params.feedId)
        .select("id")
        .maybeSingle();
      return { recorded: true, feedStatusChanged: !writeMatchedNoRows(marked) };
    }
  }

  return { recorded: true, feedStatusChanged: false };
}
