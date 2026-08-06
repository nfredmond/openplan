/**
 * THE WORKSPACE'S OWN INGESTED GTFS FEEDS, ANSWERING A CORRIDOR QUESTION.
 *
 * This is the adapter that makes the transit half of a corridor screen come
 * from an agency's published schedule instead of from a count of
 * OpenStreetMap nodes. It reads the DERIVED SERVICE LEVELS written by
 * `src/lib/gtfs/` and nothing else — there is no timetable in this repository to
 * read, by design, and this adapter could not answer "what time does anything
 * leave" if it wanted to.
 *
 * ============================================================ THE NUMBER MOVES
 *
 * A workspace that ingests a real feed can watch the same corridor's
 * accessibility score FALL. That is correct and it is disclosed in three places
 * (see `method.ts`), but the mechanism belongs here, where the decision is made:
 *
 *   - An OpenStreetMap tally counts mapped objects. Platforms, stop positions
 *     and both sides of a street are separate nodes, so a well-mapped town shows
 *     several times the "stops" of an identically-served one that nobody has
 *     traced. Density alone therefore rewards mapping effort.
 *   - A GTFS feed counts the stops its own schedule calls at, and — this is the
 *     part OSM cannot do at all — says how often. So the transit term becomes
 *     half density and half the share of stops meeting a frequent-service
 *     headway, and a corridor of many stops that each see four buses a day no
 *     longer scores like a corridor with a bus every ten minutes.
 *
 * The ceiling of the term is unchanged, so the composite's arithmetic is
 * untouched; what changes is what fills it. See `scoring.ts`.
 *
 * ==================================================== THREE RULES ABOUT SILENCE
 *
 * 1. A FEED WHOSE STOPS DO NOT REACH THE STUDY AREA DOES NOT ANSWER AT ALL. It
 *    is not counted as zero stops. A workspace whose only feed serves a city
 *    four hundred miles away would otherwise have that feed's absence reported
 *    as a measurement of this corridor — the "0 crashes, therefore safe" failure
 *    wearing a transit jersey.
 *
 * 2. PARTIAL COVERAGE WITHHOLDS THE FREQUENCY SHARE, AND SCORES THAT HALF OF THE
 *    TERM AS ZERO. A share of frequent stops taken over the third of a study area
 *    a feed reaches is a fact about that third. Reporting it as the area's
 *    frequency would be the strongest single overstatement this module could
 *    make, because the covered part is almost always the urban part. But handing
 *    the unmeasured half BACK as density — which is what this did until it was
 *    caught — is a larger overstatement still, and an inverted one: it made a
 *    partial-coverage run score 6.45 points ABOVE a full-coverage run over the
 *    identical stops. An unmeasured half is not an earned one. See
 *    `accessibilityTransitTerm`.
 *
 * 3. AN EXPIRED FEED STILL ANSWERS AND STILL SCORES, and this is the rule most
 *    likely to be "corrected" by someone who has not thought it through. Three
 *    of four real Sacramento-area feeds measured on 2026-08-05 had already
 *    expired — SacRT's schedule ended 2025-04-05 — so refusing expired feeds
 *    would refuse most of the real data in the country. Worse, refusing is not
 *    neutral: an unobserved transit summary makes `computeAccessibility` DROP
 *    the transit term and rescale the remaining components upward, so an agency
 *    with a stale feed would score MORE accessible than one whose feed is
 *    current. The service window travels with the figures instead, on every
 *    contributing source, so a reader can see what the schedule described.
 *
 * ======================================================= THE TENANT BOUNDARY
 *
 * `gtfs_feeds.workspace_id IS NULL` means a PUBLIC PRELOADED feed shared by
 * every tenant on a deployment. A read that merely followed RLS would therefore
 * show a workspace a stranger's transit agency as its own, on a scorecard, with
 * nothing saying so. This adapter filters on the workspace explicitly and
 * DELIBERATELY EXCLUDES the public feeds: a corridor score that moved because an
 * operator preloaded somebody else's agency would move for a reason nobody in
 * the workspace could see, inspect, or undo. A workspace scores on the feeds it
 * chose to ingest.
 *
 * That is also why the service-role client here is not a shortcut around the
 * tenant boundary — the `.eq("workspace_id", …)` chain IS the access control,
 * and it is asserted rather than assumed in the tests.
 */

