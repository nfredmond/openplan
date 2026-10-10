/**
 * Finding a street or place on the resident's map, through Mapbox's geocoder
 * on the same public token that draws the map.
 *
 * What the resident types is sent to Mapbox, so an operator can switch this
 * off with `OPENPLAN_PUBLIC_PLACE_SEARCH=off`. A result only moves the camera;
 * the resident still marks the place themselves.
 *
 * Pure and client-safe: the URL builder and the parser are tested without a
 * network.
 */

export const PLACE_SEARCH_ENV = "OPENPLAN_PUBLIC_PLACE_SEARCH";
export const PLACE_SEARCH_MIN_LENGTH = 3;
const GEOCODE_ENDPOINT = "https://api.mapbox.com/search/geocode/v6/forward";
// Street addresses, streets and named places; no countries or regions, which
// would only move a resident further from the spot they mean.
const PLACE_TYPES = "address,street,neighborhood,locality,place,postcode";

export type PlaceSearchResult = {
  id: string;
  name: string;
  /** The rest of the address ("Grass Valley, California 95945"), when given. */
  detail: string | null;
  center: [number, number];
  /** West, south, east, north, for a place with an extent. */
  bbox: [number, number, number, number] | null;
};

/** Whether this deployment offers place search. On unless the operator says off. */
export function placeSearchEnabled(env: Record<string, string | undefined>): boolean {
  return (env[PLACE_SEARCH_ENV] ?? "").trim().toLowerCase() !== "off";
}

export function buildPlaceSearchUrl(
  query: string,
  options: { token: string; language: string; proximity?: [number, number] | null }
): string {
  const params = new URLSearchParams({
    q: query.trim(),
    access_token: options.token,
    autocomplete: "true",
    limit: "5",
    types: PLACE_TYPES,
    // Mapbox takes a base language tag; "es-MX" would be refused.
    language: options.language.split("-")[0],
  });
  if (options.proximity) {
    params.set("proximity", `${options.proximity[0].toFixed(5)},${options.proximity[1].toFixed(5)}`);
  }
  return `${GEOCODE_ENDPOINT}?${params.toString()}`;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Results Mapbox returned, keeping only ones with a usable position. */
export function parsePlaceSearchResults(payload: unknown): PlaceSearchResult[] {
  const features = (payload as { features?: unknown })?.features;
  if (!Array.isArray(features)) return [];
  const results: PlaceSearchResult[] = [];
  for (const feature of features) {
    const geometry = (feature as { geometry?: { coordinates?: unknown } })?.geometry;
    const coordinates = geometry?.coordinates;
    if (!Array.isArray(coordinates) || !finiteNumber(coordinates[0]) || !finiteNumber(coordinates[1])) continue;
    const properties = ((feature as { properties?: Record<string, unknown> }).properties ?? {}) as Record<
      string,
      unknown
    >;
    const name = typeof properties.name === "string" ? properties.name.trim() : "";
    if (!name) continue;
    const detail = typeof properties.place_formatted === "string" ? properties.place_formatted.trim() : "";
    const rawBbox = properties.bbox;
    const bbox =
      Array.isArray(rawBbox) && rawBbox.length === 4 && rawBbox.every(finiteNumber)
        ? (rawBbox as [number, number, number, number])
        : null;
    const id =
      typeof (feature as { id?: unknown }).id === "string"
        ? (feature as { id: string }).id
        : typeof properties.mapbox_id === "string"
          ? properties.mapbox_id
          : `${coordinates[0]},${coordinates[1]}`;
    results.push({ id, name, detail: detail || null, center: [coordinates[0], coordinates[1]], bbox });
  }
  return results;
}
