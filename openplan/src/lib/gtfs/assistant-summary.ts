/**
 * WHAT THE COPILOT IS ALLOWED TO KNOW ABOUT A WORKSPACE'S TRANSIT FEEDS.
 *
 * The Planner Agent can offer exactly one transit action — refetch a feed from
 * the address the database already holds for it — and an offer is only honest if
 * something in the data actually justifies it. This module is that something: it
 * turns the rows a workspace really has into the small set of facts the offer's
 * condition reads, and nothing else.
 *
 * ===================================== WHY THIS IS A BUILDER AND NOT A LOADER
 *
 * `record_stage_gate_hold` shipped with an offer condition NO BOARD COULD EVER
 * SATISFY, and its reachability test passed, because the test described the
 * state in a fixture instead of building it. A described fixture proves the
 * assertion; only a built one proves the feature. So the derivation lives here,
 * as a pure function over row shapes, and `context.ts` does nothing but read the
 * rows and hand them over. A test can then drive the REAL derivation with
 * real-shaped rows and find out whether the offer can render at all.
 *
 * ============================== WHY "STALE" IS THE SERVICE WINDOW, NOT THE INGEST
 *
 * `gtfs_feeds.status = 'loaded'` and `gtfs_feed_versions.fetched_at` both
 * describe the DOWNLOAD. Neither says anything about whether the schedule inside
 * the archive is still running, and on real published feeds it very often is
 * not — three of four Sacramento-area feeds measured on 2026-08-05 had already
 * expired, one of them sixteen months earlier. The fact worth acting on is
 * `service_end_date`: the last day the calendar in the feed OpenPlan analyses
 * with actually covers. A feed downloaded this morning whose calendar ran out in
 * April is stale; a feed downloaded a year ago whose calendar runs to next June
 * is not.
 *
 * ==================================== WHAT IS DELIBERATELY *NOT* DERIVED HERE
 *
 * No headway, no trip count, no service level of any kind. The copilot decides
 * WHETHER to offer a refetch; it does not summarise service, because a service
 * figure that reaches a planner has to arrive with the caveats that qualify it
 * (`selectGtfsCaveats`), and a quick link's one-line reason is not a place those
 * fit. The rule this lane is built around — a number and its qualifications
 * travel together — is easier to keep by not carrying the number.
 */

/** The stored feed row, exactly as the assistant projection asks for it. */
export type GtfsAssistantFeedRow = {
  id: string;
  agency_name: string | null;
  source_kind: string | null;
  feed_url: string | null;
  catalog_source_id: string | null;
};

/**
 * The version row a workspace ANALYSES with, already narrowed by
 * `filterToCurrentReadyVersion`. Passing an unfiltered list here would let a
 * promoted-then-failed ingest supply the service window, which is the exact
 * asymmetry that predicate exists to prevent.
 */
export type GtfsAssistantVersionRow = {
  feed_id: string;
  service_end_date: string | null;
};

/** Why a stored feed cannot be fetched again, when it cannot. */
export type GtfsRefetchRefusal = "uploaded_archive" | "no_recorded_address";

export type WorkspaceTransitFeedSummary = {
  id: string;
  /** The agency name on the row. Never invented — a nameless row says so. */
  name: string;
  sourceKind: string | null;
  /** The stored row records an address a refresh can fetch from again. */
  refetchable: boolean;
  /** Stated rather than implied, so a copilot can explain a feed it did not offer. */
  notRefetchableReason: GtfsRefetchRefusal | null;
  /**
   * Last day covered by the calendar in the version this workspace analyses
   * with. NULL means unknown — no ready version, or a row written before the
   * column existed — and unknown is never treated as stale.
   */
  serviceEndDate: string | null;
  /** Whole days from today to that date; negative once the schedule has ended. */
  serviceDaysRemaining: number | null;
};

