import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { readSynthesisThematicRequest } from "./synthesis-thematic-requests-server";
import { readSynthesisThematicChoice } from "./synthesis-thematic-choices-server";
import { readSynthesisThematicInputHistory, verifySynthesisThematicInputProof } from "./synthesis-thematic-inputs-server";
import { loadSynthesisContextHistory } from "./synthesis-context-history-server";
import { verifySynthesisSource } from "./synthesis-sources-server";
import { createSynthesisThematicInputManifest, verifySynthesisThematicInputSeal } from "./synthesis-thematic-input-manifest";
import { reconstructSynthesisThematicPlan } from "./synthesis-thematic-continuation";
import { createSynthesisThematicStagingPlan, verifySynthesisThematicStagingState } from "./synthesis-thematic-staging";
import type { SynthesisThematicPreparedInputs } from "./synthesis-thematic-content";
import { synthesisWorkerRequestSignal } from "./synthesis-generation-worker-load";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), natural = z.number().int().nonnegative().safe();
const date = z.string().datetime({ offset: true });
const scopeSchema = z.object({ campaignId: id, workspaceId: id, requestId: id }).strict();
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const contextOutputSchema = z.object({ notes: z.array(z.object({ id: natural, text: z.string() })), uncertainties: z.array(z.string()) });
const planSchema = z.object({ request_id: id, header_text: z.string(), header_sha256: hash }).strict();
const sealSchema = z.object({ request_id: id, receipt_text: z.string(), receipt_sha256: hash }).strict();
const frameSchema = z.object({ request_id: id, frame_index: natural, frame_text: z.string(), frame_sha256: hash, frame_bytes: natural }).strict();
const taskSchema = z.object({ request_id: id, task_index: natural, task_text: z.string(), task_sha256: hash, task_bytes: natural,
  cumulative_bytes: natural, chain_sha256: hash }).strict();
const referenceSchema = z.object({ schemaVersion: z.literal(1), purpose: z.literal("private_synthesis_thematic_frame_reference"),
  frameIndex: natural, frameSha256: hash, frameBytes: natural, inputManifestSha256: hash, contentManifestSha256: hash }).strict();
type Client = Pick<SupabaseClient, "rpc">;
type Service = Pick<SupabaseClient, "from" | "rpc">;
type Scope = z.infer<typeof scopeSchema>;
type Request = Awaited<ReturnType<typeof readSynthesisThematicRequest>>;
const differs = (): never => { throw new Error("Historical thematic inputs differ from retained originals"); };

function cancellation(request: Request, scope: Scope) {
  if (request.state.cancellation === null) return null;
  const row = z.object({ id, receiptText: z.string(), receiptSha256: hash, createdAt: date }).strict().parse(request.state.cancellation);
  if (digest(row.receiptText) !== row.receiptSha256) differs();
  z.object({ schemaVersion: z.literal(1), id: z.literal(row.id), requestId: z.literal(scope.requestId),
    campaignId: z.literal(scope.campaignId), workspaceId: z.literal(scope.workspaceId), actorId: z.literal(request.state.request.actorId),
    reason: z.string().min(1).refine(text => Array.from(text).length <= 4000 && text.trim().length > 0), requestExisted: z.literal(true), cancelledAt: date,
  }).strict().parse(JSON.parse(row.receiptText));
  return row;
}

/** Recheck current staff permission after private replay. Cancellation may arrive,
 * but original request bytes and any previously observed cancellation cannot change.
 */
export async function recheckSynthesisThematicHistoryAccess(client: Client, previous: Request, scope: Scope, signal: AbortSignal) {
  const current = await readSynthesisThematicRequest(client, scope, signal);
  if (!isDeepStrictEqual(previous.state.request, current.state.request) || !isDeepStrictEqual(previous.state.thematic, current.state.thematic)) differs();
  const before = cancellation(previous, scope), after = cancellation(current, scope);
  if (before && !isDeepStrictEqual(before, after)) differs();
  return { ...current, cancellation: after };
}

/** Reconstruct complete sealed inputs through the current staff member's history
 * access. Every choice replays its anchored original context; retained proof hashes
 * alone are insufficient. This path never calls a current-worker preparation gate.
 */
