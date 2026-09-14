import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applySynthesisReviewChange, createSynthesisReviewContent, synthesisReviewIntentSchema, verifySynthesisReviewContent, type SynthesisReviewIntent } from "./synthesis-review";
import { synthesisReviewReceiptSchema, synthesisReviewRecordSchema, type SynthesisReviewRecord } from "./synthesis-review-records";
import { loadSynthesisSource } from "./synthesis-sources-server";

type Client = Pick<SupabaseClient, "rpc">;
type Scope = { campaignId: string; workspaceId: string; reviewId: string; revisionId?: string };
const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

export class SynthesisReviewError extends Error {
  constructor(public readonly kind: "conflict" | "invalid" | "forbidden" | "unavailable", message: string) { super(message); }
}
function databaseError(code: string) {
  const kind = code === "PT409" ? "conflict" : code === "22023" ? "invalid" : code === "42501" ? "forbidden" : "unavailable";
  return new SynthesisReviewError(kind, "Saved review operation could not be confirmed");
}

/** Missing work is distinct from a failed query; only a successful null permits a new request. */
async function readRecord(client: Client, scope: Scope) {
  const result = await client.rpc("read_engagement_synthesis_review", { p_campaign: scope.campaignId, p_review: scope.reviewId, p_revision: scope.revisionId ?? null });
  if (result.error) throw databaseError(result.error.code);
  if (result.data === null) return null;
  const record = synthesisReviewRecordSchema.parse(result.data);
  if (record.campaignId !== scope.campaignId || record.workspaceId !== scope.workspaceId || record.reviewId !== scope.reviewId
    || (scope.revisionId && record.revision.requestId !== scope.revisionId)) throw new Error("Saved review scope differs");
  if (hash(record.preparationText) !== record.preparationSha256 || hash(record.revision.contentText) !== record.revision.contentSha256) throw new Error("Saved review checksum differs");
  const { revision } = record, { intent } = revision;
  if (intent.requestId !== revision.requestId || intent.actorId !== revision.actorId || intent.workspaceId !== record.workspaceId) throw new Error("Saved review authorship differs");
  if (intent.operation === "create") {
    if (revision.revisionNo !== 1 || revision.requestId !== record.reviewId || revision.parentId !== null || revision.parentSha256 !== null
      || revision.reason !== null || revision.actorId !== record.createdBy || intent.sourceId !== record.sourceId || intent.sourceSha256 !== record.sourceSha256) throw new Error("Saved review original differs");
  } else if (revision.revisionNo <= 1 || intent.reviewId !== record.reviewId || intent.expectedRevisionId !== revision.parentId
    || intent.expectedRevisionSha256 !== revision.parentSha256 || intent.reason !== revision.reason) throw new Error("Saved review correction lineage differs");
  return record;
}

/** Check the complete lineage against its immutable source, including replaying each retained staff command. */
export async function loadSynthesisReview(client: Client, scope: Scope) {
  const saved = await readRecord(client, scope);
  if (!saved) return null;
  const source = await loadSynthesisSource(client, { campaignId: scope.campaignId, workspaceId: scope.workspaceId, requestId: saved.sourceId });
  if (source.snapshotSha256 !== saved.sourceSha256) throw new Error("Saved review source checksum differs");
  const initial = createSynthesisReviewContent(source.snapshot, source.snapshotSha256);
  if (!isDeepStrictEqual(JSON.parse(saved.preparationText), initial.preparation)) throw new Error("Saved review preparation differs from its source");
  const chain: SynthesisReviewRecord[] = [saved];
  let child = saved;
  while (child.revision.parentId !== null) {
    const parent = await readRecord(client, { ...scope, revisionId: child.revision.parentId });
    if (!parent || parent.revision.revisionNo !== child.revision.revisionNo - 1 || parent.revision.contentSha256 !== child.revision.parentSha256
      || parent.sourceId !== saved.sourceId || parent.sourceSha256 !== saved.sourceSha256 || parent.preparationText !== saved.preparationText
      || parent.createdBy !== saved.createdBy || parent.createdAt !== saved.createdAt) throw new Error("Saved review parent differs");
    chain.push(parent); child = parent;
  }
  let content = initial.content;
  for (const record of chain.reverse()) {
    if (record.revision.intent.operation === "correct") content = applySynthesisReviewChange(content, record.revision.intent.change, source.snapshot, source.snapshotSha256);
    const retained = verifySynthesisReviewContent(JSON.parse(record.revision.contentText), source.snapshot, source.snapshotSha256);
    if (!isDeepStrictEqual(retained, content)) throw new Error("Saved review content differs from its command");
  }
  return { ...saved, preparation: initial.preparation, content, source };
}

