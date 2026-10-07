import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireProviderBrowserOrigin } from "@/lib/assistant/provider-server";
import { createClient } from "@/lib/supabase/server";
import { loadCampaignAccess } from "@/lib/engagement/api";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { readBytesWithLimitStreaming } from "@/lib/http/body-limit";
import { cancelSynthesisGenerationRequest, createSynthesisGenerationRequest, readSynthesisGenerationRequest,
  SynthesisGenerationRequestError } from "@/lib/engagement/synthesis-generation-requests-server";

const id = z.string().uuid();
const commandSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("create"), requestId: id, intentText: z.string().max(4096) }).strict(),
  z.object({ operation: z.literal("cancel"), requestId: id, cancellationId: id,
    reason: z.string().min(1).max(4000).refine(value => /\S/.test(value)) }).strict(),
]);
const headers = { "Cache-Control": "private, no-store" };
const messages = {
  invalid: "Review the exact saved generation request and try again.",
  forbidden: "Current staff access in the selected account and workspace is required.",
  conflict: "The saved request or selected source differs. Keep the original request and review its status.",
  unavailable: "OpenPlan could not confirm this request. Keep its exact saved copy and retry.",
};
const failure = (kind: keyof typeof messages, status: number) => NextResponse.json({ kind, error: messages[kind] }, { status, headers });
type Context = { params: Promise<{ campaignId: string }> };

async function staff(request: NextRequest, campaignId: string) {
  const client = await createClient(), { data: { user }, error } = await client.auth.getUser();
  if (error || !user) throw new SynthesisGenerationRequestError("forbidden", 401);
  const access = await loadCampaignAccess(client, campaignId, user.id, "engagement.write");
  if (access.error) throw new SynthesisGenerationRequestError("unavailable", 503);
  if (!access.campaign || !access.allowed) throw new SynthesisGenerationRequestError("forbidden", 403);
  const workspaceId = access.campaign.workspace_id;
  // Both headers are required: an old browser command cannot silently move to
  // another signed-in account or a campaign's new workspace.
  if (request.headers.get("x-openplan-expected-user") !== user.id ||
    request.headers.get("x-openplan-expected-workspace") !== workspaceId) throw new SynthesisGenerationRequestError("forbidden", 403);
  return { client, actorId: user.id, workspaceId, campaignId };
}

function classify(error: unknown) {
  if (error instanceof SynthesisGenerationRequestError) return error;
  if (error instanceof z.ZodError || error instanceof SyntaxError) return new SynthesisGenerationRequestError("invalid", 400);
  return new SynthesisGenerationRequestError("unavailable", 503);
}

/** Retain or cancel exact intent only. Preparation, provider execution and staff
 * approval use separate authorities; this handler never runs a generation worker.
 */
export async function POST(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("engagement.synthesis-generation.write", request);
  try {
    const { campaignId } = z.object({ campaignId: id }).parse(await context.params);
    if (["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"].some(key => request.headers.has(key))) {
      return failure("forbidden", 403);
    }
    try { requireProviderBrowserOrigin(request); } catch { return failure("forbidden", 403); }
    const body = await readBytesWithLimitStreaming(request, 24 * 1024);
    if (!body.ok) { body.response.headers.set("Cache-Control", headers["Cache-Control"]); return body.response; }
    let raw: unknown;
    try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body.bytes)); }
    catch { return failure("invalid", 400); }
    const command = commandSchema.parse(raw), auth = await staff(request, campaignId);
    const scope = { campaignId, workspaceId: auth.workspaceId, actorId: auth.actorId, requestId: command.requestId };
    const result = command.operation === "create"
      ? await createSynthesisGenerationRequest(auth.client, { ...scope, intentText: command.intentText }, request.signal)
      : await cancelSynthesisGenerationRequest(auth.client, { ...scope, cancellationId: command.cancellationId, reason: command.reason }, request.signal);
    audit.info("request_retained", { operation: command.operation, requestId: command.requestId, replayed: result.state.replayed });
    return NextResponse.json(result.state, { status: result.state.replayed ? 200 : 201, headers });
  } catch (error) {
    const failed = classify(error);
    audit.warn("request_unconfirmed", { kind: failed.kind });
    return failure(failed.kind, failed.status);
  }
}

export async function GET(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("engagement.synthesis-generation.read", request);
  try {
    const { campaignId } = z.object({ campaignId: id }).parse(await context.params);
    const entries = [...request.nextUrl.searchParams];
    if (entries.length !== 1 || entries[0][0] !== "requestId") return failure("invalid", 400);
    const requestId = id.parse(entries[0][1]), auth = await staff(request, campaignId);
    const result = await readSynthesisGenerationRequest(auth.client, { campaignId, workspaceId: auth.workspaceId, requestId }, request.signal);
    audit.info("request_read", { requestId, cancelled: result.state.cancellation !== null });
    return NextResponse.json(result.state, { headers });
  } catch (error) {
    const failed = classify(error);
    audit.warn("request_read_unavailable", { kind: failed.kind });
    return failure(failed.kind, failed.status);
  }
}
