/**
 * What a map layer must say about its own completeness.
 *
 * Every `/api/map-features/*` route caps its result set. The cap was silent:
 * six routes carried an identical `TODO(pagination)` comment and a bare
 * `.limit(500)`, so a workspace with 600 projects saw 500 dots and no
 * indication that 100 were missing. A map that quietly omits a third of the
 * record is the same defect class as a data source that quietly returns
 * nothing — the viewer's honest conclusion ("this is everything") is wrong, and
 * nothing on screen contradicts it.
 *
 * Field names deliberately mirror `SafetyCrashQueryResponse`
 * (`src/lib/safety/client-types.ts`), which already got this right, so the two
 * read as one vocabulary rather than two conventions.
 *
 * PURE — no I/O, no clock.
 */

import {
  DEFAULT_SERVICE_DAY_GROUPING_PROFILE,
  type ServiceDayGroupingProfile,
} from "@/lib/gtfs/service-day-groups";
import type { GtfsServiceDayName } from "@/lib/gtfs/types";

/** How many features one `/api/map-features/*` response will carry. */
export const MAP_FEATURE_LAYER_LIMIT = 500;

/**
 * The same cap, lowered by an order of magnitude for boundary polygons.
 *
 * A project's stored area is a TIGERweb boundary, and a county one runs to tens
 * or hundreds of kilobytes even at the resolver's four-decimal precision — two
 * to three orders of magnitude heavier per feature than a point or a corridor
 * line. Five hundred of them is a payload no navigation should pull. The number
 * is derived from the shared cap rather than invented so the relationship stays
 * legible: areas are roughly ten times the weight, so ten times fewer are drawn,
 * and the truncation is disclosed by the same contract as every other layer.
 */
export const PROJECT_AREA_LAYER_LIMIT = MAP_FEATURE_LAYER_LIMIT / 10;

/**
 * The same cap, RAISED an order of magnitude for transit stops — the multiplier
 * goes the other way from `PROJECT_AREA_LAYER_LIMIT`, and both directions are
 * derived from what one feature weighs against how many of them a real record
 * holds.
 *
 * WHAT A STOP WEIGHS. A drawn stop is a point plus eight scalars — a name, a
 * feed id, a trip count, a headway, a tier, a routes-serving count and a short
 * route-id list — call it 300 bytes of JSON. A project AREA is a TIGERweb
 * boundary running to tens or hundreds of kilobytes. That is two to three
 * orders of magnitude, which is why fifty areas and five thousand stops are
 * comparable payloads, and why the stop layer is the LIGHTER of the two at ten
 * times the row count.
 *
 * WHY THE ROW COUNT HAD TO RISE ANYWAY, which is the real argument. The derived
 * grain is stop × service day, and this layer reads ONE service day, so the row
 * count is the agency's stop count. Sacramento Regional Transit's published
 * feed — a mid-size operator — has 2,821 stops (18,141 derived rows across the
 * week). At the shared 500 cap a planner would see 18% of a mid-size agency and
 * a truncation sentence on every load, which trains the reader to ignore the
 * sentence. At 5,000 that agency is drawn WHOLE and the sentence appears only
 * where it is genuinely load-bearing: a large multi-agency workspace, where a
 * subset really is all a single request should carry.
 *
 * IT IS DERIVED RATHER THAN TYPED so the relationship between the three caps
 * stays legible — one shared number, one layer that divides it, one that
 * multiplies it — and so raising the shared cap raises all three together.
 *
 * AND IT IS THE FIRST CAP IN THIS REPOSITORY THAT ONE REQUEST CANNOT SATISFY.
 * See `POSTGREST_MAX_ROWS_PER_REQUEST` below: a layer asking for more than that
 * gets silently truncated by the platform, so this one MUST be read in pages.
 * The sentence "that agency is drawn WHOLE" above is only true because the route
 * pages; asked for in one request it returned 1,000 of Sacramento's 2,821.
 */
export const TRANSIT_STOP_LAYER_LIMIT = MAP_FEATURE_LAYER_LIMIT * 10;

