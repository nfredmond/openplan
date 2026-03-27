import { z } from "zod";

export const countyGeographySearchItemSchema = z.object({
  geographyId: z.string().length(5),
  geographyLabel: z.string().min(1),
  countyPrefix: z.string().min(1),
  countySlug: z.string().min(1),
  suggestedRunName: z.string().min(1),
});

export const countyGeographySearchResponseSchema = z.object({
  items: z.array(countyGeographySearchItemSchema),
});

export type CountyGeographySearchItem = z.infer<typeof countyGeographySearchItemSchema>;
export type CountyGeographySearchResponse = z.infer<typeof countyGeographySearchResponseSchema>;