export async function loadSynthesisThematicHistoryInputs(client: Client, service: Service, rawScope: Scope, signal: AbortSignal) {
  signal.throwIfAborted(); const scope = scopeSchema.parse(rawScope), request = await readSynthesisThematicRequest(client, scope, signal);
  cancellation(request, scope);
  async function readSeal() {
    signal.throwIfAborted();
    const response = await client.rpc("read_engagement_synthesis_thematic_input_seal_history", { p_campaign: scope.campaignId, p_request: scope.requestId })
      .abortSignal(synthesisWorkerRequestSignal(signal));
    signal.throwIfAborted(); if (response.error) throw new Error("Historical thematic input seal unavailable");
    return response.data;
  }
  const rawSeal = await readSeal();
  if (rawSeal === null) return { preparationStatus: "inputs_not_sealed" as const,
    request: await recheckSynthesisThematicHistoryAccess(client, request, scope, signal) };
  const sourceScope = { requestId: request.intent.sourceId, campaignId: scope.campaignId, workspaceId: scope.workspaceId };
  const sourceResponse = await client.rpc("read_engagement_synthesis_sources", { p_campaign: scope.campaignId, p_request: sourceScope.requestId })
    .abortSignal(synthesisWorkerRequestSignal(signal));
  signal.throwIfAborted(); if (sourceResponse.error) throw new Error("Historical thematic source unavailable");
  const source = verifySynthesisSource(sourceResponse.data, sourceScope);
  if (source.snapshotSha256 !== request.intent.sourceSha256) differs();
  const saved = { ...sourceScope, snapshotText: source.snapshotText, snapshotSha256: source.snapshotSha256, createdAt: source.createdAt };
  const targets = [...source.snapshot.items.map(row => `item:${row.id}`), ...source.snapshot.answers.map(row => `answer:${row.id}`)].sort();
  const originals: SynthesisThematicPreparedInputs["originals"] = [], contexts: SynthesisThematicPreparedInputs["input"]["contexts"] = [];
  const metadata: Array<{ targetRecordId: string; proofText: string; proofSha256: string; outputSha256: string; outputBytes: number }> = [];
  for (const targetRecordId of targets) {
    signal.throwIfAborted();
    const choice = await readSynthesisThematicChoice(client, scope, targetRecordId, signal);
    const stored = await readSynthesisThematicInputHistory(client, { ...scope, targetRecordId }, signal);
    if (!choice || !stored) throw new Error("Historical thematic sealed input is missing");
    const history = await loadSynthesisContextHistory(client, service, { ...scope, requestId: choice.choice.contextRequestId,
      throughSequence: choice.choice.selectionSequence }, signal);
    const context = history.request, binding = context.binding, last = history.entries.at(-1);
    if (choice.record.createdBy !== request.state.request.actorId || context.state.campaignId !== scope.campaignId
      || context.state.workspaceId !== scope.workspaceId || context.state.request.id !== choice.choice.contextRequestId
      || context.intent.sourceId !== source.requestId || context.intent.sourceSha256 !== source.snapshotSha256
      || binding.parentRequestId !== request.binding.parentRequestId || binding.selectionSequence !== request.binding.selectionSequence
      || binding.segmentResultsManifestSha256 !== request.binding.segmentResultsManifestSha256
      || binding.contextManifestSha256 !== request.binding.contextManifestSha256 || binding.targetRecordId !== targetRecordId
      || history.manifest.throughSequence !== choice.choice.selectionSequence || history.manifest.status !== "frames_complete"
      || history.finalOutputText === null || history.sha256 !== choice.choice.historyManifestSha256
      || last?.captureSha256 !== choice.choice.finalCaptureSha256 || last?.resultSha256 !== choice.choice.finalResultSha256) return differs();
    const outputText = history.finalOutputText;
    const proof = verifySynthesisThematicInputProof(JSON.stringify({ schemaVersion: 1, purpose: "private_synthesis_thematic_input", ...scope, targetRecordId,
      actorId: request.state.request.actorId, intentSha256: request.state.request.intentSha256, thematicSha256: request.state.thematic.thematicSha256,
      sourceId: source.requestId, sourceSha256: source.snapshotSha256, choiceSha256: choice.record.choiceSha256,
      contextRequestId: context.state.request.id, contextRequestSha256: context.state.context.contextSha256,
      historyManifestSha256: history.sha256, finalCaptureSha256: choice.choice.finalCaptureSha256,
      finalResultSha256: choice.choice.finalResultSha256, outputSha256: digest(outputText) }), { ...scope, targetRecordId });
    const proofText = JSON.stringify(proof);
    if (stored.record.proofText !== proofText || stored.record.outputText !== outputText) differs();
    const output = contextOutputSchema.parse(JSON.parse(outputText));
    originals.push({ targetRecordId, proofText, outputText });
    metadata.push({ targetRecordId, proofText, proofSha256: stored.record.proofSha256, outputSha256: stored.record.outputSha256,
      outputBytes: Buffer.byteLength(outputText, "utf8") });
    contexts.push({ sourceId: targetRecordId, contextRequestId: context.state.request.id, selectionSequence: choice.choice.selectionSequence,
      historyManifestSha256: history.sha256, finalCaptureSha256: choice.choice.finalCaptureSha256, finalResultSha256: choice.choice.finalResultSha256,
      notes: output.notes, uncertainties: output.uncertainties });
  }
  const inputPlan = createSynthesisThematicInputManifest(request.state, scope, saved, metadata);
  const inputSeal = verifySynthesisThematicInputSeal(rawSeal, inputPlan);
  if (!isDeepStrictEqual(verifySynthesisThematicInputSeal(await readSeal(), inputPlan), inputSeal)) differs();
  const prepared: SynthesisThematicPreparedInputs = { request, source: saved, plan: inputPlan, seal: inputSeal,
    input: { manifestSha256: inputPlan.manifestSha256, sourceId: source.requestId, sourceSha256: source.snapshotSha256, contexts }, originals };
  const plan = createSynthesisThematicStagingPlan(reconstructSynthesisThematicPlan(prepared));
  async function read(query: PromiseLike<{ data: unknown; error: unknown }>) {
    signal.throwIfAborted(); const response = await query; signal.throwIfAborted();
    if (response.error) throw new Error("Historical thematic staging unavailable"); return response.data;
  }
  // A seal observed first must already have every immutable frame and task.
  const rawFrameSeal = await read(service.from("engagement_synthesis_generation_plan_seals")
    .select("request_id,receipt_text,receipt_sha256").eq("request_id", scope.requestId).abortSignal(synthesisWorkerRequestSignal(signal)).maybeSingle());
  const rawHeader = await read(service.from("engagement_synthesis_generation_plans")
    .select("request_id,header_text,header_sha256").eq("request_id", scope.requestId).abortSignal(synthesisWorkerRequestSignal(signal)).maybeSingle());
  const seal = rawFrameSeal === null ? null : sealSchema.parse(rawFrameSeal);
  if (seal && seal.request_id !== scope.requestId) differs();
  let storedFrameCount = 0;
  if (rawHeader === null) { if (seal) differs(); }
  else {
    const header = planSchema.parse(rawHeader);
    if (header.request_id !== scope.requestId || header.header_text !== plan.headerText || header.header_sha256 !== plan.headerSha256) differs();
    let gap = false;
    for (const expected of plan.entries) {
      const rawFrame = await read(service.from("engagement_synthesis_thematic_frames")
        .select("request_id,frame_index,frame_text,frame_sha256,frame_bytes").eq("request_id", scope.requestId).eq("frame_index", expected.index)
        .abortSignal(synthesisWorkerRequestSignal(signal)).maybeSingle());
      const rawTask = await read(service.from("engagement_synthesis_generation_plan_tasks")
        .select("request_id,task_index,task_text,task_sha256,task_bytes,cumulative_bytes,chain_sha256").eq("request_id", scope.requestId).eq("task_index", expected.index)
        .abortSignal(synthesisWorkerRequestSignal(signal)).maybeSingle());
      if (rawFrame === null && rawTask === null) { gap = true; continue; }
      if (gap || rawFrame === null || rawTask === null) {
        if (seal) differs(); throw new Error("Historical thematic staging changed during inspection; retry");
      }
      const frame = frameSchema.parse(rawFrame), task = taskSchema.parse(rawTask), reference = referenceSchema.parse(JSON.parse(task.task_text));
      if (frame.request_id !== scope.requestId || frame.frame_index !== expected.index || frame.frame_text !== expected.canonical
        || frame.frame_sha256 !== expected.sha256 || frame.frame_bytes !== expected.utf8Bytes || task.request_id !== scope.requestId
        || task.task_index !== expected.index || digest(task.task_text) !== task.task_sha256 || Buffer.byteLength(task.task_text, "utf8") !== task.task_bytes
        || task.cumulative_bytes !== expected.cumulativeBytes || task.chain_sha256 !== expected.chainSha256
        || reference.frameIndex !== expected.index || reference.frameSha256 !== expected.sha256 || reference.frameBytes !== expected.utf8Bytes
        || reference.inputManifestSha256 !== plan.header.inputManifestSha256 || reference.contentManifestSha256 !== plan.header.contentManifestSha256) differs();
      storedFrameCount++;
    }
    const last = plan.entries[storedFrameCount - 1];
    verifySynthesisThematicStagingState(plan, { schemaVersion: 1, ...scope, headerText: header.header_text, headerSha256: header.header_sha256,
      nextIndex: storedFrameCount, frameBytes: last?.cumulativeBytes ?? 0, tailSha256: last?.chainSha256 ?? plan.seedSha256,
      cancelled: request.state.cancellation !== null, seal: seal && { receiptText: seal.receipt_text, receiptSha256: seal.receipt_sha256 } });
    if (seal) {
      const final = taskSchema.parse(await read(service.from("engagement_synthesis_generation_plan_tasks")
        .select("request_id,task_index,task_text,task_sha256,task_bytes,cumulative_bytes,chain_sha256").eq("request_id", scope.requestId)
        .eq("task_index", plan.header.frameCount).abortSignal(synthesisWorkerRequestSignal(signal)).single()));
      const receipt = JSON.parse(seal.receipt_text) as { proposalReferenceText: string; proposalReferenceSha256: string };
      if (final.request_id !== scope.requestId || final.task_index !== plan.header.frameCount || final.task_text !== receipt.proposalReferenceText
        || final.task_sha256 !== receipt.proposalReferenceSha256 || Buffer.byteLength(final.task_text, "utf8") !== final.task_bytes
        || final.cumulative_bytes !== plan.header.frameBytes || final.chain_sha256 !== plan.header.tailSha256) differs();
    }
  }
  const current = await recheckSynthesisThematicHistoryAccess(client, request, scope, signal);
  return { scope, request: current, prepared: { ...prepared, request: current }, plan, storedFrameCount,
    preparationStatus: rawHeader === null ? "not_prepared" as const : seal === null ? "staging" as const : "sealed" as const };
}
