import { z } from "zod";
import { closeLoopEntrySchema } from "./close-loop";
import { synthesisReviewContentSchema } from "./synthesis-review";
import { responseHistoryMetadataSchema } from "./response-history";
import { readSynthesisApprovalEvent } from "./synthesis-approval";
import { readSynthesisResponseLinkAcknowledgement, synthesisResponseLinkEventSchema, synthesisResponseLinkPacketSchema,
  synthesisResponseLinkScopeSchema, verifyResponseLinkText, type SynthesisResponseLinkScope } from "./synthesis-response-link";

const uuid = z.string().uuid(), digest = z.string().regex(/^[a-f0-9]{64}$/);
const packetSchema = z.object({ contextText: z.string(), contextSha256: digest }).strict();
export const responseLinkContextPreviewSchema = synthesisResponseLinkScopeSchema.extend({
  schemaVersion: z.literal(1), visibility: z.literal("private"), purpose: z.literal("reviewed_synthesis_response"),
  sourceId: uuid, sourceSha256: digest, preparationSha256: digest,
  revision: z.object({ id: uuid, number: z.number().int().positive(), contentText: z.string(), contentSha256: digest }).strict(),
  approval: z.object({ eventText: z.string(), eventSha256: digest }).strict(),
  responseHistory: responseHistoryMetadataSchema.extend({ recordText: z.string() }).strict(),
}).passthrough();
function checkScope(actual: SynthesisResponseLinkScope, expected: SynthesisResponseLinkScope) {
  for (const field of ["campaignId", "workspaceId", "reviewId", "responseId", "groupId"] as const) {
    if (actual[field] !== expected[field]) throw new Error("Response link display belongs to another review, group or response");
  }
}

/** Display checks exact retained packets; the authenticated server verifies complete source membership and current authority. */
export async function readResponseLinkContextPreview(raw: unknown, expected: SynthesisResponseLinkScope) {
  const scope = synthesisResponseLinkScopeSchema.parse(expected), packet = packetSchema.parse(raw);
  await verifyResponseLinkText(packet.contextText, packet.contextSha256);
  const context = responseLinkContextPreviewSchema.parse(JSON.parse(packet.contextText)); checkScope(context, scope);
  await verifyResponseLinkText(context.revision.contentText, context.revision.contentSha256);
  const content = synthesisReviewContentSchema.parse(JSON.parse(context.revision.contentText));
  if (content.sourceId !== context.sourceId || content.sourceSha256 !== context.sourceSha256) throw new Error("Response link review source differs");
  const group = content.groups.find(row => row.id === scope.groupId);
  if (!group) throw new Error("Response link review group is missing");
  const responseHistory = context.responseHistory;
  if (responseHistory.campaign_id !== scope.campaignId || responseHistory.response_id !== scope.responseId || responseHistory.event === "removed") throw new Error("Response link retained response differs");
  await verifyResponseLinkText(responseHistory.recordText, responseHistory.record_sha256);
  const response = closeLoopEntrySchema.parse(JSON.parse(responseHistory.recordText));
  if (response.id !== scope.responseId || response.campaign_id !== scope.campaignId) throw new Error("Response link response record differs");
  const approval = await readSynthesisApprovalEvent(context.approval, { campaignId: scope.campaignId, workspaceId: scope.workspaceId,
    reviewId: scope.reviewId, sourceId: context.sourceId, sourceSha256: context.sourceSha256, preparationSha256: context.preparationSha256 });
  if (approval.intent.operation !== "approve" || approval.intent.revisionId !== context.revision.id
    || approval.intent.revisionNo !== context.revision.number || approval.intent.revisionSha256 !== context.revision.contentSha256) throw new Error("Response link approval differs from this retained review");
  return { packet, context, content, group, response, approval };
}
export type ResponseLinkContextPreview = Awaited<ReturnType<typeof readResponseLinkContextPreview>>;
const historySchema = synthesisResponseLinkScopeSchema.extend({ eventCount: z.number().int().nonnegative(), headId: uuid.nullable(),
  headSha256: digest.nullable(), entries: z.array(synthesisResponseLinkPacketSchema) });
type DisplayEvent = Awaited<ReturnType<typeof readSynthesisResponseLinkAcknowledgement>>["event"] & { preview: ResponseLinkContextPreview };

/** Every retained event stays available; a complete chain is required before proposing its successor. */
export async function readResponseLinkHistoryDisplay(raw: unknown, expected: SynthesisResponseLinkScope) {
  const scope = synthesisResponseLinkScopeSchema.parse(expected), history = historySchema.parse(raw); checkScope(history, scope);
  if (history.eventCount !== history.entries.length) throw new Error("Response link history is incomplete");
  const entries: DisplayEvent[] = [], ids = new Set<string>(); let head: DisplayEvent | null = null;
  for (const packet of history.entries) {
    const intent = synthesisResponseLinkEventSchema.parse(JSON.parse(packet.eventText)).intent;
    const { event } = await readSynthesisResponseLinkAcknowledgement({ event: packet, replayed: false }, intent);
    checkScope(event.intent, scope);
    if (event.eventNo !== entries.length + 1 || ids.has(intent.requestId)) throw new Error("Response link history order differs");
    if (intent.predecessorId !== (head?.intent.requestId ?? null) || intent.predecessorSha256 !== (head?.eventSha256 ?? null)) throw new Error("Response link history predecessor differs");
    if (intent.operation === "withdraw" && (!head || head.intent.operation === "withdraw" || event.context.contextText !== head.context.contextText
      || event.context.contextSha256 !== head.context.contextSha256)) throw new Error("Response link withdrawal evidence differs");
    const preview = await readResponseLinkContextPreview(event.context, scope);
    head = { ...event, preview }; ids.add(intent.requestId); entries.push(head);
  }
  if (history.headId !== (head?.intent.requestId ?? null) || history.headSha256 !== (head?.eventSha256 ?? null)) throw new Error("Response link history head differs");
  return { scope, entries, head };
}
export type ResponseLinkHistoryDisplay = Awaited<ReturnType<typeof readResponseLinkHistoryDisplay>>;
