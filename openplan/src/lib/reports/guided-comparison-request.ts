import { z } from "zod";

/** Selection syntax is shared without importing private artifact readers. */
export const guidedComparisonRequestSchema = z.object({ snapshotId: z.string().uuid() })
  .strict().nullable().optional();
