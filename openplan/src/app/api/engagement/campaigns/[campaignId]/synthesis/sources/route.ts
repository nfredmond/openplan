import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { loadCampaignAccess } from "@/lib/engagement/api";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { requireProviderBrowserOrigin } from "@/lib/assistant/provider-server";
import { readBytesWithLimitStreaming } from "@/lib/http/body-limit";
import { synthesisSourceIntentSchema, synthesisSourceReceiptSchema, synthesisSourceListSchema, synthesisSourceCursorSchema } from "@/lib/engagement/synthesis-sources";
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
    if (intent.data.actorId !== user.id) return NextResponse.json({ kind: "forbidden", error: "The signed-in account changed. Reopen the source selection." }, { status: 403, headers });
    const access = await loadCampaignAccess(client, params.data.campaignId, user.id, "engagement.write");
    if (access.error) return NextResponse.json(unavailable, { status: 503, headers });
    if (!access.campaign || !access.allowed) return NextResponse.json({ kind: "forbidden", error: "Staff campaign access is required." }, { status: 403, headers });
    if (intent.data.workspaceId !== access.campaign.workspace_id) return NextResponse.json({ kind: "forbidden", error: "The campaign workspace changed. Reopen the source selection." }, { status: 403, headers });
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
    const query = z.object({ requestId: z.string().uuid().optional(), beforeId: z.string().uuid().optional(), beforeCreatedAt: z.string().datetime({ offset: true }).optional() }).strict().safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!params.success || !query.success || (query.data.requestId && (query.data.beforeId || query.data.beforeCreatedAt)) || Boolean(query.data.beforeId) !== Boolean(query.data.beforeCreatedAt)) return NextResponse.json(invalid, { status: 400, headers });
    const client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return NextResponse.json({ kind: "forbidden", error: "Sign in to read the saved source." }, { status: 401, headers });
    const access = await loadCampaignAccess(client, params.data.campaignId, user.id, "engagement.write");
    if (access.error) return NextResponse.json(unavailable, { status: 503, headers });
    if (!access.campaign || !access.allowed) return NextResponse.json({ kind: "forbidden", error: "Staff campaign access is required." }, { status: 403, headers });
    if ((request.headers.has("x-openplan-expected-user") && request.headers.get("x-openplan-expected-user") !== user.id)
      || (request.headers.has("x-openplan-expected-workspace") && request.headers.get("x-openplan-expected-workspace") !== access.campaign.workspace_id)) return NextResponse.json({ kind: "forbidden", error: "The campaign session changed. Reopen this campaign." }, { status: 403, headers });
    if (!query.data.requestId) {
      const before = query.data.beforeId ? synthesisSourceCursorSchema.parse({ id: query.data.beforeId, createdAt: query.data.beforeCreatedAt }) : null;
      const listed = await client.rpc("list_engagement_synthesis_sources", { p_campaign: params.data.campaignId, p_before: before });
      if (listed.error) return NextResponse.json(unavailable, { status: 503, headers });
      const page = synthesisSourceListSchema.parse(listed.data);
      if (page.campaignId !== params.data.campaignId || page.workspaceId !== access.campaign.workspace_id) throw new Error("Saved source list scope differs");
      return NextResponse.json(page, { headers });
    }
    const saved = await loadSynthesisSource(client, { campaignId: params.data.campaignId, workspaceId: access.campaign.workspace_id, requestId: query.data.requestId });
    return NextResponse.json(saved, { headers });
  } catch {
    return NextResponse.json(unavailable, { status: 503, headers });
  }
}
