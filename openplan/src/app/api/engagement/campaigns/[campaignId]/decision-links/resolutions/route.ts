import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireProviderBrowserOrigin } from "@/lib/assistant/provider-server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { readBytesWithLimitStreaming } from "@/lib/http/body-limit";
import { decisionLinkAccess } from "@/lib/engagement/decision-link-access";
import { decisionLinkFailure } from "@/lib/engagement/decision-links-server";
import type { DecisionLinkFailure } from "@/lib/engagement/decision-links-server";
import { DECISION_RESOLUTION_BODY_LIMIT, decisionResolutionIntentSchema } from "@/lib/engagement/decision-request-resolution";
import { resolveDecisionRequest } from "@/lib/engagement/decision-resolution-server";

const paramsSchema = z.object({ campaignId: z.string().uuid() });
const headers = { "Cache-Control": "private, no-store" };
function refused(error: Pick<DecisionLinkFailure, "status" | "message"> & { kind: string }) {
  return NextResponse.json({ kind: error.kind, error: error.message }, { status: error.status, headers });
}

export async function POST(request: NextRequest, context: { params: Promise<{ campaignId: string }> }) {
  const audit = createApiAuditLogger("engagement.decision-links.resolve", request);
  try {
    const params = paramsSchema.safeParse(await context.params);
    if (!params.success) return refused(decisionLinkFailure("22023"));
    if (["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"].some(key => request.headers.has(key))) {
      return refused({ kind: "forbidden", status: 403, message: "Planner Agent decision-request recovery is not supported. Use the staff recovery controls." });
    }
    try { requireProviderBrowserOrigin(request); } catch { return refused(decisionLinkFailure("42501")); }
    const access = await decisionLinkAccess(params.data.campaignId);
    if (!access.allowed) return refused(access.error);
    if (request.headers.get("x-openplan-expected-user") !== access.scope.actorId
      || request.headers.get("x-openplan-expected-workspace") !== access.scope.workspaceId) return refused(decisionLinkFailure("42501"));
    const body = await readBytesWithLimitStreaming(request, DECISION_RESOLUTION_BODY_LIMIT);
    if (!body.ok) { body.response.headers.set("Cache-Control", headers["Cache-Control"]); return body.response; }
    let data: unknown;
    try { data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body.bytes)); } catch { return refused(decisionLinkFailure("22023")); }
    const intent = decisionResolutionIntentSchema.safeParse(data);
    if (!intent.success) return refused(decisionLinkFailure("22023"));
    const result = await resolveDecisionRequest(access.client, access.scope, intent.data);
    if (result.error) {
      audit.warn("decision_recovery_refused", { campaignId: access.scope.campaignId, requestId: intent.data.requestId, kind: result.error.kind });
      return refused(result.error);
    }
    audit.info("decision_request_resolved", { campaignId: access.scope.campaignId, requestId: intent.data.requestId,
      resolutionId: intent.data.resolutionId, actorId: access.scope.actorId, replayed: result.packet.replayed });
    return NextResponse.json(result.packet, { status: result.packet.replayed ? 200 : 201, headers });
  } catch {
    audit.error("decision_recovery_unconfirmed");
    return refused(decisionLinkFailure());
  }
}