export type WorkspaceTransitSummary = {
  /**
   * Whether the feed read answered at all.
   *
   * An empty `feeds` list with `readable: false` means "this console could not
   * look", which is a completely different sentence from "this workspace has no
   * transit feeds" — and handing the second one to a model as a fact is how a
   * copilot ends up confidently describing a workspace it never saw.
   */
  readable: boolean;
  feeds: WorkspaceTransitFeedSummary[];
  /**
   * The one feed a refetch offer is for, or null. Chosen rather than left to the
   * caller so the choice is testable, and so it is STABLE: a quick link that
   * names a different feed on every page load is worse than no quick link.
   */
  staleRefetchableFeed: WorkspaceTransitFeedSummary | null;
};

/**
 * How close to the end of its calendar a feed has to be before a refetch is
 * worth offering.
 *
 * Thirty days is a judgement, not a measurement, and it is written down as one.
 * The reasoning: an agency republishes around a service change, so a calendar
 * inside a month of running out is either about to be replaced upstream or has
 * already been replaced and this workspace has not picked it up. A window of
 * zero would only ever offer a refetch after the data went wrong, which is late;
 * a window of a year would offer one constantly, and an offer that is always
 * present carries no information.
 */
export const GTFS_REFRESH_OFFER_WINDOW_DAYS = 30;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole days between two `YYYY-MM-DD` dates, or null if either is unusable.
 *
 * Parsed component-wise into a UTC instant rather than handed to `new Date(…)`,
 * because a bare date string is interpreted in the runtime's own zone by some
 * engines and in UTC by others — a difference that shows up as an off-by-one day
 * only on deployments in the wrong hemisphere. Both sides are treated the same
 * way, so the subtraction is exact.
 *
 * A day of slop either way would not matter to a thirty-day window in any case;
 * the reason to be precise is that the number is also reported to the planner.
 */
function wholeDaysBetween(fromIsoDate: string, toIsoDate: string): number | null {
  const parse = (value: string): number | null => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!match) return null;
    const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isFinite(timestamp) ? timestamp : null;
  };

  const from = parse(fromIsoDate);
  const to = parse(toIsoDate);
  if (from === null || to === null) return null;
  return Math.round((to - from) / MILLISECONDS_PER_DAY);
}

/**
 * Can this stored row be fetched again, and if not, why not?
 *
 * Both branches mirror a refusal the refresh route ALREADY answers with, and
 * that correspondence is the point: an offer whose condition is looser than the
 * route's would put a quick link in front of a planner that always fails.
 *
 *   - an uploaded archive has no address at all (the route answers 422),
 *   - a row with neither a catalog id nor a feed URL has nothing to fetch
 *     (the route answers 422).
 *
 * A CATALOG ID OUTRANKS A STORED URL, exactly as the route resolves it: a
 * catalog feed is re-resolved through the catalog's own redirects, because
 * agencies republish under new ids and the old address keeps serving a frozen
 * mirror of a schedule that no longer runs.
 */
function classifyRefetchability(row: GtfsAssistantFeedRow): {
  refetchable: boolean;
  notRefetchableReason: GtfsRefetchRefusal | null;
} {
  if (row.source_kind === "upload") {
    return { refetchable: false, notRefetchableReason: "uploaded_archive" };
  }
  const hasAddress = Boolean(row.catalog_source_id?.trim()) || Boolean(row.feed_url?.trim());
  return hasAddress
    ? { refetchable: true, notRefetchableReason: null }
    : { refetchable: false, notRefetchableReason: "no_recorded_address" };
}

export type BuildWorkspaceTransitSummaryParams = {
  /** Feeds this workspace OWNS. See the loader: a public preloaded feed is not one. */
  feeds: GtfsAssistantFeedRow[];
  /** Current, ready versions only — see `GtfsAssistantVersionRow`. */
  currentVersions: GtfsAssistantVersionRow[];
  /** Today as `YYYY-MM-DD`. Injected so the derivation has no clock of its own. */
  today: string;
  /** False when either read failed. See `WorkspaceTransitSummary.readable`. */
  readable: boolean;
};

