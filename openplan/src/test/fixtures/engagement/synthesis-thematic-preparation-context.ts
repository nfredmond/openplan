import { randomUUID } from "node:crypto";
import { createSynthesisGenerationContextContent } from "@/lib/engagement/synthesis-generation-context-content";
import { createSynthesisContextStagingPlan } from "@/lib/engagement/synthesis-context-plan";
import { loadSynthesisContextHistory } from "@/lib/engagement/synthesis-context-history-server";
import { synthesisContextJobFixture } from "./synthesis-context-job";
import { synthesisContextHistoryFixture } from "./synthesis-context-history";
import type { synthesisThematicPreparationFixture } from "./synthesis-thematic-preparation";
import { sourceHash as hash } from "./synthesis-source";

/** Add another real context execution over the same retained source and parent.
 * Only transport is synthetic; frames, captures, continuation and historical
 * replay use production code. This is not semantic or native permission proof.
 */
export async function addThematicPreparationContext(f: Awaited<ReturnType<typeof synthesisThematicPreparationFixture>>, targetRecordId: string, emitNotes = false) {
  const base = f.f, scope = { ...base.scope, requestId: randomUUID() };
  const contentArgs: typeof base.contentArgs = [...base.contentArgs]; contentArgs[4] = targetRecordId;
  const content = createSynthesisGenerationContextContent(...contentArgs);
  const request = structuredClone(base.request); request.request.id = scope.requestId;
  request.context.contextText = JSON.stringify({ ...JSON.parse(request.context.contextText), targetRecordId, contentManifestSha256: content.manifestSha256 });
  request.context.contextSha256 = hash(request.context.contextText);
  const plan = createSynthesisContextStagingPlan(request, scope, contentArgs), created = request.request.createdAt;
  function add(table: string, row: Record<string, unknown>) { base.rows.set(table, [...(base.rows.get(table) ?? []), row]); return row; }
  const requestRow = add("engagement_synthesis_generation_requests", { ...base.requestRow, id: scope.requestId });
  const contextRow = add("engagement_synthesis_context_requests", { ...base.contextRow, request_id: scope.requestId,
    context_text: request.context.contextText, context_sha256: request.context.contextSha256 });
  for (const frame of plan.entries) {
    add("engagement_synthesis_context_frames", { request_id: scope.requestId, frame_index: frame.index,
      frame_text: frame.canonical, frame_sha256: frame.sha256, frame_bytes: frame.utf8Bytes });
    const text = JSON.stringify({ schemaVersion: 1, purpose: "private_synthesis_context_frame_reference", frameIndex: frame.index,
      frameSha256: frame.sha256, frameBytes: frame.utf8Bytes, contextManifestSha256: plan.header.contextManifestSha256, targetRecordId });
    add("engagement_synthesis_generation_plan_tasks", { request_id: scope.requestId, task_index: frame.index, task_text: text,
      task_sha256: hash(text), task_bytes: Buffer.byteLength(text), cumulative_bytes: frame.cumulativeBytes, chain_sha256: frame.chainSha256 });
  }
  const receiptText = JSON.stringify({ schemaVersion: 1, requestId: scope.requestId, headerSha256: plan.headerSha256,
    frameCount: plan.entries.length, frameBytes: plan.header.frameBytes, tailSha256: plan.header.tailSha256, sealedAt: created });
  const state = { schemaVersion: 1, requestId: scope.requestId, headerText: plan.headerText, headerSha256: plan.headerSha256,
    nextIndex: plan.entries.length, frameBytes: plan.header.frameBytes, tailSha256: plan.header.tailSha256, cancelled: false,
    seal: { receiptText, receiptSha256: hash(receiptText) } };
  const inner = { ...base.f, scope, request: { ...request, cancellation: null }, content };
  const worker = { ...base, f: inner, plan, contentArgs, state, requestRow, contextRow };
  const context = synthesisContextHistoryFixture(0, synthesisContextJobFixture(0, undefined, worker, emitNotes)); context.completeHistory();
  const expected = await loadSynthesisContextHistory(context.client, context.service, scope, context.controller.signal);
  if (expected.manifest.throughSequence === null || expected.manifest.status !== "frames_complete") throw new Error("Synthetic second context is incomplete");
  const choiceText = JSON.stringify({ schemaVersion: 1, targetRecordId, contextRequestId: scope.requestId,
    selectionSequence: expected.manifest.throughSequence, historyManifestSha256: expected.sha256,
    finalCaptureSha256: expected.entries.at(-1)!.captureSha256, finalResultSha256: expected.entries.at(-1)!.resultSha256 });
  const choice = { ...f.bundle.choice, targetRecordId, choiceText, choiceSha256: hash(choiceText) };
  f.contexts.set(targetRecordId, { context: context.request, choice, client: context.client, throughSequence: expected.manifest.throughSequence });
  f.f.trace.length = 0; f.calls.length = 0;
  return { context, expected, choice };
}
