import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireProviderBrowserOrigin } from "@/lib/assistant/provider-server";
import { createClient } from "@/lib/supabase/server";
import { loadCampaignAccess } from "@/lib/engagement/api";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { readBytesWithLimitStreaming } from "@/lib/http/body-limit";
import { authorizeSynthesisExecution } from "@/lib/engagement/synthesis-execution-server";
import { synthesisExecutionCommandSchema, synthesisExecutionScopeSchema } from "@/lib/engagement/synthesis-execution-records";
import { SynthesisGenerationRequestError } from "@/lib/engagement/synthesis-generation-requests-server";

const commandSchema = synthesisExecutionScopeSchema.omit({ campaignId: true, workspaceId: true, actorId: true })
  .extend(synthesisExecutionCommandSchema.shape).strict();
const headers = { "Cache-Control": "private, no-store" };
const messages = {
  invalid: "Review the exact authorization and its resource limits before trying again.",
  forbidden: "The original requester needs current staff access in this account and workspace.",
  conflict: "This request or its execution conditions changed. Preserve the original authorization and inspect its status.",
  unavailable: "OpenPlan could not confirm this authorization. Preserve its exact saved command and retry.",
};
const failure = (kind: keyof typeof messages, status: number) => NextResponse.json({ kind, error: messages[kind] }, { status, headers });
type Context = { params: Promise<{ campaignId: string }> };

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
    const client = await createClient(), { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return failure("forbidden", 401);
    const access = await loadCampaignAccess(client, campaignId, user.id, "engagement.write");
    if (access.error) return failure("unavailable", 503);
    if (!access.allowed || !access.campaign) return failure("forbidden", 403);
    const workspaceId = access.campaign.workspace_id;
    if (request.headers.get("x-openplan-expected-user") !== user.id ||
      request.headers.get("x-openplan-expected-workspace") !== workspaceId) return failure("forbidden", 403);
    const receipt = await authorizeSynthesisExecution(client, { ...command, campaignId, workspaceId, actorId: user.id }, request.signal);
    audit.info("authorization_retained", { requestId: command.requestId, authorizationId: receipt.id, stage: command.stage });
    // The native function returns the same receipt on creation and exact replay.
    return NextResponse.json(receipt, { status: 200, headers });
  } catch (cause) {
    const failed = cause instanceof SynthesisGenerationRequestError ? cause
      : cause instanceof z.ZodError || cause instanceof SyntaxError ? new SynthesisGenerationRequestError("invalid", 400)
      : new SynthesisGenerationRequestError("unavailable", 503);
    audit.warn("authorization_unconfirmed", { kind: failed.kind });
    return failure(failed.kind, failed.status);
  }
}
