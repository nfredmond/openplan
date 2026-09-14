import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { loadCampaignAccess } from "@/lib/engagement/api";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { requireProviderBrowserOrigin } from "@/lib/assistant/provider-server";
import { readBytesWithLimitStreaming } from "@/lib/http/body-limit";
import { synthesisSourceIntentSchema, synthesisSourceReceiptSchema } from "@/lib/engagement/synthesis-sources";
import { loadSynthesisSource } from "@/lib/engagement/synthesis-sources-server";

const headers = { "Cache-Control": "private, no-store" };
const paramsSchema = z.object({ campaignId: z.string().uuid() });
const unavailable = { kind: "unavailable", error: "OpenPlan could not confirm the saved source. Keep this request and retry it." };
const invalid = { kind: "invalid", error: "Review the contribution selection before saving it." };
type Context = { params: Promise<{ campaignId: string }> };

/** Retain the selected source once. This endpoint does not call a model or publish any contribution. */
export async function POST(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("engagement.synthesis-source.post", request);
  try {
    const params = paramsSchema.safeParse(await context.params);
    if (!params.success) return NextResponse.json(invalid, { status: 400, headers });
    if (["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"].some(key => request.headers.has(key))) {
      return NextResponse.json({ kind: "forbidden", error: "Planner Agent synthesis writes are not supported. Use the staff synthesis review." }, { status: 403, headers });
    }
    try { requireProviderBrowserOrigin(request); } catch {
      return NextResponse.json({ kind: "forbidden", error: "Use the staff synthesis review to save a source selection." }, { status: 403, headers });
    }
    const bytes = await readBytesWithLimitStreaming(request, 65_536);
    if (!bytes.ok) { bytes.response.headers.set("Cache-Control", headers["Cache-Control"]); return bytes.response; }
    let raw: unknown;
    try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.bytes)); }
    catch { return NextResponse.json(invalid, { status: 400, headers }); }
    const intent = synthesisSourceIntentSchema.safeParse(raw);
    if (!intent.success) return NextResponse.json(invalid, { status: 400, headers });
    const client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return NextResponse.json({ kind: "forbidden", error: "Sign in to save the synthesis source." }, { status: 401, headers });
    const access = await loadCampaignAccess(client, params.data.campaignId, user.id, "engagement.write");
    if (access.error) return NextResponse.json(unavailable, { status: 503, headers });
    if (!access.campaign || !access.allowed) return NextResponse.json({ kind: "forbidden", error: "Staff campaign access is required." }, { status: 403, headers });
    const result = await client.rpc("capture_engagement_synthesis_sources", { p_campaign: params.data.campaignId, p_request: intent.data.requestId, p_selection: intent.data.selection });
    if (result.error) {
      if (result.error.code === "PT409") return NextResponse.json({ kind: "conflict", error: "This request already belongs to a different source selection." }, { status: 409, headers });
      if (result.error.code === "42501") return NextResponse.json({ kind: "forbidden", error: "Staff campaign access is required." }, { status: 403, headers });
      if (result.error.code === "22023") return NextResponse.json(invalid, { status: 400, headers });
      return NextResponse.json(unavailable, { status: 503, headers });
    }
    const receipt = synthesisSourceReceiptSchema.parse(result.data);
    if (receipt.requestId !== intent.data.requestId || receipt.campaignId !== params.data.campaignId || receipt.workspaceId !== access.campaign.workspace_id) throw new Error("Source receipt scope differs");
    audit.info("synthesis_source_retained", { campaignId: receipt.campaignId, requestId: receipt.requestId, snapshotSha256: receipt.snapshotSha256, replayed: receipt.replayed });
    return NextResponse.json(receipt, { status: receipt.replayed ? 200 : 201, headers });
  } catch {
    audit.error("synthesis_source_unconfirmed");
    return NextResponse.json(unavailable, { status: 503, headers });
  }
}

/** Read retained bytes through the staff-only RPC and verify them independently of current campaign data. */
export async function GET(request: NextRequest, context: Context) {
  try {
    const params = paramsSchema.safeParse(await context.params);
    const requestId = z.string().uuid().safeParse(request.nextUrl.searchParams.get("requestId"));
    if (!params.success || !requestId.success) return NextResponse.json(invalid, { status: 400, headers });
    const client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return NextResponse.json({ kind: "forbidden", error: "Sign in to read the saved source." }, { status: 401, headers });
    const access = await loadCampaignAccess(client, params.data.campaignId, user.id, "engagement.write");
    if (access.error) return NextResponse.json(unavailable, { status: 503, headers });
    if (!access.campaign || !access.allowed) return NextResponse.json({ kind: "forbidden", error: "Staff campaign access is required." }, { status: 403, headers });
    const saved = await loadSynthesisSource(client, { campaignId: params.data.campaignId, workspaceId: access.campaign.workspace_id, requestId: requestId.data });
    return NextResponse.json(saved, { headers });
  } catch {
    return NextResponse.json(unavailable, { status: 503, headers });
  }
}
