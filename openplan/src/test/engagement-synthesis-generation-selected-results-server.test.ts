// @vitest-environment node
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readSynthesisGenerationSelectedResults, loadSynthesisGenerationHistory, readSynthesisContextParentResults } from "@/lib/engagement/synthesis-generation-selected-results-server";
import { createSynthesisGenerationApiResult } from "@/lib/engagement/synthesis-generation-api-result";
import { verifySynthesisGenerationApiDispatchReceipt, verifySynthesisGenerationApiDispatch } from "@/lib/engagement/synthesis-generation-api";
import { createSynthesisGenerationResult, type SynthesisGenerationAttemptBinding } from "@/lib/engagement/synthesis-generation-results";
import { sourceScope } from "./fixtures/engagement/synthesis-source";
import { synthesisWorkerFixture, synthesisWorkerHash as hash } from "./fixtures/engagement/synthesis-worker";

const fixtures: Awaited<ReturnType<typeof synthesisWorkerFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); vi.unstubAllEnvs(); });
async function fixture() {
  const f = await synthesisWorkerFixture(1); fixtures.push(f);
  const requestRow = f.rows.engagement_synthesis_generation_requests;
  const request = { id: String(requestRow.id), intentText: String(requestRow.intent_text), intentSha256: String(requestRow.intent_sha256) };
  const args = { request, saved: f.saved, scope: sourceScope, actorId: String(requestRow.actor_id) };
  const attemptId = randomUUID(), workerId = randomUUID(), authorizationId = f.args.authorizationId;
  const binding: SynthesisGenerationAttemptBinding = { jobId: request.id, planSha256: f.plan.header.taskManifestSha256,
    configurationRevisionId: f.revision.revisionId, configurationHash: f.revision.configurationHash,
    provider: "api_connection", modelId: "synthetic", taskSha256: f.task.sha256, attemptId };
  const dispatch = { schemaVersion: 1, attemptId, workerId, authorizationId, binding,
    maxOutputTokens: 8192, responseByteLimit: 4096, expiresAt: f.authorizationIntent.expiresAt, authorizedAt: new Date(Date.now() - 1000).toISOString() };
  const selection = { schemaVersion: 1, id: randomUUID(), requestId: request.id, taskIndex: 0, attemptId: attemptId as string | null,
    previousSelectionId: null as string | null, sequence: 1, actorId: args.actorId, origin: "authorization", authorizationId: authorizationId as string | null,
    reason: "SYNTHETIC selected initial attempt", selectedAt: new Date().toISOString() };
  const rows: Record<string, Record<string, unknown> | null> = { ...f.rows,
    engagement_synthesis_generation_attempts: { id: attemptId, authorization_id: authorizationId, request_id: request.id,
      task_index: 0, previous_attempt_id: null, worker_id: workerId, binding_text: JSON.stringify(binding) },
    engagement_synthesis_generation_dispatches: null, engagement_synthesis_generation_outputs: null };
  function sealDispatch() { const text = JSON.stringify(dispatch); rows.engagement_synthesis_generation_dispatches = {
    attempt_id: attemptId, expires_at: dispatch.expiresAt, receipt_text: text, receipt_sha256: hash(text) }; }
  function capture(outputText?: string, taskIndex = 0, selectedBinding = binding, selectedDispatch = dispatch) {
    const task = JSON.parse(f.plan.entries[taskIndex].canonical);
    const text = outputText ?? JSON.stringify({ status: "complete", coveredPartIds: task.input.parts.map((p: { id: string }) => p.id), observations: [], uncertainty: "SYNTHETIC interpretation unassessed" });
    const body = JSON.stringify({ id: "synthetic-response", model: "synthetic", choices: [{ finish_reason: "stop", message: { role: "assistant", content: text } }] });
    const result = createSynthesisGenerationApiResult(selectedBinding, { dispatchSha256: hash(JSON.stringify(selectedDispatch)), responseByteLimit: 4096,
      startedAt: selectedDispatch.authorizedAt, finishedAt: new Date().toISOString(), receipt: { schemaVersion: 1, statusCode: 200,
        contentType: "application/json", contentEncoding: null, bodyBase64: Buffer.from(body).toString("base64"), bodySha256: hash(body),
        retainedBytes: Buffer.byteLength(body), bodyComplete: true, termination: "complete" } });
    if (taskIndex === 0) rows.engagement_synthesis_generation_outputs = { attempt_id: attemptId, capture_text: result.canonical, capture_sha256: result.sha256 };
    return result;
  }
  sealDispatch(); capture();
  const selections = [selection];
  const additionalRows = new Map<string, Record<string, unknown>>();
  for (const task of f.plan.entries.slice(1)) {
    const otherId = randomUUID(), otherBinding = { ...binding, attemptId: otherId, taskSha256: task.sha256 };
    const otherDispatch = { ...dispatch, attemptId: otherId, binding: otherBinding }, text = JSON.stringify(otherDispatch);
    const result = capture(undefined, task.index, otherBinding, otherDispatch);
    selections.push({ ...selection, id: randomUUID(), attemptId: otherId, taskIndex: task.index, sequence: task.index + 1 });
    additionalRows.set(`engagement_synthesis_generation_attempts:${otherId}`, { ...rows.engagement_synthesis_generation_attempts,
      id: otherId, task_index: task.index, binding_text: JSON.stringify(otherBinding) });
    additionalRows.set(`engagement_synthesis_generation_dispatches:${otherId}`, { attempt_id: otherId, expires_at: otherDispatch.expiresAt, receipt_text: text, receipt_sha256: hash(text) });
    additionalRows.set(`engagement_synthesis_generation_outputs:${otherId}`, { attempt_id: otherId, capture_text: result.canonical, capture_sha256: result.sha256 });
  }
  const trace: Array<{ table: string; columns: string; filters: Record<string, unknown>; signal?: AbortSignal }> = [];
  const options = { failTable: "", failSelections: false, emptySelections: false, abortOn: "", contextRequestId: "" };
  const from = vi.fn((table: string) => {
    const entry = { table, columns: "", filters: {} as Record<string, unknown>, signal: undefined as AbortSignal | undefined }; trace.push(entry);
    const finish = async () => { if (options.abortOn === table) f.controller.abort(); return { data: additionalRows.get(`${table}:${entry.filters.id ?? entry.filters.attempt_id}`) ?? rows[table], error: options.failTable === table ? { code: "SYNTHETIC" } : null }; };
    const query = { select(value: string) { entry.columns = value; return query; }, eq(key: string, value: unknown) { entry.filters[key] = value; return query; },
      abortSignal(signal: AbortSignal) { entry.signal = signal; return query; }, single: finish, maybeSingle: finish }; return query;
  });
  const rpc = vi.fn((name: string) => {
    expect(name).toBe(options.contextRequestId ? "read_engagement_synthesis_context_parent_selections" : "read_engagement_synthesis_generation_selections");
    const result = Promise.resolve({ data: { schemaVersion: 1, requestId: request.id, throughSequence: options.emptySelections ? 0 : selections.length,
      afterTaskIndex: -1, hasMore: false, entries: options.emptySelections ? [] : selections.map(value => { const receiptText = JSON.stringify(value); return { receiptText, receiptSha256: hash(receiptText) }; }) },
      error: options.failSelections ? { code: "42501" } : null });
    return Object.assign(result, { abortSignal: () => result });
  });
  const service = { from, rpc } as unknown as Pick<SupabaseClient, "from" | "rpc">;
  const historyRecord = { schemaVersion: 1, campaignId: sourceScope.campaignId, workspaceId: sourceScope.workspaceId,
    request: { ...request, actorId: args.actorId, createdAt: "2026-09-30T00:00:00Z" }, cancellation: null };
  const historyOptions = { failRequest: false, failSource: false, loseAccessAtEnd: false, changeAtEnd: false };
  let requestReads = 0;
  const historyRpc = vi.fn((name: string) => {
    let data: unknown, error: { code: string } | null = null;
    if (name === "read_engagement_synthesis_generation_request") {
      requestReads++; data = structuredClone(historyRecord);
      if (historyOptions.failRequest || (requestReads > 1 && historyOptions.loseAccessAtEnd)) error = { code: "42501" };
      if (requestReads > 1 && historyOptions.changeAtEnd) data = { ...historyRecord, request: { ...historyRecord.request, actorId: randomUUID() } };
    } else if (name === "read_engagement_synthesis_sources") {
      data = f.saved; if (historyOptions.failSource) error = { code: "42501" };
    } else if (name === "read_engagement_synthesis_generation_selection_history") return rpc("read_engagement_synthesis_generation_selections");
    else throw new Error(`Unexpected history RPC ${name}`);
    const result = Promise.resolve({ data, error }); return Object.assign(result, { abortSignal: () => result });
  });
  const historyClient = { rpc: historyRpc } as unknown as Pick<SupabaseClient, "rpc">;
  const historyScope = { campaignId: sourceScope.campaignId, workspaceId: sourceScope.workspaceId, requestId: request.id };
  return { ...f, service, args, binding, attemptId, workerId, authorizationId, dispatch, selection, rows, trace, options, from, rpc,
    selections, additionalRows, sealDispatch, capture, read: () => readSynthesisGenerationSelectedResults(service, args, f.controller.signal),
    historyRecord, historyOptions, historyRpc, historyScope, historyClient,
    history: () => loadSynthesisGenerationHistory(historyClient, service, historyScope, f.controller.signal) };
}

