import type { PlaceBoundaryResponse } from "@/lib/api/place-geographies";
import {
  bboxOfGeometry,
  DRAWN_PLACE_SOURCE,
  type PlaceOfRecord,
} from "@/lib/geographies/place-of-record";
import { subdivisionCodeFromTigerwebGeoid, TIGERWEB_GEOGRAPHY_SOURCE } from "@/lib/workspaces/home-geography";

/**
 * The area a project studies, as stored on the `projects` row (20260728000009).
 *
 * This is NOT the project's map marker. `latitude`/`longitude` record the SITE —
 * the intersection, the bridge — and are owned solely by
 * `/api/projects/[projectId]/location`. This records the AREA the work covers,
 * and it is the thing other modules inherit: a county run needs the GEOID, a
 * model run needs the Polygon, a representativeness screen needs the extent.
 * A point can supply none of those, which is why the columns exist.
 */

export type ProjectPlaceRow = {
  place_source: string | null;
  place_kind: string | null;
  place_ref: string | null;
  place_label: string | null;
  place_country_code: string | null;
  place_subdivision_code: string | null;
  place_min_lon: number | null;
  place_min_lat: number | null;
  place_max_lon: number | null;
  place_max_lat: number | null;
  place_geometry_geojson: unknown;
  place_set_at: string | null;
};

export const PROJECT_PLACE_COLUMN_NAMES = [
  "place_source",
  "place_kind",
  "place_ref",
  "place_label",
  "place_country_code",
  "place_subdivision_code",
  "place_min_lon",
  "place_min_lat",
  "place_max_lon",
  "place_max_lat",
  "place_geometry_geojson",
  "place_set_at",
] as const satisfies readonly (keyof ProjectPlaceRow)[];

export const PROJECT_PLACE_COLUMNS = PROJECT_PLACE_COLUMN_NAMES.join(", ");

/**
 * Every place column EXCEPT the boundary geometry.
 *
 * A TIGERweb county boundary can be megabytes (see home-geography.ts), and a map
 * route that lists many projects would multiply that by the project count. Any
 * query that does not need to SEED a study area — a list, a map layer, a
 * readiness rollup — must select this instead.
 */
export const PROJECT_PLACE_SCOPE_COLUMNS = PROJECT_PLACE_COLUMN_NAMES.filter(
  (column) => column !== "place_geometry_geojson"
).join(", ");

/** Narrow a project row into the shared, owner-agnostic shape. */
export function placeOfRecordFromProject(row: Partial<ProjectPlaceRow> | null | undefined): PlaceOfRecord {
  const hasBbox =
    row?.place_min_lon != null &&
    row?.place_min_lat != null &&
    row?.place_max_lon != null &&
    row?.place_max_lat != null;

  return {
    source: row?.place_source ?? null,
    kind: row?.place_kind ?? null,
    ref: row?.place_ref ?? null,
    label: row?.place_label ?? null,
    countryCode: row?.place_country_code ?? null,
    subdivisionCode: row?.place_subdivision_code ?? null,
    bbox: hasBbox
      ? {
          minLon: row!.place_min_lon as number,
          minLat: row!.place_min_lat as number,
          maxLon: row!.place_max_lon as number,
          maxLat: row!.place_max_lat as number,
        }
      : null,
    geometry: row?.place_geometry_geojson ?? null,
  };
}

/**
 * A resolved place, from the boundary the server re-fetched.
 *
 * The bbox comes from the resolver, never from the client and never recomputed
 * from the polygon: a client-supplied extent would be an unverifiable geography
 * wearing trusted-looking provenance, and a recomputed one could disagree with
 * the source of record.
 */
export function projectPlaceFromPlaceBoundary(
  boundary: PlaceBoundaryResponse,
  options?: { label?: string | null; setAt?: Date }
): ProjectPlaceRow {
  const label = options?.label?.trim() || boundary.label?.trim() || null;

  return {
    place_source: TIGERWEB_GEOGRAPHY_SOURCE,
    place_kind: boundary.kind,
    place_ref: boundary.geoid,
    place_label: label,
    // TIGERweb is a United States Census service. That is a fact about the
    // adapter, not an assumption in the core.
    place_country_code: "US",
    place_subdivision_code: subdivisionCodeFromTigerwebGeoid(boundary.kind, boundary.geoid),
    place_min_lon: boundary.bbox.minLon,
    place_min_lat: boundary.bbox.minLat,
    place_max_lon: boundary.bbox.maxLon,
    place_max_lat: boundary.bbox.maxLat,
    place_geometry_geojson: boundary.geojson,
    place_set_at: (options?.setAt ?? new Date()).toISOString(),
  };
}

/**
 * A hand-drawn area.
 *
 * `place_ref`, `place_kind` and the jurisdiction codes are null BY CONSTRUCTION,
 * not by omission: a drawn polygon has no identity in anyone's namespace, and
 * the `projects_place_drawn_has_no_ref` CHECK enforces it at the database too.
 * Downstream modules that need a jurisdiction must say "area known, identity
 * unknown" rather than guess which county contains the shape.
 */
export function projectPlaceFromDrawnArea(
  geometry: unknown,
  options?: { label?: string | null; setAt?: Date }
): ProjectPlaceRow | null {
  const bbox = bboxOfGeometry(geometry);
  if (!bbox) return null;

  return {
    place_source: DRAWN_PLACE_SOURCE,
    place_kind: null,
    place_ref: null,
    place_label: options?.label?.trim() || null,
    place_country_code: null,
    place_subdivision_code: null,
    place_min_lon: bbox.minLon,
    place_min_lat: bbox.minLat,
    place_max_lon: bbox.maxLon,
    place_max_lat: bbox.maxLat,
    place_geometry_geojson: geometry,
    place_set_at: (options?.setAt ?? new Date()).toISOString(),
  };
}

/** Every place column blanked — what clearing a project's area writes. */
export function clearedProjectPlace(): ProjectPlaceRow {
  return {
    place_source: null,
    place_kind: null,
    place_ref: null,
    place_label: null,
    place_country_code: null,
    place_subdivision_code: null,
    place_min_lon: null,
    place_min_lat: null,
    place_max_lon: null,
    place_max_lat: null,
    place_geometry_geojson: null,
    place_set_at: null,
  };
}

/**
 * The US county this project's area IS, when it is one.
 *
 * Returns null for a city, a metro, a drawn shape, or anything outside the US —
 * deliberately, because county onboarding runs on a county and inferring one
 * from a smaller or larger area would be a guess. The caller is expected to say
 * so rather than substitute.
 */
export function tigerwebCountyFipsFromProjectPlace(
  place: PlaceOfRecord | null | undefined
): { stateFips: string; countyFips: string } | null {
  if (!place) return null;
  if (place.source !== TIGERWEB_GEOGRAPHY_SOURCE) return null;
  if (place.countryCode !== "US") return null;
  if (place.kind !== "county") return null;

  const ref = place.ref ?? "";
  if (!/^\d{5}$/.test(ref)) return null;

  return { stateFips: ref.slice(0, 2), countyFips: ref.slice(2, 5) };
}
