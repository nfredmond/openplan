import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const date = z.iso.datetime({ offset: true });
const attempt = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const stage = z.enum(["segment", "context", "thematic"]);
const scopeSchema = z.object({ campaignId: id, workspaceId: id, requestId: id }).strict();
const stateSchema = scopeSchema.extend({ schemaVersion: z.literal(1), actorId: id, intentSha256: hash,
  stage, status: z.enum(["queued", "running", "failed", "cancelled", "prepared"]), attempts: attempt,
  leaseUntil: date.nullable(), failureCode: z.enum(["access_unavailable", "input_unavailable", "preparation_failed"]).nullable(),
  sealSha256: hash.nullable(), cancelled: z.boolean(), createdAt: date, updatedAt: date, replayed: z.boolean().optional(),
}).strict();
type Client = Pick<SupabaseClient, "rpc">;
export type SynthesisPreparationScope = z.infer<typeof scopeSchema>;
export type SynthesisPreparationState = z.infer<typeof stateSchema>;

export class SynthesisPreparationError extends Error {
  constructor(public readonly kind: "invalid" | "forbidden" | "conflict" | "unavailable", public readonly status: number) {
    super(`Synthesis preparation ${kind}`);
  }
}

/** Validate staff-visible state. A saved seal reports preparation, not execution authority. */
export function verifySynthesisPreparation(raw: unknown, rawScope: SynthesisPreparationScope) {
  const scope = scopeSchema.parse(rawScope);
  if (raw === null) return null;
  const state = stateSchema.parse(raw);
  if (state.campaignId !== scope.campaignId || state.workspaceId !== scope.workspaceId || state.requestId !== scope.requestId) {
    throw new Error("Preparation scope differs");
  }
  if ((state.status === "running") !== (state.leaseUntil !== null) ||
    (state.status === "failed") !== (state.failureCode !== null) ||
    (state.status === "prepared") !== (state.sealSha256 !== null) ||
    (["running", "prepared"].includes(state.status) && state.attempts === 0) ||
    (state.status === "cancelled" && !state.cancelled)) throw new Error("Preparation state differs");
  return state;
}

async function invoke(client: Client, name: string, args: Record<string, unknown>, scope: SynthesisPreparationScope, signal: AbortSignal) {
  signal.throwIfAborted();
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  const response = await client.rpc(name, args).abortSignal(boundedSignal);
  boundedSignal.throwIfAborted();
  if (response.error) {
    const code = response.error.code;
    if (code === "42501") throw new SynthesisPreparationError("forbidden", 403);
    if (["PT409", "23505"].includes(code)) throw new SynthesisPreparationError("conflict", 409);
    if (["22023", "22P02"].includes(code)) throw new SynthesisPreparationError("invalid", 400);
    throw new SynthesisPreparationError("unavailable", 503);
  }
  try { return verifySynthesisPreparation(response.data, scope); }
  catch { throw new SynthesisPreparationError("unavailable", 503); }
}

export function readSynthesisPreparation(client: Client, rawScope: SynthesisPreparationScope, signal: AbortSignal) {
  const scope = scopeSchema.parse(rawScope);
  return invoke(client, "read_engagement_synthesis_preparation", { p_campaign: scope.campaignId, p_request: scope.requestId }, scope, signal);
}

const enqueueSchema = scopeSchema.extend({ actorId: id, stage, intentSha256: hash }).strict();

/** Recover the exact enqueue acknowledgement, including later progress or cancellation. */
export async function enqueueSynthesisPreparation(client: Client, raw: z.infer<typeof enqueueSchema>, signal: AbortSignal) {
  const args = enqueueSchema.parse(raw);
  const scope = { campaignId: args.campaignId, workspaceId: args.workspaceId, requestId: args.requestId };
  const state = await invoke(client, "enqueue_engagement_synthesis_preparation", {
    p_campaign: args.campaignId, p_request: args.requestId, p_stage: args.stage, p_intent_sha256: args.intentSha256,
  }, scope, signal);
  if (!state || state.actorId !== args.actorId || state.stage !== args.stage || state.intentSha256 !== args.intentSha256 ||
    state.replayed === undefined) throw new SynthesisPreparationError("unavailable", 503);
  return state;
}

const retrySchema = scopeSchema.extend({ actorId: id, attempt }).strict();

/** An old retry may inspect a newer attempt. Native code alone decides whether to requeue. */
export async function retrySynthesisPreparation(client: Client, raw: z.infer<typeof retrySchema>, signal: AbortSignal) {
  const args = retrySchema.parse(raw);
  const scope = { campaignId: args.campaignId, workspaceId: args.workspaceId, requestId: args.requestId };
  const state = await invoke(client, "retry_engagement_synthesis_preparation", {
    p_campaign: args.campaignId, p_request: args.requestId, p_attempt: args.attempt,
  }, scope, signal);
  if (!state || state.actorId !== args.actorId || state.attempts < args.attempt) throw new SynthesisPreparationError("unavailable", 503);
  return state;
}
