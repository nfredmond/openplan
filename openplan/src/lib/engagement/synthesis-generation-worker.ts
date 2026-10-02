import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { acquireConnectorLock, writeConnectorJournal } from "../../../../workers/planner_agent_connector/connector-worker.mjs";
import { readPrivateJson } from "../../../../workers/planner_agent_connector/connector-client.mjs";
import { providerApiWorkerTarget } from "@/lib/assistant/provider-api-worker";
import { verifyProviderApiResponseReceipt } from "@/lib/assistant/provider-api-response-receipt";
import { checkedSynthesisWorkerJob, loadSynthesisWorkerJob, loadSynthesisWorkerCredential, synthesisWorkerRequestSignal } from "./synthesis-generation-worker-load";
import { createSynthesisGenerationApiAttempt, createSynthesisContextApiAttempt, createSynthesisThematicApiAttempt, verifySynthesisGenerationApiDispatch } from "./synthesis-generation-api";
import { loadSynthesisContextWorkerJob } from "./synthesis-context-worker-job";
import { loadSynthesisThematicWorkerJob } from "./synthesis-thematic-worker-job";
import { createSynthesisGenerationApiResult, verifySynthesisGenerationApiResult } from "./synthesis-generation-api-result";
import { retainSynthesisGenerationOutput } from "./synthesis-generation-delivery";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), timestamp = z.string().datetime({ offset: true });
const natural = z.number().int().nonnegative().safe();
const base = z.object({ version: z.literal(1), target: z.string(), authorizationId: id, taskIndex: natural, workerId: id, attemptId: id,
  context: z.literal(true).optional(), thematic: z.literal(true).optional() });
const assigned = base.extend({ job: z.unknown() });
const dispatched = assigned.extend({ dispatch: z.unknown() });
const observationSchema = z.object({ receipt: z.unknown(), startedAt: timestamp, finishedAt: timestamp, dispatchSha256: hash }).strict();
const observed = dispatched.extend({ observation: observationSchema });
const journalSchema = z.discriminatedUnion("phase", [
  base.extend({ phase: z.literal("prepared") }).strict(),
  assigned.extend({ phase: z.literal("claimed") }).strict(),
  assigned.extend({ phase: z.literal("dispatching") }).strict(),
  dispatched.extend({ phase: z.literal("running") }).strict(),
  observed.extend({ phase: z.literal("observed") }).strict(),
  observed.extend({ phase: z.literal("delivered"), captureSha256: hash }).strict(),
  assigned.extend({ phase: z.literal("unobserved") }).strict(),
]);
type Journal = z.infer<typeof journalSchema>;
type Observed = Extract<Journal, { phase: "observed" | "delivered" }>;
const claimSchema = z.object({ schemaVersion: z.literal(1), attemptId: id, authorizationId: id,
  taskIndex: natural, workerId: id, claimExpiresAt: timestamp, bindingText: z.string().max(4096) }).strict();
const statusSchema = z.object({ schemaVersion: z.literal(1), attemptId: id, workerId: id,
  dispatchSha256: hash.nullable(), outputSha256: hash.nullable(), expiresAt: timestamp.nullable(), canContinue: z.boolean() }).strict();
const dispatchAck = z.object({ schemaVersion: z.literal(1), authorizedNow: z.boolean(), receiptText: z.string().max(16384), receiptSha256: hash }).strict();
// One escaped 1 MiB task, a 4 MiB body in base64 and bounded metadata fit within
// 16 MiB. Keep one original observation; do not duplicate a 32 MiB capture here.
const SYNTHESIS_WORKER_JOURNAL_BYTES = 16 * 1024 * 1024;
export type SynthesisWorkerOutcome = { state: "delivered" | "unobserved"; attemptId: string; captureSha256?: string };
type Service = Pick<SupabaseClient, "from" | "rpc">;
function mismatch(): never { throw new Error("Synthesis worker journal or acknowledgement differs"); }

/** Check every saved phase before recovery. Dispatch verification here proves
 * historical identity only; only a fresh native acknowledgement permits a call.
 */
