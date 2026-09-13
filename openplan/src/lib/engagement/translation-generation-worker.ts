import { createHash } from "node:crypto";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { acquireConnectorLock, writeConnectorJournal } from "../../../../workers/planner_agent_connector/connector-worker.mjs";
import { readPrivateJson } from "../../../../workers/planner_agent_connector/connector-client.mjs";
import type { createServiceRoleClient } from "@/lib/supabase/server";
import { translationCredentialSchema } from "@/lib/integrations/translation-credentials";
import { verifyWorkspaceTranslationSelection } from "@/lib/integrations/workspace-keys";
import { providerApiWorkerTarget } from "@/lib/assistant/provider-api-worker";
import { createTranslationGeneration, translationGenerationBindingSchema, translationGenerationPacketSchema } from "./translation-generation";
import { decodeTranslationGenerationDelivery, encodeTranslationGenerationDelivery, translationGenerationDeliverySchema } from "./translation-generation-delivery";

const id = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true });
const terminal = z.enum(["completed", "incomplete", "failed", "interrupted", "cancelled"]);
const state = z.enum(["queued", "reserved", "running", ...terminal.options]);
const fieldSchema = z.object({ id, request_id: id, packet_canonical: z.string().max(200000), packet_hash: hash,
  state, attempt_id: id.nullable(), reservation_id: id.nullable(), lease_expires_at: timestamp.nullable() });
const requestSchema = z.object({ id, workspace_id: id, campaign_id: id, credential: translationCredentialSchema,
  selected_key_ciphertext_hash: hash.nullable() }).strict();
export const TRANSLATION_WORKER_FIELD_COLUMNS = "id,request_id,packet_canonical,packet_hash,state,attempt_id,reservation_id,lease_expires_at";
export const TRANSLATION_WORKER_REQUEST_COLUMNS = "id,workspace_id,campaign_id,credential,selected_key_ciphertext_hash";
const jobSchema = z.object({ binding: translationGenerationBindingSchema, packetCanonical: z.string().max(200000),
  model: z.string(), credentialSource: z.enum(["workspace", "env"]) }).strict();
type Job = z.infer<typeof jobSchema>;
const deliverySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("output"), value: translationGenerationDeliverySchema }).strict(),
  z.object({ kind: z.literal("failure"), state: z.enum(["failed", "interrupted"]), code: z.string().regex(/^[a-z_]{1,100}$/) }).strict(),
]);
type Delivery = z.infer<typeof deliverySchema>;
const baseJournal = z.object({ version: z.literal(1), target: z.string(), job: jobSchema });
const journalSchema = z.discriminatedUnion("phase", [
  baseJournal.extend({ phase: z.literal("running") }).strict(),
  baseJournal.extend({ phase: z.literal("completed"), delivery: deliverySchema }).strict(),
  baseJournal.extend({ phase: z.literal("delivered"), delivery: deliverySchema, acknowledgedState: terminal }).strict(),
]);
const statusSchema = z.object({ fieldId: id, attemptId: id, state, failureCode: z.string().nullable(), leaseExpiresAt: timestamp.nullable() }).strict();
const dispatchSchema = z.object({ fieldId: id, attemptId: id, reservationId: id, state, leaseExpiresAt: timestamp }).strict();
const outputAckSchema = z.object({ fieldId: id, attemptId: id, status: z.enum(["completed", "incomplete"]), state: terminal, digest: hash }).strict();
const stopAckSchema = z.object({ fieldId: id, attemptId: id.nullable(), state: terminal, failureCode: z.string().nullable() }).strict();
type Service = ReturnType<typeof createServiceRoleClient>;
export type TranslationWorkerOutcome = { state: "idle" | z.infer<typeof terminal>; fieldId?: string };
function failure(): never { throw new Error("translation_worker_identity_mismatch"); }
function rpcError(error: unknown) { if (error) throw new Error("translation_worker_database_failed"); }
function checkedJob(raw: unknown): Job {
  const job = jobSchema.parse(raw);
  const packet = translationGenerationPacketSchema.parse(JSON.parse(job.packetCanonical));
  if (JSON.stringify(packet) !== job.packetCanonical || createHash("sha256").update(job.packetCanonical).digest("hex") !== job.binding.packetHash ||
    packet.fieldId !== job.binding.fieldId || packet.workspaceId !== job.binding.workspaceId || packet.campaignId !== job.binding.campaignId) failure();
  return job;
}
function checkedDelivery(job: Job, delivery: Delivery): Delivery {
  if (delivery.kind === "output") {
    const result = decodeTranslationGenerationDelivery(delivery.value);
    const binding = translationGenerationBindingSchema.parse(Object.fromEntries(Object.keys(job.binding).map(key => [key, result.receipt[key as keyof typeof result.receipt]])));
    const packet = translationGenerationPacketSchema.parse(JSON.parse(job.packetCanonical));
    if (!isDeepStrictEqual(binding, job.binding) || result.receipt.model !== job.model || result.receipt.credentialSource !== job.credentialSource ||
      result.receipt.targetLanguage !== packet.targetLanguage || result.receipt.sourceHash !== createHash("sha256").update(packet.sourceText).digest("hex")) failure();
  }
  return delivery;
}

