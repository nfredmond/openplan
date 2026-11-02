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
