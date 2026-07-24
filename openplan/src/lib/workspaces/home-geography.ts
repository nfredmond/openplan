/**
 * A workspace's HOME GEOGRAPHY — the one place of record for "where does this
 * agency work?".
 *
 * Before this existed, every geography-aware surface had to invent its own
 * answer, and each invention was a hardcoded place: a map camera parked on one
 * town, a baked-in study-area bbox, a stage-gate template that defaulted every
 * workspace in the country to one state. This module is the shared answer, and
 * — just as importantly — the shared way of saying "not set", so a caller can
 * fall back to something neutral instead of to somebody else's county.
 *
 * Two rules shape everything here:
 *
 *   1. NEVER RETURN A DEFAULT PLACE. Every accessor returns `null` when the
 *      workspace has not stated its geography. `null` is a normal state the
 *      caller must handle (neutral continental camera, "set your area" prompt),
 *      never a licence to substitute a plausible-looking wrong location.
 *
 *   2. THE CORE STAYS JURISDICTION-NEUTRAL. The stored shape is only
 *      (source, kind, ref) plus ISO codes and a bbox. Nothing here knows what a
 *      FIPS code, a state, or a county is. Country-specific knowledge lives in
 *      the resolver adapters at the bottom of this file — today TIGERweb, the
 *      app's existing any-place front door.
 */

import type { PlaceBoundaryResponse, PlaceKind } from "@/lib/api/place-geographies";
import { stateUspsFromFips } from "@/lib/geographies/state-fips";

/**
 * The home-geography columns on `workspaces`
 * (20260723000005_workspace_home_geography.sql), in database shape.
 *
 * Kept snake_case on purpose: this is the row, and a camelCase mirror would
 * mean a mapping layer plus a second place to forget a column. Every field is
 * nullable because an unset workspace is valid.
 */
export type WorkspaceHomeGeography = {
  /** Which resolver produced this — namespaces `home_geography_ref`. */
  home_geography_source: string | null;
  /** The resolver's own kind vocabulary; opaque to this module. */
  home_geography_kind: string | null;
  /** Id within the source's namespace (Census GEOID for `tigerweb`). */
  home_geography_ref: string | null;
  home_geography_label: string | null;
  /** ISO 3166-1 alpha-2. */
  home_country_code: string | null;
  /** ISO 3166-2 subdivision part, without the country prefix ("CA", not "US-CA"). */
  home_subdivision_code: string | null;
  home_min_lon: number | null;
  home_min_lat: number | null;
  home_max_lon: number | null;
  home_max_lat: number | null;
  home_geometry_geojson: unknown | null;
  home_geography_set_at: string | null;
};

/**
 * Select list for the home-geography columns, so consumers do not each retype
 * the column names and drift when one is added.
 */
export const HOME_GEOGRAPHY_COLUMNS = [
  "home_geography_source",
  "home_geography_kind",
  "home_geography_ref",
  "home_geography_label",
  "home_country_code",
  "home_subdivision_code",
  "home_min_lon",
  "home_min_lat",
  "home_max_lon",
  "home_max_lat",
  "home_geometry_geojson",
  "home_geography_set_at",
].join(", ");

export type HomeGeographyBbox = {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
};

export type HomeMapView = {
  center: [number, number];
  zoom: number;
};

/**
 * Coerce an arbitrary row (a Supabase select, a JSON body) into a home
 * geography, or `null` if it does not carry one.
 *
 * "Carries one" deliberately means the SOURCE is present: a source is what
 * makes the ref resolvable, and the migration's coherence CHECK enforces the
 * same rule. A row with only a stray label is treated as unset rather than
 * half-trusted.
 */
