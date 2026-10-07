import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { readSynthesisGenerationRequest, SynthesisGenerationRequestError } from "./synthesis-generation-requests-server";
import { parseSynthesisExecutionReceipt, synthesisExecutionCursorSchema, synthesisExecutionHistorySchema } from "./synthesis-execution-records";

const id = z.string().uuid();
const querySchema = z.object({ campaignId: id, workspaceId: id, requestId: id, before: synthesisExecutionCursorSchema.nullable() }).strict();
const rowSchema = z.object({ id, request_id: id, intent_text: z.string().max(4096),
  intent_sha256: z.string().regex(/^[a-f0-9]{64}$/), created_at: z.string().datetime({ offset: true }) }).strict();
const unavailable = (): never => { throw new SynthesisGenerationRequestError("unavailable", 503); };

/** Discover original grants on another device or after a lost acknowledgement.
 * Current staff access is checked on both sides of the private read. Original
 * expired or cancelled authority remains history, never renewed permission.
 */
export async function readSynthesisExecutionHistory(client: Pick<SupabaseClient, "rpc">, service: Pick<SupabaseClient, "from">,
  rawQuery: z.infer<typeof querySchema>, signal: AbortSignal) {
  signal.throwIfAborted();
  const query = querySchema.parse(rawQuery), scope = { campaignId: query.campaignId, workspaceId: query.workspaceId, requestId: query.requestId };
  const original = await readSynthesisGenerationRequest(client, scope, signal);
  const request = original.state.request, intent = original.intent;
  if (!request || !intent) throw new SynthesisGenerationRequestError("conflict", 409);
  let selection = service.from("engagement_synthesis_generation_authorizations")
    .select("id,request_id,intent_text,intent_sha256,created_at").eq("request_id", query.requestId)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(26);
  if (query.before) selection = selection.or(`created_at.lt."${query.before.createdAt}",and(created_at.eq."${query.before.createdAt}",id.lt.${query.before.id})`);
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  const response = await selection.abortSignal(bounded);
  bounded.throwIfAborted();
  if (response.error) unavailable();
  const rows = z.array(rowSchema).max(26).parse(response.data);
  const seen = new Set<string>();
  const entries = rows.map(row => {
    if (row.request_id !== query.requestId || seen.has(row.id) ||
      createHash("sha256").update(row.intent_text, "utf8").digest("hex") !== row.intent_sha256) unavailable();
    seen.add(row.id);
    const { receipt } = parseSynthesisExecutionReceipt({ schemaVersion: 1, id: row.id, requestId: row.request_id,
      intentText: row.intent_text, intentSha256: row.intent_sha256 }, { authorizationId: row.id, intentText: row.intent_text }, query.requestId);
    return { ...receipt, createdAt: row.created_at };
  });
  const current = await readSynthesisGenerationRequest(client, scope, signal);
  if (current.state.request?.intentText !== request.intentText || current.state.request.actorId !== request.actorId) unavailable();
  signal.throwIfAborted();
  const page = entries.slice(0, 25), last = page.at(-1);
  return synthesisExecutionHistorySchema.parse({ schemaVersion: 1, ...scope, actorId: request.actorId,
    sourceId: intent.sourceId, sourceSha256: intent.sourceSha256, requestIntentSha256: request.intentSha256,
    cancelled: current.cancellation !== null, entries: page,
    nextCursor: entries.length > 25 && last ? { id: last.id, createdAt: last.createdAt } : null });
}