describe("native selected synthesis output custody", () => {
  it("loads context parent originals through child authority with exact projections", async () => {
    const f = await fixture(); f.options.contextRequestId = randomUUID();
    const result = await readSynthesisContextParentResults(f.service, f.options.contextRequestId,
      { ...f.args, throughSequence: f.plan.entries.length }, f.controller.signal);
    expect(result.inventory.status).toBe("ready_for_record_consolidation");
    expect(result.inventory.interpretation).toBe("not_assessed");
    expect(result.inventory.results[0]).toEqual({ canonical: f.rows.engagement_synthesis_generation_outputs!.capture_text,
      sha256: f.rows.engagement_synthesis_generation_outputs!.capture_sha256 });
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("read_engagement_synthesis_context_parent_selections", {
      p_request: f.options.contextRequestId, p_after_task_index: -1, p_limit: 128,
    });
    const native = f.trace.filter(r => ["engagement_synthesis_generation_attempts", "engagement_synthesis_generation_dispatches", "engagement_synthesis_generation_outputs"].includes(r.table));
    expect(native.slice(0, 3).map(({ signal: _signal, ...r }) => r)).toEqual([
      { table: "engagement_synthesis_generation_attempts", columns: "id,authorization_id,request_id,task_index,previous_attempt_id,worker_id,binding_text", filters: { id: f.attemptId } },
      { table: "engagement_synthesis_generation_dispatches", columns: "attempt_id,expires_at,receipt_text,receipt_sha256", filters: { attempt_id: f.attemptId } },
      { table: "engagement_synthesis_generation_outputs", columns: "attempt_id,capture_text,capture_sha256", filters: { attempt_id: f.attemptId } },
    ]);
    expect(f.providerCalls).toHaveLength(0); expect(f.historyRpc).not.toHaveBeenCalled();
  });
  it("refuses context parent outputs after the child selection read is denied", async () => {
    const f = await fixture(); f.options.contextRequestId = randomUUID(); f.options.failSelections = true;
    await expect(readSynthesisContextParentResults(f.service, f.options.contextRequestId, f.args, f.controller.signal)).rejects.toThrow("inventory unavailable");
    expect(f.from).not.toHaveBeenCalled();
  });
  it("loads historical authority and source through the authenticated client and rechecks access", async () => {
    const f = await fixture(), result = await f.history();
    expect(result.requesterId).toBe(f.args.actorId); expect(result.inventory.status).toBe("ready_for_record_consolidation");
    expect(f.historyRpc.mock.calls).toEqual([
      ["read_engagement_synthesis_generation_request", { p_campaign: f.historyScope.campaignId, p_request: f.historyScope.requestId }],
      ["read_engagement_synthesis_sources", { p_campaign: f.historyScope.campaignId, p_request: f.saved.requestId }],
      ["read_engagement_synthesis_generation_selection_history", { p_campaign: f.historyScope.campaignId, p_request: f.historyScope.requestId,
        p_through_sequence: null, p_after_task_index: -1, p_limit: 128 }],
      ["read_engagement_synthesis_generation_request", { p_campaign: f.historyScope.campaignId, p_request: f.historyScope.requestId }],
    ]);
    expect(f.providerCalls).toHaveLength(0);
  });
  it.each(["campaignId", "workspaceId", "requestId"])("refuses historical request scope drift %s before service reads", async field => {
    const f = await fixture(); if (field === "requestId") f.historyRecord.request.id = randomUUID();
    else f.historyRecord[field as "campaignId" | "workspaceId"] = randomUUID();
    await expect(f.history()).rejects.toThrow("differs"); expect(f.from).not.toHaveBeenCalled();
    expect(f.historyRpc).toHaveBeenCalledTimes(1);
  });
  it.each(["failRequest", "failSource", "loseAccessAtEnd", "changeAtEnd"] as const)("refuses historical %s", async mode => {
    const f = await fixture(); f.historyOptions[mode] = true;
    await expect(f.history()).rejects.toThrow(mode === "changeAtEnd" ? "differs" : "unavailable");
    if (mode === "failRequest" || mode === "failSource") expect(f.from).not.toHaveBeenCalled();
  });
  it("does not read private history after an aborted request", async () => {
    const f = await fixture(); f.controller.abort(); await expect(f.history()).rejects.toMatchObject({ name: "AbortError" });
    expect(f.historyRpc).not.toHaveBeenCalled(); expect(f.from).not.toHaveBeenCalled();
  });
  it("passes a retained history sequence through without replacing it with latest", async () => {
    const f = await fixture();
    await loadSynthesisGenerationHistory(f.historyClient, f.service, { ...f.historyScope, throughSequence: f.plan.entries.length }, f.controller.signal);
    expect(f.historyRpc).toHaveBeenCalledWith("read_engagement_synthesis_generation_selection_history", expect.objectContaining({ p_through_sequence: f.plan.entries.length }));
  });
  it("joins source-bound choices to original bytes with explicit projections and no provider calls", async () => {
    const f = await fixture(), result = await f.read();
    expect(result.inventory.status).toBe("ready_for_record_consolidation");
    expect(result.inventory.interpretation).toBe("not_assessed");
    expect(result.inventory.results[0]).toEqual({ canonical: f.rows.engagement_synthesis_generation_outputs!.capture_text, sha256: f.rows.engagement_synthesis_generation_outputs!.capture_sha256 });
    expect(result.inventory.results).toHaveLength(f.plan.entries.length);
    expect(result.selections.throughSequence).toBe(f.plan.entries.length);
    const native = f.trace.filter(r => ["engagement_synthesis_generation_attempts", "engagement_synthesis_generation_dispatches", "engagement_synthesis_generation_outputs"].includes(r.table));
    expect(native.slice(0, 3).map(({ signal: _signal, ...r }) => r)).toEqual([
      { table: "engagement_synthesis_generation_attempts", columns: "id,authorization_id,request_id,task_index,previous_attempt_id,worker_id,binding_text", filters: { id: f.attemptId } },
      { table: "engagement_synthesis_generation_dispatches", columns: "attempt_id,expires_at,receipt_text,receipt_sha256", filters: { attempt_id: f.attemptId } },
      { table: "engagement_synthesis_generation_outputs", columns: "attempt_id,capture_text,capture_sha256", filters: { attempt_id: f.attemptId } },
    ]);
    expect(native).toHaveLength(f.plan.entries.length * 3);
    expect(f.trace.filter(r => r.table === "engagement_synthesis_generation_authorizations")).toHaveLength(1);
    expect(f.trace.every(r => r.signal instanceof AbortSignal)).toBe(true);
    expect(f.providerCalls).toHaveLength(0); expect(f.trace.some(r => r.table.includes("credentials"))).toBe(false);
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("read_engagement_synthesis_generation_selections", { p_request: f.args.request.id, p_through_sequence: null, p_after_task_index: -1, p_limit: 128 });
  });
  it("reads an expired receipt without manufacturing new execution permission", async () => {
    const f = await fixture(); f.dispatch.authorizedAt = "2025-01-01T00:00:00Z"; f.dispatch.expiresAt = "2025-01-01T00:01:00Z"; f.sealDispatch(); f.capture();
    expect((await f.read()).inventory.status).toBe("ready_for_record_consolidation");
    const args = { binding: f.binding, workerId: f.workerId, authorizationId: f.authorizationId,
      dispatch: { receiptText: JSON.stringify(f.dispatch), receiptSha256: hash(JSON.stringify(f.dispatch)) } };
    expect(verifySynthesisGenerationApiDispatchReceipt(args).receipt).toEqual(f.dispatch);
    expect(() => verifySynthesisGenerationApiDispatch(args)).toThrow();
    expect(() => verifySynthesisGenerationApiDispatch({ ...args, dispatch: { ...args.dispatch, schemaVersion: 1, authorizedNow: false } })).toThrow();
    expect(f.providerCalls).toHaveLength(0);
  });
  it.each(["absent-output", "absent-dispatch", "cleared", "unselected"])("preserves %s as incomplete", async mode => {
    const f = await fixture(); f.rows.engagement_synthesis_generation_outputs = null;
    if (mode === "absent-dispatch") f.rows.engagement_synthesis_generation_dispatches = null;
    if (mode === "cleared") Object.assign(f.selection, { attemptId: null, authorizationId: null, origin: "staff", previousSelectionId: randomUUID() });
    if (mode === "unselected") f.options.emptySelections = true;
    const result = await f.read(); expect(result.inventory.status).toBe("incomplete");
    expect(result.inventory.results).toHaveLength(mode === "unselected" ? 0 : f.plan.entries.length - 1);
    expect(result.inventory.entries[0].disposition).toBe(["cleared", "unselected"].includes(mode) ? "not_started" : "awaiting_result");
  });
  it("retains escaped NUL and malformed Unicode without treating it as usable synthesis", async () => {
    const f = await fixture(), result = f.capture("SYNTHETIC\u0000\ud800🌉");
    const loaded = await f.read(); expect(loaded.inventory.results[0]).toEqual(result); expect(loaded.inventory.entries[0].disposition).toBe("invalid_output");
  });
  it("rejects a self-hashed rewrite against the original response", async () => {
    const f = await fixture(), row = f.rows.engagement_synthesis_generation_outputs!;
    const capture = JSON.parse(String(row.capture_text)); capture.outputText = "SYNTHETIC forged interpretation";
    const changed = createSynthesisGenerationResult(f.binding, capture); Object.assign(row, { capture_text: changed.canonical, capture_sha256: changed.sha256 });
    await expect(f.read()).rejects.toThrow("capture differs from its original response");
  });
  it.each(["id", "authorization_id", "request_id", "task_index", "worker_id", "previous_attempt_id"])("rejects foreign attempt %s", async field => {
    const f = await fixture(); f.rows.engagement_synthesis_generation_attempts![field] = field === "task_index" ? 1 : randomUUID();
    await expect(f.read()).rejects.toThrow(/differs/);
    if (["id", "authorization_id", "request_id", "task_index"].includes(field)) expect(f.trace).toHaveLength(1);
  });
  it.each(["jobId", "planSha256", "configurationRevisionId", "configurationHash", "provider", "modelId", "taskSha256", "attemptId"])("rejects binding drift %s", async field => {
    const f = await fixture(), binding = { ...f.binding, [field]: field.endsWith("Sha256") || field === "configurationHash" ? "a".repeat(64) : field.endsWith("Id") ? randomUUID() : "codex" };
    f.rows.engagement_synthesis_generation_attempts!.binding_text = JSON.stringify(binding);
    await expect(f.read()).rejects.toThrow("differs");
    expect(f.trace.some(row => row.table === "engagement_synthesis_generation_dispatches")).toBe(false);
  });
  it("reads an explicitly selected retry without losing unselected source tasks", async () => {
    const f = await fixture(), predecessor = randomUUID();
    Object.assign(f.authorizationIntent, { retryTaskIndex: 0, retryOfAttemptId: predecessor, maxAttempts: 1 }); f.resealGrant();
    f.rows.engagement_synthesis_generation_attempts!.previous_attempt_id = predecessor;
    Object.assign(f.selection, { origin: "staff", authorizationId: null, previousSelectionId: randomUUID() });
    f.selections.splice(1);
    const result = await f.read(); expect(result.inventory.results).toHaveLength(1);
    expect(result.inventory.entries).toHaveLength(f.plan.entries.length);
    expect(result.inventory.entries[0].disposition).toBe("validated_output"); expect(result.inventory.status).toBe("incomplete");
  });
  it.each(["attempt_id", "expires_at", "receipt_sha256"])("rejects changed dispatch column %s", async field => {
    const f = await fixture(); f.rows.engagement_synthesis_generation_dispatches![field] = field === "attempt_id" ? randomUUID() : field === "expires_at" ? "2025-01-01T00:00:00Z" : "a".repeat(64);
    await expect(f.read()).rejects.toThrow("differs");
  });
  it.each(["maxOutputTokens", "responseByteLimit", "expiresAt"])("rejects rehashed dispatch beyond its grant %s", async field => {
    const f = await fixture(); if (field === "maxOutputTokens") f.dispatch.maxOutputTokens = 16384;
    if (field === "responseByteLimit") f.dispatch.responseByteLimit = 8192;
    if (field === "expiresAt") f.dispatch.expiresAt = "2099-01-01T00:00:00Z";
    f.sealDispatch(); f.capture(); await expect(f.read()).rejects.toThrow("differs");
  });
  it.each(["actor_id", "campaign_id", "workspace_id"])("rejects authorization request scope drift %s", async field => {
    const f = await fixture(); f.rows.engagement_synthesis_generation_requests![field] = randomUUID();
    await expect(f.read()).rejects.toThrow();
  });
  it.each(["attempt_id", "capture_sha256"])("rejects output identity %s", async field => {
    const f = await fixture(); f.rows.engagement_synthesis_generation_outputs![field] = field === "attempt_id" ? randomUUID() : "a".repeat(64);
    await expect(f.read()).rejects.toThrow("differs");
  });
  it("rejects an output without its dispatch", async () => {
    const f = await fixture(); f.rows.engagement_synthesis_generation_dispatches = null; await expect(f.read()).rejects.toThrow("differs");
  });
  it.each(["attempts", "dispatches", "outputs"])("keeps failed %s reads unavailable", async suffix => {
    const f = await fixture(); f.options.failTable = `engagement_synthesis_generation_${suffix}`;
    await expect(f.read()).rejects.toThrow("execution unavailable");
  });
  it("does not convert denied selections or absent attempts into empty success", async () => {
    const f = await fixture(); f.options.failSelections = true; await expect(f.read()).rejects.toThrow("inventory unavailable"); expect(f.from).not.toHaveBeenCalled();
    f.options.failSelections = false; f.rows.engagement_synthesis_generation_attempts = null; await expect(f.read()).rejects.toThrow();
  });
  it.each(["before", "during"])("stops an aborted read %s queries finish", async mode => {
    const f = await fixture(); if (mode === "before") f.controller.abort(); else f.options.abortOn = "engagement_synthesis_generation_attempts";
    await expect(f.read()).rejects.toMatchObject({ name: "AbortError" }); expect(f.trace).toHaveLength(mode === "before" ? 0 : 1);
  });
});
