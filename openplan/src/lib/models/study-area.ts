/**
 * Pure helpers for the model study-area picker — kept out of the "use client"
 * component so they can be unit-tested without importing Mapbox.
 */

import { placeKindSchema, type PlaceBoundaryResponse } from "@/lib/api/place-geographies";
import { corridorGeojsonSchema, type CorridorGeojson } from "@/lib/models/run-launch";
import {
  placeOfRecordFromHomeGeography,
  TIGERWEB_GEOGRAPHY_SOURCE,
  type WorkspaceHomeGeography,
} from "@/lib/workspaces/home-geography";
import type { PlaceOfRecord } from "@/lib/geographies/place-of-record";

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

  // The narrowing lives in `home-geography.ts` beside the columns it reads, so
  // that this module and `resolveStudyArea` cannot disagree about what a
  // workspace's place of record is.
  return studyAreaPrefillFrom(placeOfRecordFromHomeGeography(geo));
}

/**
 * THE prefill builder, for any place of record — a workspace's home geography,
 * a project's study area, or whatever adopts the shape next.
 *
 * Both honesty rules from the original workspace-only version are unchanged:
 *
 *   - Without the stored boundary geometry there is no prefill at all. A bbox
 *     rectangle drawn around a county is not that county, and quietly analyzing
 *     the wrong shape is worse than asking the user to pick.
 *   - `place` — the identity a lossless county filter is derived from — is only
 *     reconstructed for a source whose refs really are Census GEOIDs. Another
 *     resolver's ref is a different namespace, and a drawn area has no ref at
 *     all, so both stay boundary-only.
 */
export function studyAreaPrefillFrom(source: PlaceOfRecord | null | undefined): StudyAreaPrefill {
  if (!source) return EMPTY_STUDY_AREA_PREFILL;

  const geometry = corridorGeojsonSchema.safeParse(source.geometry);
  if (!geometry.success) return EMPTY_STUDY_AREA_PREFILL;

  const label = source.label?.trim() || null;
  const corridorText = JSON.stringify(geometry.data);

  const kind = placeKindSchema.safeParse(source.kind);
  const place: PlaceBoundaryResponse | null =
    source.source === TIGERWEB_GEOGRAPHY_SOURCE && kind.success && source.bbox && source.ref
      ? { kind: kind.data, geoid: source.ref, label, geojson: geometry.data, bbox: source.bbox }
      : null;

  return { corridorText, geometry: geometry.data, place, label };
}

/** Where an inherited study area came from. `none` means nothing was inherited. */
export type StudyAreaOrigin = "existing" | "project" | "workspace_home" | "previous_run" | "none";

export type ResolvedStudyArea = StudyAreaPrefill & {
  origin: StudyAreaOrigin;
  /**
   * What the planner is TOLD about where this area came from, for the picker's
   * `externalLabel`. Null when nothing was inherited — never a place name
   * standing in for an explanation.
   */
  originLabel: string | null;
};

const EMPTY_RESOLVED_STUDY_AREA: ResolvedStudyArea = {
  ...EMPTY_STUDY_AREA_PREFILL,
  origin: "none",
  originLabel: null,
};

/**
 * Decide which study area a surface should open with.
 *
 * Two invariants hold for every caller, and both are asserted in
 * `study-area-precedence.test.ts`:
 *
 *   1. A prefill is applied ONCE, into an EMPTY field, and never over a user's
 *      edit. This function is pure and does not know about edits, so the caller
 *      owns that — the established pattern is `use-explore-home-geography.ts`'s
 *      `prefillAppliedRef`.
 *   2. The origin is always SHOWN. `StudyAreaPicker` has an `externalLabel` prop
 *      for exactly this. An inherited study area that does not say where it came
 *      from is a silent assumption about what is being analysed.
 *
 * No branch of this function can invent a place: with nothing to inherit it
 * returns empty, never a continental default.
 */
export function resolveStudyArea(candidates: {
  /** The area this record ALREADY carries — a model's launch template, a reloaded run. */
  existing?: CorridorGeojson | null;
  project?: PlaceOfRecord | null;
  workspaceHome?: PlaceOfRecord | null;
  /** What this surface ran last time. A habit, not a statement. */
  previousRun?: CorridorGeojson | null;
}): ResolvedStudyArea {
  // The record's own value is not part of the chain — it OUTRANKS it. A corridor
  // someone deliberately chose for this record must not be replaced by a
  // project-wide area just because one exists.
  if (candidates.existing) {
    return {
      corridorText: JSON.stringify(candidates.existing),
      geometry: candidates.existing,
      place: null,
      label: null,
      origin: "existing",
      originLabel: "the area this record already uses",
    };
  }

  const project = studyAreaPrefillFrom(candidates.project);
  if (project.geometry) {
    return {
      ...project,
      origin: "project",
      originLabel: project.label ?? "this project's study area",
    };
  }

  const workspaceHome = studyAreaPrefillFrom(candidates.workspaceHome);
  if (workspaceHome.geometry) {
    return {
      ...workspaceHome,
      origin: "workspace_home",
      originLabel: workspaceHome.label ?? "this workspace's home geography",
    };
  }

  if (candidates.previousRun) {
    return {
      corridorText: JSON.stringify(candidates.previousRun),
      geometry: candidates.previousRun,
      place: null,
      label: null,
      origin: "previous_run",
      originLabel: "the area this surface last used",
    };
  }

  return EMPTY_RESOLVED_STUDY_AREA;
}
