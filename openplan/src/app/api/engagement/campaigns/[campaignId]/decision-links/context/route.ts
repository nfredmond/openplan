import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { decisionLinkAccess } from "@/lib/engagement/decision-link-access";
import { decisionLinkFailure, loadDecisionContext } from "@/lib/engagement/decision-links-server";

const headers = { "Cache-Control": "private, no-store" };
const paramsSchema = z.object({ campaignId: z.string().uuid() });
const querySchema = z.object({ responseId: z.string().uuid(), decisionId: z.string().uuid() }).strict();

export async function GET(request: NextRequest, context: { params: Promise<{ campaignId: string }> }) {
  const audit = createApiAuditLogger("engagement.decision-context", request);
  try {
    const params = paramsSchema.safeParse(await context.params);
    const query = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!params.success || !query.success) return NextResponse.json({ kind: "invalid", error: "Select a response and decision." }, { status: 400, headers });
    const access = await decisionLinkAccess(params.data.campaignId);
    if (!access.allowed) return NextResponse.json({ kind: access.error.kind, error: access.error.message }, { status: access.error.status, headers });
    const result = await loadDecisionContext(access.client, { ...access.scope, ...query.data });
    if (result.error) return NextResponse.json({ kind: result.error.kind, error: result.error.message }, { status: result.error.status, headers });
    return NextResponse.json({ packet: result.packet, actorId: access.scope.actorId }, { headers });
  } catch {
    audit.error("decision_context_unavailable");
    const error = decisionLinkFailure();
    return NextResponse.json({ kind: error.kind, error: error.message }, { status: error.status, headers });
  }
}