function checkedJournal(raw: unknown): Journal {
  const value = journalSchema.parse(raw);
  if (value.context && value.thematic) mismatch();
  if (value.phase === "prepared") return value;
  const { job, intent } = checkedSynthesisWorkerJob(value.job);
  if (job.authorizationId !== value.authorizationId || job.taskIndex !== value.taskIndex || job.binding.attemptId !== value.attemptId) mismatch();
  if ("dispatch" in value) {
    const { dispatch, receipt } = verifySynthesisGenerationApiDispatch({ binding: job.binding, dispatch: value.dispatch,
      workerId: value.workerId, authorizationId: value.authorizationId });
    if (receipt.maxOutputTokens !== intent.maxOutputTokens || receipt.responseByteLimit !== intent.responseByteLimit ||
      Date.parse(receipt.expiresAt) > Date.parse(intent.expiresAt)) mismatch();
    if ("observation" in value) {
      if (value.observation.dispatchSha256 !== dispatch.receiptSha256) mismatch();
      verifyProviderApiResponseReceipt(value.observation.receipt, intent.responseByteLimit);
    }
  }
  return value;
}

function retainedResult(value: Observed) {
  const { job, intent } = checkedSynthesisWorkerJob(value.job);
  const context = { dispatchSha256: value.observation.dispatchSha256, responseByteLimit: intent.responseByteLimit };
  const result = createSynthesisGenerationApiResult(job.binding, { ...context, ...value.observation });
  verifySynthesisGenerationApiResult(job.binding, result, context);
  if (value.phase === "delivered" && value.captureSha256 !== result.sha256) mismatch();
  return { job, result, intent };
}

/** One directory belongs to one authorized task and one durable attempt ID.
 * The caller schedules other tasks in separate directories. No phase here picks
 * a new attempt after interruption or renews resource authorization.
 */
type WorkerArgs = {
  service: Service; target: string; directory: string; authorizationId: string; taskIndex: number; signal: AbortSignal;
  generate?: typeof createSynthesisGenerationApiAttempt; statusIntervalMs?: number;
};
export function runSynthesisGenerationWorkerAttempt(args: WorkerArgs): Promise<SynthesisWorkerOutcome> {
  return runAttempt(args, "segment");
}

/** Context shares original-receipt recovery with segment execution. The journal
 * records its mode before any claim, including a claim with an unknown receipt.
 */
export function runSynthesisContextWorkerAttempt(args: WorkerArgs): Promise<SynthesisWorkerOutcome> {
  return runAttempt(args, "context");
}

/** Thematic tasks retain their mode through the same original-output journal.
 * A recovered dispatch never permits another provider call.
 */
export function runSynthesisThematicWorkerAttempt(args: WorkerArgs): Promise<SynthesisWorkerOutcome> {
  return runAttempt(args, "thematic");
}

