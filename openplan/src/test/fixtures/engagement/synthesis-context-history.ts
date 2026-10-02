import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { vi } from "vitest";
import { synthesisContextJobFixture } from "./synthesis-context-job";
import { sourceHash as hash } from "./synthesis-source";
import { loadSynthesisContextHistoryInputs } from "@/lib/engagement/synthesis-context-history-inputs";

/** Transport-only fixture. Parent originals, context reconstruction and native
 * storage verification use their real implementations. Native permissions need
 * separate database/HTTP tests; this fixture cannot establish those permissions.
 */
export function synthesisContextHistoryFixture(priorCount = 2) {
  const f = synthesisContextJobFixture(priorCount), scope = f.f.scope;
  const request: { [K in keyof typeof f.f.request]: K extends "cancellation" ? unknown : typeof f.f.request[K] } = structuredClone(f.f.request);
  const planRow = { request_id: scope.requestId, header_text: f.plan.headerText, header_sha256: f.plan.headerSha256 };
  const sealRow = { request_id: scope.requestId, receipt_text: f.state.seal!.receiptText, receipt_sha256: f.state.seal!.receiptSha256 };
  f.rows.get("engagement_synthesis_generation_plans")!.push(planRow);
  f.rows.get("engagement_synthesis_generation_plan_seals")!.push(sealRow);
  const options = { denied: "", denyContextRead: 0, contextReads: 0, pageSize: 128,
    change: null as null | ((name: string, data: unknown) => unknown),
    before: null as null | ((name: string) => void) };
  const calls: Array<{ name: string; parameters: Record<string, unknown>; signal?: AbortSignal }> = [];
  const rpc = vi.fn((name: string, parameters: Record<string, unknown>) => {
    const call = { name, parameters, signal: undefined as AbortSignal | undefined }; calls.push(call);
    options.before?.(name);
    let data: unknown;
    if (name === "read_engagement_synthesis_context_request") { options.contextReads++; data = structuredClone(request); }
    else if (name === "read_engagement_synthesis_generation_request") {
      data = { schemaVersion: 1, campaignId: scope.campaignId, workspaceId: scope.workspaceId,
        request: { id: f.parentRow.id, actorId: f.parentRow.actor_id, intentText: f.parentRow.intent_text,
          intentSha256: f.parentRow.intent_sha256, createdAt: f.parentRow.created_at }, cancellation: null };
    } else if (name === "read_engagement_synthesis_sources") data = f.f.f.args.saved;
    else if (name === "read_engagement_synthesis_generation_selection_history") {
      const entries = parameters.p_request === scope.requestId ? f.history.map(({ selection }) => {
        const receiptText = JSON.stringify(selection); return { receiptText, receiptSha256: hash(receiptText) };
      }) : f.choices;
      const throughSequence = parameters.p_through_sequence ?? entries.length;
      const remaining = entries.filter(entry => {
        const value = JSON.parse(entry.receiptText); return value.taskIndex > Number(parameters.p_after_task_index) && value.sequence <= Number(throughSequence);
      });
      const limit = Math.min(Number(parameters.p_limit), options.pageSize);
      data = { schemaVersion: 1, requestId: parameters.p_request, throughSequence, afterTaskIndex: parameters.p_after_task_index,
        hasMore: remaining.length > limit, entries: remaining.slice(0, limit) };
    } else throw new Error(`Unexpected authenticated history command ${name}`);
    data = options.change?.(name, structuredClone(data)) ?? data;
    const error = options.denied === name || (name === "read_engagement_synthesis_context_request" && options.contextReads === options.denyContextRead)
      ? { code: "42501" } : null;
    const result = Promise.resolve({ data, error });
    return Object.assign(result, { abortSignal(signal: AbortSignal) { call.signal = signal; return result; } });
  });
  const client = { rpc } as unknown as Pick<SupabaseClient, "rpc">;
  const serviceRpc = vi.fn(() => { throw new Error("Historical inspection must not use current execution scope"); });
  const service = { from: f.from, rpc: serviceRpc } as unknown as Pick<SupabaseClient, "from" | "rpc">;
  function cancel(reason = "SYNTHETIC historical cancellation") {
    const cancellationId = randomUUID(), createdAt = "2026-09-30T12:00:00Z";
    const receiptText = JSON.stringify({ schemaVersion: 1, id: cancellationId, requestId: scope.requestId,
      campaignId: scope.campaignId, workspaceId: scope.workspaceId, actorId: request.request.actorId,
      reason, requestExisted: true, cancelledAt: createdAt });
    request.cancellation = { id: cancellationId, receiptText, receiptSha256: hash(receiptText), createdAt };
  }
  return { ...f, scope, request, planRow, sealRow, client, service, serviceRpc, calls, historyOptions: options, cancel,
    loadInputs: () => loadSynthesisContextHistoryInputs(client, service, scope, f.controller.signal) };
}