/**
 * WHAT ONE PostgREST REQUEST WILL RETURN, NO MATTER WHAT `.limit()` ASKS FOR.
 *
 * `supabase/config.toml` sets `max_rows = 1000` and the running container
 * carries `PGRST_DB_MAX_ROWS=1000`. The cap is applied by the SERVER, silently:
 * a query asking for 5,000 rows gets 1,000 and no error, no warning, and no
 * indication in the response that anything was withheld.
 *
 * HOW THIS WAS FOUND, because no test could have found it. Every map-layer test
 * in this repository drives a mocked Supabase client, which returns its fixture
 * regardless of what `.limit()` said — so the platform ceiling is invisible to
 * the entire suite by construction. It surfaced only by replaying the transit
 * route's real query against a real database with a real feed: the layer
 * declared a limit of 5,000, returned 1,000 of 2,821 matched stops, and reported
 * `limit: 5000` in a disclosure whose whole purpose is to tell a planner what
 * was left out. Same class as the hex-EWKB geometry trap — a mocked client
 * cannot see it, and it is only wrong against the real thing.
 *
 * IT IS NOT SAFE TO RAISE. `max_rows` is a GLOBAL PostgREST setting affecting
 * every route in the deployment, and a hosted Supabase project carries its own
 * value that this repository does not control. Raising it here would work
 * locally and truncate differently in production, which is worse than the bug —
 * a limit that varies by deployment is one no disclosure can state.
 *
 * The three older caps predate this discovery and are all under the ceiling
 * (500 and 50), which is exactly why nothing ever hit it.
 */
export const POSTGREST_MAX_ROWS_PER_REQUEST = 1000;

/**
 * Whether a layer's cap needs more than one round trip to satisfy.
 *
 * Exported so `src/test/map-layer-caps-are-reachable.test.ts` can assert the
 * relationship rather than restating either number, and so a future layer that
 * raises its cap past the ceiling is told at build time instead of shipping a
 * disclosure that names a limit the platform will not honour.
 */
export function layerLimitNeedsPaging(limit: number): boolean {
  return limit > POSTGREST_MAX_ROWS_PER_REQUEST;
}

/**
 * The one service day the transit stop layer draws, DERIVED from the active
 * grouping profile rather than typed as a day name.
 *
 * WHY ONE DAY AND NOT ALL SEVEN. The derived rows are stop × service day. Seven
 * days of a mid-size agency is 18,141 rows for 2,821 places, so drawing them
 * all would put six invisible duplicates under every dot and make "the 5,000
 * most-served stops" mean "the 700 busiest stops, seven times each". A map that
 * shows one dot per place has to pick a day, and picking one is a claim that
 * must be stated on the layer rather than assumed by the reader.
 *
 * WHY THE MIDDLE OF THE WORKWEEK. The first workweek day carries the observed
 * holidays (US federal holidays are overwhelmingly Mondays) and the last
 * carries reduced or early-release patterns; the middle day is what traffic
 * count and transit practice mean by "a typical weekday". Taking the middle of
 * the profile's workweek group also happens to be robust across the registry:
 * Monday-to-Friday yields Wednesday, Sunday-to-Thursday yields Tuesday, and a
 * Gulf agency never gets its busiest commute day reported as a weekend.
 *
 * THE FIRST GROUP IS THE WORKWEEK GROUP, by construction in
 * `service-day-groups.ts` — every profile in that registry orders the workweek
 * first. That is an assumption a new profile could break silently, so the
 * transit map layer's test asserts it holds for every registered profile.
 */
export function representativeWorkweekDay(
  profile: ServiceDayGroupingProfile,
): GtfsServiceDayName {
  const days = profile.groups[0]?.days ?? [];
  if (days.length === 0) {
    throw new Error(
      `Service day grouping profile "${profile.key}" has no workweek group, so the transit map ` +
        "layer cannot name the day it is drawing.",
    );
  }
  return days[Math.floor((days.length - 1) / 2)];
}

/** The day `/api/map-features/transit` reads, and the day its copy names. */
export const TRANSIT_MAP_SERVICE_DAY = representativeWorkweekDay(
  DEFAULT_SERVICE_DAY_GROUPING_PROFILE,
);

export type MapLayerKey =
  | "projects"
  | "projectAreas"
  | "rtp"
  | "corridors"
  | "engagement"
  | "aerial"
  | "equity"
  | "crashes"
  | "transit";

/** The counts that keep a map layer honest. */
export type MapLayerDisclosure = {
  /** Features this response actually carries — what the map draws. */
  returnedCount: number;
  /** Rows matching this layer's scope in the database. */
  matchedCount: number;
  /** Rows fetched but not drawable (unusable geometry/coordinates). */
  droppedCount: number;
  /** True when the map is a subset of what matched. */
  truncated: boolean;
  limit: number;
};

