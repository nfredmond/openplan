import { z } from "zod";

// Contains attempt identifiers and outcomes, never recipient addresses or message text.
export const responseEmailOutcomeSchema = z.object({
  outboxId: z.string().uuid(),
  attemptToken: z.string().uuid(),
  state: z.enum(["accepted", "skipped", "failed", "uncertain"]),
  transport: z.string().min(1).max(80),
  error: z.string().max(500).nullable(),
}).strict();
export type ResponseEmailOutcome = z.infer<typeof responseEmailOutcomeSchema>;
