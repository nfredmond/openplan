/**
 * Pure helpers for the model study-area picker — kept out of the "use client"
 * component so they can be unit-tested without importing Mapbox.
 */

import { placeKindSchema, type PlaceBoundaryResponse } from "@/lib/api/place-geographies";
import { corridorGeojsonSchema, type CorridorGeojson } from "@/lib/models/run-launch";
import {
  homeGeographyBbox,
  homeGeographyLabel,
  TIGERWEB_GEOGRAPHY_SOURCE,
  type WorkspaceHomeGeography,
} from "@/lib/workspaces/home-geography";

export type StudyAreaBbox = { minLon: number; minLat: number; maxLon: number; maxLat: number };

export type CorridorSummary = {
  valid: boolean;
  bbox: StudyAreaBbox | null;
  areaKm2: number | null;
};

// A bbox extent larger than this (km²) is a big study area: the in-process
// sketch ABM caps at 150 tracts and runs synchronously, so large areas belong
// on the async AequilibraE (Fast Screening) engine and take longer.
export const LARGE_AREA_KM2 = 2500;

export const CONTINENTAL_US_CENTER: [number, number] = [-98.5795, 39.8283];

function walkCoordinates(coordinates: unknown, visit: (lon: number, lat: number) => void): void {
  if (!Array.isArray(coordinates)) return;
  if (coordinates.length >= 2 && typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
    visit(coordinates[0] as number, coordinates[1] as number);
    return;
  }
  for (const child of coordinates) {
    walkCoordinates(child, visit);
  }
}

/**
 * Best-effort summary of whatever corridor GeoJSON text is currently set —
 * regardless of whether it came from search, drawing, or a raw paste. Returns
 * a bounding box and an approximate bounding-extent area in km².
 */
export function summarizeCorridorText(text: string): CorridorSummary {
  const trimmed = text.trim();
  if (!trimmed) return { valid: false, bbox: null, areaKm2: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { valid: false, bbox: null, areaKm2: null };
  }

  const geometry = parsed as { type?: string; coordinates?: unknown };
  if (geometry?.type !== "Polygon" && geometry?.type !== "MultiPolygon") {
    return { valid: false, bbox: null, areaKm2: null };
  }

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  walkCoordinates(geometry.coordinates, (lon, lat) => {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  });

  if (!Number.isFinite(minLon) || !Number.isFinite(minLat)) {
    return { valid: false, bbox: null, areaKm2: null };
  }

  const midLat = (minLat + maxLat) / 2;
  const latKm = (maxLat - minLat) * 111;
  const lonKm = (maxLon - minLon) * 111 * Math.cos((midLat * Math.PI) / 180);
  const areaKm2 = Math.max(0, Math.round(latKm * lonKm));

  return { valid: true, bbox: { minLon, minLat, maxLon, maxLat }, areaKm2 };
}

/**
 * The corridor geometry a study-area text carries, or `null` when the text is
 * empty or is not one.
 *
 * `StudyAreaPicker` is controlled around GeoJSON TEXT, but a caller whose own
 * state is the geometry object (Analysis Studio holds `corridorGeojson`) has to
 * cross that boundary. Doing it here, against the same schema the run APIs
 * validate against, keeps "what the picker accepted" and "what a run will
 * accept" from drifting apart in each caller's private parser.
 */
export function parseCorridorText(text: string): CorridorGeojson | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const result = corridorGeojsonSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

/**
 * A study-area selection reconstructed from something the user already told the
 * app — today, the workspace's home geography.
 *
 * `corridorText` is what the controlled picker takes; `geometry` is the same
 * boundary as an object, for callers whose state is the geometry rather than its
 * text (Analysis Studio). `place` is the resolved place identity when — and only
 * when — it can be reconstructed losslessly.
 */
export type StudyAreaPrefill = {
  corridorText: string;
  geometry: CorridorGeojson | null;
  place: PlaceBoundaryResponse | null;
  label: string | null;
};

export const EMPTY_STUDY_AREA_PREFILL: StudyAreaPrefill = {
  corridorText: "",
  geometry: null,
  place: null,
  label: null,
};

/**
 * Turn a workspace's stated home geography back into a study-area selection.
 *
 * This is the inverse of `homeGeographyFromPlaceBoundary` — it exists so an
 * agency that has already told the app where it works does not have to re-pick
 * its own county on every visit. It is still a PRE-FILL, not a lock: the picker
 * above it can change or clear it exactly as before.
 *
 * Two honesty rules:
 *
 *   - Without the stored boundary geometry there is no prefill at all. A bbox
 *     rectangle drawn around a county is not that county, and quietly analyzing
 *     the wrong shape is worse than asking the user to pick.
 *   - `place` (the identity a lossless county filter is derived from) is only
 *     reconstructed for a source whose refs really are Census GEOIDs. Another
 *     resolver's ref would be a different namespace, so it stays bbox-only.
 *
 * Lives here rather than beside its first caller because it is now shared:
 * Safety and Analysis Studio both open on the workspace's own geography, and
 * two copies of this reasoning would be two places for it to drift.
 */
export function studyAreaPrefillFromHomeGeography(
  geo: WorkspaceHomeGeography | null | undefined
): StudyAreaPrefill {
  if (!geo) return EMPTY_STUDY_AREA_PREFILL;

  const geometry = corridorGeojsonSchema.safeParse(geo.home_geometry_geojson);
  if (!geometry.success) return EMPTY_STUDY_AREA_PREFILL;

  const label = homeGeographyLabel(geo);
  const corridorText = JSON.stringify(geometry.data);

  const kind = placeKindSchema.safeParse(geo.home_geography_kind);
  const bbox = homeGeographyBbox(geo);
  const geoid = geo.home_geography_ref;
  const place: PlaceBoundaryResponse | null =
    geo.home_geography_source === TIGERWEB_GEOGRAPHY_SOURCE && kind.success && bbox && geoid
      ? { kind: kind.data, geoid, label, geojson: geometry.data, bbox }
      : null;

  return { corridorText, geometry: geometry.data, place, label };
}