/**
 * A GeoJSON FeatureCollection carrying its own disclosure.
 *
 * Intersected rather than wrapped, so `map.addSource({ data })` still takes the
 * payload directly — GeoJSON foreign members are legal and Mapbox ignores them.
 */
export type MapLayerFeatureCollection<F> = {
  type: "FeatureCollection";
  features: F[];
} & MapLayerDisclosure;

export function buildMapLayerDisclosure(input: {
  returnedCount: number;
  droppedCount: number;
  /** PostgREST's exact count, or null when it was not requested/available. */
  matchedCount: number | null | undefined;
  limit?: number;
}): MapLayerDisclosure {
  const limit = input.limit ?? MAP_FEATURE_LAYER_LIMIT;
  const fetched = input.returnedCount + input.droppedCount;
  const matchedCount =
    typeof input.matchedCount === "number" && Number.isFinite(input.matchedCount)
      ? input.matchedCount
      : fetched;

  return {
    returnedCount: input.returnedCount,
    matchedCount,
    droppedCount: input.droppedCount,
    truncated: fetched < matchedCount,
    limit,
  };
}

const LAYER_NOUNS: Record<MapLayerKey, { singular: string; plural: string }> = {
  projects: { singular: "project", plural: "projects" },
  projectAreas: { singular: "project area", plural: "project areas" },
  rtp: { singular: "RTP cycle", plural: "RTP cycles" },
  corridors: { singular: "study corridor", plural: "study corridors" },
  engagement: { singular: "engagement pin", plural: "engagement pins" },
  aerial: { singular: "aerial mission", plural: "aerial missions" },
  equity: { singular: "census tract", plural: "census tracts" },
  // Present so a FAILED crash fetch has a sentence. Everything the crash layer
  // says when it succeeds comes from `describeCrashLayerCoverage`, which knows
  // about source coverage and acquisition history — facts this generic
  // vocabulary cannot express, and without which an empty layer reads as
  // "no crashes here".
  crashes: { singular: "crash", plural: "crashes" },
  // Present so a FAILED transit fetch has a sentence, and for the undrawable-row
  // sentence. The TRUNCATION sentence is deliberately NOT taken from here: the
  // generic wording ("the rest are not drawn") says nothing about WHICH rows
  // were dropped, and this layer's whole cap is only honest because it orders by
  // trips first. `/api/map-features/transit` builds that sentence itself and
  // sends it as a coverage note, exactly as the crash layer does.
  transit: { singular: "transit stop", plural: "transit stops" },
};

/**
 * The sentences a viewer needs for one layer.
 *
 * Returns a list rather than a string: a layer can be BOTH truncated and
 * carrying undrawable rows, and appending the second to the first would let a
 * non-truncated layer hide its drops entirely.
 */
export function describeMapLayerCoverage(
  key: MapLayerKey,
  disclosure: MapLayerDisclosure
): string[] {
  const notes: string[] = [];
  const noun = LAYER_NOUNS[key];

  if (disclosure.truncated) {
    notes.push(
      `${noun.plural[0].toUpperCase()}${noun.plural.slice(1)}: showing ` +
        `${disclosure.returnedCount.toLocaleString()} of ${disclosure.matchedCount.toLocaleString()} — ` +
        `the map draws at most ${disclosure.limit.toLocaleString()}. The rest are not drawn, which is not ` +
        `a finding that they do not exist.`
    );
  }

  if (disclosure.droppedCount > 0) {
    const count = disclosure.droppedCount;
    notes.push(
      `${noun.plural[0].toUpperCase()}${noun.plural.slice(1)}: ${count.toLocaleString()} ` +
        `${count === 1 ? noun.singular : noun.plural} could not be drawn because the stored location was ` +
        `unusable, so ${count === 1 ? "it is" : "they are"} missing from the map rather than absent from ` +
        `the record.`
    );
  }

  return notes;
}

/** A layer whose fetch failed outright — distinct from one that came back empty. */
export function describeMapLayerFailure(key: MapLayerKey): string {
  const noun = LAYER_NOUNS[key];
  return (
    `${noun.plural[0].toUpperCase()}${noun.plural.slice(1)}: this layer could not be loaded, so nothing ` +
    `is drawn for it. That is not a finding that there are none here.`
  );
}
