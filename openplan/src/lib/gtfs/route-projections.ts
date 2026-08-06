/**
 * WHAT THE TRANSIT ROUTES ASK THE DATABASE FOR, WRITTEN ONCE.
 *
 * WHY A MODULE AND NOT A STRING AT EACH CALL SITE. Two reasons, and the second
 * is the one this repository has actually been bitten by.
 *
 *   1. A `route.ts` may export ONLY handlers and route segment config —
 *      `next build` rejects anything else, and
 *      `a-route-file-exports-only-route-handlers.test.ts` says so before the
 *      build does. A projection shared between the list route and the detail
 *      route therefore cannot live in either of them.
 *
 *   2. THE SUPABASE CLIENTS IN THIS REPO ARE DELIBERATELY UNTYPED (see the
 *      convention recorded in `knowledge-base/documents.ts`), so a `.select()`
 *      string is never checked against the schema. A column typo surfaces at
 *      runtime as `undefined` on a rendered page, and a mocked client in a test
 *      returns the fixture whatever columns were asked for — which is why
 *      CLAUDE.md's standing instruction is to ASSERT ON THE PROJECTION STRING
 *      ITSELF. That assertion needs one importable name per projection; three
 *      copies of a string cannot be asserted against.
 *
 * WHAT IS DELIBERATELY ABSENT. `gtfs_feed_versions.storage_path` appears in no
 * projection here. It is the object key inside the private `gtfs-uploads`
 * bucket, it is read by the ingest and the reaper directly, and a workspace
 * member has nothing to do with it — handing it to a browser publishes the
 * internal layout of a private bucket for no capability in return.
 */

import type { GtfsCaveatContext } from "./caveats";

/* -------------------------------------------------------------------------- */
/* Projections                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A feed as a Data Hub card needs it.
 *
 * `workspace_id` is projected on purpose even though every read filters on it:
 * a surface rendering a feed needs to be able to say whether it is this
 * workspace's own or a public preloaded one, and deriving that from the absence
 * of a column is how the distinction gets lost.
 */
export const GTFS_FEED_COLUMNS = [
  "id",
  "workspace_id",
  "agency_name",
  "city",
  "state",
  "status",
  "source_kind",
  "feed_url",
  "normalized_source_url",
  "catalog_provider",
  "catalog_source_id",
  "current_version_id",
  "is_active",
  "created_by",
  "created_at",
  "loaded_at",
].join(", ");

/**
 * One ingest attempt, as a card and a detail page need it.
 *
 * EVERY COUNT IS PROJECTED, including the ones a compact card will not render.
 * They are the evidence behind the numbers a planner is about to cite — a
 * headway derived from 12 frequency trips and one derived from 4,000 scheduled
 * trips are different strengths of claim — and a projection that carries only
 * what today's card shows is a projection the next surface has to widen.
 */
export const GTFS_FEED_VERSION_COLUMNS = [
  "id",
  "feed_id",
  "workspace_id",
  "source_kind",
  "source_url",
  "catalog_provider",
  "catalog_source_id",
  "catalog_row_status",
  "checksum_sha256",
  "byte_size",
  "requested_by",
  "fetched_at",
  "last_checked_at",
  "status",
  "failure_code",
  "failure_detail",
  "parse_warnings",
  "agency_count",
  "route_count",
  "stop_count",
  "trip_count",
  "shape_count",
  "shapes_status",
  "calendar_service_count",
  "stop_time_row_count",
  "route_service_level_rows",
  "stop_service_level_rows",
  "frequency_trip_count",
  "scheduled_trip_count",
  "feed_info_version",
  "feed_info_publisher_name",
  "feed_info_start_date",
  "feed_info_end_date",
  "service_start_date",
  "service_end_date",
  "is_current",
  "created_at",
  "updated_at",
].join(", ");

/**
 * What a REFRESH reads off the stored feed row, and nothing more.
 *
 * NARROW ON PURPOSE, because this projection is the mechanism behind a rule:
 * a refetch takes its address from the DATABASE and never from the request. A
 * route holding only these six columns cannot accidentally prefer a URL the
 * caller supplied, because it never asked the caller for one.
 */
export const GTFS_FEED_REFRESH_SOURCE_COLUMNS = [
  "id",
  "workspace_id",
  "agency_name",
  "source_kind",
  "feed_url",
  "catalog_provider",
  "catalog_source_id",
].join(", ");

