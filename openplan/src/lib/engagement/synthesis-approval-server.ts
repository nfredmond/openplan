import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { loadSynthesisReview } from "./synthesis-review-server";
import {
  checkSynthesisApprovalIntent, readSynthesisApprovalEvent, readSynthesisApprovalHistory, readSynthesisApprovalReceipt,
  synthesisApprovalIntentSchema, SynthesisApprovalConflictError, type SynthesisApprovalContext, type SynthesisApprovalIntent, type SynthesisApprovalScope,
} from "./synthesis-approval";

type Client = Pick<SupabaseClient, "rpc">;
const addressSchema = z.object({ campaignId: z.string().uuid(), workspaceId: z.string().uuid(), reviewId: z.string().uuid() }).strict();
type Address = z.infer<typeof addressSchema>;
type Actor = { campaignId: string; workspaceId: string; actorId: string };

export class SynthesisApprovalError extends Error {
  constructor(public readonly kind: "invalid" | "forbidden" | "conflict" | "unavailable", message: string) { super(message); }
}
function databaseError(code: string) {
  return new SynthesisApprovalError(code === "42501" ? "forbidden" : code === "PT409" ? "conflict" : code === "22023" ? "invalid" : "unavailable",
    "The saved approval operation could not be confirmed");
}
function scopeFor(intent: SynthesisApprovalIntent): SynthesisApprovalScope {
  return { campaignId: intent.campaignId, workspaceId: intent.workspaceId, reviewId: intent.reviewId,
    sourceId: intent.sourceId, sourceSha256: intent.sourceSha256, preparationSha256: intent.preparationSha256 };
}

/** Verify the current review once, then bind every approval to an actually verified immutable revision. */
export async function loadSynthesisApprovalState(client: Client, address: Address) {
  const scopeAddress = addressSchema.parse(address);
  const revisions = new Map<string, { revisionNo: number; contentSha256: string }>();
  const review = await loadSynthesisReview(client, scopeAddress, revision => revisions.set(revision.requestId, revision));
  if (!review) return null;
  const scope: SynthesisApprovalScope = { ...scopeAddress, sourceId: review.sourceId,
    sourceSha256: review.sourceSha256, preparationSha256: review.preparationSha256 };
  const result = await client.rpc("read_engagement_synthesis_approval_history", { p_campaign: scope.campaignId, p_review: scope.reviewId });
  if (result.error) throw databaseError(result.error.code);
  if (result.data === null) throw new SynthesisApprovalError("conflict", "Saved approval history is unavailable");
  const history = await readSynthesisApprovalHistory(result.data, scope);
  for (const event of history.entries) {
    const revision = revisions.get(event.intent.revisionId);
    if (!revision || revision.revisionNo !== event.intent.revisionNo || revision.contentSha256 !== event.intent.revisionSha256) {
      throw new SynthesisApprovalError("conflict", "Approval history differs from the verified review revisions");
    }
  }
  const current: SynthesisApprovalContext = { ...scope, revisionId: review.revision.requestId,
    revisionNo: review.revision.revisionNo, revisionSha256: review.revision.contentSha256 };
  const packet = { ...scope, headId: history.head?.intent.requestId ?? null, headSha256: history.head?.eventSha256 ?? null,
    eventCount: history.entries.length, entries: history.entries.map(({ eventText, eventSha256 }) => ({ eventText, eventSha256 })) };
  return { current, history, packet, review };
}

/** A staff read checks current database access even when recovering an old, already committed request. */
export async function loadSynthesisApprovalRequest(client: Client, scope: SynthesisApprovalScope, requestId: string) {
  const request = z.string().uuid().parse(requestId);
  const result = await client.rpc("read_engagement_synthesis_approval", { p_campaign: scope.campaignId, p_request: request });
  if (result.error) throw databaseError(result.error.code);
  if (result.data === null) return null;
  const event = await readSynthesisApprovalEvent(result.data, scope);
  if (event.intent.requestId !== request) throw new Error("Saved approval request identity differs");
  return event;
}

/** Bind route-authenticated identity, recover exact commands first, and let the transaction fence both current heads. */
export async function retainSynthesisApproval(client: Client, service: Client, actor: Actor, raw: unknown) {
  const parsed = synthesisApprovalIntentSchema.safeParse(raw);
  if (!parsed.success) throw new SynthesisApprovalError("invalid", "Review the approval command");
  const intent = parsed.data;
  if (intent.actorId !== actor.actorId || intent.workspaceId !== actor.workspaceId || intent.campaignId !== actor.campaignId) {
    throw new SynthesisApprovalError("forbidden", "Approval actor or consultation differs");
  }
  const scope = scopeFor(intent);
  const recover = async () => {
    try {
      const existing = await loadSynthesisApprovalRequest(client, scope, intent.requestId);
      if (!existing) return null;
      return await readSynthesisApprovalReceipt({ event: { eventText: existing.eventText, eventSha256: existing.eventSha256 }, replayed: true }, intent);
    } catch (error) {
      if (error instanceof SynthesisApprovalConflictError) throw new SynthesisApprovalError("conflict", "This request belongs to a different approval command");
      throw error;
    }
  };
  const existing = await recover();
  if (existing) return existing;
  let state: Awaited<ReturnType<typeof loadSynthesisApprovalState>>;
  try {
    state = await loadSynthesisApprovalState(client, { campaignId: actor.campaignId, workspaceId: actor.workspaceId, reviewId: intent.reviewId });
  } catch (error) {
    if (error instanceof SynthesisApprovalError && error.kind === "conflict") {
      const raced = await recover();
      if (raced) return raced;
    }
    throw error;
  }
  try {
    if (!state) throw new Error("Saved review is unavailable");
    checkSynthesisApprovalIntent(intent, state.current, state.history.head);
  } catch {
    const raced = await recover();
    if (raced) return raced;
    throw new SynthesisApprovalError("conflict", "Open the current review and approval history before changing approval");
  }
  const result = await service.rpc("retain_engagement_synthesis_approval", {
    p_campaign: actor.campaignId, p_actor: actor.actorId, p_workspace: actor.workspaceId, p_intent: intent,
  });
  if (result.error) {
    if (result.error.code === "PT409" || result.error.code === "PT503") {
      const raced = await recover();
      if (raced) return raced;
    }
    throw databaseError(result.error.code);
  }
  const receipt = await readSynthesisApprovalReceipt(result.data, intent);
  if (receipt.event.eventNo !== (state!.history.head?.eventNo ?? 0) + 1) throw new Error("Saved approval event sequence differs");
  return receipt;
}
