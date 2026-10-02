import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createSynthesisThematicPreparationReader, loadSynthesisThematicPreparation } from "./synthesis-thematic-preparation-server";
import { synthesisWorkerRequestSignal } from "./synthesis-generation-worker-load";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const target = z.string().regex(/^(item|answer):[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
const scopeSchema = z.object({ campaignId: id, workspaceId: id, requestId: id, targetRecordId: target }).strict();
const proofSchema = scopeSchema.extend({ schemaVersion: z.literal(1), purpose: z.literal("private_synthesis_thematic_input"),
  actorId: id, intentSha256: hash, thematicSha256: hash, sourceId: id, sourceSha256: hash,
  choiceSha256: hash, contextRequestId: id, contextRequestSha256: hash, historyManifestSha256: hash,
  finalCaptureSha256: hash, finalResultSha256: hash, outputSha256: hash }).strict();
const recordSchema = z.object({ schemaVersion: z.literal(1), requestId: id, targetRecordId: target,
  proofText: z.string(), proofSha256: hash, outputText: z.string(), outputSha256: hash,
  createdAt: z.string().datetime({ offset: true }), replayed: z.boolean().optional() }).strict();
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
type Scope = z.infer<typeof scopeSchema>;
type Service = Pick<SupabaseClient, "rpc" | "from">;

/** Parse the shared contribution proof without inventing output bytes. A
 * metadata page can verify this binding while full custody reads also verify
 * the original output's bytes. Neither path replaces context reconstruction.
 */
export function verifySynthesisThematicInputProof(proofText: string, rawScope: Scope) {
  const scope = scopeSchema.parse(rawScope), proof = proofSchema.parse(JSON.parse(proofText));
  if (Buffer.byteLength(proofText, "utf8") > 8192 || proof.requestId !== scope.requestId || proof.targetRecordId !== scope.targetRecordId
    || proof.campaignId !== scope.campaignId || proof.workspaceId !== scope.workspaceId) throw new Error("Retained thematic input custody differs");
  return proof;
}

/** Check retained byte custody. This does not reconstruct original context or
 * authorize execution. Before use in a task, replay originals and compare the
 * entire proof and output, then verify complete source membership and its seal.
 */
export function verifySynthesisThematicInput(raw: unknown, rawScope: Scope) {
  const scope = scopeSchema.parse(rawScope), record = recordSchema.parse(raw);
  const proof = verifySynthesisThematicInputProof(record.proofText, scope);
  if (record.requestId !== scope.requestId || record.targetRecordId !== scope.targetRecordId
    || !record.outputText.isWellFormed() || record.outputText.includes("\0")
    || Buffer.byteLength(record.outputText, "utf8") < 1 || Buffer.byteLength(record.outputText, "utf8") > 4_194_304
    || digest(record.proofText) !== record.proofSha256 || digest(record.outputText) !== record.outputSha256
    || proof.outputSha256 !== record.outputSha256) throw new Error("Retained thematic input custody differs");
  return { record, proof };
}

/** Read an interrupted worker's retained acknowledgement, including after
 * cancellation. Native scope still requires the original requester to be staff.
 * A read returns custody only; it must never start fresh preparation or dispatch.
 */
export async function readSynthesisThematicInput(service: Pick<SupabaseClient, "rpc">, rawScope: Scope, signal: AbortSignal) {
  signal.throwIfAborted(); const scope = scopeSchema.parse(rawScope);
  const response = await service.rpc("read_engagement_synthesis_thematic_input", { p_request: scope.requestId, p_target: scope.targetRecordId })
    .abortSignal(synthesisWorkerRequestSignal(signal));
  signal.throwIfAborted();
  if (response.error) throw new Error("Thematic input custody unavailable");
  return response.data === null ? null : verifySynthesisThematicInput(response.data, scope);
}

/** Current staff can inspect original input custody after its author departs.
 * This authenticated read remains separate from the worker's named delegation.
 */
export async function readSynthesisThematicInputHistory(client: Pick<SupabaseClient, "rpc">, rawScope: Scope, signal: AbortSignal) {
  signal.throwIfAborted(); const scope = scopeSchema.parse(rawScope);
  const response = await client.rpc("read_engagement_synthesis_thematic_input_history", { p_campaign: scope.campaignId,
    p_request: scope.requestId, p_target: scope.targetRecordId }).abortSignal(synthesisWorkerRequestSignal(signal));
  signal.throwIfAborted();
  if (response.error) throw new Error("Historical thematic input unavailable");
  return response.data === null ? null : verifySynthesisThematicInput(response.data, scope);
}

/** Retain one contribution after complete original history replay. Native save
 * rechecks current delegation and exact choice while holding the request lock.
 * Exact retries preserve first-write bytes and time. No source seal, task,
 * provider call, resource grant, review revision or approval is created here.
 */
export async function retainSynthesisThematicInput(service: Service, rawScope: Scope, signal: AbortSignal) {
  signal.throwIfAborted(); const scope = scopeSchema.parse(rawScope);
  const preparation = await loadSynthesisThematicPreparation(service, scope, signal);
  return retainPreparedInput(service, scope, preparation, signal);
}

/** Prepare multiple contributions of one request with shared immutable originals.
 * A new process reconstructs its own cache. Each call still replays its context
 * and reaches the native save's current authority, cancellation and seal checks.
 */
export function createSynthesisThematicInputPreparer(service: Service, rawScope: Omit<Scope, "targetRecordId">) {
  const requestScope = scopeSchema.omit({ targetRecordId: true }).parse(rawScope);
  const read = createSynthesisThematicPreparationReader(service, requestScope);
  return async (targetRecordId: string, signal: AbortSignal) => {
    signal.throwIfAborted(); const scope = scopeSchema.parse({ ...requestScope, targetRecordId });
    return retainPreparedInput(service, scope, await read(targetRecordId, signal), signal);
  };
}

async function retainPreparedInput(service: Service, scope: Scope,
  preparation: Awaited<ReturnType<typeof loadSynthesisThematicPreparation>>, signal: AbortSignal) {
  const { thematic, choice, context } = preparation.delegation;
  const outputText = preparation.history.finalOutputText;
  if (outputText === null) throw new Error("Thematic input requires complete original context output");
  const proof = proofSchema.parse({ schemaVersion: 1, purpose: "private_synthesis_thematic_input",
    ...scope, actorId: thematic.state.request.actorId, intentSha256: thematic.state.request.intentSha256,
    thematicSha256: thematic.state.thematic.thematicSha256, sourceId: preparation.source.requestId,
    sourceSha256: preparation.source.snapshotSha256, choiceSha256: choice.record.choiceSha256,
    contextRequestId: context.state.request.id, contextRequestSha256: context.state.context.contextSha256,
    historyManifestSha256: preparation.history.sha256, finalCaptureSha256: choice.choice.finalCaptureSha256,
    finalResultSha256: choice.choice.finalResultSha256, outputSha256: digest(outputText) });
  const proofText = JSON.stringify(proof);
  signal.throwIfAborted();
  const response = await service.rpc("retain_engagement_synthesis_thematic_input", { p_request: scope.requestId,
    p_target: scope.targetRecordId, p_proof_text: proofText, p_output_text: outputText }).abortSignal(synthesisWorkerRequestSignal(signal));
  signal.throwIfAborted();
  if (response.error) throw new Error("Thematic input save unconfirmed; read retained custody or retry the same input");
  const retained = verifySynthesisThematicInput(response.data, scope);
  if (retained.record.proofText !== proofText || retained.record.outputText !== outputText || retained.record.replayed === undefined) {
    throw new Error("Saved thematic input differs from reconstructed originals");
  }
  return retained;
}
