import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { vi } from "vitest";
import { contextInputFixture } from "./synthesis-context";
import { makeSourceSnapshot, sourceHash as hash } from "./synthesis-source";
import { createSynthesisGenerationApiResult } from "@/lib/engagement/synthesis-generation-api-result";
import { createSynthesisGenerationPlan } from "@/lib/engagement/synthesis-generation-plan";
import { assembleSynthesisGenerationResults } from "@/lib/engagement/synthesis-generation-results";
import { createSynthesisGenerationContext } from "@/lib/engagement/synthesis-generation-context";
import { createSynthesisGenerationContextContent } from "@/lib/engagement/synthesis-generation-context-content";
import { createSynthesisContextStagingPlan } from "@/lib/engagement/synthesis-context-plan";
import { loadSynthesisContextWorkerInputs } from "@/lib/engagement/synthesis-context-worker-load";

export function synthesisContextWorkerFixture(configuration?: { connectionId: string; revisionId: string; configurationHash: string; modelId: string }) {
  const snapshot = makeSourceSnapshot(1); snapshot.items[0].body = "SYNTHETIC é 😀 original ".repeat(80);
  const f = contextInputFixture(snapshot), rows = new Map<string, Record<string, unknown>[]>();
  if (configuration) {
    Object.assign(f.f.args.job, { configurationRevisionId: configuration.revisionId, configurationHash: configuration.configurationHash, modelId: configuration.modelId });
    f.request.request.intentText = JSON.stringify({ ...JSON.parse(f.request.request.intentText), connectionId: configuration.connectionId,
      configurationRevisionId: configuration.revisionId, configurationHash: configuration.configurationHash, modelId: configuration.modelId });
    f.request.request.intentSha256 = hash(f.request.request.intentText);
  }
  function add(table: string, row: Record<string, unknown>) { rows.set(table, [...(rows.get(table) ?? []), row]); return row; }
  const created = "2026-09-30T00:00:00Z", expires = "2099-01-01T00:00:00Z";
  const parentActor = randomUUID(), parentGrant = randomUUID();
  const parentIntent = JSON.stringify({ ...JSON.parse(f.request.request.intentText), modelId: f.f.args.job.modelId, taskByteLimit: 4096 });
  const parentRequest = { id: f.f.args.job.jobId, intentText: parentIntent, intentSha256: hash(parentIntent) };
  const parentPlan = createSynthesisGenerationPlan(parentRequest, f.f.args.saved, f.f.args.scope);
  const parentRow = add("engagement_synthesis_generation_requests", { id: parentRequest.id, campaign_id: f.scope.campaignId,
    workspace_id: f.scope.workspaceId, actor_id: parentActor, source_id: f.f.args.saved.requestId,
    configuration_revision_id: f.f.args.job.configurationRevisionId, intent_text: parentIntent, intent_sha256: hash(parentIntent), created_at: created });
  const sealText = JSON.stringify({ schemaVersion: 1, requestId: parentRequest.id, headerSha256: parentPlan.headerSha256,
    taskCount: parentPlan.entries.length, taskBytes: parentPlan.header.taskBytes, tailSha256: parentPlan.header.tailSha256, sealedAt: created });
  add("engagement_synthesis_generation_plans", { request_id: parentRequest.id, header_text: parentPlan.headerText, header_sha256: parentPlan.headerSha256 });
  add("engagement_synthesis_generation_plan_seals", { request_id: parentRequest.id, receipt_text: sealText, receipt_sha256: hash(sealText) });
  const grantText = JSON.stringify({ schemaVersion: 1, headerSha256: parentPlan.headerSha256, maxAttempts: parentPlan.entries.length,
    maxOutputTokens: 8192, responseByteLimit: 1048576, expiresAt: expires, chargesAcknowledged: true, retryTaskIndex: null, retryOfAttemptId: null });
  add("engagement_synthesis_generation_authorizations", { id: parentGrant, request_id: parentRequest.id,
    intent_text: grantText, intent_sha256: hash(grantText), credential_sha256: null });
  const choices: Array<{ receiptText: string; receiptSha256: string }> = [];
  const captures = f.f.args.results.map((result, index) => {
    const prior = JSON.parse(result.canonical), binding = { ...prior.binding, ...f.f.args.job }, workerId = randomUUID();
    const dispatchText = JSON.stringify({ schemaVersion: 1, attemptId: binding.attemptId, workerId, authorizationId: parentGrant,
      binding, maxOutputTokens: 8192, responseByteLimit: 1048576, expiresAt: expires, authorizedAt: created });
    const body = JSON.stringify({ id: "synthetic-parent", model: binding.modelId,
      choices: [{ finish_reason: "stop", message: { role: "assistant", content: prior.outputText } }] });
    const capture = createSynthesisGenerationApiResult(binding, { dispatchSha256: hash(dispatchText), responseByteLimit: 1048576,
      startedAt: created, finishedAt: "2026-09-30T00:01:00Z", receipt: { schemaVersion: 1, statusCode: 200, contentType: "application/json",
        contentEncoding: null, bodyBase64: Buffer.from(body).toString("base64"), bodySha256: hash(body), retainedBytes: Buffer.byteLength(body),
        bodyComplete: true, termination: "complete" } });
    add("engagement_synthesis_generation_attempts", { id: binding.attemptId, authorization_id: parentGrant, request_id: parentRequest.id,
      task_index: index, previous_attempt_id: null, worker_id: workerId, binding_text: JSON.stringify(binding) });
    add("engagement_synthesis_generation_dispatches", { attempt_id: binding.attemptId, expires_at: expires, receipt_text: dispatchText, receipt_sha256: hash(dispatchText) });
    add("engagement_synthesis_generation_outputs", { attempt_id: binding.attemptId, capture_text: capture.canonical, capture_sha256: capture.sha256 });
    const receiptText = JSON.stringify({ schemaVersion: 1, id: randomUUID(), requestId: parentRequest.id, taskIndex: index,
      attemptId: binding.attemptId, previousSelectionId: null, sequence: index + 1, actorId: parentActor,
      origin: "authorization", authorizationId: parentGrant, reason: "SYNTHETIC initial attempt", selectedAt: created });
    choices.push({ receiptText, receiptSha256: hash(receiptText) });
    return capture;
  });
  const reconstruction = { ...f.f.args, results: captures };
  const inventory = assembleSynthesisGenerationResults(reconstruction), dependencies = createSynthesisGenerationContext(inventory, reconstruction, choices.length);
  const contentArgs: Parameters<typeof createSynthesisGenerationContextContent> = [dependencies, inventory, reconstruction, choices.length,
    f.content.targetRecordId, f.content.frameByteLimit];
  const content = createSynthesisGenerationContextContent(...contentArgs);
  f.request.context.contextText = JSON.stringify({ ...JSON.parse(f.request.context.contextText),
    segmentResultsManifestSha256: inventory.manifestSha256, contextManifestSha256: dependencies.manifestSha256, contentManifestSha256: content.manifestSha256 });
  f.request.context.contextSha256 = hash(f.request.context.contextText);
  const requestRow = add("engagement_synthesis_generation_requests", { ...parentRow, id: f.scope.requestId, actor_id: f.request.request.actorId,
    intent_text: f.request.request.intentText, intent_sha256: f.request.request.intentSha256 });
  const contextRow = add("engagement_synthesis_context_requests", { request_id: f.scope.requestId, parent_request_id: parentRequest.id,
    context_text: f.request.context.contextText, context_sha256: f.request.context.contextSha256, created_at: created });
  const sourceRow = add("engagement_synthesis_sources", { id: f.f.args.saved.requestId, campaign_id: f.scope.campaignId, workspace_id: f.scope.workspaceId,
    snapshot_text: f.f.args.saved.snapshotText, snapshot_sha256: f.f.args.saved.snapshotSha256, created_at: f.f.args.saved.createdAt });
  const plan = createSynthesisContextStagingPlan(f.request, f.scope, contentArgs);
  for (const frame of plan.entries) {
    add("engagement_synthesis_context_frames", { request_id: f.scope.requestId, frame_index: frame.index, frame_text: frame.canonical,
      frame_sha256: frame.sha256, frame_bytes: frame.utf8Bytes });
    const referenceText = JSON.stringify({ schemaVersion: 1, purpose: "private_synthesis_context_frame_reference", frameIndex: frame.index,
      frameSha256: frame.sha256, frameBytes: frame.utf8Bytes, contextManifestSha256: plan.header.contextManifestSha256, targetRecordId: plan.header.targetRecordId });
    add("engagement_synthesis_generation_plan_tasks", { request_id: f.scope.requestId, task_index: frame.index, task_text: referenceText,
      task_sha256: hash(referenceText), task_bytes: Buffer.byteLength(referenceText), cumulative_bytes: frame.cumulativeBytes, chain_sha256: frame.chainSha256 });
  }
  const contextSeal = JSON.stringify({ schemaVersion: 1, requestId: f.scope.requestId, headerSha256: plan.headerSha256,
    frameCount: plan.entries.length, frameBytes: plan.header.frameBytes, tailSha256: plan.header.tailSha256, sealedAt: created });
  const state = { schemaVersion: 1, requestId: f.scope.requestId, headerText: plan.headerText, headerSha256: plan.headerSha256,
    nextIndex: plan.entries.length, frameBytes: plan.header.frameBytes, tailSha256: plan.header.tailSha256, cancelled: false,
    seal: { receiptText: contextSeal, receiptSha256: hash(contextSeal) } as { receiptText: string; receiptSha256: string } | null };
  const controller = new AbortController(), options = { failTable: "", failRpc: "", abortTable: "",
    returnedPatch: null as null | { table: string; key?: string; value?: unknown; patch: Record<string, unknown> } };
  const trace: Array<{ table: string; columns: string; filters: Record<string, unknown>; signal?: AbortSignal }> = [];
  const from = vi.fn((table: string) => {
    const entry = { table, columns: "", filters: {} as Record<string, unknown>, signal: undefined as AbortSignal | undefined }; trace.push(entry);
    const finish = async () => {
      if (options.abortTable === table) controller.abort();
      const row = rows.get(table)?.find(candidate => Object.entries(entry.filters).every(([key, value]) => candidate[key] === value));
      const patch = options.returnedPatch;
      const returned = row && patch?.table === table && (!patch.key || entry.filters[patch.key] === patch.value) ? { ...row, ...patch.patch } : row;
      return { data: returned ? Object.fromEntries(entry.columns.split(",").map(column => [column, returned[column]])) : null,
        error: options.failTable === table ? { code: "SYNTHETIC" } : null };
    };
    const query = { select(value: string) { entry.columns = value; return query; }, eq(key: string, value: unknown) { entry.filters[key] = value; return query; },
      abortSignal(signal: AbortSignal) { entry.signal = signal; return query; }, single: finish, maybeSingle: finish }; return query;
  });
  const rpc = vi.fn((name: string, parameters: Record<string, unknown>) => {
    let data: unknown;
    if (name === "read_engagement_synthesis_context_plan" && parameters.p_request === f.scope.requestId) data = state;
    else if (name === "read_engagement_synthesis_context_parent_selections" && parameters.p_request === f.scope.requestId) {
      data = { schemaVersion: 1, requestId: parentRequest.id, throughSequence: choices.length, afterTaskIndex: -1, hasMore: false, entries: choices };
    } else throw new Error(`Unexpected context fixture command ${name}`);
    const result = Promise.resolve({ data, error: options.failRpc === name ? { code: "42501" } : null });
    return Object.assign(result, { abortSignal: () => result });
  });
  const service = { from, rpc } as unknown as Pick<SupabaseClient, "from" | "rpc">;
  return { f, plan, contentArgs, requestRow, parentRow, contextRow, sourceRow, state, rows, choices, options, controller, trace, from, rpc,
    service, load: () => loadSynthesisContextWorkerInputs(service, f.scope.requestId, controller.signal) };
}