export function parseWorkspaceHomeGeography(row: unknown): WorkspaceHomeGeography | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;

  const text = (key: string): string | null => {
    const value = record[key];
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  const num = (key: string): number | null => {
    const value = record[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };

  const source = text("home_geography_source");
  if (!source) return null;

  return {
    home_geography_source: source,
    home_geography_kind: text("home_geography_kind"),
    home_geography_ref: text("home_geography_ref"),
    home_geography_label: text("home_geography_label"),
    home_country_code: text("home_country_code"),
    home_subdivision_code: text("home_subdivision_code"),
    home_min_lon: num("home_min_lon"),
    home_min_lat: num("home_min_lat"),
    home_max_lon: num("home_max_lon"),
    home_max_lat: num("home_max_lat"),
    home_geometry_geojson: record.home_geometry_geojson ?? null,
    home_geography_set_at: text("home_geography_set_at"),
  };
}

/**
 * The stored bbox, or `null` if it is absent or incomplete. Partial bounds are
 * rejected rather than patched: three of four corners would frame a map that
 * looks right and is wrong.
 */
export function homeGeographyBbox(
  geo: WorkspaceHomeGeography | null | undefined
): HomeGeographyBbox | null {
  if (!geo) return null;
  const { home_min_lon: minLon, home_min_lat: minLat, home_max_lon: maxLon, home_max_lat: maxLat } = geo;
  if (minLon === null || minLat === null || maxLon === null || maxLat === null) return null;
  if (![minLon, minLat, maxLon, maxLat].every((value) => Number.isFinite(value))) return null;
  if (minLat > maxLat) return null;
  return { minLon, minLat, maxLon, maxLat };
}

/**
 * Longitudinal width of a bbox in degrees, handling the antimeridian.
 *
 * A bbox that crosses 180° (Fiji, Chukotka, the western Aleutians) has
 * minLon > maxLon — that is well-formed, not corrupt, which is why the
 * migration does not constrain longitude ordering. Treating it as a negative
 * span would send the camera to the far side of the planet.
 */
function lonSpanDegrees(minLon: number, maxLon: number): number {
  const raw = maxLon - minLon;
  return raw >= 0 ? raw : raw + 360;
}

/** Normalize a longitude into [-180, 180]. */
function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** Web Mercator y as a fraction of the world square, 0 at the north edge. */
function mercatorY(lat: number): number {
  // Clamp to the Mercator limit; the projection is undefined at the poles.
  const clamped = Math.min(Math.max(lat, -85.051129), 85.051129);
  const radians = (clamped * Math.PI) / 180;
  return 0.5 - Math.log(Math.tan(Math.PI / 4 + radians / 2)) / (2 * Math.PI);
}

/**
 * Reference viewport used to turn a bbox into a zoom level.
 *
 * A zoom number is only meaningful relative to a viewport size, and this helper
 * is pure (it never sees the DOM), so it assumes a mid-size desktop map pane and
 * lets a caller that knows better pass its own. Erring small keeps the whole
 * geography on screen on a phone rather than cropping it on a desktop.
 */
const REFERENCE_VIEWPORT = { width: 900, height: 600 } as const;

/** Mapbox tile size in CSS pixels; the world is TILE_SIZE * 2^zoom wide. */
const TILE_SIZE = 512;

/** Leave the boundary a little breathing room inside the frame. */
const FIT_PADDING_FACTOR = 0.9;

/**
 * Widest sensible framing (roughly a continent) and tightest (roughly a block).
 * These bound arithmetic, they do not encode a place: a degenerate point bbox
 * would otherwise compute infinite zoom.
 */
const MIN_ZOOM = 2;
const MAX_ZOOM = 14;

/**
 * The map camera implied by the workspace's home geography — or `null` when it
 * has none.
 *
 * `null` is the whole point of this function. Callers pair it with a NEUTRAL
 * fallback (`CONTINENTAL_US_CENTER` in src/lib/models/study-area.ts), because
 * showing an unset workspace a specific town is the exact defect this module
 * exists to remove.
 */
export function deriveHomeMapView(
  geo: WorkspaceHomeGeography | null | undefined,
  options?: { viewportWidth?: number; viewportHeight?: number }
): HomeMapView | null {
  const bbox = homeGeographyBbox(geo);
  if (!bbox) return null;

  const width = options?.viewportWidth ?? REFERENCE_VIEWPORT.width;
  const height = options?.viewportHeight ?? REFERENCE_VIEWPORT.height;

  const lonSpan = lonSpanDegrees(bbox.minLon, bbox.maxLon);
  const centerLon = wrapLon(bbox.minLon + lonSpan / 2);
  const centerLat = (bbox.minLat + bbox.maxLat) / 2;

  // World-fraction spans: longitude is linear, latitude is not.
  const lonFraction = lonSpan / 360;
  const latFraction = Math.abs(mercatorY(bbox.maxLat) - mercatorY(bbox.minLat));

  const zoomFor = (fraction: number, pixels: number): number =>
    fraction > 0 ? Math.log2((pixels * FIT_PADDING_FACTOR) / (TILE_SIZE * fraction)) : Number.POSITIVE_INFINITY;

  // The tighter of the two constraints is the one that fits.
  const fitted = Math.min(zoomFor(lonFraction, width), zoomFor(latFraction, height));
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fitted));

  return {
    center: [centerLon, centerLat],
    // Two decimals is finer than any camera can express; keep the value tidy.
    zoom: Math.round(zoom * 100) / 100,
  };
}

