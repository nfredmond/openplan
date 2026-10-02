import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { vi } from "vitest";
import { synthesisThematicWorkerFixture } from "./synthesis-thematic-worker";
import { sourceHash as hash } from "./synthesis-source";
import { createSynthesisThematicContinuation } from "@/lib/engagement/synthesis-thematic-continuation";
import { createSynthesisGenerationApiResult } from "@/lib/engagement/synthesis-generation-api-result";
import { loadSynthesisThematicWorkerJob } from "@/lib/engagement/synthesis-thematic-worker-job";
import type { SynthesisGenerationAttemptBinding } from "@/lib/engagement/synthesis-generation-results";

type HistoryEntry = {
  selection: { schemaVersion: number; id: string; requestId: string; taskIndex: number; attemptId: string | null;
    previousSelectionId: string | null; sequence: number; actorId: string; origin: string; authorizationId: string | null; reason: string; selectedAt: string };
  attempt: Record<string, unknown>; input: Record<string, unknown>; dispatchRow: Record<string, unknown>; outputRow: Record<string, unknown>;
  dispatch: { schemaVersion: number; attemptId: string; workerId: string; authorizationId: string; binding: SynthesisGenerationAttemptBinding;
    maxOutputTokens: number; responseByteLimit: number; expiresAt: string; authorizedAt: string };
  output: { status: string; coveredPartIds: string[]; notes: unknown[]; uncertainties: string[] };
  result: { canonical: string; sha256: string }; recapture: (text?: string, finish?: string, statusCode?: number) => ReturnType<typeof createSynthesisGenerationApiResult>;
  task: { canonical: string; sha256: string; utf8Bytes: number }; binding: SynthesisGenerationAttemptBinding;
};

