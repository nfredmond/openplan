import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { vi } from "vitest";
import { synthesisThematicAuthorityFixture } from "./synthesis-thematic-authority";
import { sourceHash as hash } from "./synthesis-source";
import { createSynthesisThematicContinuation } from "@/lib/engagement/synthesis-thematic-continuation";
import { createSynthesisGenerationApiResult } from "@/lib/engagement/synthesis-generation-api-result";
import { loadSynthesisThematicHistory } from "@/lib/engagement/synthesis-thematic-history-server";
import { loadSynthesisThematicHistoryInputs } from "@/lib/engagement/synthesis-thematic-history-inputs";

/** Real original replay over mocked transport. Native staff access is tested by
 * the separate HTTP case, not inferred from these fixture responses. */
export async function synthesisThematicHistoryFixture() {
  const f = await synthesisThematicAuthorityFixture(); f.completeHistory();
  const processor = createSynthesisThematicContinuation(f.prepared, f.history.map(entry => entry.result));
  const next = processor.next(); if (next.status !== "ready" || next.stage !== "proposal") throw new Error("SYNTHETIC final task unavailable");
  const prior = f.history.at(-1)!, attemptId = randomUUID(), workerId = randomUUID();
  const binding = { ...prior.binding, attemptId, taskSha256: next.task.sha256 };
  const selection = { ...prior.selection, id: randomUUID(), taskIndex: next.taskIndex, attemptId: attemptId as string | null, sequence: next.taskIndex + 1 };
  function add(table: string, row: Record<string, unknown>) { f.rows.set(table, [...(f.rows.get(table) ?? []), row]); return row; }
  const attempt = add("engagement_synthesis_generation_attempts", { id: attemptId, request_id: f.f.scope.requestId,
    authorization_id: f.args.authorizationId, task_index: next.taskIndex, previous_attempt_id: null, worker_id: workerId, binding_text: JSON.stringify(binding) });
  const input = add("engagement_synthesis_thematic_attempt_inputs", { attempt_id: attemptId, task_text: next.task.canonical,
    task_sha256: next.task.sha256, task_bytes: next.task.utf8Bytes, predecessor_attempt_id: prior.attempt.id,
    predecessor_selection_id: prior.selection.id, predecessor_capture_sha256: prior.outputRow.capture_sha256, previous_result_sha256: prior.result.sha256 });
  const dispatch = { ...prior.dispatch, attemptId, workerId, binding }, dispatchRow = add("engagement_synthesis_generation_dispatches", { attempt_id: attemptId });
  const output = { status: "complete", title: "SYNTHETIC proposed themes", notes: "Unreviewed", groups: [],
    unassigned: f.prepared.input.contexts.map(context => ({ sourceId: context.sourceId, reason: "SYNTHETIC unassigned", citations: [] })),
    uncertainties: JSON.parse(JSON.parse(prior.result.canonical).outputText).uncertainties as string[] };
  const outputRow = add("engagement_synthesis_generation_outputs", { attempt_id: attemptId });
  function recapture(text = JSON.stringify(output), finishReason = "stop", statusCode = 200) {
    dispatchRow.receipt_text = JSON.stringify(dispatch); dispatchRow.receipt_sha256 = hash(String(dispatchRow.receipt_text)); dispatchRow.expires_at = dispatch.expiresAt;
    const body = JSON.stringify({ id: "synthetic-final", model: binding.modelId, choices: [{ finish_reason: finishReason, message: { role: "assistant", content: text } }] });
    const capture = createSynthesisGenerationApiResult(binding, { dispatchSha256: String(dispatchRow.receipt_sha256), responseByteLimit: dispatch.responseByteLimit,
      startedAt: "2026-09-30T00:00:00Z", finishedAt: "2026-09-30T00:01:00Z", receipt: { schemaVersion: 1, statusCode, contentType: "application/json",
        contentEncoding: null, bodyBase64: Buffer.from(body).toString("base64"), bodySha256: hash(body), retainedBytes: Buffer.byteLength(body), bodyComplete: true, termination: "complete" } });
    Object.assign(outputRow, { capture_text: capture.canonical, capture_sha256: capture.sha256 }); return capture;
  }
  recapture();
  const result = processor.accept({ taskSha256: next.task.sha256, outputText: JSON.stringify(output), finishReason: "stop" });
  const final = { selection, attempt, input, dispatch, dispatchRow, output, outputRow, result, recapture, task: next.task, binding };
  const history = [...f.history, final], request = structuredClone(f.prepared.request.state), scope = f.f.scope;
  const { receipt: _receipt, ...seal } = f.prepared.seal;
  const options = { denied: "", deniedCall: 0, requestReads: 0, denyRequestRead: 0, pageSize: 128, missingSeal: false,
    change: null as null | ((name: string, data: unknown) => unknown), before: null as null | ((name: string) => void) };
  const calls: Array<{ name: string; parameters: Record<string, unknown>; signal?: AbortSignal }> = [];
  const rpc = vi.fn((name: string, parameters: Record<string, unknown>) => {
    const call = { name, parameters, signal: undefined as AbortSignal | undefined }; calls.push(call); options.before?.(name);
    const response = (async () => {
      let data: unknown;
      const contexts = f.original.f.contexts, selected = [...contexts.values()].find(row => row.context.request.id === parameters.p_request);
      if (name === "read_engagement_synthesis_thematic_request") { options.requestReads++; data = structuredClone(request); }
      else if (name === "read_engagement_synthesis_thematic_input_seal_history") data = options.missingSeal ? null : structuredClone(seal);
      else if (name === "read_engagement_synthesis_thematic_choice") data = structuredClone(contexts.get(String(parameters.p_target))?.choice ?? f.original.f.bundle.choice);
      else if (name === "read_engagement_synthesis_thematic_input_history") data = structuredClone(f.original.records.get(String(parameters.p_target)) ?? null);
      else if (name === "read_engagement_synthesis_generation_selection_history" && parameters.p_request === scope.requestId) {
        const throughSequence = parameters.p_through_sequence ?? Math.max(...history.map(entry => entry.selection.sequence));
        const remaining = history.filter(entry => entry.selection.taskIndex > Number(parameters.p_after_task_index) && entry.selection.sequence <= Number(throughSequence));
        const limit = Math.min(Number(parameters.p_limit), options.pageSize);
        data = { schemaVersion: 1, requestId: scope.requestId, throughSequence, afterTaskIndex: parameters.p_after_task_index,
          hasMore: remaining.length > limit, entries: remaining.slice(0, limit).map(entry => { const receiptText = JSON.stringify(entry.selection); return { receiptText, receiptSha256: hash(receiptText) }; }) };
      } else data = (await (selected?.client ?? f.original.f.f.client).rpc(name, parameters)).data;
      const changed = options.change?.(name, structuredClone(data)); if (changed !== undefined) data = changed;
      return { data, error: (options.denied === name && (options.deniedCall === 0 || calls.filter(call => call.name === name).length === options.deniedCall)) || (name === "read_engagement_synthesis_thematic_request" && options.requestReads === options.denyRequestRead) ? { code: "42501" } : null };
    })();
    return Object.assign(response, { abortSignal(signal: AbortSignal) { call.signal = signal; return response; } });
  });
  const client = { rpc } as unknown as Pick<SupabaseClient, "rpc">;
  const serviceRpc = vi.fn(() => { throw new Error("Historical thematic inspection must not use current execution scope"); });
  const service = { from: f.from, rpc: serviceRpc } as unknown as Pick<SupabaseClient, "from" | "rpc">;
  function cancel() {
    const id = randomUUID(), createdAt = "2026-09-30T12:00:00Z";
    const receiptText = JSON.stringify({ schemaVersion: 1, id, ...scope, actorId: request.request.actorId,
      reason: "SYNTHETIC historical cancellation", requestExisted: true, cancelledAt: createdAt });
    request.cancellation = { id, receiptText, receiptSha256: hash(receiptText), createdAt };
  }
  f.trace.length = 0; f.original.f.f.trace.length = 0;
  return { ...f, client, service, serviceRpc, request, scope, final, history, historyOptions: options, calls, cancel, seal,
    load: (throughSequence?: number) => loadSynthesisThematicHistory(client, service, { ...scope, ...(throughSequence === undefined ? {} : { throughSequence }) }, f.controller.signal),
    loadInputs: () => loadSynthesisThematicHistoryInputs(client, service, scope, f.controller.signal) };
}
