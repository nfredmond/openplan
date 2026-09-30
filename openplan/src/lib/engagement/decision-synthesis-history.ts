import { z } from "zod";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";
import { synthesisResponseLinkPacketSchema, synthesisResponseLinkScopeSchema } from "./synthesis-response-link";
import { readResponseLinkHistoryDisplay } from "./synthesis-response-link-reader";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const historySchema = synthesisResponseLinkScopeSchema.extend({
  headId: z.string().uuid(), headSha256: z.string().regex(/^[a-f0-9]{64}$/),
  eventCount: count.refine(value => value > 0), entries: synthesisResponseLinkPacketSchema.array(),
}).strict();
export const decisionSynthesisHistorySchema = z.object({
  observation: z.literal("retained_at_link_preview"), historyCount: count, eventCount: count,
  histories: historySchema.array(),
}).strict();
export type DecisionSynthesisHistory = z.infer<typeof decisionSynthesisHistorySchema>;
type ResponseHead = { id: string; revision: number; recordText: string; recordSha256: string };

/** Validate the captured inventory without treating a historical approval as current authority. */
export async function readDecisionSynthesisHistory(raw: unknown,
  scope: { campaignId: string; workspaceId: string; responseId: string }, response: ResponseHead) {
  const packet = decisionSynthesisHistorySchema.parse(raw);
  if (packet.historyCount !== packet.histories.length
    || packet.eventCount !== packet.histories.reduce((sum, row) => sum + row.eventCount, 0)) {
    throw new Error("Decision synthesis inventory is incomplete");
  }
  const histories = [], addresses = new Set<string>(), events = new Set<string>(), identities = new Map<string, string>();
  for (const history of packet.histories) {
    const address = JSON.stringify([history.reviewId, history.groupId]);
    if (addresses.has(address)) throw new Error("Duplicate decision synthesis history");
    addresses.add(address);
    const verified = await readResponseLinkHistoryDisplay(history, { campaignId: scope.campaignId, workspaceId: scope.workspaceId, responseId: scope.responseId, reviewId: history.reviewId, groupId: history.groupId });
    for (const event of verified.entries) {
      if (events.has(event.intent.requestId)) throw new Error("Duplicate decision synthesis event");
      events.add(event.intent.requestId);
      const context = event.preview.context, retained = context.responseHistory;
      if (retained.revision > response.revision || (retained.revision === response.revision
        && (retained.id !== response.id || retained.recordText !== response.recordText || retained.record_sha256 !== response.recordSha256))) {
        throw new Error("Decision synthesis response version differs");
      }
      for (const [key, value] of [
        [`review:${history.reviewId}`, { sourceId: context.sourceId, sourceSha256: context.sourceSha256, preparationSha256: context.preparationSha256 }],
        [`revision:${context.revision.id}`, { reviewId: history.reviewId, revision: context.revision }],
        [`response:${retained.id}`, retained],
        [`response-version:${retained.revision}`, retained],
        [`approval:${event.preview.approval.intent.requestId}`, context.approval],
      ] as const) {
        const identity = canonicalizeActionPayload(value), previous = identities.get(key);
        if (previous !== undefined && previous !== identity) throw new Error("Decision synthesis retained identity differs");
        identities.set(key, identity);
      }
    }
    histories.push(verified);
  }
  return histories;
}
