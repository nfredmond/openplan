import { z } from "zod";
import { corridorGeojsonSchema } from "@/lib/models/run-launch";

/**
 * A resolvable US place a user can pick as a model study area. `kind` selects the
 * TIGERweb layer used to fetch the boundary; `geoid` is the Census GEOID
 * (5 digits for county/CBSA, 7 for an incorporated place / CDP).
 */
export const placeKindSchema = z.enum(["county", "city", "cdp", "metro", "micro"]);
export type PlaceKind = z.infer<typeof placeKindSchema>;

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
};

export const placeSearchItemSchema = z.object({
  kind: placeKindSchema,
  geoid: z.string().min(5).max(7),
  label: z.string().min(1),
  description: z.string().min(1),
  stateFips: z.string().nullable(),
});

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

export const placeBoundaryResponseSchema = z.object({
  kind: placeKindSchema,
  geoid: z.string().min(5).max(7),
  label: z.string().nullable(),
  geojson: corridorGeojsonSchema,
  bbox: placeBoundaryBboxSchema,
});

export type PlaceSearchItem = z.infer<typeof placeSearchItemSchema>;
export type PlaceSearchResponse = z.infer<typeof placeSearchResponseSchema>;
export type PlaceBoundaryResponse = z.infer<typeof placeBoundaryResponseSchema>;
