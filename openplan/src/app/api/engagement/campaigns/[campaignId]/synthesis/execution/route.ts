import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireProviderBrowserOrigin } from "@/lib/assistant/provider-server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { loadCampaignAccess } from "@/lib/engagement/api";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { readBytesWithLimitStreaming } from "@/lib/http/body-limit";
import { authorizeSynthesisExecution } from "@/lib/engagement/synthesis-execution-server";
import { readSynthesisExecutionPreview } from "@/lib/engagement/synthesis-execution-preview-server";
import { readSynthesisExecutionHistory } from "@/lib/engagement/synthesis-execution-history-server";
import { synthesisExecutionCommandSchema, synthesisExecutionScopeSchema, synthesisExecutionCursorSchema } from "@/lib/engagement/synthesis-execution-records";
import { SynthesisGenerationRequestError } from "@/lib/engagement/synthesis-generation-requests-server";

const commandSchema = synthesisExecutionScopeSchema.omit({ campaignId: true, workspaceId: true, actorId: true })
  .extend(synthesisExecutionCommandSchema.shape).strict();
const historyQuerySchema = z.object({ mode: z.literal("history"), requestId: z.string().uuid(),
  beforeId: synthesisExecutionCursorSchema.shape.id.optional(), beforeCreatedAt: synthesisExecutionCursorSchema.shape.createdAt.optional(),
}).strict().refine(query => Boolean(query.beforeId) === Boolean(query.beforeCreatedAt), "Both cursor fields are required");
const headers = { "Cache-Control": "private, no-store" };
const messages = {
  invalid: "Review the exact authorization and its resource limits before trying again.",
  forbidden: "The original requester needs current staff access in this account and workspace.",
  conflict: "This request or its execution conditions changed. Preserve the original authorization and inspect its status.",
  unavailable: "OpenPlan could not confirm this authorization. Preserve its exact saved command and retry.",
};
const failure = (kind: keyof typeof messages, status: number) => NextResponse.json({ kind, error: messages[kind] }, { status, headers });
type Context = { params: Promise<{ campaignId: string }> };

async function staff(request: NextRequest, campaignId: string) {
  const client = await createClient(), { data: { user }, error } = await client.auth.getUser();
  if (error || !user) throw new SynthesisGenerationRequestError("forbidden", 401);
  const access = await loadCampaignAccess(client, campaignId, user.id, "engagement.write");
  if (access.error) throw new SynthesisGenerationRequestError("unavailable", 503);
  if (!access.allowed || !access.campaign) throw new SynthesisGenerationRequestError("forbidden", 403);
  const workspaceId = access.campaign.workspace_id;
  if (request.headers.get("x-openplan-expected-user") !== user.id ||
    request.headers.get("x-openplan-expected-workspace") !== workspaceId) throw new SynthesisGenerationRequestError("forbidden", 403);
  return { client, workspaceId, actorId: user.id };
}

function classify(cause: unknown) {
  return cause instanceof SynthesisGenerationRequestError ? cause
    : cause instanceof z.ZodError || cause instanceof SyntaxError ? new SynthesisGenerationRequestError("invalid", 400)
    : new SynthesisGenerationRequestError("unavailable", 503);
}

/** Record explicit staff authority. Durable workers independently recheck it
 * before every provider call. This route never starts a worker or sends data.
 */
export async function POST(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("engagement.synthesis-execution.authorize", request);
  try {
    const { campaignId } = z.object({ campaignId: z.string().uuid() }).parse(await context.params);
    if (["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"].some(key => request.headers.has(key))) {
      return failure("forbidden", 403);
    }
    try { requireProviderBrowserOrigin(request); } catch { return failure("forbidden", 403); }
    const body = await readBytesWithLimitStreaming(request, 24 * 1024);
    if (!body.ok) { body.response.headers.set("Cache-Control", headers["Cache-Control"]); return body.response; }
    let raw: unknown;
    try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body.bytes)); }
    catch { return failure("invalid", 400); }
    const command = commandSchema.parse(raw);
    const { client, workspaceId, actorId } = await staff(request, campaignId);
    const receipt = await authorizeSynthesisExecution(client, { ...command, campaignId, workspaceId, actorId }, request.signal);
    audit.info("authorization_retained", { requestId: command.requestId, authorizationId: receipt.id, stage: command.stage });
    // The native function returns the same receipt on creation and exact replay.
    return NextResponse.json(receipt, { status: 200, headers });
  } catch (cause) {
    const failed = classify(cause);
    audit.warn("authorization_unconfirmed", { kind: failed.kind });
    return failure(failed.kind, failed.status);
  }
}

/** Current staff can inspect a retained prepared plan and its original provider
 * choice. This bounded read never reconstructs or sends contribution content.
 */
export async function GET(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("engagement.synthesis-execution.inspect", request);
  try {
    const { campaignId } = z.object({ campaignId: z.string().uuid() }).parse(await context.params);
    const entries = [...request.nextUrl.searchParams];
    if (new Set(entries.map(([key]) => key)).size !== entries.length) return failure("invalid", 400);
    const raw = Object.fromEntries(entries);
    const query = raw.mode === "history" ? historyQuerySchema.parse(raw)
      : z.object({ requestId: z.string().uuid(), stage: z.enum(["segment", "context", "thematic"]) }).strict().parse(raw);
    const { client, workspaceId } = await staff(request, campaignId);
    let summary;
    try {
      summary = "mode" in query
        ? await readSynthesisExecutionHistory(client, createServiceRoleClient(), { campaignId, workspaceId, requestId: query.requestId,
          before: query.beforeId && query.beforeCreatedAt ? { id: query.beforeId, createdAt: query.beforeCreatedAt } : null }, request.signal)
        : await readSynthesisExecutionPreview(client, createServiceRoleClient(), { ...query, campaignId, workspaceId }, request.signal);
    }
    catch (cause) {
      // Malformed native records are unavailable evidence, not bad user input.
      if (cause instanceof z.ZodError || cause instanceof SyntaxError) throw new SynthesisGenerationRequestError("unavailable", 503);
      throw cause;
    }
    audit.info("authorization_plan_read", { requestId: query.requestId, ...("stage" in query ? { stage: query.stage } : { mode: query.mode }) });
    return NextResponse.json(summary, { headers });
  } catch (cause) {
    const failed = classify(cause);
    audit.warn("authorization_plan_unavailable", { kind: failed.kind });
    return failure(failed.kind, failed.status);
  }
}
