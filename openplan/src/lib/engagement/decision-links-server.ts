import type { SupabaseClient } from "@supabase/supabase-js";
import {
  decisionLinkIntentSchema, readDecisionContext, readDecisionLinkReceipt, readDecisionLinkSnapshot,
} from "./decision-links";
import type { DecisionLinkAddress, DecisionLinkIntent, DecisionLinkScope } from "./decision-links";

type Client = Pick<SupabaseClient, "rpc">;
export type DecisionLinkFailure = { kind: "invalid" | "forbidden" | "missing" | "conflict" | "unavailable"; status: number; message: string };

export function decisionLinkFailure(code?: string): DecisionLinkFailure {
  if (code === "42501") return { kind: "forbidden", status: 403, message: "Staff access is required for this campaign's decision links." };
  if (code === "P0002") return { kind: "missing", status: 404, message: "The response, decision or project link is no longer available. Its retained history is preserved." };
  if (code === "PT409" || code === "23505") return { kind: "conflict", status: 409, message: "The source or link changed. Review its current version; your explanation is retained." };
  if (["22023", "22P02", "22021"].includes(code ?? "")) return { kind: "invalid", status: 400, message: "Review the decision, source version and change reason." };
  return { kind: "unavailable", status: 503, message: "OpenPlan could not confirm this request. Keep your explanation and retry the same request." };
}

/** Return exact native packets only after checking their complete private content. */
export async function loadDecisionLinks(client: Client, scope: DecisionLinkScope) {
  try {
    const reply = await client.rpc("read_engagement_decision_links", { p_campaign: scope.campaignId });
    if (reply.error) return { packet: null, error: decisionLinkFailure(reply.error.code) };
    await readDecisionLinkSnapshot(reply.data, scope);
    return { packet: reply.data as unknown, error: null };
  } catch { return { packet: null, error: decisionLinkFailure() }; }
}

/** Preview only a decision on the campaign's current projects. */
export async function loadDecisionContext(client: Client, scope: DecisionLinkAddress) {
  try {
    const reply = await client.rpc("read_engagement_response_decision_context", {
      p_campaign: scope.campaignId, p_response: scope.responseId, p_decision: scope.decisionId,
    });
    if (reply.error) return { packet: null, error: decisionLinkFailure(reply.error.code) };
    const result = await readDecisionContext(reply.data, scope);
    return { packet: result.packet, error: null };
  } catch { return { packet: null, error: decisionLinkFailure() }; }
}

/** Submit once, preserving the exact request identity. The transaction owns retry ordering. */
export async function writeDecisionLink(client: Client, scope: DecisionLinkScope & { actorId: string }, raw: DecisionLinkIntent) {
  const parsed = decisionLinkIntentSchema.safeParse(raw);
  if (!parsed.success) return { receipt: null, error: decisionLinkFailure("22023") };
  const intent = parsed.data;
  try {
    const reply = await client.rpc("write_engagement_response_decision_link", {
      p_campaign: scope.campaignId, p_response: intent.responseId, p_decision: intent.decisionId,
      p_request: intent.requestId, p_operation: intent.operation, p_predecessor: intent.predecessorId,
      p_expected_context_sha256: intent.expectedContextSha256, p_reason: intent.reason,
    });
    if (reply.error) return { receipt: null, error: decisionLinkFailure(reply.error.code) };
    const verified = await readDecisionLinkReceipt(reply.data, scope, intent);
    return { receipt: verified.receipt, error: null };
  } catch { return { receipt: null, error: decisionLinkFailure() }; }
}