export function buildWorkspaceTransitSummary(
  params: BuildWorkspaceTransitSummaryParams
): WorkspaceTransitSummary {
  const serviceEndByFeedId = new Map<string, string | null>();
  for (const version of params.currentVersions) {
    if (!version?.feed_id) continue;
    serviceEndByFeedId.set(version.feed_id, version.service_end_date ?? null);
  }

  const feeds: WorkspaceTransitFeedSummary[] = params.feeds
    .filter((row): row is GtfsAssistantFeedRow => Boolean(row?.id))
    .map((row) => {
      const serviceEndDate = serviceEndByFeedId.get(row.id) ?? null;
      const { refetchable, notRefetchableReason } = classifyRefetchability(row);

      return {
        id: row.id,
        // A feed with no agency name is a real state — the name is written by
        // the parse, and a version that never parsed leaves it provisional or
        // empty. Saying so beats printing an empty string into a quick link.
        name: row.agency_name?.trim() || "Unnamed transit feed",
        sourceKind: row.source_kind ?? null,
        refetchable,
        notRefetchableReason,
        serviceEndDate,
        serviceDaysRemaining: serviceEndDate ? wholeDaysBetween(params.today, serviceEndDate) : null,
      };
    });

  /**
   * The candidate is the refetchable feed whose calendar runs out soonest,
   * INCLUDING ones that ran out long ago — those are the ones most worth acting
   * on, and excluding them would offer a refetch only during the month before a
   * feed went stale and never again afterwards.
   *
   * Ties break on id so the same feed is named on every render. Two feeds with
   * the same end date is not a rare shape: an agency publishing bus and rail as
   * separate feeds changes them on the same day.
   */
  const candidates = feeds.filter(
    (feed) =>
      feed.refetchable &&
      feed.serviceDaysRemaining !== null &&
      feed.serviceDaysRemaining <= GTFS_REFRESH_OFFER_WINDOW_DAYS
  );

  const staleRefetchableFeed =
    candidates.length === 0
      ? null
      : candidates.reduce((soonest, feed) => {
          const difference = (feed.serviceDaysRemaining ?? 0) - (soonest.serviceDaysRemaining ?? 0);
          if (difference < 0) return feed;
          if (difference > 0) return soonest;
          return feed.id < soonest.id ? feed : soonest;
        });

  return { readable: params.readable, feeds, staleRefetchableFeed };
}

/* -------------------------------------------------------------------------- */
/* What the assistant context asks the database for                            */
/* -------------------------------------------------------------------------- */

/**
 * The feed columns the copilot needs, and not one more.
 *
 * These live here rather than in `route-projections.ts` because that module is
 * explicitly "what the transit ROUTES ask for" and this is not a route — but the
 * reason for hoisting them into a named constant is identical, and worth
 * restating: the Supabase clients in this repository are deliberately untyped,
 * so a column named in a `.select()` string is never checked against the schema
 * and a typo renders `undefined` with the suite green. A named constant is
 * something a test can assert on.
 *
 * NARROW ON PURPOSE. `status`, `loaded_at` and the catalog provider are not
 * here: nothing above reads them, and a projection carrying columns nobody uses
 * invites a later reader to key an offer on one.
 */
export const GTFS_ASSISTANT_FEED_COLUMNS = [
  "id",
  "agency_name",
  "source_kind",
  "feed_url",
  "catalog_source_id",
].join(", ");

/**
 * The version columns, which are the feed key and the service window.
 *
 * `service_end_date` is the whole reason this read exists — see the header. It
 * is also the column `gtfs-claim-boundaries` requires on every presentation
 * projection, for the same underlying reason: a feed described without its
 * service window reads as current service.
 */
export const GTFS_ASSISTANT_VERSION_COLUMNS = ["feed_id", "service_end_date"].join(", ");
