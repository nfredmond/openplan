import { setTimeout as delay } from "node:timers/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { verifySynthesisPreparation } from "./synthesis-preparation-server";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), date = z.iso.datetime({ offset: true });
const claimSchema = z.object({ token: id, request_id: id, attempt: z.number().int().positive().safe(),
  claimed_at: date, initial_lease_until: date }).strict();
const workerFields = z.object({ leaseToken: id.nullable(), claim: claimSchema.optional(), active: z.boolean().optional() });
const outcomeSchema = z.union([
  z.object({ sealSha256: hash }).strict(),
  z.object({ failureCode: z.enum(["input_unavailable", "preparation_failed"]) }).strict(),
]);
type Service = Pick<SupabaseClient, "rpc">;
export type SynthesisPreparationOutcome = z.infer<typeof outcomeSchema>;

/** Split private lease metadata from the existing staff-state verifier. */
function workerState(raw: unknown, requestId: string) {
  const fields = workerFields.parse(raw);
  const { leaseToken: _token, claim: _claim, active: _active, ...publicState } = z.record(z.string(), z.unknown()).parse(raw);
  const scope = z.object({ campaignId: id, workspaceId: id }).parse(publicState);
  const state = verifySynthesisPreparation(publicState, { ...scope, requestId });
  if (!state) throw new Error("Preparation worker state missing");
  return { ...state, ...fields };
}
type WorkerState = ReturnType<typeof workerState>;
export type SynthesisPreparationLease = WorkerState & { leaseToken: string };

async function call(service: Service, name: string, args: Record<string, unknown>, signal: AbortSignal) {
  signal.throwIfAborted();
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  const result = await service.rpc(name, args).abortSignal(bounded);
  bounded.throwIfAborted();
  if (result.error) throw new Error("Preparation worker acknowledgement unavailable");
  return result.data;
}

function sameAttempt(current: WorkerState, original: SynthesisPreparationLease) {
  if (current.requestId !== original.requestId || current.campaignId !== original.campaignId ||
    current.workspaceId !== original.workspaceId || current.actorId !== original.actorId || current.stage !== original.stage ||
    current.intentSha256 !== original.intentSha256 || current.attempts !== original.attempts ||
    current.leaseToken !== original.leaseToken || current.createdAt !== original.createdAt) {
    throw new Error("Preparation worker attempt differs");
  }
}

/** Verify either a native claim reply or the original claim saved in a journal. */
export function verifySynthesisPreparationClaim(raw: unknown, rawRequestId: string, rawToken: string) {
  const requestId = id.parse(rawRequestId), token = id.parse(rawToken);
  if (raw === null) return null;
  const state = workerState(raw, requestId), claim = state.claim;
  if (!claim || state.active === undefined || claim.token !== token || claim.request_id !== requestId ||
    claim.attempt > state.attempts || Date.parse(claim.initial_lease_until) <= Date.parse(claim.claimed_at)) {
    throw new Error("Preparation worker claim differs");
  }
  if (!state.active) return null;
  if (state.status !== "running" || state.cancelled || state.leaseToken !== token || claim.attempt !== state.attempts) {
    throw new Error("Preparation worker lease is not current");
  }
  return { ...state, leaseToken: token };
}

export function verifySynthesisPreparationOutcome(raw: unknown) {
  return outcomeSchema.parse(raw);
}

/** Recover the supplied claim token. A superseded token never starts fresh work. */
export async function claimSynthesisPreparation(service: Service, rawRequestId: string, rawToken: string, signal: AbortSignal) {
  const requestId = id.parse(rawRequestId), token = id.parse(rawToken);
  const raw = await call(service, "claim_engagement_synthesis_preparation", { p_request: requestId, p_token: token }, signal);
  return verifySynthesisPreparationClaim(raw, requestId, token);
}

export async function renewSynthesisPreparation(service: Service, lease: SynthesisPreparationLease, signal: AbortSignal) {
  const state = workerState(await call(service, "renew_engagement_synthesis_preparation", {
    p_request: lease.requestId, p_token: lease.leaseToken,
  }, signal), lease.requestId);
  sameAttempt(state, lease);
  if (state.status !== "running" || state.cancelled) throw new Error("Preparation worker renewal is not current");
  return state;
}

/** Completion replay uses the original lease and exact outcome even after later cancellation. */
export async function finishSynthesisPreparation(service: Service, lease: SynthesisPreparationLease,
  rawOutcome: SynthesisPreparationOutcome, signal: AbortSignal,
) {
  const outcome = outcomeSchema.parse(rawOutcome);
  const seal = "sealSha256" in outcome ? outcome.sealSha256 : null;
  const failure = "failureCode" in outcome ? outcome.failureCode : null;
  const state = workerState(await call(service, "finish_engagement_synthesis_preparation", {
    p_request: lease.requestId, p_token: lease.leaseToken, p_seal_sha256: seal, p_failure_code: failure,
  }, signal), lease.requestId);
  sameAttempt(state, lease);
  if (state.status !== (seal === null ? "failed" : "prepared") || state.sealSha256 !== seal || state.failureCode !== failure) {
    throw new Error("Preparation worker completion differs");
  }
  return state;
}

/** Maintain one native lease around stage-specific preparation. Unknown replies or
 * interruption leave the attempt unconfirmed for exact recovery or later lease
 * reclamation. Only an explicit preparation outcome is recorded as failed/prepared.
 * The callback must reconstruct the original stage; this runner grants no dispatch.
 */
export async function runSynthesisPreparationAttempt(args: {
  service: Service; requestId: string; token: string; signal: AbortSignal;
  prepare: (lease: SynthesisPreparationLease, signal: AbortSignal) => Promise<SynthesisPreparationOutcome>;
}) {
  const lease = await claimSynthesisPreparation(args.service, args.requestId, args.token, args.signal);
  if (!lease) return { state: "not_active" as const };
  const lost = new AbortController(), stopTimer = new AbortController();
  const signal = AbortSignal.any([args.signal, lost.signal]);
  const timerSignal = AbortSignal.any([signal, stopTimer.signal]);
  const heartbeat = (async () => {
    while (!stopTimer.signal.aborted && !signal.aborted) {
      try { await delay(30_000, undefined, { signal: timerSignal }); }
      catch { break; }
      if (stopTimer.signal.aborted || signal.aborted) break;
      try { await renewSynthesisPreparation(args.service, lease, signal); }
      catch (error) { lost.abort(error); break; }
    }
  })();
  let outcome: SynthesisPreparationOutcome;
  try {
    signal.throwIfAborted();
    outcome = await args.prepare(lease, signal);
    signal.throwIfAborted();
  } finally {
    stopTimer.abort();
    // Join an in-flight renewal before completion, so it cannot outlive this job.
    await heartbeat;
  }
  signal.throwIfAborted();
  const result = await finishSynthesisPreparation(args.service, lease, outcome, signal);
  return { state: result.status === "prepared" ? "prepared" as const : "failed" as const, result };
}
