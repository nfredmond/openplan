import type { SupabaseClient } from "@supabase/supabase-js";
import { decisionResolutionIntentSchema, readDecisionResolution } from "./decision-request-resolution";
import type { DecisionResolutionIntent, DecisionResolutionScope } from "./decision-request-resolution";
import { decisionLinkFailure } from "./decision-links-server";

/** Resolve once in the native transaction; verify the exact receipt before acknowledging it. */
export async function resolveDecisionRequest(client: Pick<SupabaseClient, "rpc">, scope: DecisionResolutionScope, raw: DecisionResolutionIntent) {
  const parsed = decisionResolutionIntentSchema.safeParse(raw);
  if (!parsed.success) return { packet: null, error: decisionLinkFailure("22023") };
  const intent = parsed.data;
  try {
    const reply = await client.rpc("resolve_engagement_decision_request", {
      p_campaign: scope.campaignId, p_request: intent.requestId, p_resolution: intent.resolutionId,
      p_copy_json: intent.copyJson, p_reason: intent.reason,
    });
    if (reply.error) return { packet: null, error: decisionLinkFailure(reply.error.code) };
    const result = await readDecisionResolution(reply.data, scope, intent);
    return { packet: result.packet, error: null };
  } catch { return { packet: null, error: decisionLinkFailure() }; }
}
