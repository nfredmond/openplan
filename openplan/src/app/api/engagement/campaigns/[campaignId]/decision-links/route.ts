import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireProviderBrowserOrigin } from "@/lib/assistant/provider-server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { decisionLinkAccess } from "@/lib/engagement/decision-link-access";
import { decisionLinkIntentSchema } from "@/lib/engagement/decision-links";
import { decisionLinkFailure, loadDecisionLinks, writeDecisionLink } from "@/lib/engagement/decision-links-server";
import type { DecisionLinkFailure } from "@/lib/engagement/decision-links-server";

const paramsSchema = z.object({ campaignId: z.string().uuid() });
const headers = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ campaignId: string }> };
function refused(error: Pick<DecisionLinkFailure, "status" | "message"> & { kind: string }) {
  return NextResponse.json({ kind: error.kind, error: error.message }, { status: error.status, headers });
}

export async function GET(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("engagement.decision-links.read", request);
  try {
    const params = paramsSchema.safeParse(await context.params);
    if (!params.success) return refused(decisionLinkFailure("22023"));
    const access = await decisionLinkAccess(params.data.campaignId);
    if (!access.allowed) return refused(access.error);
    const result = await loadDecisionLinks(access.client, access.scope);
    if (result.error) return refused(result.error);
    return NextResponse.json({ snapshot: result.packet, actorId: access.scope.actorId }, { headers });
  } catch {
    audit.error("decision_links_unavailable");
    return refused(decisionLinkFailure());
  }
}

export async function POST(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("engagement.decision-links.write", request);
  try {
    const params = paramsSchema.safeParse(await context.params);
    if (!params.success) return refused(decisionLinkFailure("22023"));
    // There is no registered Planner Agent decision-link action yet.
    if (["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"].some(key => request.headers.has(key))) {
      return refused({ kind: "forbidden", status: 403, message: "Planner Agent decision-link writes are not supported. Use the staff decision-link editor." });
    }
    try { requireProviderBrowserOrigin(request); } catch { return refused(decisionLinkFailure("42501")); }
    const body = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!body.ok) { body.response.headers.set("Cache-Control", headers["Cache-Control"]); return body.response; }
    const intent = decisionLinkIntentSchema.safeParse(body.data);
    if (!intent.success) return refused(decisionLinkFailure("22023"));
    const access = await decisionLinkAccess(params.data.campaignId);
    if (!access.allowed) return refused(access.error);
    if (request.headers.get("x-openplan-expected-user") !== access.scope.actorId
      || request.headers.get("x-openplan-expected-workspace") !== access.scope.workspaceId) return refused(decisionLinkFailure("42501"));
    const result = await writeDecisionLink(access.client, access.scope, intent.data);
    if (result.error) {
      audit.warn("decision_link_refused", { campaignId: access.scope.campaignId, requestId: intent.data.requestId, kind: result.error.kind });
      return refused(result.error);
    }
    audit.info("decision_link_saved", { campaignId: access.scope.campaignId, requestId: intent.data.requestId, actorId: access.scope.actorId, replayed: result.receipt.replayed });
    return NextResponse.json(result.receipt, { status: result.receipt.replayed ? 200 : 201, headers });
  } catch {
    audit.error("decision_link_unconfirmed");
    return refused(decisionLinkFailure());
  }
}
