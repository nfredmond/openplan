import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { requireProviderBrowserOrigin } from "@/lib/assistant/provider-server";
import { loadCampaignAccess } from "@/lib/engagement/api";
import { readBytesWithLimitStreaming } from "@/lib/http/body-limit";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { synthesisContinuationParentSchema, synthesisContinuationCommandSchema } from "@/lib/engagement/synthesis-continuation-records";
import { readSynthesisContinuationPage, createSynthesisContinuation } from "@/lib/engagement/synthesis-continuation-server";
import { SynthesisGenerationRequestError } from "@/lib/engagement/synthesis-generation-requests-server";

const id = z.string().uuid(), integer = z.string().regex(/^(0|[1-9]\d*)$/).transform(Number).pipe(z.number().int().nonnegative().safe());
const querySchema = synthesisContinuationParentSchema.extend({ throughSequence: integer, offset: integer }).strict();
const headers = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ campaignId: string }> };
const failure = (status: number) => NextResponse.json({ error: status === 400 ? "Review the exact saved continuation command."
  : status === 401 || status === 403 ? "Current staff access in the selected account and workspace is required."
  : status === 409 ? "The saved parent results differ. Keep the original command and inspect its history."
  : "The continuation could not be confirmed. Keep its exact saved command and retry after checking access." }, { status, headers });

async function staff(request: NextRequest, context: Context) {
  const parsed = z.object({ campaignId: id }).safeParse(await context.params);
  if (!parsed.success) throw new SynthesisGenerationRequestError("invalid", 400);
  const { campaignId } = parsed.data;
  const client = await createClient(), { data: { user }, error } = await client.auth.getUser();
  if (error || !user) throw new SynthesisGenerationRequestError("forbidden", 401);
  const access = await loadCampaignAccess(client, campaignId, user.id, "engagement.write");
  if (access.error) throw new SynthesisGenerationRequestError("unavailable", 503);
  if (!access.allowed || !access.campaign) throw new SynthesisGenerationRequestError("forbidden", 403);
  const workspaceId = access.campaign.workspace_id;
  if (request.headers.get("x-openplan-expected-user") !== user.id || request.headers.get("x-openplan-expected-workspace") !== workspaceId) {
    throw new SynthesisGenerationRequestError("forbidden", 403);
  }
  return { client, actorId: user.id, scope: { campaignId, workspaceId } };
}
const status = (cause: unknown) => cause instanceof SynthesisGenerationRequestError ? cause.status : 503;

export async function GET(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("engagement.synthesis-continuation.read", request);
  try {
    const entries = [...request.nextUrl.searchParams];
    if (new Set(entries.map(([key]) => key)).size !== entries.length) return failure(400);
    const parsed = querySchema.safeParse(Object.fromEntries(entries));
    if (!parsed.success) return failure(400);
    const { offset, ...parent } = parsed.data;
    const auth = await staff(request, context), signal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
    signal.throwIfAborted();
    const result = await readSynthesisContinuationPage(auth.client, createServiceRoleClient(), auth.scope, parent, offset, signal);
    signal.throwIfAborted();
    audit.info("contributions_read", { requestId: parent.parentRequestId, offset, count: result.entries.length });
    return NextResponse.json(result, { headers });
  } catch (cause) { const code = status(cause); audit.warn("contributions_unconfirmed", { status: code }); return failure(code); }
}

/** Browser staff commands use existing native child-request custody. An agent
 * cannot invoke an unregistered write by attaching assistant approval headers.
 */
export async function POST(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("engagement.synthesis-continuation.write", request);
  try {
    if (["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"].some(key => request.headers.has(key))) return failure(403);
    try { requireProviderBrowserOrigin(request); } catch { return failure(403); }
    const body = await readBytesWithLimitStreaming(request, 24 * 1024);
    if (!body.ok) { body.response.headers.set("Cache-Control", headers["Cache-Control"]); return body.response; }
    let raw: unknown;
    try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body.bytes)); } catch { return failure(400); }
    const parsed = synthesisContinuationCommandSchema.safeParse(raw);
    if (!parsed.success) return failure(400);
    const command = parsed.data, auth = await staff(request, context);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
    signal.throwIfAborted();
    const result = await createSynthesisContinuation(auth.client, createServiceRoleClient(), auth.scope, auth.actorId, command, signal);
    signal.throwIfAborted();
    audit.info("continuation_retained", { requestId: command.requestId, stage: command.stage, replayed: result.replayed });
    return NextResponse.json(result, { status: result.replayed ? 200 : 201, headers });
  } catch (cause) { const code = status(cause); audit.warn("continuation_unconfirmed", { status: code }); return failure(code); }
}
