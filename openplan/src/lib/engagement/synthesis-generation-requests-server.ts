import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { synthesisGenerationRequestIntentSchema, synthesisGenerationRequestScopeSchema as scopeSchema,
  synthesisGenerationCancellationReceiptSchema as receiptSchema, parseSynthesisGenerationRequestRecords,
  type SynthesisGenerationRequestScope } from "./synthesis-generation-request-records";

const id = z.string().uuid();
type Client = Pick<SupabaseClient, "rpc">;
export type { SynthesisGenerationRequestScope } from "./synthesis-generation-request-records";
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

export class SynthesisGenerationRequestError extends Error {
  constructor(public readonly kind: "invalid" | "forbidden" | "conflict" | "unavailable", public readonly status: number) {
    super(`Synthesis request ${kind}`);
  }
}

/** Verify native custody without treating a request or cancellation as execution authority. */
export function verifySynthesisGenerationRequest(raw: unknown, rawScope: SynthesisGenerationRequestScope) {
  const result = parseSynthesisGenerationRequestRecords(raw, rawScope), { state } = result;
  if (state.request && digest(state.request.intentText) !== state.request.intentSha256) throw new Error("Synthesis request bytes differ");
  if (state.cancellation && digest(state.cancellation.receiptText) !== state.cancellation.receiptSha256) throw new Error("Synthesis cancellation bytes differ");
  return result;
}

async function invoke(client: Client, name: string, args: Record<string, unknown>,
  scope: SynthesisGenerationRequestScope, signal: AbortSignal) {
  signal.throwIfAborted();
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  let response = await client.rpc(name, args).abortSignal(boundedSignal);
  boundedSignal.throwIfAborted();
  // Request reads take the native request lock too. Retry explicit contention
  // within the original deadline; uncertain writes retain their existing recovery.
  if (name === "read_engagement_synthesis_generation_request") {
    for (const waitMs of [50, 150]) {
      if (response.error?.code !== "PT503") break;
      await delay(waitMs, undefined, { signal: boundedSignal });
      boundedSignal.throwIfAborted();
      response = await client.rpc(name, args).abortSignal(boundedSignal);
      boundedSignal.throwIfAborted();
    }
  }
  if (response.error) {
    const code = response.error.code;
    if (code === "42501") throw new SynthesisGenerationRequestError("forbidden", 403);
    if (["PT409", "23505"].includes(code)) throw new SynthesisGenerationRequestError("conflict", 409);
    if (["22023", "22P02"].includes(code)) throw new SynthesisGenerationRequestError("invalid", 400);
    throw new SynthesisGenerationRequestError("unavailable", 503);
  }
  try { return verifySynthesisGenerationRequest(response.data, scope); }
  catch { throw new SynthesisGenerationRequestError("unavailable", 503); }
}

export function readSynthesisGenerationRequest(client: Client, rawScope: SynthesisGenerationRequestScope, signal: AbortSignal) {
  const scope = scopeSchema.parse(rawScope);
  return invoke(client, "read_engagement_synthesis_generation_request", { p_campaign: scope.campaignId, p_request: scope.requestId }, scope, signal);
}

const createSchema = scopeSchema.extend({ actorId: id, intentText: z.string().max(4096) }).strict();

/** Actor comes from authenticated route identity. Preserve the exact intent text on
 * retries; checking today's provider/source first would break lost-response recovery.
 * Native creation rechecks current authority for new requests and returns old receipts.
 */
export async function createSynthesisGenerationRequest(client: Client, raw: z.infer<typeof createSchema>, signal: AbortSignal) {
  const args = createSchema.parse(raw);
  if (Buffer.byteLength(args.intentText, "utf8") > 4096) throw new SynthesisGenerationRequestError("invalid", 400);
  synthesisGenerationRequestIntentSchema.parse(JSON.parse(args.intentText));
  const scope = { campaignId: args.campaignId, workspaceId: args.workspaceId, requestId: args.requestId };
  const result = await invoke(client, "create_engagement_synthesis_generation_request", {
    p_campaign: args.campaignId, p_request: args.requestId, p_intent_text: args.intentText,
  }, scope, signal);
  if (result.state.replayed === undefined || result.state.request?.actorId !== args.actorId ||
    result.state.request.intentText !== args.intentText) throw new SynthesisGenerationRequestError("unavailable", 503);
  return result;
}

const cancelSchema = scopeSchema.extend({ actorId: id, cancellationId: id, reason: receiptSchema.shape.reason }).strict();

/** A cancellation may precede request creation. Its exact receipt remains recoverable. */
export async function cancelSynthesisGenerationRequest(client: Client, raw: z.infer<typeof cancelSchema>, signal: AbortSignal) {
  const args = cancelSchema.parse(raw);
  const scope = { campaignId: args.campaignId, workspaceId: args.workspaceId, requestId: args.requestId };
  const result = await invoke(client, "cancel_engagement_synthesis_generation_request", {
    p_campaign: args.campaignId, p_request: args.requestId, p_cancellation: args.cancellationId, p_reason: args.reason,
  }, scope, signal);
  if (result.state.replayed === undefined || result.cancellation?.id !== args.cancellationId ||
    result.cancellation.actorId !== args.actorId || result.cancellation.reason !== args.reason) {
    throw new SynthesisGenerationRequestError("unavailable", 503);
  }
  return result;
}
