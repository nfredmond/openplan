/**
 * Place resolver — turns a typed place name (city, CDP, county, or metro/micro
 * area) into an official Census TIGERweb boundary polygon usable as a model
 * study area (`corridor_geojson`). This is the "type a place, run it anywhere"
 * front door: no place is hardcoded, every US geography resolves the same way.
 *
 * Search hits the TIGERweb `tigerWMS_Current` layers by clean BASENAME; boundary
 * resolution fetches a single feature by GEOID as generalized WGS84 GeoJSON.
 * Counties reuse the existing `searchUsCounties` catalog so we don't duplicate it.
 *
 * All functions are server-side (they use the shared cached fetcher). The pure
 * URL/parse/score helpers are exported for unit testing without network.
 */
import { fetchJsonWithRetry } from "@/lib/data-sources/http";
import { bboxFromGeojson } from "@/lib/data-sources/census";
import { corridorGeojsonSchema, type CorridorGeojson } from "@/lib/models/run-launch";
import { searchUsCounties } from "@/lib/geographies/us-counties";
import { splitStateQualifier, splitTrailingStateWords, stateUspsFromFips } from "@/lib/geographies/state-fips";
import type { PlaceKind } from "@/lib/api/place-geographies";

export type { PlaceKind } from "@/lib/api/place-geographies";

const TIGERWEB_ROOT = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb";
const TIGERWEB_BASE = `${TIGERWEB_ROOT}/tigerWMS_Current/MapServer`;

/**
 * The 2020 Census vintage, consulted ONLY for population.
 *
 * WHY A SECOND SERVICE. Ranking same-named places needs population, and
 * `tigerWMS_Current` does not carry it: its county/place/CDP layers have no
 * POP100 field at all, and its CBSA layers have the field but leave every value
 * null. `tigerWMS_Census2020` has real values on all four.
 *
 * WHY NOT JUST SEARCH THE 2020 SERVICE. Because it would silently shrink the
 * country. Measured against the live services: CDPs 12,902 -> 12,454, and 54
 * CBSAs present today are absent from the 2020 vintage. Moving search there
 * would make ~500 real US geographies unfindable with no message explaining
 * why — the exact place-specific failure the product forbids.
 *
 * So search stays on Current (authoritative coverage) and population is joined
 * in from Census2020 by GEOID. A geography the 2020 vintage never knew about
 * keeps its full search behavior and simply ranks as unknown-population.
 */
const TIGERWEB_POPULATION_BASE = `${TIGERWEB_ROOT}/tigerWMS_Census2020/MapServer`;

// TIGERweb layer ids (tigerWMS_Current), verified against the live service.
const LAYER = {
  county: 82,
  incorporatedPlace: 28,
  censusDesignatedPlace: 30,
  metro: 93,
  micro: 91,
} as const;

/**
 * Matching layer ids on `tigerWMS_Census2020` — they differ from Current and
 * must not be assumed equal. Counties are absent on purpose: they never touch
 * TIGERweb search, they come from the ACS catalog in `us-counties`, which
 * carries its own population column.
 */
const POPULATION_LAYER_BY_KIND: Partial<Record<PlaceKind, number>> = {
  city: 26,
  cdp: 28,
  metro: 76,
  micro: 78,
};

/**
 * How many rows each layer returns before ranking. Deliberately larger than any
 * caller's result limit: the server truncates by BASENAME, so a limit-sized
 * fetch would discard the highest-population match before we ever got to rank
 * it — precisely the bug this change exists to fix, one level down.
 */
const CANDIDATE_POOL_PER_LAYER = 40;

const LAYER_BY_KIND: Record<PlaceKind, number> = {
  county: LAYER.county,
  city: LAYER.incorporatedPlace,
  cdp: LAYER.censusDesignatedPlace,
  metro: LAYER.metro,
  micro: LAYER.micro,
};

/**
 * Every kind `searchPlaces` consults. Derived from the layer map so the
 * "nothing answered" test cannot drift from the lookups actually performed.
 */
const ALL_PLACE_KINDS = Object.keys(LAYER_BY_KIND) as PlaceKind[];

