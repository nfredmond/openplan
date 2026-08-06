import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import {
  buildMapLayerDisclosure,
  POSTGREST_MAX_ROWS_PER_REQUEST,
  TRANSIT_MAP_SERVICE_DAY,
  TRANSIT_STOP_LAYER_LIMIT,
} from "@/lib/cartographic/layer-disclosure";
import { filterToCurrentReadyVersion } from "@/lib/gtfs/persist";
import {
  GTFS_FEED_VERSION_COLUMNS,
  gtfsCaveatContextFromVersionRow,
} from "@/lib/gtfs/route-projections";
import { selectGtfsCaveats, type GtfsCaveatContext } from "@/lib/gtfs/caveats";
import {
  BASIC_SERVICE_HEADWAY_MINUTES,
  FREQUENT_SERVICE_HEADWAY_MINUTES,
} from "@/lib/gtfs/service-levels";

/**
 * WHERE TRANSIT STOPS, AS A SHARED MAP LAYER — and nothing about when.
 *
 * WHAT IS DRAWN AND WHAT IS DELIBERATELY ABSENT. Stops only. There are no route
 * lines and there is not going to be one from this route: an alignment comes
 * from `shapes.txt`, which this product does not parse at all — every ingested
 * version records `shapes_status = 'not_ingested'` — so a line drawn here would
 * either be invented or be a straight hop between consecutive stops, which is a
 * picture of a road network nobody built. A missing layer is recoverable; a
 * plausible wrong alignment on a planner's screen is not, because nothing on
 * the map says it was guessed. The layer's own label says stops, so the absence
 * is stated rather than left as a gap a reader fills in.
 *
 * ONE SERVICE DAY, NAMED. The derived table's grain is stop × service day, so a
 * feed contributes about seven rows per place. Drawing them all would put six
 * invisible duplicates under every dot and would silently redefine the cap:
 * "the 5,000 most-served stops" would mean "the 700 busiest stops, seven times
 * each". `TRANSIT_MAP_SERVICE_DAY` picks the middle of the active grouping
 * profile's workweek group — see its own reasoning — and every sentence this
 * route writes names the day rather than leaving the reader to assume one.
 *
 * WHY THE ORDER IS PART OF THE HONESTY, NOT A PREFERENCE. This layer is capped,
 * and the only sentence a capped layer can honestly offer is one that says what
 * was left out. "The 5,000 most-served of 12,400" is a FACT when the query
 * sorts by trips descending and a FALSEHOOD under any other order — under a
 * uuid-ordered scatter the undrawn rows are an arbitrary sample, and telling a
 * planner they are the quiet ones would be an invention. So `trips_per_day
 * DESC` is load-bearing: change it and the coverage sentence below stops being
 * true, without anything else changing shape.
 *
 * WHY IT READS `gtfs_stops_map` AND NOT `gtfs_stop_service_levels`. supabase-js
 * cannot read a PostGIS geometry — PostgREST serialises `geom` as hex EWKB and
 * nothing in this repository parses it. A route selecting `geom` directly gets
 * a string with no error anywhere, and a fully ingested feed renders as "0
 * drawn, 2,821 could not be drawn", which a planner reads as a finding about
 * their DATA rather than about this query. The view (20260805000006) converts
 * once, in the database, and runs as its invoker so it is not a way around RLS.
 *
 * WHY THE WORKSPACE FILTER IS EXPLICIT RATHER THAN LEFT TO RLS. A feed row with
 * `workspace_id IS NULL` is a PUBLIC preloaded feed shared by every tenant on
 * the deployment, and the read policies allow it on purpose. A read that merely
 * followed RLS would therefore draw a stranger's transit agency inside this
 * workspace's map with nothing distinguishing it from the workspace's own
 * record. Every read below names the workspace. Preloaded feeds are counted and
 * DISCLOSED instead of being silently absent, because "the map is empty" and
 * "the map is empty of things that are yours" are different sentences and only
 * the second one is true.
 *
 * WHAT AN EMPTY LAYER MEANS, which is four different things and only one of them
 * is a finding about transit: this workspace has ingested no feed of its own; it
 * has feeds but none with a completed ingest in use; its ingests are in use but
 * derived no stop for the day being drawn; or the feeds genuinely have no stops.
 * The coverage notes say which, every time, in the same shape the crash layer
 * uses and for the same reason.
 */