/**
 * Everything a delete needs in order to say what it is about to destroy.
 *
 * The two row counts are taken from the VERSION ROW rather than counted out of
 * the derived tables, and that is the honest number rather than the convenient
 * one: `writeParsedFeedVersion` sets them in the same statement that sets
 * `ready`, from the rows it actually wrote, and `failGtfsFeedVersion` zeroes
 * them when it clears a failed ingest's rows. A `SELECT count(*)` would be a
 * second, slower way to learn the same fact and could disagree with the
 * database's own `ready`-is-not-empty CHECK, which reads these columns.
 */
export const GTFS_FEED_VERSION_TEARDOWN_COLUMNS = [
  "id",
  "storage_path",
  "route_service_level_rows",
  "stop_service_level_rows",
].join(", ");

/* -------------------------------------------------------------------------- */
/* Row shapes                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The subset of a projected version row this module reasons about.
 *
 * Deliberately not a full row type. The clients are untyped and the rows are
 * cast at the call site; declaring a 37-field interface here would be a second,
 * unverified copy of the schema that drifts the first time a migration lands.
 * What IS declared is what `gtfsCaveatContextFromVersionRow` reads, because
 * that function's correctness depends on those five fields meaning what their
 * names say.
 */
export type GtfsVersionCaveatFields = {
  frequency_trip_count?: number | null;
  parse_warnings?: unknown;
  route_service_level_rows?: number | null;
};

/* -------------------------------------------------------------------------- */
/* Caveats, from a stored row                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Sum the counts of the named parse-warning codes on a stored version row.
 *
 * `parse_warnings` is JSONB written verbatim from the parser's own
 * `GtfsParseWarning[]`, so this reads it defensively rather than trusting a
 * shape the database does not enforce: a row written by an older build, or by
 * hand, must produce zero rather than an exception on a page.
 */
function warningCount(warnings: unknown, codes: readonly string[]): number {
  if (!Array.isArray(warnings)) return 0;
  let total = 0;
  for (const entry of warnings) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as { code?: unknown; count?: unknown };
    if (typeof record.code !== "string" || !codes.includes(record.code)) continue;
    if (typeof record.count === "number" && Number.isFinite(record.count)) total += record.count;
  }
  return total;
}

/**
 * THE CAVEATS THAT APPLY TO A STORED FEED, DERIVED IN EXACTLY ONE PLACE.
 *
 * WHY THE INGEST RESPONSE AND THE DETAIL PAGE MUST SHARE THIS FUNCTION. The
 * ingest holds the freshly parsed feed and knows strictly more than the row it
 * just wrote. It would be easy — and wrong — to build a richer caveat list
 * there: a planner would then see one set of qualifications on the screen that
 * appears the moment their feed lands, and a different, shorter set every time
 * they come back to it. A caveat that disappears on the second visit is worse
 * than one that was never shown, because the reader concludes it stopped
 * applying. So both surfaces read the stored row, and both say the same thing.
 *
 * ONE CAVEAT CANNOT BE SELECTED FROM A STORED ROW, AND THAT IS A KNOWN GAP
 * RATHER THAN A DECISION. `GTFS_INTERPOLATED_STOP_TIME_CAVEAT` is conditional
 * on `stopTimesWithoutTime`, which the parser counts in
 * `ParsedGtfsFeed.stats` and which `writeParsedFeedVersion` does not persist —
 * there is no column for it on `gtfs_feed_versions`. Blank times at a
 * non-timepoint stop are legal GTFS and common, so this is a caveat that will
 * genuinely apply to real feeds and currently cannot be raised. Closing it
 * means one migration adding `stop_times_without_time INTEGER NOT NULL
 * DEFAULT 0` and one line in `writeParsedFeedVersion`; passing zero here in the
 * meantime is the honest reading of a column that does not exist, and is
 * recorded rather than hidden.
 */
export function gtfsCaveatContextFromVersionRow(row: GtfsVersionCaveatFields): GtfsCaveatContext {
  return {
    usesFrequencies: (row.frequency_trip_count ?? 0) > 0,
    // See the paragraph above. Not knowable from a stored version row today.
    stopTimesWithoutTime: 0,
    departuresBeyondBinRange: warningCount(row.parse_warnings, ["departure_past_bin_range"]),
    danglingReferences: warningCount(row.parse_warnings, [
      "dangling_stop_reference",
      "dangling_trip_reference",
      "dangling_service_reference",
    ]),
    // A frequent-service tier is a per-row derivation, so a feed-level surface
    // shows the tier caveat whenever it has route service levels to tier at
    // all. Overstating which caveats apply is the safe direction; understating
    // them is how an unqualified number gets quoted in a plan.
    showsFrequentServiceTier: (row.route_service_level_rows ?? 0) > 0,
  };
}