import {
  GTFS_FEED_COLUMNS,
  GTFS_FEED_VERSION_COLUMNS,
  gtfsCaveatContextFromVersionRow,
} from "@/lib/gtfs/route-projections";
import { filterToCurrentReadyVersion } from "@/lib/gtfs/persist";
import { selectGtfsCaveats } from "@/lib/gtfs/caveats";
import {
  DEFAULT_SERVICE_DAY_GROUPING_PROFILE,
  groupServiceDays,
  type ServiceDayGroup,
  type ServiceDayGroupingProfile,
} from "@/lib/gtfs/service-day-groups";
import { FREQUENT_SERVICE_HEADWAY_MINUTES } from "@/lib/gtfs/service-levels";
import type { GtfsServiceDayName, GtfsServiceLevel } from "@/lib/gtfs/types";
import type { StudyAreaBbox } from "@/lib/models/study-area";
import { bboxAreaSquareMiles, bboxContains, bboxesIntersect } from "./bbox";
import { gtfsServiceLevelMethod } from "./method";
import {
  classifyTransitAccessTier,
  type TransitAccessCore,
  type TransitAdapterOutcome,
  type TransitContributingSource,
  type TransitFetchContext,
  type TransitSourceAdapter,
} from "./types";

/* -------------------------------------------------------------------------- */
/* Projections — asserted on by name, because the clients are untyped           */
/* -------------------------------------------------------------------------- */

/**
 * What a corridor read asks of `gtfs_stop_service_levels`.
 *
 * NARROW ON PURPOSE. This projection is fetched for every stop-day inside the
 * study area, which is 18,141 rows for one mid-size agency's whole service area
 * (Sacramento Regional Transit, measured), so every column costs real bytes on
 * a serverless function. It carries exactly the fields `groupServiceDays` reads
 * plus the stop key, and `groupServiceDaysReadsOnlyTheseFields` in the tests
 * proves that set is still exactly right rather than merely believed to be.
 *
 * `geom` is deliberately absent, and asking for it would be a defect rather
 * than a waste: PostgREST serialises a PostGIS geometry as hex EWKB and nothing
 * in this repository parses it. A surface that needs stop geometry reads the
 * `gtfs_stops_map` view, which converts it in the database. A corridor score
 * needs no geometry at all — the bbox predicate is on the plain
 * latitude/longitude columns the geometry is generated FROM.
 */
export const GTFS_CORRIDOR_STOP_COLUMNS = [
  "stop_id",
  "service_day",
  "trips_per_day",
  "first_departure_seconds",
  "last_departure_seconds",
  "peak_headway_seconds",
  "peak_window_start_seconds",
].join(", ");

/* -------------------------------------------------------------------------- */
/* Bounds                                                                       */
/* -------------------------------------------------------------------------- */

/** Rows per PostgREST page. Supabase caps a single response near this anyway. */
const STOP_ROW_PAGE_SIZE = 1000;

/**
 * The most stop-day rows one corridor run will read from one feed version.
 *
 * A BOUND, NOT A BUDGET, and it is disclosed when it bites. 30,000 rows is
 * roughly 4,300 stops across a seven-day week — comfortably more than Sacramento
 * Regional Transit's ENTIRE service area (18,141 rows), so a corridor drawn
 * inside any ordinary study area is nowhere near it. What it stops is a planner
 * selecting a whole metropolitan county and a transit-rich feed turning one
 * screening request into a hundred round trips.
 *
 * When it bites, `truncated` is set and the summary says so, because a stop
 * count that silently stopped counting is a wrong number rather than a missing
 * one — and this one divides into a density that lands in a grant application.
 */
const STOP_ROW_CAP = 30_000;

const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;

/* -------------------------------------------------------------------------- */
/* Row shapes                                                                   */
/* -------------------------------------------------------------------------- */

type FeedRow = {
  id: string;
  agency_name?: string | null;
  city?: string | null;
  state?: string | null;
};