/**
 * What the map asks the view for.
 *
 * WRITTEN OUT HERE RATHER THAN IMPORTED because `route-projections.ts` holds the
 * projections SHARED between the transit routes, and this is the only reader of
 * `gtfs_stops_map` in the product. What it must not become is a `select("*")`:
 * the view carries `first_departure_seconds`, `last_departure_seconds` and
 * `median_headway_seconds`, and the first two are the closest thing in this
 * schema to a departure time. They are not asked for, so they cannot reach a
 * browser, so no future popup can quietly start printing one.
 *
 * The clients are deliberately untyped, so this string is never checked against
 * the view — a column typo renders `undefined` with the suite green. The route's
 * test asserts on the string itself, which is the only thing that catches it.
 */
const TRANSIT_STOP_COLUMNS = [
  "id",
  "feed_version_id",
  "stop_id",
  "stop_name",
  "geometry_geojson",
  "service_day",
  "trips_per_day",
  "peak_headway_seconds",
  "routes_serving",
  "route_ids",
].join(", ");

/** Identity and service window; the map never needs the whole feed row. */
const TRANSIT_FEED_COLUMNS = "id, agency_name, is_active, status";

/**
 * How many route ids travel with one stop.
 *
 * `routes_serving` carries the TRUE count, so the popup can always say "served
 * by 14 routes" even when it lists eight of them. The cap exists because a
 * downtown transit centre can be served by dozens and this payload is five
 * thousand features wide; a list nobody reads past the first line is not worth
 * a kilobyte per stop.
 */
const ROUTE_IDS_PER_STOP = 8;

type TransitFeedRow = {
  id: string;
  agency_name: string | null;
  is_active: boolean | null;
  status: string | null;
};

type TransitVersionRow = {
  id: string;
  feed_id: string;
  service_start_date: string | null;
  service_end_date: string | null;
  frequency_trip_count?: number | null;
  parse_warnings?: unknown;
  route_service_level_rows?: number | null;
};

type TransitStopRow = {
  id: string;
  feed_version_id: string;
  stop_id: string | null;
  stop_name: string | null;
  geometry_geojson: unknown;
  service_day: string | null;
  trips_per_day: number | string | null;
  peak_headway_seconds: number | string | null;
  routes_serving: number | string | null;
  route_ids: unknown;
};

function coerceInt(value: unknown): number {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : 0;
}

function coerceOptionalInt(value: unknown): number | null {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * The drawn point, or `null` when the view handed back something that is not
 * one.
 *
 * `geom` is a generated column over NOT NULL coordinates, so this should never
 * fire — which is exactly why it is checked rather than trusted. The failure
 * mode it guards is not bad data but a WRONG QUERY: selecting `geom` instead of
 * `geometry_geojson` returns a hex EWKB string for every row, and without this
 * check that string would be handed to Mapbox as a geometry. Returning null
 * makes those rows count as dropped, which the disclosure states.
 */
function pointFrom(value: unknown): [number, number] | null {
  if (!value || typeof value !== "object") return null;
  const geometry = value as { type?: unknown; coordinates?: unknown };
  if (geometry.type !== "Point") return null;
  if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2) return null;
  const [lon, lat] = geometry.coordinates;
  if (typeof lon !== "number" || typeof lat !== "number") return null;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
  return [lon, lat];
}

function routeIdsFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    .slice(0, ROUTE_IDS_PER_STOP);
}

/**
 * The frequent-service tier a headway meets, or `null` when none of them does.
 *
 * Derived HERE rather than in the browser so the map and any future report
 * cannot tier the same stop differently, and expressed through the shared
 * constants so neither tier is ever a literal in a comparison. `null` is the
 * honest answer for a stop with no derivable peak headway — a single daily trip
 * has no interval — and the map paints it in the neutral colour rather than
 * borrowing the wider tier's meaning.
 */
function serviceTierMinutes(headwayMinutes: number | null): number | null {
  if (headwayMinutes === null) return null;
  if (headwayMinutes <= FREQUENT_SERVICE_HEADWAY_MINUTES) return FREQUENT_SERVICE_HEADWAY_MINUTES;
  if (headwayMinutes <= BASIC_SERVICE_HEADWAY_MINUTES) return BASIC_SERVICE_HEADWAY_MINUTES;
  return null;
}

/** `wednesday` -> `Wednesday`, for a sentence rather than a column name. */
function dayLabel(day: string): string {
  return day.charAt(0).toUpperCase() + day.slice(1);
}