// GEOID length by kind: county/CBSA are 5-digit, places are 7-digit.
const GEOID_LENGTH_BY_KIND: Record<PlaceKind, number> = {
  county: 5,
  city: 7,
  cdp: 7,
  metro: 5,
  micro: 5,
};

const KIND_DESCRIPTION: Record<PlaceKind, string> = {
  county: "County",
  city: "City / town",
  cdp: "Census-designated place",
  metro: "Metro area",
  micro: "Micropolitan area",
};

export interface PlaceSearchResult {
  kind: PlaceKind;
  geoid: string;
  label: string;
  description: string;
  stateFips: string | null;
}

/**
 * The result of a place search, including which lookups never answered.
 *
 * WHY THIS IS NOT JUST AN ARRAY. Every lookup here can fail silently:
 * `fetchJsonWithRetry` returns `null` for a timeout, a non-OK status, or a body
 * that would not parse, and the Census county catalog answers an unauthenticated
 * request with a 302 to an HTML page. Collapsing all of that into `[]` made an
 * outage — or an unset `CENSUS_API_KEY` — indistinguishable from "your county
 * does not exist", which is what the study-area picker then told the planner.
 * This is the front door of the whole product; it has to know the difference.
 */
export interface PlaceSearchOutcome {
  items: PlaceSearchResult[];
  /** Place kinds whose lookup did not answer. Empty when every lookup answered. */
  unavailableKinds: PlaceKind[];
  /** True when NOT ONE lookup answered: the search failed, it did not come back empty. */
  searchUnavailable: boolean;
  /** The most specific knowable cause, when there is one. */
  unavailableReason: string | null;
}

// Internal: carries the lowercased key we rank matches against, plus the
// population used only to break ties between equally good name matches.
type RankedPlace = PlaceSearchResult & { sortKey: string; population: number | null };

export interface ResolvedBoundary {
  kind: PlaceKind;
  geoid: string;
  label: string | null;
  geojson: CorridorGeojson;
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number };
}

interface TigerAttributes {
  GEOID?: string | number;
  NAME?: string;
  BASENAME?: string;
  STATE?: string | number;
  POP100?: number | string | null;
}

interface TigerQueryJson {
  features?: Array<{ attributes?: TigerAttributes }>;
}

interface TigerGeojson {
  type?: string;
  features?: Array<{ type?: string; geometry?: unknown; properties?: Record<string, unknown> }>;
}

/**
 * Sanitize a user query for embedding in an ArcGIS `where` LIKE clause. Strips
 * everything but letters/digits/space/period/hyphen/apostrophe, collapses
 * whitespace, caps length, then escapes single quotes by doubling them (SQL
 * standard) so a name like "O'Fallon" is safe and injection is not possible.
 */
