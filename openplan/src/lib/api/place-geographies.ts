import { z } from "zod";
import { corridorGeojsonSchema } from "@/lib/models/run-launch";

/**
 * A resolvable US place a user can pick as a model study area. `kind` selects the
 * TIGERweb layer used to fetch the boundary; `geoid` is the Census GEOID
 * (5 digits for county/CBSA, 7 for an incorporated place / CDP).
 */
export const placeKindSchema = z.enum(["county", "city", "cdp", "metro", "micro"]);
export type PlaceKind = z.infer<typeof placeKindSchema>;

export const placeSearchItemSchema = z.object({
  kind: placeKindSchema,
  geoid: z.string().min(5).max(7),
  label: z.string().min(1),
  description: z.string().min(1),
  stateFips: z.string().nullable(),
});

export const placeSearchResponseSchema = z.object({
  items: z.array(placeSearchItemSchema),
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
