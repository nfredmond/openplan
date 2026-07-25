import { z } from "zod";

export const countyGeographySearchItemSchema = z.object({
  geographyId: z.string().length(5),
  geographyLabel: z.string().min(1),
  countyPrefix: z.string().min(1),
  countySlug: z.string().min(1),
  suggestedRunName: z.string().min(1),
});

/**
 * Like the place search, the county search reports whether the catalog could be
 * read. An empty `items` with `catalogUnavailable: true` is "we could not ask",
 * not "your county is not in the United States".
 */
export const countyGeographySearchResponseSchema = z.object({
  items: z.array(countyGeographySearchItemSchema),
  catalogUnavailable: z.boolean().default(false),
  unavailableReason: z.string().nullable().default(null),
});

export type CountyGeographySearchItem = z.infer<typeof countyGeographySearchItemSchema>;
export type CountyGeographySearchResponse = z.infer<typeof countyGeographySearchResponseSchema>;