export function sanitizeLikeQuery(raw: string): string {
  return raw
    .replace(/[^A-Za-z0-9 .'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40)
    .replace(/'/g, "''");
}

export interface PlaceSearchUrlOptions {
  layerId: number;
  sanitizedLike: string;
  limit: number;
  hasStateField: boolean;
  /**
   * Restrict to one state FIPS. Only meaningful on layers that carry a STATE
   * field — CBSA layers do not, and pass null: a metro area legitimately spans
   * states, and its own BASENAME already names them ("Columbus, GA-AL").
   */
  stateFips?: string | null;
}

export function buildPlaceSearchUrl({
  layerId,
  sanitizedLike,
  limit,
  hasStateField,
  stateFips = null,
}: PlaceSearchUrlOptions): string {
  const clauses = [`UPPER(BASENAME) LIKE UPPER('${sanitizedLike}%')`];
  // Digits only — `stateFips` reaches here from user input via the state-name
  // lookup, so it can only ever be a table value, but the LIKE clause next to it
  // is escaped and this one should not be the weak link.
  if (hasStateField && stateFips && /^\d{2}$/.test(stateFips)) {
    clauses.push(`STATE='${stateFips}'`);
  }

  const params = new URLSearchParams({
    where: clauses.join(" AND "),
    outFields: hasStateField ? "GEOID,NAME,BASENAME,STATE" : "GEOID,NAME,BASENAME",
    returnGeometry: "false",
    orderByFields: "BASENAME",
    resultRecordCount: String(limit),
    f: "json",
  });
  return `${TIGERWEB_BASE}/${layerId}/query?${params.toString()}`;
}

/**
 * Population-only companion query against the 2020 vintage. Same LIKE predicate
 * as the search so the two result sets line up, but it returns just GEOID and
 * POP100 — it is a join table, not a second source of truth about what exists.
 */
export function buildPlacePopulationUrl(layerId: number, sanitizedLike: string, limit: number): string {
  const params = new URLSearchParams({
    where: `UPPER(BASENAME) LIKE UPPER('${sanitizedLike}%')`,
    outFields: "GEOID,POP100",
    returnGeometry: "false",
    orderByFields: "POP100 DESC",
    resultRecordCount: String(limit),
    f: "json",
  });
  return `${TIGERWEB_POPULATION_BASE}/${layerId}/query?${params.toString()}`;
}

/**
 * Build a GEOID -> population map from a companion query. A missing, malformed,
 * or negative value is simply absent from the map: unknown population must rank
 * as unknown, never as zero.
 */
export function parsePlacePopulationResponse(json: TigerQueryJson | null): Map<string, number> {
  const populations = new Map<string, number>();
  const features = json?.features;
  if (!Array.isArray(features)) return populations;

  for (const feature of features) {
    const attrs = feature.attributes ?? {};
    const geoid = attrs.GEOID != null ? String(attrs.GEOID) : "";
    if (!geoid) continue;

    // `Number(null)` is 0, not NaN — and the Current CBSA layers really do
    // answer `POP100: null`. Without this guard an unknown population would be
    // recorded as a real zero and sort dead last among knowns instead of being
    // treated as unknown.
    const raw = attrs.POP100;
    if (raw === null || raw === undefined || raw === "") continue;

    const population = Number(raw);
    if (!Number.isFinite(population) || population < 0) continue;
    populations.set(geoid, population);
  }
  return populations;
}

export function buildPlaceBoundaryUrl(layerId: number, geoid: string): string {
  const params = new URLSearchParams({
    where: `GEOID='${geoid}'`,
    outFields: "GEOID,NAME,BASENAME",
    returnGeometry: "true",
    outSR: "4326",
    // ~11m precision: compact payloads, plenty for a screening study area.
    geometryPrecision: "4",
    f: "geojson",
  });
  return `${TIGERWEB_BASE}/${layerId}/query?${params.toString()}`;
}

/**
 * Parse a TIGERweb attribute query response into ranked place results. `kind`
 * must match the layer queried (city/cdp = places, metro/micro = CBSAs).
 */
export function parsePlaceSearchResponse(
  json: TigerQueryJson | null,
  kind: PlaceKind,
  populations?: Map<string, number>
): RankedPlace[] {
  const features = json?.features;
  if (!Array.isArray(features)) return [];

  const results: RankedPlace[] = [];
  for (const feature of features) {
    const attrs = feature.attributes ?? {};
    const geoid = attrs.GEOID != null ? String(attrs.GEOID) : "";
    if (!geoid) continue;

    const basename = String(attrs.BASENAME ?? attrs.NAME ?? "").trim();
    if (!basename) continue;

    const population = populations?.get(geoid) ?? null;

    if (kind === "metro" || kind === "micro") {
      // CBSA layers carry a fully-formed NAME ("Reno, NV Metro Area") and no
      // STATE. Their BASENAME already ends in the state(s) — "Columbus, OH" —
      // which is why they are ranked against the caller's full query too.
      const label = String(attrs.NAME ?? basename).trim();
      results.push({
        kind,
        geoid,
        label,
        description: KIND_DESCRIPTION[kind],
        stateFips: null,
        sortKey: basename.toLowerCase(),
        population,
      });
      continue;
    }

    const stateFips = attrs.STATE != null ? String(attrs.STATE) : null;
    const usps = stateUspsFromFips(stateFips);
    const label = usps ? `${basename}, ${usps}` : basename;
    results.push({
      kind,
      geoid,
      label,
      description: KIND_DESCRIPTION[kind],
      stateFips,
      sortKey: basename.toLowerCase(),
      population,
    });
  }
  return results;
}

export function scorePlaceMatch(sortKey: string, queryLower: string): number {
  if (!queryLower) return 0;
  if (sortKey === queryLower) return 1000;
  if (sortKey.startsWith(queryLower)) return 800;
  if (sortKey.includes(queryLower)) return 400;
  return 100; // matched the LIKE server-side but not on the clean base name
}

/**
 * Extract the first Polygon/MultiPolygon from a TIGERweb GeoJSON response and
 * validate it as a corridor geometry. Returns null if absent or malformed.
 */
export function extractCorridorFromGeojson(json: TigerGeojson | null): CorridorGeojson | null {
  const feature = json?.features?.[0];
  if (!feature?.geometry) return null;
  const parsed = corridorGeojsonSchema.safeParse(feature.geometry);
  return parsed.success ? parsed.data : null;
}

function labelFromBoundaryGeojson(json: TigerGeojson | null, kind: PlaceKind): string | null {
  const props = json?.features?.[0]?.properties;
  if (!props) return null;
  if (kind === "metro" || kind === "micro") {
    return typeof props.NAME === "string" ? props.NAME : null;
  }
  const basename = typeof props.BASENAME === "string" ? props.BASENAME : null;
  if (!basename) return typeof props.NAME === "string" ? props.NAME : null;
  const usps = stateUspsFromFips(kind === "county" ? String(props.GEOID ?? "") : null);
  return usps ? `${basename}, ${usps}` : basename;
}

async function fetchTigerSearch(options: PlaceSearchUrlOptions): Promise<TigerQueryJson | null> {
  const { layerId, sanitizedLike, limit, stateFips = null } = options;
  return fetchJsonWithRetry<TigerQueryJson>(buildPlaceSearchUrl(options), undefined, {
    timeoutMs: 8000,
    retries: 1,
    cacheTtlMs: 24 * 60 * 60 * 1000,
    // The state filter is part of the query, so it must be part of the key —
    // otherwise a state-qualified search would serve the unfiltered answer.
    cacheKey: `tigerweb:search:${layerId}:${sanitizedLike.toLowerCase()}:${limit}:${stateFips ?? "all"}`,
  });
}

/**
 * Fetch populations for a kind, or an empty map when that kind has no 2020
 * companion layer. Never throws and never reports unavailability: population is
 * a ranking refinement, so losing it must degrade the ORDER of results, never
 * the results themselves or the coverage report.
 */
async function fetchTigerPopulations(
  kind: PlaceKind,
  sanitizedLike: string,
  limit: number
): Promise<Map<string, number>> {
  const layerId = POPULATION_LAYER_BY_KIND[kind];
  if (layerId === undefined) return new Map();

  const json = await fetchJsonWithRetry<TigerQueryJson>(
    buildPlacePopulationUrl(layerId, sanitizedLike, limit),
    undefined,
    {
      timeoutMs: 8000,
      retries: 1,
      cacheTtlMs: 24 * 60 * 60 * 1000,
      cacheKey: `tigerweb:population:${layerId}:${sanitizedLike.toLowerCase()}:${limit}`,
    }
  ).catch(() => null);

  return parsePlacePopulationResponse(json);
}

/**
 * Did a TIGERweb layer actually answer?
 *
 * `null` is `fetchJsonWithRetry`'s single signal for timeout / non-OK status /
 * unparseable body. A 200 that carries no `features` array is also not an answer
 * — ArcGIS reports a rejected query that way, with an `error` object instead.
 * Anything else, including `{ features: [] }`, is a real "nothing matched".
 */
function tigerLayerAnswered(json: TigerQueryJson | null): boolean {
  return json !== null && Array.isArray(json.features);
}

const TIGERWEB_UNAVAILABLE_REASON =
  "The US Census TIGERweb boundary service did not respond, so place names could not be searched.";

/**
 * Search US places by name across counties, incorporated places, CDPs, and
 * metro/micro areas. Returns a ranked, de-duplicated list plus the coverage of
 * the search itself — see `PlaceSearchOutcome` for why the second part matters.
 */
export async function searchPlaces(query: string, limit = 8): Promise<PlaceSearchOutcome> {
  const answered: PlaceSearchOutcome = {
    items: [],
    unavailableKinds: [],
    searchUnavailable: false,
    unavailableReason: null,
  };

  const trimmed = query.trim();
  if (trimmed.length < 2) return answered;

  // "Franklin County, OH" means the name AND the state. The LIKE predicate runs
  // against the bare name — TIGERweb BASENAMEs for counties and places carry no
  // state, and `sanitizeLikeQuery` would turn the comma into a space and match
  // nothing — while the state becomes a real filter.
  const { name: bareQuery, stateFips: qualifiedStateFips } = splitStateQualifier(trimmed);
  const like = sanitizeLikeQuery(bareQuery);
  if (!like) return answered;

  const perLayer = Math.min(Math.max(Number.isFinite(limit) ? Math.trunc(limit) : 8, 1), 20);
  const pool = Math.max(CANDIDATE_POOL_PER_LAYER, perLayer);
  const queryLower = trimmed.toLowerCase();
  const bareQueryLower = bareQuery.toLowerCase();

  // `.catch` guards remain because these are network calls; they are belt to the
  // braces of the `null` contract, not the primary failure signal.
  const [
    countyOutcome,
    cityJson,
    cdpJson,
    metroJson,
    microJson,
    cityPopulations,
    cdpPopulations,
    metroPopulations,
    microPopulations,
  ] = await Promise.all([
    searchUsCounties(trimmed, pool).catch(() => null),
    fetchTigerSearch({
      layerId: LAYER.incorporatedPlace,
      sanitizedLike: like,
      limit: pool,
      hasStateField: true,
      stateFips: qualifiedStateFips,
    }).catch(() => null),
    fetchTigerSearch({
      layerId: LAYER.censusDesignatedPlace,
      sanitizedLike: like,
      limit: pool,
      hasStateField: true,
      stateFips: qualifiedStateFips,
    }).catch(() => null),
    fetchTigerSearch({
      layerId: LAYER.metro,
      sanitizedLike: like,
      limit: pool,
      hasStateField: false,
    }).catch(() => null),
    fetchTigerSearch({
      layerId: LAYER.micro,
      sanitizedLike: like,
      limit: pool,
      hasStateField: false,
    }).catch(() => null),
    fetchTigerPopulations("city", like, pool),
    fetchTigerPopulations("cdp", like, pool),
    fetchTigerPopulations("metro", like, pool),
    fetchTigerPopulations("micro", like, pool),
  ]);

  const unavailableKinds: PlaceKind[] = [];
  let countyReason: string | null = null;

  if (countyOutcome === null || countyOutcome.availability === "unavailable") {
    unavailableKinds.push("county");
    countyReason = countyOutcome?.unavailableReason ?? TIGERWEB_UNAVAILABLE_REASON;
  }
  if (!tigerLayerAnswered(cityJson)) unavailableKinds.push("city");
  if (!tigerLayerAnswered(cdpJson)) unavailableKinds.push("cdp");
  if (!tigerLayerAnswered(metroJson)) unavailableKinds.push("metro");
  if (!tigerLayerAnswered(microJson)) unavailableKinds.push("micro");

  const counties = countyOutcome?.items ?? [];

  const countyResults: RankedPlace[] = counties.map((county) => ({
    kind: "county" as const,
    geoid: county.geographyId,
    label: county.geographyLabel,
    description: KIND_DESCRIPTION.county,
    stateFips: county.geographyId.slice(0, 2),
    // Rank counties on their bare name (strip a trailing ", XX").
    sortKey: county.geographyLabel.replace(/,\s*[A-Z]{2}$/, "").toLowerCase(),
    // Normalized to null rather than trusted: an absent value must compare as
    // "unknown", because `undefined - number` is NaN and a comparator that
    // returns NaN silently corrupts the whole sort order.
    population: county.population ?? null,
  }));

  const all: RankedPlace[] = [
    ...countyResults,
    ...parsePlaceSearchResponse(cityJson, "city", cityPopulations),
    ...parsePlaceSearchResponse(cdpJson, "cdp", cdpPopulations),
    ...parsePlaceSearchResponse(metroJson, "metro", metroPopulations),
    ...parsePlaceSearchResponse(microJson, "micro", microPopulations),
  ];

  const seen = new Set<string>();
  const items = all
    .map((place) => ({
      place,
      // Two label conventions coexist here: county and place sort keys are bare
      // names ("columbus"), while a CBSA's is "columbus, oh". Scoring against
      // both forms and keeping the better one lets "Columbus, OH" match the
      // metro area exactly without penalizing the city, and needs no per-kind
      // branching that would drift as kinds are added.
      score: Math.max(
        scorePlaceMatch(place.sortKey, queryLower),
        scorePlaceMatch(place.sortKey, bareQueryLower)
      ),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      // Population breaks ties between equally good name matches, and nothing
      // more: it can never lift a weaker match above a stronger one. Unknown
      // population sorts last, then alphabetically, so ordering stays stable
      // whether or not the 2020 companion layer answered.
      const leftPopulation = left.place.population;
      const rightPopulation = right.place.population;
      if (leftPopulation !== rightPopulation) {
        if (leftPopulation === null) return 1;
        if (rightPopulation === null) return -1;
        return rightPopulation - leftPopulation;
      }
      return left.place.label.localeCompare(right.place.label);
    })
    .filter(({ place }) => {
      const key = `${place.kind}:${place.geoid}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, perLayer)
    .map(({ place }) => ({
      kind: place.kind,
      geoid: place.geoid,
      label: place.label,
      description: place.description,
      stateFips: place.stateFips,
    }));

  const searchUnavailable = unavailableKinds.length === ALL_PLACE_KINDS.length;

  /*
    "Reno NV" — the comma-less form — found nothing until this existed.

    `splitStateQualifier` reads ", XX" and nothing else, so a query written the
    way people usually type it reached TIGERweb as `LIKE 'RENO NV%'` and matched
    no place in the country. The picker then told a planner searching for their
    own city that there were no results, which is the one thing the study-area
    front door must never say about a place that exists.

    It is retried rather than parsed up front because a space is not a
    separator — see `splitTrailingStateWords`. Retrying only on a genuinely
    empty result means this can add the missing answer but can never displace a
    correct one. The rewritten query carries a comma, so the retry cannot
    recurse a second time.
  */
  if (items.length === 0 && !searchUnavailable) {
    const spaced = splitTrailingStateWords(trimmed);
    const usps = stateUspsFromFips(spaced.stateFips);
    if (spaced.stateFips && usps && spaced.name) {
      const retried = await searchPlaces(`${spaced.name}, ${usps}`, limit);
      if (retried.items.length > 0) {
        return { ...retried, unavailableKinds, searchUnavailable };
      }
    }
  }

  return {
    items,
    unavailableKinds,
    searchUnavailable,
    // Prefer the county cause: it is the one that names a specific, fixable
    // configuration gap rather than a generic upstream outage.
    unavailableReason:
      unavailableKinds.length === 0 ? null : (countyReason ?? TIGERWEB_UNAVAILABLE_REASON),
  };
}

/**
 * Resolve a place to its official TIGERweb boundary polygon (WGS84), validated
 * as a corridor geometry, with a bounding box. Returns null if the GEOID is
 * malformed for its kind or no boundary is found.
 */
export async function resolvePlaceBoundary(kind: PlaceKind, geoid: string): Promise<ResolvedBoundary | null> {
  const cleanGeoid = geoid.replace(/[^0-9]/g, "");
  if (cleanGeoid.length !== GEOID_LENGTH_BY_KIND[kind]) return null;

  const json = await fetchJsonWithRetry<TigerGeojson>(
    buildPlaceBoundaryUrl(LAYER_BY_KIND[kind], cleanGeoid),
    undefined,
    {
      timeoutMs: 15000,
      retries: 1,
      cacheTtlMs: 24 * 60 * 60 * 1000,
      cacheKey: `tigerweb:boundary:${LAYER_BY_KIND[kind]}:${cleanGeoid}`,
    },
  );

  const geojson = extractCorridorFromGeojson(json);
  if (!geojson) return null;

  // A boundary with no usable coordinates is not a resolved place. Returning it
  // with a substituted bbox would hand the caller someone else's geography.
  const bbox = bboxFromGeojson(geojson);
  if (!bbox) return null;

  return {
    kind,
    geoid: cleanGeoid,
    label: labelFromBoundaryGeojson(json, kind),
    geojson,
    bbox,
  };
}