type VersionRow = {
  id: string;
  feed_id: string;
  service_end_date?: string | null;
  frequency_trip_count?: number | null;
  parse_warnings?: unknown;
  route_service_level_rows?: number | null;
};

type StopDayRow = {
  stop_id: string;
  service_day: string;
  trips_per_day: number | null;
  first_departure_seconds: number | null;
  last_departure_seconds: number | null;
  peak_headway_seconds: number | null;
  peak_window_start_seconds: number | null;
};

/**
 * The fields `groupServiceDays` reads off a service level, and nothing else.
 *
 * A NARROW TYPE RATHER THAN A FULL `GtfsServiceLevel`, because a full one cannot
 * be built honestly from a stored row: `peakHourDepartures` and
 * `frequentServiceTierMinutes` are DERIVATIONS the ingest never persisted, and
 * filling them with a reconstruction would put invented numbers into a typed
 * field that the rest of the product treats as measured.
 *
 * The widening at `asGroupableServiceLevels` is the one place this type meets
 * `groupServiceDays`, and a test drives that function through a recording proxy
 * to prove it reads no field outside this set. Without that test the widening
 * would be exactly the kind of cast that renders `undefined` on a page with the
 * suite green.
 */
export type GroupableStopServiceDay = {
  serviceDay: GtfsServiceDayName;
  tripsPerDay: number;
  firstDepartureSeconds: number | null;
  lastDepartureSeconds: number | null;
  peakHeadwayMinutes: number | null;
  frequentServiceTierMinutes: number | null;
  peakHour: number | null;
};

/** The keys above, as data, so the proxy test cannot drift from the type. */
export const GROUPABLE_SERVICE_LEVEL_FIELDS: readonly (keyof GroupableStopServiceDay)[] = [
  "serviceDay",
  "tripsPerDay",
  "firstDepartureSeconds",
  "lastDepartureSeconds",
  "peakHeadwayMinutes",
  "frequentServiceTierMinutes",
  "peakHour",
];

export function asGroupableServiceLevels(
  rows: readonly GroupableStopServiceDay[]
): readonly GtfsServiceLevel[] {
  return rows as unknown as readonly GtfsServiceLevel[];
}

/* -------------------------------------------------------------------------- */
/* Pure derivation                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The frequent-service tier a stored peak headway meets, or null.
 *
 * DERIVED AT READ TIME because there is no column for it: the tiers are a
 * reporting vocabulary, and storing one would freeze a feed's rows against the
 * tiers that existed on the day it was ingested. `FREQUENT_SERVICE_HEADWAY_MINUTES`
 * is imported rather than typed, so a jurisdiction with a different statutory
 * test changes one constant and not every call site.
 */
export function frequentServiceTierFor(peakHeadwayMinutes: number | null): number | null {
  if (peakHeadwayMinutes === null) return null;
  return peakHeadwayMinutes <= FREQUENT_SERVICE_HEADWAY_MINUTES
    ? FREQUENT_SERVICE_HEADWAY_MINUTES
    : null;
}

export function toGroupableServiceDay(row: StopDayRow): GroupableStopServiceDay {
  const peakHeadwayMinutes =
    row.peak_headway_seconds === null || row.peak_headway_seconds === undefined
      ? null
      : Math.round((row.peak_headway_seconds / SECONDS_PER_MINUTE) * 10) / 10;

  return {
    serviceDay: row.service_day as GtfsServiceDayName,
    tripsPerDay: row.trips_per_day ?? 0,
    firstDepartureSeconds: row.first_departure_seconds ?? null,
    lastDepartureSeconds: row.last_departure_seconds ?? null,
    peakHeadwayMinutes,
    frequentServiceTierMinutes: frequentServiceTierFor(peakHeadwayMinutes),
    peakHour:
      row.peak_window_start_seconds === null || row.peak_window_start_seconds === undefined
        ? null
        : Math.floor(row.peak_window_start_seconds / SECONDS_PER_HOUR),
  };
}