/**
 * The sentence a preloaded feed earns, and the reason it is worth a query.
 *
 * A deployment can carry public feeds that every tenant reads. This layer draws
 * none of them, deliberately — see the header — and the failure mode of that
 * decision is a planner staring at an empty map on a deployment whose Data Hub
 * plainly lists a transit agency. Saying so costs one count-only read.
 */
function publicFeedNote(count: number): string[] {
  if (count <= 0) return [];
  return [
    `Transit stops: ${count.toLocaleString()} preloaded transit ${count === 1 ? "feed is" : "feeds are"} ` +
      "shared across this deployment and are not drawn here, because this layer shows only the feeds this " +
      "workspace brought in itself.",
  ];
}

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("map-features.transit", request);
  const startedAt = Date.now();
  const serviceDay = TRANSIT_MAP_SERVICE_DAY;

  /** The empty answer, shaped like the full one so a client never branches. */
  const emptyLayer = (coverageNotes: string[]) => ({
    type: "FeatureCollection" as const,
    features: [] as never[],
    ...buildMapLayerDisclosure({
      returnedCount: 0,
      droppedCount: 0,
      matchedCount: 0,
      limit: TRANSIT_STOP_LAYER_LIMIT,
    }),
    serviceDay,
    serviceDayLabel: dayLabel(serviceDay),
    feeds: [] as never[],
    caveats: [] as string[],
    coverageNotes,
  });

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { membership } = await loadCurrentWorkspaceMembership(supabase, user.id);

    if (!membership) {
      return NextResponse.json(
        emptyLayer([
          "Transit stops: this session is not in a workspace, so no feed can be read for it. That is not a " +
            "finding that no transit serves this area.",
        ]),
        { status: 200 },
      );
    }

    const workspaceId = membership.workspace_id;

    // The workspace's OWN feeds, and — separately — how many preloaded feeds
    // this deployment shares. Two queries rather than one `.or()` on purpose:
    // an `.or()` matching the workspace OR null is the shape that lets a
    // stranger's agency into a tenant's map, and it would be a one-token edit
    // away from doing exactly that.
    const [feedResult, publicFeedResult] = await Promise.all([
      supabase
        .from("gtfs_feeds")
        .select(TRANSIT_FEED_COLUMNS)
        .eq("workspace_id", workspaceId)
        .eq("is_active", true),
      supabase
        .from("gtfs_feeds")
        .select("id", { count: "exact", head: true })
        .is("workspace_id", null)
        .eq("is_active", true),
    ]);

    // Both are fatal to the LAYER, not merely to its copy. A failed read that
    // renders as an empty map has told the planner their workspace has no
    // transit, and by then the error is gone — the 200 would be the last place
    // the truth existed.
    const feedFailure =
      classifyRouteReadFailure("this workspace's transit feeds", feedResult, {
        pendingError: "Transit feed schema is not available yet",
      }) ??
      classifyRouteReadFailure("the deployment's preloaded transit feeds", publicFeedResult, {
        pendingError: "Transit feed schema is not available yet",
      });
    if (feedFailure) {
      audit.error("transit_layer_feed_read_failed", {
        workspaceId,
        message: feedFailure.message,
      });
      return NextResponse.json(feedFailure.body, { status: feedFailure.status });
    }

    const feeds = (feedResult.data ?? []) as unknown as TransitFeedRow[];
    const publicFeedCount = typeof publicFeedResult.count === "number" ? publicFeedResult.count : 0;
    const publicNotes = publicFeedNote(publicFeedCount);

    if (feeds.length === 0) {
      audit.info("transit_layer_loaded", {
        workspaceId,
        count: 0,
        matchedCount: 0,
        droppedCount: 0,
        feedCount: 0,
        versionCount: 0,
        serviceDay,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json(
        emptyLayer([
          "Transit stops: this workspace has not brought in a transit feed of its own, so nothing is drawn. " +
            "That is not a finding that no transit serves this area.",
          ...publicNotes,
        ]),
        { status: 200 },
      );
    }

    // The version each feed is actually analysed with. `filterToCurrentReadyVersion`
    // applies BOTH halves of that predicate in one place: `is_current` alone
    // would read a version that failed after being promoted as though it were
    // service data, and `status = 'ready'` alone would give a workspace with
    // three successful ingests three times its real stops.
    const feedIds = feeds.map((feed) => feed.id);
    const versionResult = await filterToCurrentReadyVersion(
      supabase
        .from("gtfs_feed_versions")
        .select(GTFS_FEED_VERSION_COLUMNS)
        .eq("workspace_id", workspaceId)
        .in("feed_id", feedIds),
    );

    const versionFailure = classifyRouteReadFailure(
      "the transit feed versions in use",
      versionResult,
      { pendingError: "Transit feed schema is not available yet" },
    );
    if (versionFailure) {
      audit.error("transit_layer_version_read_failed", {
        workspaceId,
        message: versionFailure.message,
      });
      return NextResponse.json(versionFailure.body, { status: versionFailure.status });
    }

    const versions = (versionResult.data ?? []) as unknown as TransitVersionRow[];

    if (versions.length === 0) {
      audit.info("transit_layer_loaded", {
        workspaceId,
        count: 0,
        matchedCount: 0,
        droppedCount: 0,
        feedCount: feeds.length,
        versionCount: 0,
        serviceDay,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json(
        emptyLayer([
          `Transit stops: ${feeds.length.toLocaleString()} transit ` +
            `${feeds.length === 1 ? "feed belongs" : "feeds belong"} to this workspace, and none of them has a ` +
            "completed ingest in use, so nothing is drawn. Bring a feed in from the Data Hub, or open it there " +
            "to see why its last ingest did not finish.",
          ...publicNotes,
        ]),
        { status: 200 },
      );
    }

    const versionIds = versions.map((version) => version.id);
    const feedById = new Map(feeds.map((feed) => [feed.id, feed]));
    // Version -> feed, resolved once. A stop row names its VERSION, and the
    // agency name a popup shows lives on the FEED; walking that hop per row
    // across five thousand features would be the map's own inner loop.
    const feedByVersionId = new Map(
      versions.map((version) => [version.id, feedById.get(version.feed_id) ?? null]),
    );

    // READ IN PAGES, BECAUSE ONE REQUEST CANNOT SATISFY THIS LAYER'S CAP.
    //
    // PostgREST returns at most `POSTGREST_MAX_ROWS_PER_REQUEST` rows however
    // large a `.limit()` it is handed — silently, with no error and nothing in
    // the response saying rows were withheld. `TRANSIT_STOP_LAYER_LIMIT` is
    // 5,000, so a single request returned 1,000 of Sacramento's 2,821 stops
    // while the disclosure went on reporting a limit of 5,000. That is a false
    // statement on the one surface whose entire job is saying what was left out,
    // and it defeats the measured argument for the cap — "a mid-size agency is
    // drawn whole" is only true if the whole agency actually arrives.
    //
    // `count: "exact"` rides the FIRST page so the disclosure and the drawn
    // features come from one filter rather than two, and the ordering is what
    // makes the truncation sentence a fact rather than a guess about a
    // uuid-ordered scatter — so every page must carry the same ordering, which
    // is why the whole query is rebuilt per page rather than reusing a builder.
    // THE `Math.min` IS DEFENSIVE AND IS CURRENTLY UNOBSERVABLE — said plainly
    // rather than left as an implied guarantee. `TRANSIT_STOP_LAYER_LIMIT`
    // (5,000) is an exact multiple of `POSTGREST_MAX_ROWS_PER_REQUEST` (1,000),
    // so the loop always lands squarely on the cap and a page can never reach
    // past it; removing this clamp changes nothing today, and a mutation
    // confirmed the test suite cannot tell the difference. It stays because the
    // moment either constant stops dividing evenly — a shared cap raised to 750,
    // a platform ceiling of 500 — the final page would read beyond the limit the
    // disclosure names, which is the exact class of quiet overrun this whole
    // change exists to remove.
    const pageOf = (offset: number) =>
      supabase
        .from("gtfs_stops_map")
        .select(TRANSIT_STOP_COLUMNS, offset === 0 ? { count: "exact" } : undefined)
        .eq("workspace_id", workspaceId)
        .in("feed_version_id", versionIds)
        .eq("service_day", serviceDay)
        .order("trips_per_day", { ascending: false })
        .order("id", { ascending: true })
        .range(offset, Math.min(offset + POSTGREST_MAX_ROWS_PER_REQUEST, TRANSIT_STOP_LAYER_LIMIT) - 1);

    const firstPage = await pageOf(0);
    const stopResult: {
      data: unknown[] | null;
      error: typeof firstPage.error;
      count: number | null;
      status?: number;
    } = {
      data: firstPage.data ? [...firstPage.data] : firstPage.data,
      error: firstPage.error,
      count: firstPage.count ?? null,
      status: firstPage.status,
    };

    if (!firstPage.error) {
      let fetched = firstPage.data?.length ?? 0;
      // Stop as soon as a page comes back short: that is the end of the result
      // set, and asking again would be a round trip whose answer is known.
      while (
        fetched >= POSTGREST_MAX_ROWS_PER_REQUEST &&
        fetched < TRANSIT_STOP_LAYER_LIMIT &&
        (stopResult.count === null || fetched < stopResult.count)
      ) {
        const next = await pageOf(fetched);
        if (next.error) {
          stopResult.error = next.error;
          break;
        }
        const rows = next.data ?? [];
        if (rows.length === 0) break;
        (stopResult.data as unknown[]).push(...rows);
        fetched += rows.length;
      }
    }

    const stopFailure = classifyRouteReadFailure("transit stops", stopResult, {
      pendingError: "Transit stop schema is not available yet",
    });
    if (stopFailure) {
      audit.error("transit_layer_stop_read_failed", {
        workspaceId,
        message: stopFailure.message,
      });
      return NextResponse.json(stopFailure.body, { status: stopFailure.status });
    }

    const stopRows = (stopResult.data ?? []) as unknown as TransitStopRow[];

    const features = stopRows.flatMap((row) => {
      const coordinates = pointFrom(row.geometry_geojson);
      if (!coordinates) return [];
      const headwaySeconds = coerceOptionalInt(row.peak_headway_seconds);
      const peakHeadwayMinutes = headwaySeconds === null ? null : Math.round(headwaySeconds / 60);
      const feed = feedByVersionId.get(row.feed_version_id) ?? null;
      return [
        {
          type: "Feature" as const,
          id: row.id,
          geometry: { type: "Point" as const, coordinates },
          properties: {
            kind: "transit_stop",
            stopRowId: row.id,
            feedId: feed?.id ?? null,
            feedVersionId: row.feed_version_id,
            stopCode: row.stop_id ?? "",
            stopName: row.stop_name ?? "",
            agencyName: feed?.agency_name ?? "",
            serviceDay: row.service_day ?? serviceDay,
            tripsPerDay: coerceInt(row.trips_per_day),
            peakHeadwayMinutes,
            serviceTierMinutes: serviceTierMinutes(peakHeadwayMinutes),
            routesServing: coerceInt(row.routes_serving),
            routeIds: routeIdsFrom(row.route_ids),
          },
        },
      ];
    });

    const matchedCount =
      typeof stopResult.count === "number" && Number.isFinite(stopResult.count)
        ? stopResult.count
        : stopRows.length;
    const droppedCount = stopRows.length - features.length;
    const disclosure = buildMapLayerDisclosure({
      returnedCount: features.length,
      droppedCount,
      matchedCount: stopResult.count,
      limit: TRANSIT_STOP_LAYER_LIMIT,
    });

    /**
     * THE CAVEATS THAT QUALIFY EVERY NUMBER ABOVE, merged across the versions
     * being drawn.
     *
     * Merged rather than reported per feed because they attach to figures a
     * planner reads off ONE map: a headway on a Sacramento stop and a headway on
     * a neighbouring operator's stop sit side by side, and a caveat that applies
     * to one of them applies to what the reader is comparing. Overstating which
     * caveats apply is the safe direction; understating them is how an
     * unqualified number gets quoted in a plan.
     *
     * `showsFrequentServiceTier` is true whenever a stop is drawn, because the
     * MAP itself paints the tier — that claim is on screen whether or not any
     * stored row would have implied it.
     */
    const versionContexts = versions.map(gtfsCaveatContextFromVersionRow);
    const caveatContext: GtfsCaveatContext = {
      usesFrequencies: versionContexts.some((context) => context.usesFrequencies),
      stopTimesWithoutTime: versionContexts.reduce((sum, c) => sum + c.stopTimesWithoutTime, 0),
      departuresBeyondBinRange: versionContexts.reduce((sum, c) => sum + c.departuresBeyondBinRange, 0),
      danglingReferences: versionContexts.reduce((sum, c) => sum + c.danglingReferences, 0),
      showsFrequentServiceTier: features.length > 0,
    };
    const caveats = features.length > 0 ? selectGtfsCaveats(caveatContext) : [];

    const coverageNotes: string[] = [];

    if (features.length > 0) {
      coverageNotes.push(
        `Transit stops: derived from ${versions.length.toLocaleString()} ingested transit ` +
          `${versions.length === 1 ? "feed" : "feeds"}, for one representative ` +
          `${dayLabel(serviceDay)} of service. Each dot is a place where something stops that day, and how ` +
          "often — a planning figure, not a timetable.",
      );
    } else {
      coverageNotes.push(
        `Transit stops: the ${versions.length === 1 ? "feed" : "feeds"} in use derived no stop for a ` +
          `${dayLabel(serviceDay)}, so nothing is drawn. That can mean the schedule inside them runs on other ` +
          "days only; it is not a finding that no transit serves this area.",
      );
    }

    /**
     * THE TRUNCATION SENTENCE, and the reason it is written here rather than
     * taken from `describeMapLayerCoverage`.
     *
     * The shared sentence says "the rest are not drawn", which is true of every
     * capped layer and useful on none of them. This layer can say something
     * stronger and much more actionable — the undrawn rows are the QUIETEST
     * stops — and it can only say it because the query above sorts by trips
     * descending. The two are one change: if that order is ever removed, this
     * sentence becomes a plain falsehood, which is why the route's test asserts
     * the order and the sentence together.
     */
    if (disclosure.truncated) {
      coverageNotes.push(
        `Transit stops: showing the ${disclosure.returnedCount.toLocaleString()} most-served of ` +
          `${disclosure.matchedCount.toLocaleString()} — the map draws at most ` +
          `${disclosure.limit.toLocaleString()}, taking them in order of how many trips call there on a ` +
          `${dayLabel(serviceDay)}. The ones not drawn are the least-served stops in these feeds, not stops ` +
          "that do not exist.",
      );
    }

    if (droppedCount > 0) {
      coverageNotes.push(
        `Transit stops: ${droppedCount.toLocaleString()} ${droppedCount === 1 ? "stop" : "stops"} could not ` +
          `be drawn because the stored location was unusable, so ${droppedCount === 1 ? "it is" : "they are"} ` +
          "missing from the map rather than absent from the record.",
      );
    }

    /**
     * A SCHEDULE THAT HAS STOPPED RUNNING IS STILL A FACT, BUT A DIFFERENT ONE.
     *
     * `gtfs_feeds.status = 'loaded'` describes the INGEST and says nothing about
     * whether the service inside it still runs. On real published feeds it often
     * does not — three of four Sacramento-area feeds measured on 2026-08-05 had
     * already expired, one of them sixteen months earlier. A headway drawn
     * without this reads as current service; the same headway beside the date it
     * ended is a historic fact, which is a different sentence entirely.
     */
    const today = new Date().toISOString().slice(0, 10);
    const expired = versions.filter(
      (version) => typeof version.service_end_date === "string" && version.service_end_date < today,
    );
    if (expired.length > 0 && features.length > 0) {
      const named = expired
        .map((version) => {
          const agency = feedById.get(version.feed_id)?.agency_name;
          return `${agency && agency.length > 0 ? agency : "an ingested feed"} through ${version.service_end_date}`;
        })
        .join("; ");
      coverageNotes.push(
        `Transit stops: the service window inside ${expired.length === 1 ? "one feed has" : `${expired.length} feeds have`} ` +
          `already ended (${named}). Those dots are historic service levels, not service running today.`,
      );
    }

    coverageNotes.push(...publicNotes);
    coverageNotes.push(...caveats);

    audit.info("transit_layer_loaded", {
      workspaceId,
      count: features.length,
      matchedCount,
      droppedCount,
      feedCount: feeds.length,
      versionCount: versions.length,
      expiredVersionCount: expired.length,
      publicFeedCount,
      serviceDay,
      truncated: disclosure.truncated,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        type: "FeatureCollection" as const,
        features,
        ...disclosure,
        serviceDay,
        serviceDayLabel: dayLabel(serviceDay),
        feeds: versions.map((version) => ({
          feedId: version.feed_id,
          feedVersionId: version.id,
          agencyName: feedById.get(version.feed_id)?.agency_name ?? "",
          serviceStartDate: version.service_start_date ?? null,
          serviceEndDate: version.service_end_date ?? null,
        })),
        caveats,
        coverageNotes,
      },
      { status: 200 },
    );
  } catch (error) {
    audit.error("transit_layer_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json(
      { error: "Unexpected error while loading transit stops" },
      { status: 500 },
    );
  }
}