/**
 * The jurisdiction descriptor a rules registry can match on — the same shape
 * `StageGateJurisdiction` uses in src/lib/stage-gates/template-registry.ts.
 *
 * `subdivision` is `null` when the geography spans subdivisions (a multi-state
 * metro) or the source cannot say. That null must stay a null: a registry
 * should decline to bind a subdivision-scoped template rather than pick one.
 */
export type HomeJurisdiction = {
  country: string;
  subdivision: string | null;
};

export function resolveJurisdiction(
  geo: WorkspaceHomeGeography | null | undefined
): HomeJurisdiction | null {
  const country = geo?.home_country_code?.trim().toUpperCase();
  if (!country) return null;
  const subdivision = geo?.home_subdivision_code?.trim().toUpperCase();
  return { country, subdivision: subdivision || null };
}

/** Display name for the home geography, or `null` — never a placeholder place. */
export function homeGeographyLabel(geo: WorkspaceHomeGeography | null | undefined): string | null {
  return geo?.home_geography_label?.trim() || null;
}

// ---------------------------------------------------------------------------
// Resolver adapters. Everything below this line is source-specific knowledge,
// kept here so the types above stay country-neutral. Adding a resolver means
// adding a builder here, not changing the schema or the accessors.
// ---------------------------------------------------------------------------

/**
 * The US Census TIGERweb resolver behind the app's any-place picker
 * (src/lib/geographies/place-resolver.ts). Its refs are Census GEOIDs.
 */
export const TIGERWEB_GEOGRAPHY_SOURCE = "tigerweb";

/**
 * TIGERweb kinds whose GEOID is prefixed by a state FIPS code:
 * county = SSCCC (5), place/CDP = SSPPPPP (7).
 *
 * Metro and micro areas are CBSAs, whose 5-digit code is NOT state-prefixed —
 * CBSA 31080 is Los Angeles, and reading "31" as a state FIPS would report the
 * workspace as being in Nebraska. A CBSA can also straddle states outright, so
 * for those kinds the subdivision is genuinely unknown and stays null.
 */
const STATE_PREFIXED_PLACE_KINDS: ReadonlySet<PlaceKind> = new Set<PlaceKind>([
  "county",
  "city",
  "cdp",
]);

/**
 * The ISO 3166-2 subdivision code for a TIGERweb GEOID, or null when it cannot
 * be derived honestly.
 *
 * For the United States the ISO 3166-2 subdivision codes are the USPS
 * abbreviations (US-CA, US-OH, and likewise for the territories), so the
 * existing FIPS→USPS table is the mapping; it is imported rather than
 * duplicated.
 */
export function subdivisionCodeFromTigerwebGeoid(
  kind: PlaceKind,
  geoid: string | null | undefined
): string | null {
  if (!geoid || !STATE_PREFIXED_PLACE_KINDS.has(kind)) return null;
  return stateUspsFromFips(geoid);
}

/**
 * Build the row to persist from a boundary the existing any-place picker
 * resolved. Routing every write through this keeps the picker the single front
 * door for geography — there is no second selector and no hand-typed bbox.
 */
export function homeGeographyFromPlaceBoundary(
  boundary: PlaceBoundaryResponse,
  options?: { label?: string | null; setAt?: Date }
): WorkspaceHomeGeography {
  const label = options?.label?.trim() || boundary.label?.trim() || null;

  return {
    home_geography_source: TIGERWEB_GEOGRAPHY_SOURCE,
    home_geography_kind: boundary.kind,
    home_geography_ref: boundary.geoid,
    home_geography_label: label,
    // TIGERweb is a United States Census service; that is a fact about the
    // adapter, not an assumption baked into the core.
    home_country_code: "US",
    home_subdivision_code: subdivisionCodeFromTigerwebGeoid(boundary.kind, boundary.geoid),
    home_min_lon: boundary.bbox.minLon,
    home_min_lat: boundary.bbox.minLat,
    home_max_lon: boundary.bbox.maxLon,
    home_max_lat: boundary.bbox.maxLat,
    home_geometry_geojson: boundary.geojson,
    home_geography_set_at: (options?.setAt ?? new Date()).toISOString(),
  };
}
