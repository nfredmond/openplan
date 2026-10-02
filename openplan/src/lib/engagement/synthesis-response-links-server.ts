import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { readResponseHistorySnapshot } from "./response-history-server";
import { loadSynthesisApprovalState, SynthesisApprovalError } from "./synthesis-approval-server";
import { SynthesisReviewError } from "./synthesis-review-server";
import { readSynthesisResponseContext } from "./synthesis-response-context-server";

import type { SynthesisReviewEvidenceService } from "./synthesis-thematic-import-server";

const uuid = z.string().uuid();
const addressSchema = z.object({
  campaignId: uuid, workspaceId: uuid, reviewId: uuid, responseId: uuid,
  groupId: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
}).strict();

export class SynthesisResponseLinkError extends Error {
  constructor(public readonly kind: "invalid" | "forbidden" | "conflict" | "unavailable", message: string) { super(message); }
}

/**
 * Use a staff-authenticated client, never a service-role shortcut. Native readers
 * enforce access and return complete histories. This preview observes their
 * current heads; the writer must compare those heads again under its locks.
 */
export async function loadSynthesisResponseContext(client: Pick<SupabaseClient, "rpc">, rawAddress: unknown, service?: SynthesisReviewEvidenceService) {
  const parsed = addressSchema.safeParse(rawAddress);
  if (!parsed.success) throw new SynthesisResponseLinkError("invalid", "Select a saved review group and response");
  const { groupId, ...scope } = parsed.data;
  try {
    const state = await loadSynthesisApprovalState(client, {
      campaignId: scope.campaignId, workspaceId: scope.workspaceId, reviewId: scope.reviewId,
    }, service);
    if (!state) throw new SynthesisResponseLinkError("conflict", "The saved review is unavailable");
    const { review, history, current } = state, approval = history.head;
    if (!approval || approval.intent.operation !== "approve" || approval.intent.revisionId !== current.revisionId
      || review.currentRevisionId !== review.revision.requestId) {
      throw new SynthesisResponseLinkError("conflict", "Approve the current saved review before linking a response");
    }
    if (!review.content.groups.some(group => group.id === groupId)) throw new SynthesisResponseLinkError("conflict", "The selected review group is unavailable");
    const result = await client.rpc("read_engagement_response_history", { p_campaign: scope.campaignId });
    if (result.error) throw new SynthesisResponseLinkError(result.error.code === "42501" ? "forbidden" : "unavailable", "The saved response history is unavailable");
    const responseHistory = readResponseHistorySnapshot(result.data, scope.campaignId);
    const latest = responseHistory.records.findLast(row => row.response_id === scope.responseId);
    if (!latest || latest.event === "removed") throw new SynthesisResponseLinkError("conflict", "The response is no longer available for a new link");
    const { record_text: recordText, ...metadata } = latest;
    const { requestId, campaignId, workspaceId, snapshotText, snapshotSha256, createdAt } = review.source;
    const contextText = JSON.stringify({
      schemaVersion: 1, visibility: "private", purpose: "reviewed_synthesis_response", ...scope,
      sourceId: review.sourceId, sourceSha256: review.sourceSha256,
      source: { requestId, campaignId, workspaceId, snapshotText, snapshotSha256, createdAt },
      preparationText: review.preparationText, preparationSha256: review.preparationSha256,
      revision: { id: review.revision.requestId, number: review.revision.revisionNo,
        contentText: review.revision.contentText, contentSha256: review.revision.contentSha256 },
      approval: { eventText: approval.eventText, eventSha256: approval.eventSha256 }, groupId,
      responseHistory: { ...metadata, recordText },
    });
    return await readSynthesisResponseContext({ contextText, contextSha256: createHash("sha256").update(contextText, "utf8").digest("hex") }, scope);
  } catch (error) {
    if (error instanceof SynthesisResponseLinkError) throw error;
    const kind = error instanceof SynthesisApprovalError || error instanceof SynthesisReviewError ? error.kind : "unavailable";
    throw new SynthesisResponseLinkError(kind, "The saved response evidence could not be verified");
  }
}