async function runAttempt(args: WorkerArgs, stage: "segment" | "context" | "thematic"): Promise<SynthesisWorkerOutcome> {
  const target = providerApiWorkerTarget(args.target), authorizationId = id.parse(args.authorizationId), taskIndex = natural.parse(args.taskIndex);
  const statusIntervalMs = z.number().int().min(10).max(2000).parse(args.statusIntervalMs ?? 2000);
  const lock = await acquireConnectorLock(args.directory), signal = AbortSignal.any([args.signal, lock.signal]);
  const service = args.service;
  const mode = stage === "thematic" ? { thematic: true as const } : stage === "context" ? { context: true as const } : {};
  async function persist(value: Journal) {
    lock.signal.throwIfAborted();
    checkedJournal(value);
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > SYNTHESIS_WORKER_JOURNAL_BYTES) throw new Error("Synthesis worker journal exceeds its byte bound");
    await writeConnectorJournal(args.directory, value);
  }
  async function rpc(name: string, values: Record<string, unknown>) {
    const response = await service.rpc(name, values).abortSignal(synthesisWorkerRequestSignal(signal));
    if (response.error) throw new Error("Synthesis worker database acknowledgement unavailable");
    return response.data;
  }
  async function deliver(value: Observed): Promise<SynthesisWorkerOutcome> {
    const { job, result, intent } = retainedResult(value);
    // Reconfirm custody even for an earlier acknowledged journal. A database
    // restore may precede that acknowledgement; repeating these bytes is safe.
    await retainSynthesisGenerationOutput(service, { binding: job.binding, result, workerId: value.workerId,
      responseByteLimit: intent.responseByteLimit }, signal);
    if (value.phase !== "delivered") {
      await persist({ ...value, phase: "delivered", captureSha256: result.sha256 });
    }
    return { state: "delivered", attemptId: value.attemptId, captureSha256: result.sha256 };
  }
  try {
    signal.throwIfAborted();
    let pending: Journal | null;
    try { pending = checkedJournal(await readPrivateJson(join(args.directory, "pending.json"), SYNTHESIS_WORKER_JOURNAL_BYTES)); }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") pending = null;
      else throw error;
    }
    if (pending && (pending.target !== target || pending.authorizationId !== authorizationId || pending.taskIndex !== taskIndex || Boolean(pending.context) !== (stage === "context") || Boolean(pending.thematic) !== (stage === "thematic"))) mismatch();
    // A process can stop after syncing a receipt temporary but before renaming
    // it. Recover only checked observations of this same attempt. A partial
    // temporary proves nothing and remains on disk; conflicting originals stop.
    let recovered: Observed | null = pending?.phase === "observed" || pending?.phase === "delivered" ? pending : null;
    for (const filename of await readdir(args.directory)) {
      if (!/^pending-[0-9a-f-]+\.tmp$/.test(filename)) continue;
      signal.throwIfAborted();
      let candidate: Journal;
      try { candidate = checkedJournal(await readPrivateJson(join(args.directory, filename), SYNTHESIS_WORKER_JOURNAL_BYTES)); }
      catch (error) { if (error instanceof SyntaxError) continue; throw error; }
      if (candidate.phase !== "observed" && candidate.phase !== "delivered") continue;
      if (candidate.phase === "delivered") retainedResult(candidate);
      if (candidate.target !== target || candidate.authorizationId !== authorizationId || candidate.taskIndex !== taskIndex || Boolean(candidate.context) !== (stage === "context") || Boolean(candidate.thematic) !== (stage === "thematic") ||
        (pending && (candidate.attemptId !== pending.attemptId || candidate.workerId !== pending.workerId))) mismatch();
      if (recovered && (!isDeepStrictEqual(candidate.job, recovered.job) || !isDeepStrictEqual(candidate.dispatch, recovered.dispatch) ||
        !isDeepStrictEqual(candidate.observation, recovered.observation))) throw new Error("Synthesis worker has conflicting retained observations");
      recovered ??= candidate;
    }
    if (recovered && recovered !== pending) { await persist(recovered); pending = recovered; }
    if (pending?.phase === "observed" || pending?.phase === "delivered") return await deliver(pending);
    if (pending && ["dispatching", "running", "unobserved"].includes(pending.phase)) {
      const unknown: Journal = { ...mode, version: 1, target, authorizationId, taskIndex, workerId: pending.workerId, attemptId: pending.attemptId,
        phase: "unobserved", job: "job" in pending ? pending.job : undefined };
      await persist(unknown);
      return { state: "unobserved", attemptId: pending.attemptId };
    }
    if (!pending) {
      pending = { ...mode, version: 1, target, authorizationId, taskIndex, workerId: randomUUID(), attemptId: randomUUID(), phase: "prepared" };
      await persist(pending);
    }
    const identity = { ...mode, version: 1 as const, target, authorizationId, taskIndex, workerId: pending.workerId, attemptId: pending.attemptId };
    if (pending.phase === "prepared") {
      const selected = { authorizationId, taskIndex, attemptId: pending.attemptId };
      const loaded = stage === "thematic" ? await loadSynthesisThematicWorkerJob(service, selected, signal)
        : stage === "context" ? await loadSynthesisContextWorkerJob(service, selected, signal)
        : { job: await loadSynthesisWorkerJob(service, selected, signal), claim: {} };
      const { job } = loaded;
      const claim = claimSchema.parse(await rpc(`claim_engagement_synthesis_${stage === "segment" ? "generation" : stage}_attempt`, {
        p_authorization: authorizationId, p_task_index: taskIndex, p_attempt: pending.attemptId, p_worker: pending.workerId, ...loaded.claim }));
      const { intent } = checkedSynthesisWorkerJob(job);
      if (claim.attemptId !== pending.attemptId || claim.workerId !== pending.workerId || claim.authorizationId !== authorizationId ||
        claim.taskIndex !== taskIndex || !isDeepStrictEqual(JSON.parse(claim.bindingText), job.binding) ||
        Date.parse(claim.claimExpiresAt) > Date.parse(intent.expiresAt)) mismatch();
      pending = { ...identity, phase: "claimed", job };
      await persist(pending);
    }
    if (pending.phase !== "claimed") mismatch();
    const { job } = checkedSynthesisWorkerJob(pending.job);
    const revision = await loadSynthesisWorkerCredential(service, job, signal);
    await persist({ ...identity, phase: "dispatching", job });
    const dispatch = dispatchAck.parse(await rpc(`dispatch_engagement_synthesis_${stage === "segment" ? "generation" : stage}_attempt`,
      { p_attempt: identity.attemptId, p_worker: identity.workerId }));
    if (!dispatch.authorizedNow) {
      await persist({ ...identity, phase: "unobserved", job });
      return { state: "unobserved", attemptId: identity.attemptId };
    }
    const running: Journal = { ...identity, phase: "running", job, dispatch };
    await persist(running);
    const stopped = new AbortController(), watching = new AbortController();
    const runningSignal = AbortSignal.any([signal, stopped.signal]);
    let timer: ReturnType<typeof setTimeout> | undefined, active: Promise<void> | undefined;
    let observation: Observed | undefined;
    const { receipt: dispatchReceipt } = verifySynthesisGenerationApiDispatch({ binding: job.binding, dispatch,
      workerId: identity.workerId, authorizationId });
    async function observe() {
      try {
        const response = await service.rpc(`read_engagement_synthesis_${stage === "segment" ? "generation" : stage}_execution_status`,
          { p_attempt: identity.attemptId, p_worker: identity.workerId })
          .abortSignal(synthesisWorkerRequestSignal(AbortSignal.any([runningSignal, watching.signal])));
        if (response.error) mismatch();
        const status = statusSchema.parse(response.data);
        if (status.attemptId !== identity.attemptId || status.workerId !== identity.workerId || status.dispatchSha256 !== dispatch.receiptSha256 ||
          status.outputSha256 !== null || !status.canContinue || !status.expiresAt ||
          Date.parse(status.expiresAt) !== Date.parse(dispatchReceipt.expiresAt) || Date.parse(status.expiresAt) <= Date.now()) mismatch();
      } catch { stopped.abort(); }
      if (!watching.signal.aborted && !runningSignal.aborted) timer = setTimeout(() => { active = observe(); }, statusIntervalMs);
    }
    try {
      await observe(); runningSignal.throwIfAborted();
      const invoke = (args.generate ?? (stage === "thematic" ? createSynthesisThematicApiAttempt : stage === "context" ? createSynthesisContextApiAttempt : createSynthesisGenerationApiAttempt))({ binding: job.binding, taskCanonical: job.taskCanonical,
        dispatch, workerId: identity.workerId, authorizationId, workspaceId: job.workspaceId, connectionId: job.connectionId,
        credentialSha256: job.credentialSha256, revision, signal: runningSignal,
        retainReceipt: async raw => {
          if (observation) throw new Error("Synthesis worker already retained an observation");
          const value: Observed = { ...identity, phase: "observed", job, dispatch, observation: observationSchema.parse(raw) };
          await persist(value); observation = value;
        } });
      const result = await invoke();
      if (!observation || !isDeepStrictEqual(result, retainedResult(observation).result)) mismatch();
    } finally {
      watching.abort(); if (timer) clearTimeout(timer); stopped.abort(); await active;
    }
    if (!observation) mismatch();
    return await deliver(observation);
  } finally { await lock.release(); }
}
