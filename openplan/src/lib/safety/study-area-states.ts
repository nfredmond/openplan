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

import { normalizePlaceGeoid, type PlaceKind } from "@/lib/api/place-geographies";
import { stateFipsFromUsps } from "@/lib/geographies/state-fips";
import { subdivisionCodeFromTigerwebGeoid, TIGERWEB_GEOGRAPHY_SOURCE } from "@/lib/workspaces/home-geography";
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
 * The states a tribal area's crashes may be read for, from the Census Bureau's
 * own list for the area. Null when the list is unread or empty.
 *
 * Every listed state is passed on, never the first alone. The registry gives a
 * state's crash file only to an area that lies wholly in states that file
 * reads, so one listed state can reach that state's file and several listed
 * states reach only a source that reads all of them, which today is the
 * national file. This is a fact about where the area lies, not about who
 * governs its roads: the place's subdivision code stays unset.
 */
export function crashStatesFromTribalAreaStates(
  censusStateFips: readonly string[] | null | undefined
): string[] | null {
  return censusStateFips && censusStateFips.length > 0 ? [...censusStateFips] : null;
}

/** A tribal study area's Census state list, as it was read for this retrieval. */
export type CrashTribalAreaStates = {
  /** Every state the Census Bureau lists for the area. Null when its record could not be read. */
  censusStateFips: string[] | null;
};

/** What a confirmed place tells the crash source resolver. */
export type ConfirmedCrashStudyPlace = {
  stateFips: string[] | null;
  geometry: unknown | null;
  /** Set only for a tribal area, confirmed or not. Null for every other kind. */
  tribalArea: CrashTribalAreaStates | null;
};

/**
 * A picked place's states and its resolved boundary polygon, under the same
 * rule: both only when the re-resolved boundary has this study area's bbox.
 * The polygon is the resolver's, never the client's, so the crashes kept are
 * the ones inside the place the identity names. A tribal area's states are
 * the Census Bureau's list for it, read from that same boundary answer.
 */
export async function confirmCrashStudyPlace(
  place: { kind: PlaceKind; geoid: string },
  studyAreaBbox: StudyAreaBbox
): Promise<ConfirmedCrashStudyPlace> {
  // The study area is not this place: nothing about the place applies to it.
  const notThisPlace: ConfirmedCrashStudyPlace = { stateFips: null, geometry: null, tribalArea: null };
  // The Census Bureau did not answer for a picked tribal area: the retrieval
  // goes on with the national file and says the state list was not read.
  const unanswered: ConfirmedCrashStudyPlace = {
    stateFips: null,
    geometry: null,
    tribalArea: place.kind === "aiannh" ? { censusStateFips: null } : null,
  };
  try {
    const boundary = await resolvePlaceBoundary(place.kind, place.geoid);
    if (!boundary || boundary.kind !== place.kind || boundary.geoid !== place.geoid) return unanswered;
    if (!studyAreaBboxesMatch(studyAreaBbox, boundary.bbox)) return notThisPlace;
    if (place.kind === "aiannh") {
      const censusStateFips = boundary.tribalAreaStateFips ?? null;
      return {
        stateFips: crashStatesFromTribalAreaStates(censusStateFips),
        geometry: boundary.geojson ?? null,
        tribalArea: { censusStateFips },
      };
    }
    return {
      stateFips: crashStatesFromTigerwebPlace(place.kind, place.geoid),
      geometry: boundary.geojson ?? null,
      tribalArea: null,
    };
  } catch {
    return unanswered;
  }
}

/**
 * A saved tribal area's Census state list, read again by its saved identity.
 * Null when the saved place is not a tribal area the place search resolved.
 *
 * WHY IT IS READ AGAIN AND NOT STORED. A saved place has no column for the
 * states a tribal area lies in: `place_subdivision_code` stays unset for one
 * on purpose (see `subdivisionCodeFromTigerwebGeoid`), and the saved label can
 * be typed by a person. The saved kind and Census id are written by the server
 * from a resolved boundary, so they are what is trusted here, and the Census
 * Bureau is asked which states that id lies in. A place saved before this
 * existed is read the same way. If the Census Bureau does not answer, the
 * list is null and only the national file is read; the retrieval never fails
 * for it.
 */
export async function crashStatesOfSavedTribalArea(place: {
  source: string | null | undefined;
  kind: string | null | undefined;
  ref: string | null | undefined;
}): Promise<CrashTribalAreaStates | null> {
  if (place.source !== TIGERWEB_GEOGRAPHY_SOURCE || place.kind !== "aiannh") return null;
  const geoid = normalizePlaceGeoid("aiannh", place.ref);
  if (!geoid) return { censusStateFips: null };
  try {
    const boundary = await resolvePlaceBoundary("aiannh", geoid);
    if (!boundary || boundary.kind !== "aiannh" || boundary.geoid !== geoid) return { censusStateFips: null };
    return { censusStateFips: boundary.tribalAreaStateFips ?? null };
  } catch {
    return { censusStateFips: null };
  }
}
