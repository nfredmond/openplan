import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { synthesisGenerationRequestIntentSchema } from "./synthesis-generation-plan";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const date = z.iso.datetime({ offset: true });
const scopeSchema = z.object({ campaignId: id, workspaceId: id, requestId: id }).strict();
const requestSchema = z.object({ id, actorId: id, intentText: z.string().max(4096), intentSha256: hash, createdAt: date }).strict();
const cancellationSchema = z.object({ id, receiptText: z.string(), receiptSha256: hash, createdAt: date }).strict();
const stateSchema = z.object({ schemaVersion: z.literal(1), campaignId: id, workspaceId: id,
  request: requestSchema.nullable(), cancellation: cancellationSchema.nullable(), replayed: z.boolean().optional(),
}).strict();
const receiptSchema = z.object({ schemaVersion: z.literal(1), id, requestId: id, campaignId: id, workspaceId: id,
  actorId: id, reason: z.string().min(1).max(4000).refine(value => /\S/.test(value)),
  requestExisted: z.boolean(), cancelledAt: date }).strict();
type Client = Pick<SupabaseClient, "rpc">;
export type SynthesisGenerationRequestScope = z.infer<typeof scopeSchema>;
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

export class SynthesisGenerationRequestError extends Error {
  constructor(public readonly kind: "invalid" | "forbidden" | "conflict" | "unavailable", public readonly status: number) {
    super(`Synthesis request ${kind}`);
  }
}

/** Verify native custody without treating a request or cancellation as execution authority. */
export function verifySynthesisGenerationRequest(raw: unknown, rawScope: SynthesisGenerationRequestScope) {
  const scope = scopeSchema.parse(rawScope), state = stateSchema.parse(raw);
  if (state.campaignId !== scope.campaignId || state.workspaceId !== scope.workspaceId ||
    (!state.request && !state.cancellation)) throw new Error("Synthesis request scope differs");
  let intent: z.infer<typeof synthesisGenerationRequestIntentSchema> | null = null;
  if (state.request) {
    if (state.request.id !== scope.requestId || digest(state.request.intentText) !== state.request.intentSha256 ||
      Buffer.byteLength(state.request.intentText, "utf8") > 4096) throw new Error("Synthesis request bytes differ");
    intent = synthesisGenerationRequestIntentSchema.parse(JSON.parse(state.request.intentText));
  }
  let cancellation: z.infer<typeof receiptSchema> | null = null;
  if (state.cancellation) {
    if (digest(state.cancellation.receiptText) !== state.cancellation.receiptSha256) throw new Error("Synthesis cancellation bytes differ");
    cancellation = receiptSchema.parse(JSON.parse(state.cancellation.receiptText));
    if (cancellation.id !== state.cancellation.id || cancellation.requestId !== scope.requestId ||
      cancellation.campaignId !== scope.campaignId || cancellation.workspaceId !== scope.workspaceId ||
      cancellation.requestExisted !== (state.request !== null) ||
      (state.request !== null && cancellation.actorId !== state.request.actorId)) throw new Error("Synthesis cancellation scope differs");
  }
  return { state, intent, cancellation };
}

async function invoke(client: Client, name: string, args: Record<string, unknown>,
  scope: SynthesisGenerationRequestScope, signal: AbortSignal) {
  signal.throwIfAborted();
  const response = await client.rpc(name, args).abortSignal(AbortSignal.any([signal, AbortSignal.timeout(10_000)]));
  signal.throwIfAborted();
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
