import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireProviderBrowserOrigin } from "@/lib/assistant/provider-server";
import { createClient } from "@/lib/supabase/server";
import { loadCampaignAccess } from "@/lib/engagement/api";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { readBytesWithLimitStreaming } from "@/lib/http/body-limit";
import { enqueueSynthesisPreparation, retrySynthesisPreparation, readSynthesisPreparation,
  SynthesisPreparationError } from "@/lib/engagement/synthesis-preparation-server";

const id = z.string().uuid();
const commandSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("enqueue"), requestId: id, stage: z.enum(["segment", "context", "thematic"]),
    intentSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ operation: z.literal("retry"), requestId: id, attempt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict(),
]);
const headers = { "Cache-Control": "private, no-store" };
const messages = {
  invalid: "Review the saved preparation request and try again.",
  forbidden: "Current staff access in the selected account and workspace is required.",
  conflict: "The saved request or preparation attempt differs. Keep the original request and review its status.",
  unavailable: "OpenPlan could not confirm preparation. Keep this exact command and review the request status before retrying.",
};
const failure = (kind: keyof typeof messages, status: number) => NextResponse.json({ kind, error: messages[kind] }, { status, headers });
type Context = { params: Promise<{ campaignId: string }> };

async function staff(request: NextRequest, campaignId: string) {
  const client = await createClient(), { data: { user }, error } = await client.auth.getUser();
  if (error || !user) throw new SynthesisPreparationError("forbidden", 401);
  const access = await loadCampaignAccess(client, campaignId, user.id, "engagement.write");
  if (access.error) throw new SynthesisPreparationError("unavailable", 503);
  if (!access.campaign || !access.allowed) throw new SynthesisPreparationError("forbidden", 403);
  const workspaceId = access.campaign.workspace_id;
  // Both headers are required: an old browser command cannot silently move to
  // another signed-in account or a campaign's new workspace.
  if (request.headers.get("x-openplan-expected-user") !== user.id ||
    request.headers.get("x-openplan-expected-workspace") !== workspaceId) throw new SynthesisPreparationError("forbidden", 403);
  return { client, actorId: user.id, workspaceId, campaignId };
}

function classify(error: unknown) {
  if (error instanceof SynthesisPreparationError) return error;
  if (error instanceof z.ZodError || error instanceof SyntaxError) return new SynthesisPreparationError("invalid", 400);
  return new SynthesisPreparationError("unavailable", 503);
}

/** Queue preparation or retry an observed attempt. Provider execution and staff
 * approval use separate authorities; this handler never runs a worker or provider.
 */
export async function POST(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("engagement.synthesis-preparation.write", request);
  try {
    const { campaignId } = z.object({ campaignId: id }).parse(await context.params);
    if (["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"].some(key => request.headers.has(key))) {
      return failure("forbidden", 403);
    }
    try { requireProviderBrowserOrigin(request); } catch { return failure("forbidden", 403); }
    const body = await readBytesWithLimitStreaming(request, 8 * 1024);
    if (!body.ok) { body.response.headers.set("Cache-Control", headers["Cache-Control"]); return body.response; }
    let raw: unknown;
    try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body.bytes)); }
    catch { return failure("invalid", 400); }
    const command = commandSchema.parse(raw), auth = await staff(request, campaignId);
    const scope = { campaignId, workspaceId: auth.workspaceId, actorId: auth.actorId, requestId: command.requestId };
    const result = command.operation === "enqueue"
      ? await enqueueSynthesisPreparation(auth.client, { ...scope, stage: command.stage, intentSha256: command.intentSha256 }, request.signal)
      : await retrySynthesisPreparation(auth.client, { ...scope, attempt: command.attempt }, request.signal);
    audit.info("preparation_command_retained", { operation: command.operation, requestId: command.requestId, status: result.status, attempts: result.attempts });
    return NextResponse.json(result, { status: command.operation === "enqueue" && !result.replayed ? 201 : 200, headers });
  } catch (error) {
    const failed = classify(error);
    audit.warn("preparation_unconfirmed", { kind: failed.kind });
    return failure(failed.kind, failed.status);
  }
}

export async function GET(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("engagement.synthesis-preparation.read", request);
  try {
    const { campaignId } = z.object({ campaignId: id }).parse(await context.params);
    const entries = [...request.nextUrl.searchParams];
    if (entries.length !== 1 || entries[0][0] !== "requestId") return failure("invalid", 400);
    const requestId = id.parse(entries[0][1]), auth = await staff(request, campaignId);
    const result = await readSynthesisPreparation(auth.client, { campaignId, workspaceId: auth.workspaceId, requestId }, request.signal);
    audit.info("preparation_read", { requestId, status: result?.status ?? "not_queued" });
    return NextResponse.json(result, { headers });
  } catch (error) {
    const failed = classify(error);
    audit.warn("preparation_read_unavailable", { kind: failed.kind });
    return failure(failed.kind, failed.status);
  }
}
