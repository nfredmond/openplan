import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { acquireConnectorLock, writeConnectorJournal } from "../../../../workers/planner_agent_connector/connector-worker.mjs";
import { readPrivateJson } from "../../../../workers/planner_agent_connector/connector-client.mjs";
import { checkedProviderTurn, ProviderRequestError, providerRpcError, type ProviderService, type RetainedProviderTurn } from "./provider-server";
import { createProviderApiGeneration, ProviderApiGenerationError } from "./provider-api-generation";
import { providerApiConfigurationSchema } from "@/lib/integrations/provider-api-credentials";

type ApiTurn = Extract<RetainedProviderTurn, { provider: "api_connection" }>;
type ClaimedTurn = ApiTurn & { attempt_id: string; lease_expires_at: string };
const deliverySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("answer"), result: z.record(z.string(), z.unknown()), receipt: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ kind: z.literal("failure"), code: z.string().regex(/^[a-z][a-z0-9_]{1,100}$/) }).strict(),
]);
type Delivery = z.infer<typeof deliverySchema>;
const baseJournalSchema = z.object({ version: z.literal(1), target: z.string(), job: z.unknown() });
const journalSchema = z.discriminatedUnion("phase", [
  baseJournalSchema.extend({ phase: z.literal("running") }).strict(),
  baseJournalSchema.extend({ phase: z.literal("completed"), delivery: deliverySchema }).strict(),
  baseJournalSchema.extend({ phase: z.literal("delivered"), acknowledgedState: z.enum(["succeeded", "failed", "cancelled", "interrupted", "access_lost"]) }).strict(),
]);
const statusSchema = z.object({ id: z.string().uuid(), attemptId: z.string().uuid(),
  state: z.enum(["queued", "running", "succeeded", "failed", "cancelled", "interrupted", "access_lost"]), leaseExpiresAt: z.string().nullable() }).strict();
const credentialSchema = z.object({ revision_id: z.string().uuid(), connection_id: z.string().uuid(),
  workspace_id: z.string().uuid(), credential_ciphertext: z.string().max(32_000).nullable() }).strict();
export const API_WORKER_CREDENTIAL_COLUMNS = "revision_id,connection_id,workspace_id,credential_ciphertext";
const journalReader: (path: string, maxBytes: number) => Promise<unknown> = readPrivateJson;
const journalWriter: (directory: string, value: unknown) => Promise<void> = writeConnectorJournal;

function claimedTurn(raw: unknown): ClaimedTurn {
  const { turn } = checkedProviderTurn(raw);
  if (turn.provider !== "api_connection" || turn.state !== "running" || !turn.attempt_id || !turn.lease_expires_at ||
    !Number.isFinite(Date.parse(turn.lease_expires_at))) throw new ProviderRequestError("api_worker_claim_invalid", 409);
  return { ...turn, attempt_id: turn.attempt_id, lease_expires_at: turn.lease_expires_at };
}

// The configured database destination is retained with every attempt. Reusing a
// journal against a different deployment must fail before any query or model call.
export function providerApiWorkerTarget(raw: string) {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new ProviderRequestError("api_worker_target_invalid");
  }
  return url.href.replace(/\/$/, "");
}

function sameAttempt(saved: ApiTurn, job: ClaimedTurn) {
  const fields = ["id", "request_id", "user_id", "workspace_id", "project_id", "connection_id", "provider", "model_id", "auth_mode", "question",
    "packet_canonical", "packet_hash", "attempt_id", "api_connection_id", "api_revision_id", "api_configuration_canonical", "api_configuration_hash", "api_charge_ack"] as const;
  return fields.every(field => saved[field] === job[field]);
}

export type ProviderApiWorkerOutcome = { state: "idle" | "succeeded" | "failed" | "cancelled" | "interrupted" | "access_lost"; turnId?: string };

