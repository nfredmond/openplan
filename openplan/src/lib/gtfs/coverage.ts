/**
 * DOES THIS FEED HAVE STOPS WHERE THE PLANNER IS ANALYSING?
 *
 * WHY THE QUESTION IS ASKED IN OPENPLAN AT ALL, GIVEN THE WORKER ALSO ASKS IT.
 * The AequilibraE worker's `feed_covers(los, lons, lats)` is the AUTHORITY and
 * always will be: it holds the parsed feed and the resolved zone system, and it
 * refuses to skim a feed whose stops fall outside the study area. Nothing here
 * overrides that. What this module buys is TIMING. A planner who picks the wrong
 * agency out of a list of four learns it here, before a run is queued, instead
 * of from a `no_feed_reason` fifteen minutes later on a deployment whose worker
 * may not even be running. The two answers can legitimately differ — the worker
 * compares against zone centroids, this compares against the study-area envelope
 * — so this one is recorded as ADVISORY and never as a refusal.
 *
 * WHY IT IS A BOUNDING BOX AND NOT THE POLYGON. `gtfs_stop_service_levels`
 * carries `latitude`/`longitude` as plain numerics beside a GENERATED `geom`,
 * and supabase-js cannot read or filter PostGIS. A bbox test over the numeric
 * columns is therefore the strongest predicate reachable from this app without
 * an RPC. It OVER-answers: a stop in the envelope's corner but outside the
 * corridor counts as coverage. That direction is deliberate — over-answering
 * lets a feed through for the worker to judge properly, while under-answering
 * would print "this feed does not cover your study area" about a feed that
 * covers it, which is the confident-wrong answer this product forbids.
 *
 * WHAT IS COUNTED IS NOT STOPS. The table's grain is (stop, service day), so a
 * stop with weekday and Saturday service is two rows. The count is named
 * `stopServiceRowsInStudyArea` for that reason and no surface may render it as
 * a stop count.
 *
 * A FAILED READ IS `not_determined`, NEVER `no`. "The database did not answer"
 * and "this agency does not serve here" are different facts, and collapsing
 * them would tell a planner their transit agency is absent from their own city
 * because a query timed out.
 */

/** The study-area envelope a coverage question is asked over. */
export type CoverageBbox = {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
};

/**
 * The three answers, and the middle one is load-bearing.
 *
 * This vocabulary is copied into `TransitFeedStamp.coversStudyArea` and travels
 * into `model_runs.input_snapshot_json`, so it is a closed set on purpose.
 */
export type StudyAreaCoverage = "yes" | "no" | "not_determined";

export type FeedVersionCoverage = {
  coverage: StudyAreaCoverage;
  /**
   * Rows in `gtfs_stop_service_levels` for this version whose coordinates fall
   * inside the envelope. NOT a stop count — see the module header. Null when
   * the coverage is `not_determined`, because a number nobody could read is
   * worse than no number.
   */
  stopServiceRowsInStudyArea: number | null;
  /** Why the answer is `not_determined`. Null otherwise. */
  reason: string | null;
};

/** Minimal structural view of the one read this module makes. */
export type CoverageQueryClient = {
  from: (table: string) => {
    select: (
      columns: string,
      options: { head: true; count: "exact" }
    ) => {
      eq: (column: string, value: string) => CoverageFilterChain;
    };
  };
};

type CoverageFilterChain = {
  gte: (column: string, value: number) => CoverageFilterChain;
  lte: (column: string, value: number) => CoverageFilterChain;
} & PromiseLike<{ count: number | null; error: { message: string } | null }>;

/**
 * Is the envelope usable as a filter?
 *
 * Exported so a caller can refuse before it queries, and because the
 * antimeridian case is a real limit rather than a theoretical one: a study area
 * spanning ±180° produces `minLon > maxLon`, and a `gte/lte` pair over that
 * selects nothing at all — which would read as "this feed has no stops here"
 * about the entire Pacific. Refusing to answer is the honest outcome.
 */