// Use a private OS-locked journal for one worker. Recovery of a running attempt
// reports interruption; only a saved completion may be retried. Credentials and
// unrelated request fields never enter the journal. SQL owns scope and allowance.
export async function runTranslationGenerationWorkerCycle(args: {
  service: Service; target: string; directory: string; signal: AbortSignal;
  generate?: typeof createTranslationGeneration; statusIntervalMs?: number;
}): Promise<TranslationWorkerOutcome> {
  const target = providerApiWorkerTarget(args.target);
  const lock = await acquireConnectorLock(args.directory);
  const signal = AbortSignal.any([args.signal, lock.signal]);
  const requestSignal = () => AbortSignal.any([signal, AbortSignal.timeout(10000)]);
  const service = args.service;
  async function status(fieldId: string, attemptId: string, observedSignal = requestSignal()) {
    const response = await service.rpc("read_translation_generation_status", { p_field: fieldId, p_attempt: attemptId }).abortSignal(observedSignal);
    rpcError(response.error);
    const value = statusSchema.parse(response.data);
    if (value.fieldId !== fieldId || value.attemptId !== attemptId) failure();
    return value;
  }
  async function stop(fieldId: string, attemptId: string | null, desiredState: "failed" | "interrupted", code: string) {
    const response = await service.rpc("stop_translation_generation_field", { p_field: fieldId, p_attempt: attemptId, p_state: desiredState, p_code: code }).abortSignal(requestSignal());
    rpcError(response.error);
    const value = stopAckSchema.parse(response.data);
    if (value.fieldId !== fieldId || value.attemptId !== attemptId || value.state !== desiredState || value.failureCode !== code) failure();
    return value.state;
  }
  try {
    signal.throwIfAborted();
    let pending: z.infer<typeof journalSchema> | null;
    try { pending = journalSchema.parse(await readPrivateJson(join(args.directory, "pending.json"), 1000000)); }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") pending = null;
      else throw error;
    }
    if (pending && pending.target !== target) failure();
    if (pending) {
      checkedJob(pending.job);
      if (pending.phase !== "running") checkedDelivery(pending.job, pending.delivery);
    }
    if (pending?.phase === "delivered") pending = null;
    let job: Job;
    let delivery: Delivery;
    if (pending) {
      job = pending.job;
      delivery = pending.phase === "completed" ? pending.delivery : { kind: "failure", state: "interrupted", code: "translation_worker_interrupted" };
    } else {
      const response = await service.from("engagement_translation_generation_fields").select(TRANSLATION_WORKER_FIELD_COLUMNS)
        .or(`state.eq.queued,and(state.in.(reserved,running),lease_expires_at.lte.${new Date().toISOString()})`)
        .order("request_id").order("ordinal").limit(1).abortSignal(requestSignal()).maybeSingle();
      rpcError(response.error);
      if (response.data === null) return { state: "idle" };
      const candidate = fieldSchema.parse(response.data);
      if (candidate.state === "reserved" || candidate.state === "running") {
        if (!candidate.attempt_id) failure();
        const current = await status(candidate.id, candidate.attempt_id);
        return terminal.safeParse(current.state).success ? { fieldId: candidate.id, state: terminal.parse(current.state) } : { state: "idle" };
      }
      if (candidate.state !== "queued" || candidate.attempt_id || candidate.reservation_id || candidate.lease_expires_at) failure();
      const loaded = await service.from("engagement_translation_generation_requests").select(TRANSLATION_WORKER_REQUEST_COLUMNS)
        .eq("id", candidate.request_id).abortSignal(requestSignal()).single();
      rpcError(loaded.error);
      const request = requestSchema.parse(loaded.data);
      if (request.id !== candidate.request_id || request.credential.requestId !== request.id || request.credential.workspaceId !== request.workspace_id) failure();
      const packet = translationGenerationPacketSchema.parse(JSON.parse(candidate.packet_canonical));
      if (JSON.stringify(packet) !== candidate.packet_canonical || packet.fieldId !== candidate.id || packet.workspaceId !== request.workspace_id ||
        packet.campaignId !== request.campaign_id || createHash("sha256").update(candidate.packet_canonical).digest("hex") !== candidate.packet_hash) failure();
      const verify = () => verifyWorkspaceTranslationSelection({ credential: request.credential, selectedKeyCiphertextHash: request.selected_key_ciphertext_hash,
        client: service, signal: requestSignal() });
      try { await verify(); }
      catch {
        signal.throwIfAborted();
        return { fieldId: candidate.id, state: await stop(candidate.id, null, "failed", "translation_credential_unavailable") };
      }
      const claimed = await service.rpc("claim_translation_generation_field", { p_field: candidate.id }).abortSignal(requestSignal());
      if (claimed.error && ["PT409", "42501"].includes(claimed.error.code)) {
        return { fieldId: candidate.id, state: await stop(candidate.id, null, "failed", "translation_scope_changed") };
      }
      rpcError(claimed.error);
      if (claimed.data === null) return { state: "idle" };
      const field = fieldSchema.parse(claimed.data);
      if (field.id !== candidate.id || field.request_id !== candidate.request_id || field.packet_canonical !== candidate.packet_canonical ||
        field.packet_hash !== candidate.packet_hash || field.state !== "reserved" || !field.attempt_id || !field.reservation_id || !field.lease_expires_at) failure();
      job = checkedJob({ binding: { workspaceId: request.workspace_id, campaignId: request.campaign_id, requestId: request.id, fieldId: field.id,
        attemptId: field.attempt_id, reservationId: field.reservation_id, leaseExpiresAt: field.lease_expires_at,
        credentialId: request.credential.credentialId, configurationHash: request.credential.configurationHash, packetHash: field.packet_hash },
        packetCanonical: field.packet_canonical, model: request.credential.configuration.modelId, credentialSource: request.credential.source });
      await writeConnectorJournal(args.directory, { version: 1, target, phase: "running", job });
      const cancelled = new AbortController();
      const runningSignal = AbortSignal.any([signal, cancelled.signal]);
      let watching = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      async function observe() {
        try {
          const current = await status(job.binding.fieldId, job.binding.attemptId, AbortSignal.any([runningSignal, AbortSignal.timeout(10000)]));
          if (current.state !== "running" || !current.leaseExpiresAt || Date.parse(current.leaseExpiresAt) !== Date.parse(job.binding.leaseExpiresAt) ||
            Date.parse(current.leaseExpiresAt) <= Date.now()) cancelled.abort();
        } catch { cancelled.abort(); }
        if (watching && !runningSignal.aborted) timer = setTimeout(() => { void observe(); }, args.statusIntervalMs ?? 2000);
      }
      try {
        await verify();
        runningSignal.throwIfAborted();
        const invoke = (args.generate ?? createTranslationGeneration)({ binding: job.binding, credential: request.credential, packetCanonical: job.packetCanonical, signal: runningSignal });
        const authorized = await service.rpc("authorize_translation_generation_dispatch", { p_field: field.id, p_attempt: field.attempt_id, p_reservation: field.reservation_id }).abortSignal(requestSignal());
        rpcError(authorized.error);
        const ack = dispatchSchema.parse(authorized.data);
        if (ack.fieldId !== field.id || ack.attemptId !== field.attempt_id || ack.reservationId !== field.reservation_id ||
          ack.state !== "running" || Date.parse(ack.leaseExpiresAt) !== Date.parse(field.lease_expires_at)) failure();
        await observe();
        runningSignal.throwIfAborted();
        delivery = checkedDelivery(job, { kind: "output", value: encodeTranslationGenerationDelivery(await invoke()) });
      } catch {
        delivery = { kind: "failure", state: "interrupted", code: "translation_worker_interrupted" };
      } finally { watching = false; if (timer) clearTimeout(timer); cancelled.abort(); }
    }
    await writeConnectorJournal(args.directory, { version: 1, target, phase: "completed", job, delivery });
    let acknowledgedState: z.infer<typeof terminal>;
    if (delivery.kind === "output") {
      const value = delivery.value;
      const saved = await service.rpc("retain_translation_generation_output", { p_field: job.binding.fieldId, p_attempt: job.binding.attemptId,
        p_status: value.status, p_output_json: value.outputJson, p_binding_canonical: value.bindingCanonical,
        p_provider_metadata_json: value.providerMetadataJson, p_digest: value.digest }).abortSignal(requestSignal());
      rpcError(saved.error);
      const ack = outputAckSchema.parse(saved.data);
      if (ack.fieldId !== job.binding.fieldId || ack.attemptId !== job.binding.attemptId || ack.status !== value.status || ack.digest !== value.digest) failure();
      acknowledgedState = ack.state;
    } else {
      const current = await status(job.binding.fieldId, job.binding.attemptId);
      if (["failed", "interrupted", "cancelled"].includes(current.state)) acknowledgedState = terminal.parse(current.state);
      else acknowledgedState = await stop(job.binding.fieldId, job.binding.attemptId, delivery.state, delivery.code);
    }
    await writeConnectorJournal(args.directory, { version: 1, target, phase: "delivered", job, delivery, acknowledgedState });
    return { state: acknowledgedState, fieldId: job.binding.fieldId };
  } finally { await lock.release(); }
}
