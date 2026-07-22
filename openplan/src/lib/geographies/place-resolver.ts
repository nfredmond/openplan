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
import { stateUspsFromFips } from "@/lib/geographies/state-fips";
import type { PlaceKind } from "@/lib/api/place-geographies";

export type { PlaceKind } from "@/lib/api/place-geographies";

const TIGERWEB_BASE =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer";

// TIGERweb layer ids (tigerWMS_Current), verified against the live service.
const LAYER = {
  county: 82,
  incorporatedPlace: 28,
  censusDesignatedPlace: 30,
  metro: 93,
  micro: 91,
} as const;

const LAYER_BY_KIND: Record<PlaceKind, number> = {
  county: LAYER.county,
  city: LAYER.incorporatedPlace,
  cdp: LAYER.censusDesignatedPlace,
  metro: LAYER.metro,
  micro: LAYER.micro,
};

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

// Internal: carries the lowercased key we rank matches against.
type RankedPlace = PlaceSearchResult & { sortKey: string };

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

export function buildPlaceSearchUrl(layerId: number, sanitizedLike: string, limit: number, hasStateField: boolean): string {
  const params = new URLSearchParams({
    where: `UPPER(BASENAME) LIKE UPPER('${sanitizedLike}%')`,
    outFields: hasStateField ? "GEOID,NAME,BASENAME,STATE" : "GEOID,NAME,BASENAME",
    returnGeometry: "false",
    orderByFields: "BASENAME",
    resultRecordCount: String(limit),
    f: "json",
  });
  return `${TIGERWEB_BASE}/${layerId}/query?${params.toString()}`;
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
export function parsePlaceSearchResponse(json: TigerQueryJson | null, kind: PlaceKind): RankedPlace[] {
  const features = json?.features;
  if (!Array.isArray(features)) return [];

  const results: RankedPlace[] = [];
  for (const feature of features) {
    const attrs = feature.attributes ?? {};
    const geoid = attrs.GEOID != null ? String(attrs.GEOID) : "";
    if (!geoid) continue;

    const basename = String(attrs.BASENAME ?? attrs.NAME ?? "").trim();
    if (!basename) continue;

    if (kind === "metro" || kind === "micro") {
      // CBSA layers carry a fully-formed NAME ("Reno, NV Metro Area") and no STATE.
      const label = String(attrs.NAME ?? basename).trim();
      results.push({
        kind,
        geoid,
        label,
        description: KIND_DESCRIPTION[kind],
        stateFips: null,
        sortKey: basename.toLowerCase(),
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

async function fetchTigerSearch(
  layerId: number,
  sanitizedLike: string,
  limit: number,
  hasStateField: boolean,
): Promise<TigerQueryJson | null> {
  return fetchJsonWithRetry<TigerQueryJson>(buildPlaceSearchUrl(layerId, sanitizedLike, limit, hasStateField), undefined, {
    timeoutMs: 8000,
    retries: 1,
    cacheTtlMs: 24 * 60 * 60 * 1000,
    cacheKey: `tigerweb:search:${layerId}:${sanitizedLike.toLowerCase()}:${limit}`,
  });
}

/**
 * Search US places by name across counties, incorporated places, CDPs, and
 * metro/micro areas. Returns a single ranked, de-duplicated list.
 */
export async function searchPlaces(query: string, limit = 8): Promise<PlaceSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const like = sanitizeLikeQuery(trimmed);
  if (!like) return [];

  const perLayer = Math.min(Math.max(Number.isFinite(limit) ? Math.trunc(limit) : 8, 1), 20);
  const queryLower = trimmed.toLowerCase();

  const [counties, cityJson, cdpJson, metroJson, microJson] = await Promise.all([
    searchUsCounties(trimmed, perLayer).catch(() => []),
    fetchTigerSearch(LAYER.incorporatedPlace, like, perLayer, true).catch(() => null),
    fetchTigerSearch(LAYER.censusDesignatedPlace, like, perLayer, true).catch(() => null),
    fetchTigerSearch(LAYER.metro, like, perLayer, false).catch(() => null),
    fetchTigerSearch(LAYER.micro, like, perLayer, false).catch(() => null),
  ]);

  const countyResults: RankedPlace[] = counties.map((county) => ({
    kind: "county" as const,
    geoid: county.geographyId,
    label: county.geographyLabel,
    description: KIND_DESCRIPTION.county,
    stateFips: county.geographyId.slice(0, 2),
    // Rank counties on their bare name (strip a trailing ", XX").
    sortKey: county.geographyLabel.replace(/,\s*[A-Z]{2}$/, "").toLowerCase(),
  }));

  const all: RankedPlace[] = [
    ...countyResults,
    ...parsePlaceSearchResponse(cityJson, "city"),
    ...parsePlaceSearchResponse(cdpJson, "cdp"),
    ...parsePlaceSearchResponse(metroJson, "metro"),
    ...parsePlaceSearchResponse(microJson, "micro"),
  ];

  const seen = new Set<string>();
  return all
    .map((place) => ({ place, score: scorePlaceMatch(place.sortKey, queryLower) }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
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

  return {
    kind,
    geoid: cleanGeoid,
    label: labelFromBoundaryGeojson(json, kind),
    geojson,
    bbox: bboxFromGeojson(geojson),
  };
}
