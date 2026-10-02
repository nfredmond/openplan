import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { loadCloseLoopEntries } from "@/lib/engagement/close-loop";
import { loadCampaignAccess } from "@/lib/engagement/api";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { requireProviderBrowserOrigin } from "@/lib/assistant/provider-server";
import { readBytesWithLimitStreaming } from "@/lib/http/body-limit";
import { synthesisResponseLinkIntentSchema, synthesisResponseLinkScopeSchema } from "@/lib/engagement/synthesis-response-link";
import { loadSynthesisResponseContext, SynthesisResponseLinkError } from "@/lib/engagement/synthesis-response-links-server";
import { loadSynthesisResponseLinkIndex } from "@/lib/engagement/synthesis-response-index-server";
import { loadSynthesisResponseLinkHistory, retainSynthesisResponseLinkCommand } from "@/lib/engagement/synthesis-response-write-server";

const headers = { "Cache-Control": "private, no-store" };
const paramsSchema = z.object({ campaignId: z.string().uuid() });
const selected = synthesisResponseLinkScopeSchema.pick({ reviewId: true, responseId: true, groupId: true });
const querySchema = z.discriminatedUnion("mode", [
  selected.pick({ reviewId: true }).extend({ mode: z.literal("index") }),
  selected.pick({ reviewId: true }).extend({ mode: z.literal("responses") }),
  selected.extend({ mode: z.literal("history") }), selected.extend({ mode: z.literal("context") }),
]);
type Context = { params: Promise<{ campaignId: string }> };
function failure(kind: "invalid" | "forbidden" | "conflict" | "unavailable" | "missing", status?: number) {
  const message = {
    invalid: "Check the selected review, response and exact link command.",
    forbidden: "Current staff access is required. Reopen the campaign if your account changed.",
    conflict: "The link or reviewed evidence changed. Keep this request and inspect the saved history.",
    unavailable: "OpenPlan could not confirm this response link operation. Keep the exact request for retry.",
    missing: "The retained staff review is unavailable.",
  };
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
const errorKind = (error: unknown) => error instanceof SynthesisResponseLinkError ? error.kind : "unavailable";

/** Private retained history remains navigable after a live response or review group is removed. */
export async function GET(request: NextRequest, context: Context) {
  try {
    const params = paramsSchema.safeParse(await context.params), entries = [...request.nextUrl.searchParams];
    const query = querySchema.safeParse(Object.fromEntries(entries));
    if (!params.success || !query.success || new Set(entries.map(([key]) => key)).size !== entries.length) return failure("invalid");
    const access = await accessFor(request, params.data.campaignId); if (access.response) return access.response;
    const scope = { campaignId: params.data.campaignId, workspaceId: access.workspaceId, reviewId: query.data.reviewId };
    if (query.data.mode === "index") {
      const index = await loadSynthesisResponseLinkIndex(access.client, scope);
      return index === null ? failure("missing") : NextResponse.json({ index }, { headers });
    }
    if (query.data.mode === "responses") {
      if (await loadSynthesisResponseLinkIndex(access.client, scope) === null) return failure("missing");
      const responses = await loadCloseLoopEntries(access.client, scope.campaignId);
      if (responses.error) return failure("unavailable");
      return NextResponse.json({ ...scope, responseCount: responses.rows.length, responses: responses.rows }, { headers });
    }
    const address = { ...scope, responseId: query.data.responseId, groupId: query.data.groupId };
    if (query.data.mode === "context") {
      const result = await loadSynthesisResponseContext(access.client, address, createServiceRoleClient());
      return NextResponse.json({ context: result.packet }, { headers });
    }
    const result = await loadSynthesisResponseLinkHistory(access.client, address);
    return NextResponse.json({ history: { ...result.scope, eventCount: result.entries.length,
      headId: result.head?.intent.requestId ?? null, headSha256: result.head?.eventSha256 ?? null,
      entries: result.entries.map(({ eventText, eventSha256 }) => ({ eventText, eventSha256 })) } }, { headers });
  } catch (error) { return failure(errorKind(error)); }
}

/** A compact exact command binds current staff identity; unregistered assistant writes remain refused. */
export async function POST(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("engagement.synthesis-response-link.post", request);
  try {
    const params = paramsSchema.safeParse(await context.params); if (!params.success) return failure("invalid");
    if (["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"].some(key => request.headers.has(key))) return failure("forbidden");
    try { requireProviderBrowserOrigin(request); } catch { return failure("forbidden"); }
    const bytes = await readBytesWithLimitStreaming(request, 16_384);
    if (!bytes.ok) { bytes.response.headers.set("Cache-Control", headers["Cache-Control"]); return bytes.response; }
    let raw: unknown;
    try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.bytes)); } catch { return failure("invalid"); }
    const intent = synthesisResponseLinkIntentSchema.safeParse(raw); if (!intent.success) return failure("invalid");
    const access = await accessFor(request, params.data.campaignId); if (access.response) return access.response;
    if (intent.data.actorId !== access.user.id || intent.data.workspaceId !== access.workspaceId || intent.data.campaignId !== params.data.campaignId) return failure("forbidden");
    const receipt = await retainSynthesisResponseLinkCommand(access.client, createServiceRoleClient(), {
      campaignId: params.data.campaignId, workspaceId: access.workspaceId, actorId: access.user.id,
    }, intent.data);
    audit.info("synthesis_response_link_retained", { campaignId: params.data.campaignId, reviewId: receipt.event.intent.reviewId,
      responseId: receipt.event.intent.responseId, requestId: receipt.event.intent.requestId,
      eventSha256: receipt.event.eventSha256, operation: receipt.event.intent.operation, replayed: receipt.replayed });
    return NextResponse.json({ event: { eventText: receipt.event.eventText, eventSha256: receipt.event.eventSha256 }, replayed: receipt.replayed }, { status: receipt.replayed ? 200 : 201, headers });
  } catch (error) { audit.error("synthesis_response_link_unconfirmed"); return failure(errorKind(error)); }
}