// One cycle holds the existing OS lock across claim, generation and delivery.
// The database owns job state and dispatch reservations; the private journal
// only preserves an exact completion for delivery after a process interruption.
export async function runProviderApiWorkerCycle(args: {
  service: ProviderService; target: string; directory: string; signal: AbortSignal;
  generate?: typeof createProviderApiGeneration; statusIntervalMs?: number;
}): Promise<ProviderApiWorkerOutcome> {
  const target = providerApiWorkerTarget(args.target);
  const lock = await acquireConnectorLock(args.directory);
  const signal = AbortSignal.any([args.signal, lock.signal]);
  const requestSignal = () => AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  const service = args.service;
  async function status(job: ClaimedTurn, observedSignal = requestSignal()) {
    const response = await service.rpc("read_assistant_api_turn_status", { p_turn_id: job.id, p_attempt_id: job.attempt_id }).abortSignal(observedSignal);
    providerRpcError(response.error);
    const value = statusSchema.parse(response.data);
    if (value.id !== job.id || value.attemptId !== job.attempt_id) throw new ProviderRequestError("api_worker_status_mismatch", 409);
    return value;
  }
  async function retire(job: ClaimedTurn, state: Exclude<ProviderApiWorkerOutcome["state"], "idle">) {
    await journalWriter(args.directory, { version: 1, target, phase: "delivered", job, acknowledgedState: state });
    return { state, turnId: job.id };
  }
  try {
    signal.throwIfAborted();
    let pending: z.infer<typeof journalSchema> | null;
    try { pending = journalSchema.parse(await journalReader(join(args.directory, "pending.json"), 1_000_000)); }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") pending = null;
      else throw error;
    }
    if (pending && pending.target !== target) throw new ProviderRequestError("api_worker_journal_mismatch", 409);
    if (pending) claimedTurn(pending.job);
    if (pending?.phase === "delivered") pending = null;
    let job: ClaimedTurn;
    let delivery: Delivery;
    if (pending) {
      job = claimedTurn(pending.job);
      // A running journal cannot distinguish a crash before dispatch from a
      // crash after provider acceptance. Recovery never calls the model again.
      delivery = pending.phase === "completed" ? pending.delivery : { kind: "failure", code: "api_worker_interrupted" };
      if (pending.phase === "running") await journalWriter(args.directory, { ...pending, phase: "completed", delivery });
    } else {
      const response = await service.rpc("claim_assistant_api_turn", {}).abortSignal(requestSignal());
      providerRpcError(response.error);
      if (response.data === null) return { state: "idle" };
      job = claimedTurn(response.data);
      await journalWriter(args.directory, { version: 1, target, phase: "running", job });
      const cancelled = new AbortController();
      const runningSignal = AbortSignal.any([signal, cancelled.signal]);
      let watching = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      async function observe() {
        try {
          const current = await status(job, AbortSignal.any([runningSignal, AbortSignal.timeout(10_000)]));
          if (current.state !== "running" || !current.leaseExpiresAt || Date.parse(current.leaseExpiresAt) !== Date.parse(job.lease_expires_at) ||
            Date.parse(current.leaseExpiresAt) <= Date.now()) cancelled.abort();
        } catch { cancelled.abort(); }
        if (watching && !runningSignal.aborted) timer = setTimeout(() => { void observe(); }, args.statusIntervalMs ?? 2000);
      }
      try {
        await observe();
        runningSignal.throwIfAborted();
        const response = await service.from("workspace_provider_api_credentials").select(API_WORKER_CREDENTIAL_COLUMNS)
          .eq("workspace_id", job.workspace_id).eq("connection_id", job.api_connection_id).eq("revision_id", job.api_revision_id)
          .abortSignal(AbortSignal.any([runningSignal, AbortSignal.timeout(10_000)])).maybeSingle();
        providerRpcError(response.error);
        const credential = credentialSchema.parse(response.data);
        if (credential.workspace_id !== job.workspace_id || credential.connection_id !== job.api_connection_id || credential.revision_id !== job.api_revision_id) {
          throw new ProviderRequestError("api_worker_credential_mismatch", 409);
        }
        runningSignal.throwIfAborted();
        const invoke = (args.generate ?? createProviderApiGeneration)({
          binding: { turnId: job.id, attemptId: job.attempt_id, workspaceId: job.workspace_id, projectId: job.project_id,
            connectionId: job.api_connection_id, revisionId: job.api_revision_id, configurationHash: job.api_configuration_hash,
            packetHash: job.packet_hash, modelId: job.model_id, authMode: job.auth_mode, chargesAcknowledged: job.api_charge_ack,
            leaseExpiresAt: job.lease_expires_at },
          revision: { workspaceId: job.workspace_id, connectionId: job.api_connection_id, revisionId: job.api_revision_id,
            configuration: providerApiConfigurationSchema.parse(JSON.parse(job.api_configuration_canonical)),
            configurationHash: job.api_configuration_hash, credentialCiphertext: credential.credential_ciphertext },
          packetCanonical: job.packet_canonical, question: job.question, signal: runningSignal,
        });
        const generated = await invoke();
        runningSignal.throwIfAborted();
        delivery = { kind: "answer", result: generated.result, receipt: generated.receipt };
      } catch (error) {
        delivery = { kind: "failure", code: runningSignal.aborted ? "api_worker_interrupted" :
          error instanceof ProviderApiGenerationError && /^api_[a-z_]{1,100}$/.test(error.code) ? error.code : "api_worker_generation_failed" };
      } finally { watching = false; if (timer) clearTimeout(timer); cancelled.abort(); }
      await journalWriter(args.directory, { version: 1, target, phase: "completed", job, delivery });
    }
    const current = await status(job);
    if (current.state === "access_lost" || current.state === "cancelled" || current.state === "interrupted") return retire(job, current.state);
    const result = delivery.kind === "answer" ? delivery.result : null;
    const receipt = delivery.kind === "answer" ? delivery.receipt : null;
    const failure = delivery.kind === "failure" ? delivery.code : null;
    const finished = await service.rpc("finish_assistant_provider_turn", { p_turn_id: job.id, p_attempt_id: job.attempt_id,
      p_user_id: job.user_id, p_connection_id: null, p_token_hash: null, p_result: result, p_provider_receipt: receipt, p_failure_code: failure }).abortSignal(requestSignal());
    if (finished.error) {
      // Access/cancellation may change between the status read and completion.
      // A minimal status can retire the private journal without retrieving data.
      const latest = await status(job);
      if (latest.state === "access_lost" || latest.state === "cancelled" || latest.state === "interrupted") return retire(job, latest.state);
      providerRpcError(finished.error);
    }
    const saved = checkedProviderTurn(finished.data).turn;
    if (saved.provider !== "api_connection" || !sameAttempt(saved, job)) throw new ProviderRequestError("api_worker_delivery_mismatch", 409);
    if (saved.state === "cancelled" || saved.state === "interrupted") return retire(job, saved.state);
    if (saved.state !== (failure === null ? "succeeded" : "failed") || saved.failure_code !== failure ||
      !isDeepStrictEqual(saved.result, result) || !isDeepStrictEqual(saved.provider_receipt, receipt)) throw new ProviderRequestError("api_worker_delivery_mismatch", 409);
    return retire(job, saved.state);
  } finally { await lock.release(); }
}
