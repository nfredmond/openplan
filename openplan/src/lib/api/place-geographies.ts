import { z } from "zod";
import { corridorGeojsonSchema } from "@/lib/models/run-launch";

/**
 * A resolvable US place a user can pick as a model study area. `kind` selects the
 * TIGERweb layer used to fetch the boundary; `geoid` is the Census GEOID in that
 * layer's own format (see `PLACE_GEOID_PATTERNS`).
 *
 * `aiannh` is an American Indian, Alaska Native or Native Hawaiian area: a
 * reservation, off-reservation trust land, Hawaiian home land or tribal
 * statistical area. `cousub` is a county subdivision: a New England town, a
 * Midwest township, a borough or other minor civil division.
 */
export const placeKindSchema = z.enum(["county", "city", "cdp", "metro", "micro", "aiannh", "cousub"]);
export type PlaceKind = z.infer<typeof placeKindSchema>;

/**
 * The GEOID each kind uses in TIGERweb, checked per kind rather than by one
 * loose length range.
 *
 * - county SSCCC and CBSA (metro/micro) codes are 5 digits; a CBSA code is not
 *   state-prefixed.
 * - incorporated places and CDPs are SSPPPPP, 7 digits.
 * - county subdivisions are SSCCCNNNNN, 10 digits.
 * - AIANNH areas are the 4-digit Census AIANNH code plus the component letter
 *   TIGERweb appends: R for a reservation or statistical area, T for trust land
 *   or a Hawaiian home land ("2430R" is the Navajo Nation Reservation, "2430T"
 *   its off-reservation trust land). The code is not state-prefixed, and one
 *   area can span several states.
 *
 * Read from each layer's `GEOID` field on tigerWMS_Current (January 1, 2026
 * vintage) on 2026-11-01; all 867 AIANNH features in the nine layers matched
 * the AIANNH pattern and none repeated.
 */
const PLACE_GEOID_PATTERNS: Record<PlaceKind, RegExp> = {
  county: /^\d{5}$/,
  city: /^\d{7}$/,
  cdp: /^\d{7}$/,
  metro: /^\d{5}$/,
  micro: /^\d{5}$/,
  aiannh: /^\d{4}[RT]$/,
  cousub: /^\d{10}$/,
};

/**
 * The GEOID in its canonical form for `kind`, or null when it is not one.
 *
 * Trims and uppercases only. Nothing is stripped: a value that needs repair to
 * look like a GEOID is not a reference anyone picked.
 */
export function normalizePlaceGeoid(kind: PlaceKind, raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const geoid = raw.trim().toUpperCase();
  return PLACE_GEOID_PATTERNS[kind].test(geoid) ? geoid : null;
}

/** Longest GEOID of any kind (a county subdivision), for a coarse bound before the kind is known. */
const PLACE_GEOID_MAX_LENGTH = 10;

/**
 * Adds the per-kind GEOID check to any object schema carrying `kind` and
 * `geoid`, so every route that accepts a place reference validates it the same
 * way the resolver will.
 */
export function refinePlaceReference(
  value: { kind: PlaceKind; geoid: string },
  ctx: z.RefinementCtx
): void {
  if (!normalizePlaceGeoid(value.kind, value.geoid)) {
    ctx.addIssue({
      code: "custom",
      path: ["geoid"],
      message: `That is not a GEOID for a ${PLACE_KIND_LABELS[value.kind]}.`,
    });
  }
}

/** A GEOID string before its kind is known: bounded, never trusted on its own. */
export const placeGeoidStringSchema = z.string().trim().min(1).max(PLACE_GEOID_MAX_LENGTH);

/**
 * Plural, planner-facing names for each kind. Lives here (not in the resolver)
 * because the picker has to name what could not be searched, and the picker is
 * a client component that must not pull the server-side resolver into its bundle.
 */
export const PLACE_KIND_PLURAL_LABELS: Record<PlaceKind, string> = {
  county: "counties",
  city: "cities and towns",
  cdp: "census-designated places",
  metro: "metro areas",
  micro: "micropolitan areas",
  aiannh: "tribal areas",
  cousub: "towns and townships",
};

/**
 * Singular forms, for telling a planner what they picked.
 *
 * A surface that only works on one kind — county onboarding runs on a county —
 * has to say "Columbus is a city, pick the county that contains it" rather than
 * silently accepting a place it cannot use. The plural map above reads wrong in
 * that sentence, and pluralizing by hand at each call site drifts.
 */
export const PLACE_KIND_LABELS: Record<PlaceKind, string> = {
  county: "county",
  city: "city or town",
  cdp: "census-designated place",
  metro: "metro area",
  micro: "micropolitan area",
  aiannh: "tribal area",
  cousub: "town or township",
};

export const placeSearchItemSchema = z
  .object({
    kind: placeKindSchema,
    geoid: placeGeoidStringSchema,
    label: z.string().min(1),
    description: z.string().min(1),
    /** Null when the place spans states (a CBSA, a multi-state tribal area). */
    stateFips: z.string().nullable(),
  })
  .superRefine(refinePlaceReference);

/**
 * A search response carries its own coverage.
 *
 * `items: []` alone cannot say whether nothing matched or nothing answered, and
 * the picker has to tell a planner which it was — telling someone their county
 * does not exist because a key is unset is the worst failure this front door
 * has. Both extra fields default, so an older client keeps working.
 */
export const placeSearchResponseSchema = z.object({
  items: z.array(placeSearchItemSchema),
  /** Place kinds whose lookup did not answer. */
  unavailableKinds: z.array(placeKindSchema).default([]),
  /** True when no lookup answered at all. */
  searchUnavailable: z.boolean().default(false),
  /** Why, in planner terms, when knowable. Never names a secret. */
  unavailableReason: z.string().nullable().default(null),
});

export const placeBoundaryBboxSchema = z.object({
  minLon: z.number(),
  minLat: z.number(),
  maxLon: z.number(),
  maxLat: z.number(),
});

export const placeBoundaryResponseSchema = z
  .object({
    kind: placeKindSchema,
    geoid: placeGeoidStringSchema,
    label: z.string().nullable(),
    geojson: corridorGeojsonSchema,
    bbox: placeBoundaryBboxSchema,
  })
  .superRefine(refinePlaceReference);

export type PlaceSearchItem = z.infer<typeof placeSearchItemSchema>;
export type PlaceSearchResponse = z.infer<typeof placeSearchResponseSchema>;
export type PlaceBoundaryResponse = z.infer<typeof placeBoundaryResponseSchema>;
