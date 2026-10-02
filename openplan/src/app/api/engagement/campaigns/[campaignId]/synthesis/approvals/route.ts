import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { loadCampaignAccess } from "@/lib/engagement/api";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { requireProviderBrowserOrigin } from "@/lib/assistant/provider-server";
import { readBytesWithLimitStreaming } from "@/lib/http/body-limit";
import { synthesisApprovalIntentSchema } from "@/lib/engagement/synthesis-approval";
import { loadSynthesisApprovalState, retainSynthesisApproval, SynthesisApprovalError } from "@/lib/engagement/synthesis-approval-server";
import { SynthesisReviewError } from "@/lib/engagement/synthesis-review-server";

const headers = { "Cache-Control": "private, no-store" };
const uuid = z.string().uuid(), paramsSchema = z.object({ campaignId: uuid });
const querySchema = z.object({ reviewId: uuid }).strict();
type Context = { params: Promise<{ campaignId: string }> };
function failure(kind: "invalid" | "forbidden" | "conflict" | "unavailable" | "missing", status?: number) {
  const message = { invalid: "Check the approval reason and exact review version.", forbidden: "Staff campaign access is required. Reopen the campaign if your account changed.",
    conflict: "The review or approval request differs. Keep the request and inspect the current history.",
    unavailable: "OpenPlan could not confirm this approval operation. Keep the same request and retry.", missing: "This staff review has not been saved." };
  return NextResponse.json({ kind, error: message[kind] }, { status: status ?? { invalid: 400, forbidden: 403, conflict: 409, unavailable: 503, missing: 404 }[kind], headers });
}
async function accessFor(request: NextRequest, campaignId: string) {
  const client = await createClient(), { data: { user } } = await client.auth.getUser();
  if (!user) return { response: failure("forbidden", 401) };
  const access = await loadCampaignAccess(client, campaignId, user.id, "engagement.write");
  if (access.error) return { response: failure("unavailable") };
  if (!access.campaign || !access.allowed) return { response: failure("forbidden") };
  const workspaceId = access.campaign.workspace_id;
  if ((request.headers.has("x-openplan-expected-user") && request.headers.get("x-openplan-expected-user") !== user.id)
    || (request.headers.has("x-openplan-expected-workspace") && request.headers.get("x-openplan-expected-workspace") !== workspaceId)) return { response: failure("forbidden") };
  return { client, user, workspaceId };
}
function errorKind(error: unknown) {
  return error instanceof SynthesisApprovalError || error instanceof SynthesisReviewError ? error.kind : "unavailable";
}

/** Staff approve or withdraw an exact retained revision; no public authority or content changes follow. */
export async function POST(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("engagement.synthesis-approval.post", request);
  try {
    const params = paramsSchema.safeParse(await context.params);
    if (!params.success) return failure("invalid");
    if (["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"].some(key => request.headers.has(key))) return failure("forbidden");
    try { requireProviderBrowserOrigin(request); } catch { return failure("forbidden"); }
    const bytes = await readBytesWithLimitStreaming(request, 16_384);
    if (!bytes.ok) { bytes.response.headers.set("Cache-Control", headers["Cache-Control"]); return bytes.response; }
    let raw: unknown;
    try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.bytes)); } catch { return failure("invalid"); }
    const intent = synthesisApprovalIntentSchema.safeParse(raw);
    if (!intent.success) return failure("invalid");
    const access = await accessFor(request, params.data.campaignId);
    if (access.response) return access.response;
    if (intent.data.actorId !== access.user.id || intent.data.workspaceId !== access.workspaceId || intent.data.campaignId !== params.data.campaignId) return failure("forbidden");
    const receipt = await retainSynthesisApproval(access.client, createServiceRoleClient(), {
      campaignId: params.data.campaignId, workspaceId: access.workspaceId, actorId: access.user.id,
    }, intent.data);
    audit.info("synthesis_approval_retained", { campaignId: params.data.campaignId, reviewId: receipt.event.intent.reviewId,
      requestId: receipt.event.intent.requestId, eventSha256: receipt.event.eventSha256, operation: receipt.event.intent.operation, replayed: receipt.replayed });
    return NextResponse.json({ event: { eventText: receipt.event.eventText, eventSha256: receipt.event.eventSha256 }, replayed: receipt.replayed }, { status: receipt.replayed ? 200 : 201, headers });
  } catch (error) { audit.error("synthesis_approval_unconfirmed"); return failure(errorKind(error)); }
}

/** Reasons, actors and complete event history remain restricted to current campaign staff. */
export async function GET(request: NextRequest, context: Context) {
  try {
    const params = paramsSchema.safeParse(await context.params), entries = [...request.nextUrl.searchParams];
    const query = querySchema.safeParse(Object.fromEntries(entries));
    if (!params.success || !query.success || new Set(entries.map(([key]) => key)).size !== entries.length) return failure("invalid");
    const access = await accessFor(request, params.data.campaignId);
    if (access.response) return access.response;
    const state = await loadSynthesisApprovalState(access.client, { campaignId: params.data.campaignId, workspaceId: access.workspaceId, reviewId: query.data.reviewId }, createServiceRoleClient());
    if (!state) return failure("missing");
    return NextResponse.json({ current: state.current, history: state.packet }, { headers });
  } catch (error) { return failure(errorKind(error)); }
}