/**
 * The group of the week whose service a corridor screen is about.
 *
 * THE GROUP WITH THE MOST DAYS, not "the one called Weekday". The profile
 * registry exists because MONDAY-TO-FRIDAY IS A CONVENTION, NOT A FACT — the
 * Gulf states and Israel run a Sunday-to-Thursday workweek — and a call site
 * that reached for a group named "weekday" would work for the US profile and
 * silently pick a leisure day for the other one. The widest group is the
 * workweek in every profile that has one.
 *
 * Ties go to the first group, which is what makes this deterministic for
 * `EVERY_DAY_SEPARATELY`, where no group is wider than any other.
 */
export function representativeServiceGroup(profile: ServiceDayGroupingProfile): ServiceDayGroup {
  return profile.groups.reduce((widest, group) =>
    group.days.length > widest.days.length ? group : widest
  );
}

/**
 * How many of these stops meet the frequent-service headway on a representative
 * service day.
 *
 * The MEDIAN peak headway across the days present in the workweek group is the
 * test, not the best day. A stop that is 12-minute on Tuesday and hourly the
 * rest of the week is not a frequent-service stop, and `bestFrequentServiceTier`
 * would call it one.
 *
 * `stopsWithHeadway` IS NOT THE DENOMINATOR OF THE REPORTED SHARE, and used to
 * be. It is now only the test for whether a headway could be derived ANYWHERE —
 * a feed that yields none on the representative day has measured no frequency at
 * all, which is a different statement from "no stop is frequent". The share
 * itself is taken over every stop counted; see `summarizeContributions`.
 */
