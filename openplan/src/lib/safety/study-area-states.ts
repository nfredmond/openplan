/**
 * Which states a crash study area lies in, read from its place identity.
 *
 * The crash registry chooses a source by state (see `crashSourcesForStudyArea`
 * in `sources/registry.ts`). These helpers turn the identities OpenPlan already
 * stores into that answer, and return null whenever the identity does not
 * establish a state. A drawn area, a metro or micro area (a CBSA code is not
 * state-prefixed and a CBSA can cross a state line) and a place outside the
 * United States all return null. Null is not a guess: the registry then lets
 * only a national source answer.
 */

import type { PlaceKind } from "@/lib/api/place-geographies";
import { stateFipsFromUsps } from "@/lib/geographies/state-fips";
import { subdivisionCodeFromTigerwebGeoid } from "@/lib/workspaces/home-geography";
import { resolvePlaceBoundary } from "@/lib/geographies/place-resolver";
import { studyAreaBboxesMatch, type StudyAreaBbox } from "@/lib/models/study-area";

/** From a stored place of record, such as a project's `place_*` columns. */
export function crashStatesFromPlaceOfRecord(place: {
  countryCode: string | null | undefined;
  subdivisionCode: string | null | undefined;
}): string[] | null {
  if (place.countryCode?.trim().toUpperCase() !== "US") return null;
  const fips = stateFipsFromUsps(place.subdivisionCode);
  return fips ? [fips] : null;
}

/** From a TIGERweb place the server has resolved. */
export function crashStatesFromTigerwebPlace(kind: PlaceKind, geoid: string): string[] | null {
  const fips = stateFipsFromUsps(subdivisionCodeFromTigerwebGeoid(kind, geoid));
  return fips ? [fips] : null;
}

/**
 * From a stored place of record, but only when its bbox is this study area's.
 *
 * A project's place says where the project is. A corridor run attributed to
 * that project can be drawn anywhere, so the project's state describes the run
 * only when the run's area is the project's area.
 */
export function crashStatesFromMatchingPlaceOfRecord(
  place: {
    countryCode: string | null | undefined;
    subdivisionCode: string | null | undefined;
    bbox: StudyAreaBbox | null | undefined;
  },
  studyAreaBbox: StudyAreaBbox
): string[] | null {
  if (!studyAreaBboxesMatch(studyAreaBbox, place.bbox)) return null;
  return crashStatesFromPlaceOfRecord(place);
}

/**
 * The states of a picked place, or null when the place cannot be confirmed to
 * be this study area. The server re-resolves the identity and uses its state
 * only when the resolved boundary has this same bbox, so a client never
 * supplies a state. A resolver outage also returns null, which lets only the
 * national source answer instead of failing the request.
 */
export async function crashStatesOfConfirmedPlace(
  place: { kind: PlaceKind; geoid: string },
  studyAreaBbox: StudyAreaBbox
): Promise<string[] | null> {
  return (await confirmCrashStudyPlace(place, studyAreaBbox)).stateFips;
}

/**
 * A picked place's states and its resolved boundary polygon, under the same
 * rule: both only when the re-resolved boundary has this study area's bbox.
 * The polygon is the resolver's, never the client's, so the crashes kept are
 * the ones inside the place the identity names.
 */
export async function confirmCrashStudyPlace(
  place: { kind: PlaceKind; geoid: string },
  studyAreaBbox: StudyAreaBbox
): Promise<{ stateFips: string[] | null; geometry: unknown | null }> {
  try {
    const boundary = await resolvePlaceBoundary(place.kind, place.geoid);
    if (!boundary || boundary.kind !== place.kind || boundary.geoid !== place.geoid) {
      return { stateFips: null, geometry: null };
    }
    if (!studyAreaBboxesMatch(studyAreaBbox, boundary.bbox)) return { stateFips: null, geometry: null };
    return {
      stateFips: crashStatesFromTigerwebPlace(place.kind, place.geoid),
      geometry: boundary.geojson ?? null,
    };
  } catch {
    return { stateFips: null, geometry: null };
  }
}