export function bboxIsQueryable(bbox: CoverageBbox): boolean {
  const values = [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat];
  if (!values.every((value) => Number.isFinite(value))) return false;
  if (bbox.minLon > bbox.maxLon) return false;
  if (bbox.minLat > bbox.maxLat) return false;
  return true;
}

/**
 * Turn a stop-row count into the answer, with no clock and no I/O.
 *
 * Separate from the query so the decision can be tested without a database, and
 * so the `null`-count case is settled once: PostgREST returns `count: null`
 * when the count could not be produced, and reading that as zero is exactly the
 * "a failed read becomes a coverage fact" defect this module refuses.
 */
export function coverageFromStopRowCount(
  count: number | null,
  error: { message: string } | null
): FeedVersionCoverage {
  if (error) {
    return {
      coverage: "not_determined",
      stopServiceRowsInStudyArea: null,
      reason: `Whether this feed serves the study area could not be checked: ${error.message}`,
    };
  }
  if (count === null || !Number.isFinite(count)) {
    return {
      coverage: "not_determined",
      stopServiceRowsInStudyArea: null,
      reason:
        "The database did not return a count of this feed's stops inside the study area, so whether " +
        "it serves the area is unknown.",
    };
  }
  return count > 0
    ? { coverage: "yes", stopServiceRowsInStudyArea: count, reason: null }
    : { coverage: "no", stopServiceRowsInStudyArea: 0, reason: null };
}

/**
 * The table and columns this read touches, as VALUES a test can import — while
 * the query below still writes every one of them out as a LITERAL.
 *
 * The duplication is deliberate and `persist.ts` argues the same point at
 * `insertInBatches`: this repo's guards read the database surface with an AST,
 * and `.from(someConstant)` records `table: null` — invisible to
 * `reference-count-projection-guard`, to `the-timetable-is-not-persisted`, and
 * to the claim-tier walker alike. A guard that cannot see a read is a guard
 * reporting the absence of a problem it never looked for. (This is not
 * hypothetical: writing `.from(GTFS_STOP_COVERAGE_TABLE)` here failed that
 * guard on the first run.) So the literal goes in the call, and these names
 * exist so a test can assert the call says what this module claims it says.
 */
export const GTFS_STOP_COVERAGE_TABLE = "gtfs_stop_service_levels";
export const GTFS_STOP_COVERAGE_COLUMNS = Object.freeze({
  version: "feed_version_id",
  latitude: "latitude",
  longitude: "longitude",
} as const);

/**
 * Count this version's stop-service rows inside the envelope.
 *
 * Filtered by `feed_version_id` and nothing else besides the coordinates —
 * which is the containment property. The version was already resolved through
 * `filterToCurrentReadyVersion` against a workspace-scoped feed by the caller,
 * so this read cannot reach another workspace's rows by construction rather
 * than by remembering to add a filter.
 *
 * NEVER THROWS. A coverage answer is a disclosure, and a disclosure that can
 * fail a launch is worse than one that says "not determined".
 */
export async function assessFeedVersionCoverage(args: {
  client: CoverageQueryClient;
  feedVersionId: string;
  bbox: CoverageBbox;
}): Promise<FeedVersionCoverage> {
  const { client, feedVersionId, bbox } = args;

  if (!bboxIsQueryable(bbox)) {
    return {
      coverage: "not_determined",
      stopServiceRowsInStudyArea: null,
      reason:
        "This study area's envelope cannot be used to check feed coverage (it is empty, or it crosses " +
        "the antimeridian), so whether this feed serves the area is unknown.",
    };
  }

  try {
    const result = await client
      .from("gtfs_stop_service_levels")
      .select("id", { head: true, count: "exact" })
      .eq("feed_version_id", feedVersionId)
      .gte("latitude", bbox.minLat)
      .lte("latitude", bbox.maxLat)
      .gte("longitude", bbox.minLon)
      .lte("longitude", bbox.maxLon);

    return coverageFromStopRowCount(result.count, result.error);
  } catch (error) {
    return coverageFromStopRowCount(null, {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
