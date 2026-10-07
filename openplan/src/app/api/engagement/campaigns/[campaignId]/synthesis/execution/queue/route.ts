import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireProviderBrowserOrigin } from "@/lib/assistant/provider-server";
import { createClient } from "@/lib/supabase/server";
import { loadCampaignAccess } from "@/lib/engagement/api";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { readBytesWithLimitStreaming } from "@/lib/http/body-limit";
import { SynthesisGenerationRequestError } from "@/lib/engagement/synthesis-generation-requests-server";

import { enqueueSynthesisExecution } from "@/lib/engagement/synthesis-execution-queue-server";

const headers = { "Cache-Control": "private, no-store" };
const messages = {
  invalid: "Review the exact saved queue command before trying again.",
  forbidden: "The original requester needs current staff access in this account and workspace.",
  conflict: "This request or its execution conditions changed. Preserve the original queue command.",
  unavailable: "OpenPlan could not confirm this queue entry. Preserve its exact saved command and retry.",
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

/** Retain an explicit staff scheduling command without dispatching provider work. */
export async function POST(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("engagement.synthesis-execution.enqueue", request);
  try {
    const { campaignId } = z.object({ campaignId: z.string().uuid() }).parse(await context.params);
    if (["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"].some(key => request.headers.has(key))) {
      return failure("forbidden", 403);
    }
    try { requireProviderBrowserOrigin(request); } catch { return failure("forbidden", 403); }
    const body = await readBytesWithLimitStreaming(request, 4096);
    if (!body.ok) { body.response.headers.set("Cache-Control", headers["Cache-Control"]); return body.response; }
    let commandText: string;
    try { commandText = new TextDecoder("utf-8", { fatal: true }).decode(body.bytes); }
    catch { return failure("invalid", 400); }
    const { client, workspaceId, actorId } = await staff(request, campaignId);
    const receipt = await enqueueSynthesisExecution(client, { commandText, campaignId, workspaceId, actorId }, request.signal);
    audit.info("queue_entry_retained", { queueId: receipt.queueId });
    // The native function returns the same receipt on creation and exact replay.
    return NextResponse.json(receipt, { status: 200, headers });
  } catch (cause) {
    const failed = classify(cause);
    audit.warn("queue_entry_unconfirmed", { kind: failed.kind });
    return failure(failed.kind, failed.status);
  }
}
