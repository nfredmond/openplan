import type { SynthesisResponseLinkIntent } from "@/lib/engagement/synthesis-response-records-server";
import type { SynthesisApprovalIntent } from "@/lib/engagement/synthesis-approval";
import { createSynthesisReviewContent } from "@/lib/engagement/synthesis-review";
import { makeSourceSnapshot, savedSource, sourceActor, sourceDate, sourceHash, sourceScope } from "./synthesis-source";

export const id = (n: number) => `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const contextScope = { campaignId: sourceScope.campaignId, workspaceId: sourceScope.workspaceId, reviewId: id(1), responseId: id(2) };
export function fixture(items = 1) {
  const source = savedSource(makeSourceSnapshot(items));
  const { content, preparation } = createSynthesisReviewContent(makeSourceSnapshot(items), source.snapshotSha256);
  const preparationText = JSON.stringify(preparation, null, 1), contentText = JSON.stringify(content, null, 2);
  const revision = { id: contextScope.reviewId, number: 1, contentText, contentSha256: sourceHash(contentText) };
  const intent: SynthesisApprovalIntent = { campaignId: contextScope.campaignId, workspaceId: contextScope.workspaceId, reviewId: contextScope.reviewId,
    sourceId: sourceScope.requestId, sourceSha256: source.snapshotSha256,
    preparationSha256: sourceHash(preparationText), revisionId: revision.id, revisionNo: 1, revisionSha256: revision.contentSha256,
    requestId: id(3), actorId: sourceActor, operation: "approve", reason: "SYNTHETIC exact private approval",
    predecessorId: null, predecessorSha256: null };
  const eventText = JSON.stringify({ schemaVersion: 1, purpose: "internal_staff_synthesis", eventNo: 1, createdAt: sourceDate, intent });
  const recordText = JSON.stringify({ id: contextScope.responseId, campaign_id: contextScope.campaignId, category_id: null,
    theme_title: "SYNTHETIC response", you_said: "SYNTHETIC reviewed issues", we_did: "SYNTHETIC staff explanation é",
    status: "draft", ai_assisted: false, source_item_ids: [], sort_order: 0, published_at: null,
    created_at: sourceDate, updated_at: sourceDate, created_by: sourceActor }, null, 1);
  return { schemaVersion: 1, visibility: "private", purpose: "reviewed_synthesis_response", ...contextScope,
    sourceId: sourceScope.requestId, sourceSha256: source.snapshotSha256, source,
    preparationText, preparationSha256: sourceHash(preparationText), revision,
    approval: { eventText, eventSha256: sourceHash(eventText) }, groupId: content.groups[0].id,
    responseHistory: { id: id(4), campaign_id: contextScope.campaignId, response_id: contextScope.responseId, revision: 1,
      actor_id: sourceActor, recorded_at: sourceDate, event: "created", recordText, record_sha256: sourceHash(recordText) } };
}

export const scope = { ...contextScope, groupId: fixture().groupId };
export type Context = ReturnType<typeof fixture>;
export function event(context: Context, number = 1, previous: ReturnType<typeof packet> | null = null, operation: SynthesisResponseLinkIntent["operation"] = number === 1 ? "link" : "refresh") {
  const contextText = JSON.stringify(context, null, 2), contextSha256 = sourceHash(contextText);
  return { schemaVersion: 1, purpose: "private_synthesis_response_link", eventNo: number, createdAt: sourceDate,
    intent: { ...scope, requestId: id(10 + number), actorId: sourceActor, operation, reason: "SYNTHETIC retained link é🚲",
      predecessorId: previous ? id(9 + number) : null, predecessorSha256: previous?.eventSha256 ?? null,
      expectedContextSha256: operation === "withdraw" ? null : contextSha256 }, context: { contextText, contextSha256 } };
}
export function packet(value: unknown) { const eventText = JSON.stringify(value, null, 2); return { eventText, eventSha256: sourceHash(eventText) }; }
export function history(entries: ReturnType<typeof packet>[]) {
  const head = entries.at(-1);
  return { ...scope, entries, eventCount: entries.length,
    headId: head ? (JSON.parse(head.eventText) as { intent: { requestId: string } }).intent.requestId : null,
    headSha256: head?.eventSha256 ?? null };
}
export function changed(context = fixture()) {
  const result = structuredClone(context);
  result.responseHistory.id = id(50); result.responseHistory.revision = 2; result.responseHistory.event = "corrected";
  const record = JSON.parse(result.responseHistory.recordText);
  result.responseHistory.recordText = JSON.stringify({ ...record, we_did: "SYNTHETIC corrected response" });
  result.responseHistory.record_sha256 = sourceHash(result.responseHistory.recordText);
  return result;
}
export function chain() {
  const original = fixture(), revised = changed(original);
  const first = packet(event(original)), second = packet(event(revised, 2, first));
  const third = packet(event(revised, 3, second, "withdraw")), fourth = packet(event(revised, 4, third));
  return { original, revised, first, second, third, fourth };
}

export function reviewVersion(context: Context, revision: number, approvalNo = 1) {
  const result = structuredClone(context); result.revision.id = id(70 + revision); result.revision.number = revision;
  const approval = JSON.parse(result.approval.eventText);
  approval.eventNo = approvalNo; approval.intent.requestId = id(80 + approvalNo);
  approval.intent.revisionId = result.revision.id; approval.intent.revisionNo = revision;
  result.approval.eventText = JSON.stringify(approval); result.approval.eventSha256 = sourceHash(result.approval.eventText);
  return result;
}
