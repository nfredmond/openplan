import { z } from "zod";
import { synthesisResponseLinkScopeSchema } from "./synthesis-response-link";

export const synthesisResponseLinkReviewSchema = synthesisResponseLinkScopeSchema.pick({ campaignId: true, workspaceId: true, reviewId: true });
export type SynthesisResponseLinkReview = z.infer<typeof synthesisResponseLinkReviewSchema>;
const indexSchema = synthesisResponseLinkReviewSchema.extend({
  entryCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  entries: z.array(synthesisResponseLinkScopeSchema.pick({ responseId: true, groupId: true })),
});

/** An index names retained links for navigation; it does not establish their evidence or current eligibility. */
export function readSynthesisResponseLinkIndex(raw: unknown, expected: SynthesisResponseLinkReview) {
  const scope = synthesisResponseLinkReviewSchema.parse(expected), index = indexSchema.parse(raw);
  if (index.campaignId !== scope.campaignId || index.workspaceId !== scope.workspaceId || index.reviewId !== scope.reviewId) {
    throw new Error("Synthesis response index scope differs");
  }
  if (index.entryCount !== index.entries.length) throw new Error("Synthesis response index is incomplete");
  let previous: string | null = null;
  for (const row of index.entries) {
    const key = `${row.responseId}:${row.groupId}`;
    if (previous !== null && previous >= key) throw new Error("Synthesis response index repeats or reorders a link");
    previous = key;
  }
  return index;
}