export function countFrequentStops(
  byStop: Map<string, GroupableStopServiceDay[]>,
  profile: ServiceDayGroupingProfile = DEFAULT_SERVICE_DAY_GROUPING_PROFILE
): { frequentStops: number; stopsWithHeadway: number } {
  const representative = representativeServiceGroup(profile);
  let frequentStops = 0;
  let stopsWithHeadway = 0;

  for (const rows of byStop.values()) {
    const summary = groupServiceDays(asGroupableServiceLevels(rows), profile).find(
      (entry) => entry.group.key === representative.key
    );
    const median = summary?.medianPeakHeadwayMinutes ?? null;
    if (median === null) continue;
    stopsWithHeadway += 1;
    if (median <= FREQUENT_SERVICE_HEADWAY_MINUTES) frequentStops += 1;
  }

  return { frequentStops, stopsWithHeadway };
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                        */
/* -------------------------------------------------------------------------- */

type StopExtent = StudyAreaBbox | null;

async function readFeedExtent(
  context: TransitFetchContext,
  versionId: string
): Promise<StopExtent> {
  // Four ordered single-row reads rather than one aggregate, because PostgREST
  // aggregate functions are disabled on a default Supabase project and a query
  // that works locally and 400s in production is worse than four cheap ones.
  // Each is an index seek on (feed_version_id, …) and returns one row.
  const bound = async (column: "latitude" | "longitude", ascending: boolean) => {
    const { data, error } = await context.client
      .from("gtfs_stop_service_levels")
      .select(column)
      .eq("workspace_id", context.workspaceId)
      .eq("feed_version_id", versionId)
      .order(column, { ascending })
      .limit(1);
    if (error) throw new Error(error.message);
    const row = (data as Array<Record<string, number>> | null)?.[0];
    const value = row?.[column];
    return typeof value === "number" ? value : null;
  };

  const [minLat, maxLat, minLon, maxLon] = await Promise.all([
    bound("latitude", true),
    bound("latitude", false),
    bound("longitude", true),
    bound("longitude", false),
  ]);

  if (minLat === null || maxLat === null || minLon === null || maxLon === null) return null;
  return { minLat, maxLat, minLon, maxLon };
}

async function readStopDaysInBbox(
  context: TransitFetchContext,
  versionId: string
): Promise<{ rows: StopDayRow[]; truncated: boolean }> {
  const rows: StopDayRow[] = [];
  let truncated = false;

  for (let offset = 0; offset < STOP_ROW_CAP; offset += STOP_ROW_PAGE_SIZE) {
    const { data, error } = await context.client
      .from("gtfs_stop_service_levels")
      .select(GTFS_CORRIDOR_STOP_COLUMNS)
      .eq("workspace_id", context.workspaceId)
      .eq("feed_version_id", versionId)
      .gte("latitude", context.bbox.minLat)
      .lte("latitude", context.bbox.maxLat)
      .gte("longitude", context.bbox.minLon)
      .lte("longitude", context.bbox.maxLon)
      // A stable order is what makes paging correct rather than merely usual:
      // without it PostgREST may return the same row on two pages and omit
      // another, which would move a stop count that nobody could reproduce.
      .order("stop_id", { ascending: true })
      .order("service_day", { ascending: true })
      .range(offset, offset + STOP_ROW_PAGE_SIZE - 1);

    if (error) throw new Error(error.message);
    const page = (data ?? []) as unknown as StopDayRow[];
    rows.push(...page);
    if (page.length < STOP_ROW_PAGE_SIZE) return { rows, truncated };
    if (rows.length >= STOP_ROW_CAP) truncated = true;
  }

  return { rows, truncated };
}

/* -------------------------------------------------------------------------- */
/* The adapter                                                                  */
/* -------------------------------------------------------------------------- */

type VersionContribution = {
  version: VersionRow;
  feed: FeedRow;
  extent: StudyAreaBbox;
  rows: StopDayRow[];
  truncated: boolean;
};

export const gtfsFeedAdapter: TransitSourceAdapter = {
  id: "gtfs-feed",
  label: "Ingested GTFS service levels",
  attribution: null,

  async fetch(context: TransitFetchContext): Promise<TransitAdapterOutcome> {
    const { data: feedData, error: feedError } = await context.client
      .from("gtfs_feeds")
      .select(GTFS_FEED_COLUMNS)
      // Both filters are the tenant boundary, not an optimisation. See header.
      .eq("workspace_id", context.workspaceId)
      .eq("is_active", true);

    if (feedError) {
      return { kind: "unavailable", reason: `Ingested transit feeds could not be read (${feedError.message}).` };
    }

    const feeds = (feedData ?? []) as unknown as FeedRow[];
    if (feeds.length === 0) {
      return { kind: "declined", reason: "This workspace has ingested no transit feed." };
    }

    const feedsById = new Map(feeds.map((feed) => [feed.id, feed]));

    const { data: versionData, error: versionError } = await filterToCurrentReadyVersion(
      context.client
        .from("gtfs_feed_versions")
        .select(GTFS_FEED_VERSION_COLUMNS)
        .eq("workspace_id", context.workspaceId)
        .in("feed_id", [...feedsById.keys()])
    );

    if (versionError) {
      return {
        kind: "unavailable",
        reason: `Ingested transit feeds could not be read (${versionError.message}).`,
      };
    }

    const versions = ((versionData ?? []) as unknown as VersionRow[]).filter((version) =>
      feedsById.has(version.feed_id)
    );

    if (versions.length === 0) {
      return {
        kind: "declined",
        reason: "No ingested transit feed in this workspace has finished loading.",
      };
    }

    // Every version is measured against the study area independently, because a
    // rider does not care who operates the bus and a region is normally served
    // by several agencies whose feeds are ingested separately.
    const measured = await Promise.all(
      versions.map(async (version): Promise<VersionContribution | null> => {
        const extent = await readFeedExtent(context, version.id);
        if (!extent || !bboxesIntersect(extent, context.bbox)) return null;
        const { rows, truncated } = await readStopDaysInBbox(context, version.id);
        return { version, feed: feedsById.get(version.feed_id)!, extent, rows, truncated };
      })
    );

    const contributions = measured.filter((entry): entry is VersionContribution => entry !== null);

    if (contributions.length === 0) {
      return {
        kind: "declined",
        reason:
          "No transit feed ingested by this workspace has stops anywhere near this study area, so none of " +
          "them can describe it.",
      };
    }

    return { kind: "answered", core: summarizeContributions(context.bbox, contributions) };
  },
};

/**
 * Turn the contributing feeds into one summary of the corridor.
 *
 * AGGREGATED ACROSS EVERY CONTRIBUTING FEED, because a rider standing on a
 * corner does not care who operates the bus. Stops are de-duplicated by
 * `(feedId, stopId)` and not by `stopId` alone: two agencies routinely publish
 * the same physical kerb under their own ids, and collapsing them would silently
 * delete one operator's service from the count. The consequence is that a shared
 * interchange counts twice, which overstates density slightly — the honest
 * alternative would be a spatial match with a tolerance nobody can justify, and
 * a wrong join here would delete real service rather than duplicate it.
 */
export function summarizeContributions(
  bbox: StudyAreaBbox,
  contributions: VersionContribution[]
): TransitAccessCore {
  const area = bboxAreaSquareMiles(bbox);

  const byStop = new Map<string, GroupableStopServiceDay[]>();
  for (const contribution of contributions) {
    for (const row of contribution.rows) {
      const key = `${contribution.version.feed_id}:${row.stop_id}`;
      const existing = byStop.get(key);
      const level = toGroupableServiceDay(row);
      if (existing) existing.push(level);
      else byStop.set(key, [level]);
    }
  }

  const totalStops = byStop.size;
  const stopsPerSqMile = Math.round((totalStops / area) * 10) / 10;
  const truncated = contributions.some((contribution) => contribution.truncated);

  // FULL means one feed's own stops span the whole study area. A union of
  // several feeds' rectangles covering it is NOT treated as full coverage, and
  // that is deliberate: a feed's stop bounding box already over-states where it
  // has service (it is a rectangle around a route network, not the network), and
  // stacking two over-statements to conclude "covered" is how a frequency share
  // taken over two city centres gets reported for the farmland between them.
  const covered = contributions.some((contribution) => bboxContains(contribution.extent, bbox));

  const { frequentStops, stopsWithHeadway } = countFrequentStops(byStop);

  // Three conditions, each of which alone makes a frequency share a claim about
  // something other than this study area: partial coverage, no derivable headway
  // anywhere, and a truncated read.
  const frequencyKnown = covered && stopsWithHeadway > 0 && !truncated;
  // THE DENOMINATOR IS EVERY STOP COUNTED, not the stops a headway could be
  // derived for. The narrative, the report table and the results-board tile all
  // present this as a share of the corridor's stops, and it used to be a share of
  // a smaller set none of them named — so a corridor with weekend-only stops
  // printed a sentence that was internally contradictory. A stop the feed
  // schedules whose representative service day yields no interval does not meet a
  // frequent-service headway, and counting it as not meeting it is also what
  // makes the share MONOTONE: measuring one more stop can raise it and can never
  // lower it.
  const frequentServiceShare = frequencyKnown ? frequentStops / totalStops : null;

  const contributingSources: TransitContributingSource[] = contributions.map((contribution) => ({
    id: contribution.feed.id,
    label:
      contribution.feed.agency_name?.trim() ||
      [contribution.feed.city, contribution.feed.state].filter(Boolean).join(", ") ||
      "Ingested feed",
    serviceEndDate: contribution.version.service_end_date ?? null,
  }));

  // The caveats every derived figure above must be shown with, unioned across
  // the contributing versions and de-duplicated. A caveat that applies to one
  // feed applies to the aggregate, because the aggregate contains it.
  const caveats = [
    ...new Set(
      contributions.flatMap((contribution) =>
        selectGtfsCaveats(gtfsCaveatContextFromVersionRow(contribution.version))
      )
    ),
  ];

  return {
    observed: true,
    totalStops,
    // GTFS records a mode on the route, not the stop. See `types.ts`.
    busStops: null,
    railStations: null,
    ferryStops: null,
    stopsPerSqMile,
    accessTier: classifyTransitAccessTier(stopsPerSqMile),
    source: "gtfs-feed",
    unavailableReason: null,
    // A published schedule ALWAYS has an opinion about how often service calls,
    // whether or not it can state one for this particular study area. That is
    // what stops a partial-coverage run being handed the frequency half of the
    // accessibility term for free — see `accessibilityTransitTerm`.
    measuresFrequency: true,
    frequentServiceShare,
    frequentServiceStops: frequencyKnown ? frequentStops : null,
    frequentServiceHeadwayMinutes: frequencyKnown ? FREQUENT_SERVICE_HEADWAY_MINUTES : null,
    truncated,
    method: gtfsServiceLevelMethod(frequencyKnown),
    contributingSources,
    caveats,
  };
}
