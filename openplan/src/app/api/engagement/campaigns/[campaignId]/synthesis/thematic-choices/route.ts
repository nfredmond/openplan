import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { requireProviderBrowserOrigin } from "@/lib/assistant/provider-server";
import { loadCampaignAccess } from "@/lib/engagement/api";
import { readBytesWithLimitStreaming } from "@/lib/http/body-limit";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { synthesisThematicChoiceCommandSchema, synthesisThematicChoiceSelectionSchema, synthesisThematicChoicePreviewSchema,
  synthesisThematicChoiceReceiptSchema } from "@/lib/engagement/synthesis-thematic-choice-command";
import { prepareSynthesisThematicChoice, readSynthesisThematicChoice, retainSynthesisThematicChoice } from "@/lib/engagement/synthesis-thematic-choices-server";
import { SynthesisGenerationRequestError } from "@/lib/engagement/synthesis-generation-requests-server";
import { readThematicContributionPage, readThematicContextPage } from "@/lib/engagement/synthesis-thematic-choice-discovery-server";
import { synthesisRequestHistoryCursorSchema } from "@/lib/engagement/synthesis-request-history";

const id = z.string().uuid(), integer = z.string().regex(/^(0|[1-9]\d*)$/).transform(Number).pipe(z.number().int().nonnegative().safe());
const querySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("contributions"), requestId: id, offset: integer }).strict(),
  synthesisThematicChoiceSelectionSchema.pick({ requestId: true, targetRecordId: true }).extend({ mode: z.literal("contexts"),
    beforeId: id.optional(), beforeCreatedAt: synthesisRequestHistoryCursorSchema.shape.createdAt.optional() }).strict(),
  synthesisThematicChoiceSelectionSchema.extend({ mode: z.literal("inspect"), throughSequence: integer }).strict(),
  synthesisThematicChoiceSelectionSchema.pick({ requestId: true, targetRecordId: true }).extend({ mode: z.literal("saved") }).strict(),
]);
const headers = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ campaignId: string }> };
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const failure = (status: number) => NextResponse.json({ error: status === 400 ? "Review the exact inspected context choice."
  : status === 401 || status === 403 ? "Current staff access in the selected account and workspace is required."
  : "The context choice could not be confirmed. Keep its original command and inspect saved history before retrying." }, { status, headers });

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

/** Current staff can inspect saved choice custody. Only the thematic author can
 * propose a new choice; full original context is reconstructed before its preview.
 */
export async function GET(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("engagement.synthesis-thematic-choice.read", request);
  try {
    const entries = [...request.nextUrl.searchParams], parsed = querySchema.safeParse(Object.fromEntries(entries));
    if (!parsed.success || new Set(entries.map(([key]) => key)).size !== entries.length ||
      (parsed.data.mode === "contexts" && Boolean(parsed.data.beforeId) !== Boolean(parsed.data.beforeCreatedAt))) return failure(400);
    const auth = await staff(request, context), signal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
    signal.throwIfAborted();
    if (parsed.data.mode === "contributions") {
      const result = await readThematicContributionPage(auth.client, createServiceRoleClient(), { ...auth.scope, actorId: auth.actorId,
        requestId: parsed.data.requestId }, parsed.data.offset, signal);
      signal.throwIfAborted();
      audit.info("contribution_choices_read", { requestId: parsed.data.requestId, offset: parsed.data.offset, count: result.page.entries.length });
      return NextResponse.json(result, { headers });
    }
    if (parsed.data.mode === "contexts") {
      const query = parsed.data;
      const before = query.beforeId ? { id: query.beforeId, createdAt: query.beforeCreatedAt! } : null;
      const result = await readThematicContextPage(auth.client, { ...auth.scope, actorId: auth.actorId, requestId: query.requestId },
        query.targetRecordId, before, signal);
      signal.throwIfAborted();
      audit.info("eligible_contexts_read", { requestId: query.requestId, count: result.eligibleRequestIds.length, hasMore: result.history.nextCursor !== null });
      return NextResponse.json(result, { headers });
    }
    const { mode, ...selection } = parsed.data;
    if (mode === "saved") {
      const result = await readSynthesisThematicChoice(auth.client, { ...auth.scope, requestId: selection.requestId }, selection.targetRecordId, signal);
      signal.throwIfAborted();
      return NextResponse.json({ schemaVersion: 1, ...auth.scope, requestId: selection.requestId, targetRecordId: selection.targetRecordId,
        choice: result?.record ?? null }, { headers });
    }
    const selected = synthesisThematicChoiceSelectionSchema.parse(selection);
    const prepared = await prepareSynthesisThematicChoice(auth.client, createServiceRoleClient(), { ...auth.scope, ...selected, actorId: auth.actorId }, signal);
    signal.throwIfAborted();
    const result = synthesisThematicChoicePreviewSchema.parse({ schemaVersion: 1, ...auth.scope, actorId: auth.actorId,
      command: { ...selected, expected: { requestIntentSha256: prepared.request.state.request.intentSha256,
        thematicSha256: prepared.request.state.thematic.thematicSha256, choiceText: prepared.choiceText } },
      choiceSha256: digest(prepared.choiceText), cancelled: prepared.request.state.cancellation !== null,
      outputText: prepared.outputText, outputExcerpt: prepared.outputText.slice(0, 1600), outputExcerptTruncated: prepared.outputText.length > 1600,
      outputBytes: Buffer.byteLength(prepared.outputText, "utf8"), outputSha256: digest(prepared.outputText), interpretation: "machine_unreviewed" });
    audit.info("context_inspected", { requestId: selected.requestId, contextRequestId: selected.contextRequestId });
    return NextResponse.json(result, { headers });
  } catch (cause) { const code = status(cause); audit.warn("choice_read_unconfirmed", { status: code }); return failure(code); }
}

/** Retain the exact inspected choice with native requester authority. Agent writes
 * remain refused until this workflow has a registered approval action.
 */
export async function POST(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("engagement.synthesis-thematic-choice.write", request);
  try {
    if (["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"].some(key => request.headers.has(key))) return failure(403);
    try { requireProviderBrowserOrigin(request); } catch { return failure(403); }
    const body = await readBytesWithLimitStreaming(request, 8 * 1024);
    if (!body.ok) { body.response.headers.set("Cache-Control", headers["Cache-Control"]); return body.response; }
    let raw: unknown;
    try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body.bytes)); } catch { return failure(400); }
    const parsed = synthesisThematicChoiceCommandSchema.safeParse(raw);
    if (!parsed.success) return failure(400);
    const auth = await staff(request, context), signal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
    signal.throwIfAborted();
    const result = await retainSynthesisThematicChoice(auth.client, createServiceRoleClient(), { ...auth.scope, actorId: auth.actorId, ...parsed.data }, signal);
    signal.throwIfAborted();
    const receipt = synthesisThematicChoiceReceiptSchema.parse(result.record);
    audit.info("choice_retained", { requestId: receipt.requestId, replayed: receipt.replayed });
    return NextResponse.json(receipt, { status: receipt.replayed ? 200 : 201, headers });
  } catch (cause) { const code = status(cause); audit.warn("choice_save_unconfirmed", { status: code }); return failure(code); }
}
