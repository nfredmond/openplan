import { z } from "zod";
import { closeLoopEntrySchema } from "./close-loop";

export const responseHistoryMetadataSchema = z.object({
  id: z.string().uuid(),
  campaign_id: z.string().uuid(),
  response_id: z.string().uuid(),
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  actor_id: z.string().uuid().nullable(),
  recorded_at: z.string().datetime({ offset: true }),
  event: z.enum(["legacy_baseline", "created", "corrected", "published", "unpublished", "removed"]),
  record_sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export const responseHistoryEntrySchema = responseHistoryMetadataSchema.extend({ record: closeLoopEntrySchema });
export type ResponseHistoryEntry = z.infer<typeof responseHistoryEntrySchema>;