function receiptFor(saved: NonNullable<Awaited<ReturnType<typeof loadSynthesisReview>>>) {
  return synthesisReviewReceiptSchema.parse({
    requestId: saved.revision.requestId, reviewId: saved.reviewId, campaignId: saved.campaignId, workspaceId: saved.workspaceId,
    sourceId: saved.sourceId, sourceSha256: saved.sourceSha256, preparationSha256: saved.preparationSha256,
    revisionNo: saved.revision.revisionNo, revisionSha256: saved.revision.contentSha256, createdAt: saved.revision.createdAt, replayed: true,
  });
}

/** Caller authenticates the bound actor; the service-only writer checks membership again inside its transaction. */
export async function retainSynthesisReview(client: Client, service: Client, campaignId: string, rawIntent: SynthesisReviewIntent) {
  const intent = synthesisReviewIntentSchema.parse(rawIntent);
  const scope = { campaignId, workspaceId: intent.workspaceId, reviewId: intent.operation === "create" ? intent.requestId : intent.reviewId };
  const recover = async () => {
    const existing = await loadSynthesisReview(client, { ...scope, revisionId: intent.requestId });
    if (!existing) return null;
    if (!isDeepStrictEqual(existing.revision.intent, intent)) throw new SynthesisReviewError("conflict", "This request belongs to a different review command");
    return receiptFor(existing);
  };
  const existing = await recover();
  if (existing) return existing;
  const parent = intent.operation === "correct" ? await loadSynthesisReview(client, scope) : null;
  if (intent.operation === "correct" && (!parent || parent.revision.requestId !== intent.expectedRevisionId || parent.revision.contentSha256 !== intent.expectedRevisionSha256)) {
    const raced = await recover();
    if (raced) return raced;
    throw new SynthesisReviewError("conflict", "Open the current review before correcting it");
  }
  const source = parent ? parent.source : intent.operation === "create"
    ? await loadSynthesisSource(client, { campaignId, workspaceId: intent.workspaceId, requestId: intent.sourceId }) : null;
  if (!source) throw new SynthesisReviewError("conflict", "The parent review is unavailable");
  if (intent.operation === "create" && source.snapshotSha256 !== intent.sourceSha256) throw new SynthesisReviewError("conflict", "The selected source checksum differs");
  const initial = createSynthesisReviewContent(source.snapshot, source.snapshotSha256);
  let content = initial.content;
  if (intent.operation === "correct" && parent) {
    try { content = applySynthesisReviewChange(parent.content, intent.change, source.snapshot, source.snapshotSha256); }
    catch { throw new SynthesisReviewError("invalid", "Review the correction and source membership"); }
  }
  const contentText = JSON.stringify(content), preparationText = parent ? null : JSON.stringify(initial.preparation);
  const result = await service.rpc("retain_engagement_synthesis_review", { p_campaign: campaignId, p_actor: intent.actorId, p_workspace: intent.workspaceId,
    p_intent: intent, p_source: source.requestId, p_source_sha256: source.snapshotSha256, p_preparation_text: preparationText, p_content_text: contentText });
  if (result.error) {
    if (result.error.code === "PT409") {
      const raced = await recover();
      if (raced) return raced;
    }
    throw databaseError(result.error.code);
  }
  const receipt = synthesisReviewReceiptSchema.parse(result.data);
  if (receipt.requestId !== intent.requestId || receipt.reviewId !== scope.reviewId || receipt.campaignId !== campaignId || receipt.workspaceId !== intent.workspaceId
    || receipt.sourceId !== source.requestId || receipt.sourceSha256 !== source.snapshotSha256 || receipt.preparationSha256 !== (parent?.preparationSha256 ?? hash(JSON.stringify(initial.preparation)))
    || receipt.revisionNo !== (parent ? parent.revision.revisionNo + 1 : 1) || receipt.revisionSha256 !== hash(contentText)) throw new Error("Saved review receipt differs");
  return receipt;
}