export async function synthesisThematicJobFixture(priorCount: number | "final" = 2, configuration?: Parameters<typeof synthesisThematicWorkerFixture>[0], emitNotes = false) {
  const f = await synthesisThematicWorkerFixture(configuration);
  priorCount = priorCount === "final" ? f.plan.header.frameCount : priorCount;
  const args = { authorizationId: randomUUID(), attemptId: randomUUID(), taskIndex: priorCount };
  const grantIntent = { schemaVersion: 1, headerSha256: f.plan.headerSha256, maxAttempts: f.plan.header.taskCount,
    maxOutputTokens: 8192, responseByteLimit: 1048576, expiresAt: "2099-01-01T00:00:00Z", chargesAcknowledged: true,
    retryTaskIndex: null as number | null, retryOfAttemptId: null as string | null };
  const grant = { id: args.authorizationId, request_id: f.f.scope.requestId, intent_text: JSON.stringify(grantIntent),
    intent_sha256: hash(JSON.stringify(grantIntent)), credential_sha256: null };
  function add(table: string, row: Record<string, unknown>) { f.rows.set(table, [...(f.rows.get(table) ?? []), row]); return row; }
  add("engagement_synthesis_generation_authorizations", grant);
  const processor = createSynthesisThematicContinuation(f.prepared);
  const history: HistoryEntry[] = [];
  let previous: { attemptId: string; selectionId: string; captureSha256: string } | null = null;
  function appendFrame() {
    const index = history.length;
    const next = processor.next(); if (next.status !== "ready") throw new Error("SYNTHETIC predecessor task unavailable");
    const task = JSON.parse(next.task.canonical), attemptId = randomUUID(), workerId = randomUUID();
    const binding = { jobId: f.f.scope.requestId, planSha256: f.plan.continuation.headerSha256,
      configurationRevisionId: f.f.f.args.job.configurationRevisionId, configurationHash: f.f.f.args.job.configurationHash,
      provider: "api_connection" as const, modelId: JSON.parse(f.f.request.request.intentText).modelId as string,
      taskSha256: next.task.sha256, attemptId };
    const selection = { schemaVersion: 1, id: randomUUID(), requestId: f.f.scope.requestId, taskIndex: index, attemptId: attemptId as string | null,
      previousSelectionId: null as string | null, sequence: index + 1, actorId: f.f.request.request.actorId,
      origin: "authorization", authorizationId: args.authorizationId as string | null, reason: "SYNTHETIC thematic selection", selectedAt: "2026-09-30T00:00:00Z" };
    const attempt = add("engagement_synthesis_generation_attempts", { id: attemptId, request_id: f.f.scope.requestId,
      authorization_id: args.authorizationId, task_index: index, previous_attempt_id: null, worker_id: workerId, binding_text: JSON.stringify(binding) });
    const input = add("engagement_synthesis_thematic_attempt_inputs", { attempt_id: attemptId, task_text: next.task.canonical,
      task_sha256: next.task.sha256, task_bytes: next.task.utf8Bytes, predecessor_attempt_id: previous?.attemptId ?? null,
      predecessor_selection_id: previous?.selectionId ?? null, predecessor_capture_sha256: previous?.captureSha256 ?? null,
      previous_result_sha256: next.previousResultSha256 });
    const dispatch = { schemaVersion: 1, attemptId, workerId, authorizationId: args.authorizationId, binding,
      maxOutputTokens: grantIntent.maxOutputTokens, responseByteLimit: grantIntent.responseByteLimit,
      expiresAt: grantIntent.expiresAt, authorizedAt: "2026-09-30T00:00:00Z" };
    const dispatchRow = add("engagement_synthesis_generation_dispatches", { attempt_id: attemptId, expires_at: dispatch.expiresAt,
      receipt_text: JSON.stringify(dispatch), receipt_sha256: hash(JSON.stringify(dispatch)) });
    const prior = task.input.previous ? JSON.parse(task.input.previous.outputText) : { notes: [], uncertainties: [] };
    const cited = task.input.frame.parts.find((part: { text?: string }) => typeof part.text === "string" && part.text.length);
    const notes = emitNotes && cited && prior.notes.length === 0 ? [{ id: 0, text: "SYNTHETIC retained note é 中文",
      citations: [{ partId: cited.id, quote: Array.from(cited.text as string)[0] }], relatedNoteIds: [] }] : prior.notes;
    const output = { status: "complete", coveredPartIds: task.input.frame.parts.map((p: { id: string }) => p.id),
      notes, uncertainties: [...prior.uncertainties, `SYNTHETIC frame ${index}`] };
    const outputRow = add("engagement_synthesis_generation_outputs", { attempt_id: attemptId });
    function recapture(outputText = JSON.stringify(output), finishReason = "stop", statusCode = 200) {
      dispatchRow.receipt_text = JSON.stringify(dispatch); dispatchRow.receipt_sha256 = hash(String(dispatchRow.receipt_text)); dispatchRow.expires_at = dispatch.expiresAt;
      const body = JSON.stringify({ id: "synthetic-thematic", model: binding.modelId,
        choices: [{ finish_reason: finishReason, message: { role: "assistant", content: outputText } }] });
      const result = createSynthesisGenerationApiResult(binding, { dispatchSha256: String(dispatchRow.receipt_sha256), responseByteLimit: dispatch.responseByteLimit,
        startedAt: "2026-09-30T00:00:00Z", finishedAt: "2026-09-30T00:01:00Z", receipt: { schemaVersion: 1, statusCode, contentType: "application/json",
          contentEncoding: null, bodyBase64: Buffer.from(body).toString("base64"), bodySha256: hash(body), retainedBytes: Buffer.byteLength(body), bodyComplete: true, termination: "complete" } });
      Object.assign(outputRow, { capture_text: result.canonical, capture_sha256: result.sha256 }); return result;
    }
    recapture();
    const result = processor.accept({ taskSha256: next.task.sha256, outputText: JSON.stringify(output), finishReason: "stop" });
    previous = { attemptId, selectionId: selection.id, captureSha256: String(outputRow.capture_sha256) };
    history.push({ selection, attempt, input, dispatch, dispatchRow, output, outputRow, result, recapture, task: next.task, binding });
  }
  for (let index = 0; index < priorCount; index++) appendFrame();
  const next = processor.next(); if (next.status !== "ready") throw new Error("SYNTHETIC next task unavailable");
  const selectionOptions = { pagePatch: {} as Record<string, unknown>, corruptChecksum: false, changeSequence: false, missing: false, receiptPrefix: "" };
  let pageReads = 0;
  const rpc = vi.fn((name: string, parameters: Record<string, unknown>) => {
    if (name !== "read_engagement_synthesis_thematic_selections") return f.rpc(name, parameters);
    const index = Number(parameters.p_after_task_index) + 1, selected = history[index]?.selection;
    const receiptText = selectionOptions.receiptPrefix + JSON.stringify(selected), entries = !selected || selectionOptions.missing ? [] : [{ receiptText,
      receiptSha256: selectionOptions.corruptChecksum ? "0".repeat(64) : hash(receiptText) }];
    pageReads++;
    const data = { schemaVersion: 1, requestId: f.f.scope.requestId, throughSequence: history.length + (selectionOptions.changeSequence && pageReads > 1 ? 1 : 0),
      afterTaskIndex: index - 1, hasMore: index < history.length - 1, entries, ...selectionOptions.pagePatch };
    const result = Promise.resolve({ data, error: f.options.failRpc === name ? { code: "42501" } : null });
    return Object.assign(result, { abortSignal: () => result });
  });
  const service = { from: f.from, rpc } as unknown as Pick<SupabaseClient, "from" | "rpc">;
  return { ...f, service, rpc, args, grantIntent, grant, history, next, selectionOptions,
    completeHistory: () => { while (history.length < f.plan.entries.length) appendFrame(); },
    resealGrant: () => { grant.intent_text = JSON.stringify(grantIntent); grant.intent_sha256 = hash(grant.intent_text); },
    loadJob: () => loadSynthesisThematicWorkerJob(service, args, f.controller.signal) };
}
