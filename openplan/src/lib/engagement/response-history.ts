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
  // Old history and pre-upgrade readers have no reason metadata. Unknown stays null.
  write_request_id: z.string().uuid().nullable().default(null),
  change_reason: z.string().nullable().default(null),
  change_origin: z.enum(["staff", "source_withdrawal"]).nullable().default(null),
});

export const responseHistoryEntrySchema = responseHistoryMetadataSchema.extend({ record: closeLoopEntrySchema });
export type ResponseHistoryEntry = z.infer<typeof responseHistoryEntrySchema>;
