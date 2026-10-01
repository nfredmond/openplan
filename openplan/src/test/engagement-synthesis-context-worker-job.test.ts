// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { synthesisContextJobFixture as fixture } from "./fixtures/engagement/synthesis-context-job";
import { sourceHash as hash } from "./fixtures/engagement/synthesis-source";

describe("context worker selected predecessor replay", () => {
  it.each([0, 2])("reconstructs frame %i with exact predecessor and dynamic task identity", async count => {
    const f = fixture(count), result = await f.loadJob(), prior = f.history.at(-1);
    expect(result.job.taskCanonical).toBe(f.next.task.canonical);
    expect(result.job.binding).toEqual({ jobId: f.f.scope.requestId, planSha256: f.plan.continuation.headerSha256,
      configurationRevisionId: f.f.f.args.job.configurationRevisionId, configurationHash: f.f.f.args.job.configurationHash,
      provider: "api_connection", modelId: "synthetic-context", taskSha256: f.next.task.sha256, attemptId: f.args.attemptId });
    expect(result.job.headerSha256).toBe(f.plan.headerSha256);
    expect(result.claim).toEqual({ p_task_text: f.next.task.canonical, p_predecessor_attempt: prior?.attempt.id ?? null,
      p_predecessor_selection: prior?.selection.id ?? null, p_predecessor_capture_sha256: prior?.outputRow.capture_sha256 ?? null,
      p_previous_result_sha256: prior?.result.sha256 ?? null });
    expect(f.rpc.mock.calls.filter(([name]) => name === "read_engagement_synthesis_context_selections")).toEqual(Array.from({ length: count }, (_, index) => [
      "read_engagement_synthesis_context_selections", { p_request: f.f.scope.requestId, p_through_sequence: index ? count : null, p_after_task_index: index - 1, p_limit: 1 },
    ]));
    const originals = f.trace.filter(row => row.table === "engagement_synthesis_context_attempt_inputs");
    expect(originals.map(({ signal: _signal, ...row }) => row)).toEqual(f.history.map(prior => ({ table: "engagement_synthesis_context_attempt_inputs",
      columns: "attempt_id,task_text,task_sha256,task_bytes,predecessor_attempt_id,predecessor_selection_id,predecessor_capture_sha256,previous_result_sha256",
      filters: { attempt_id: prior.attempt.id } })));
    expect(f.rpc.mock.calls.every(([name]) => name.startsWith("read_"))).toBe(true);
  });
  it.each(["headerSha256", "maxAttempts", "expiresAt", "retryTaskIndex"])("refuses invalid current grant %s", async field => {
    const f = fixture(0);
    if (field === "headerSha256") f.grantIntent.headerSha256 = "0".repeat(64);
    if (field === "maxAttempts") f.grantIntent.maxAttempts++;
    if (field === "expiresAt") f.grantIntent.expiresAt = "2000-01-01T00:00:00Z";
    if (field === "retryTaskIndex") f.grantIntent.retryTaskIndex = 1;
    f.resealGrant(); await expect(f.loadJob()).rejects.toThrow();
  });
  it("refuses a changed grant checksum before reconstructing sources", async () => {
    const f = fixture(0); f.grant.intent_sha256 = "0".repeat(64); await expect(f.loadJob()).rejects.toThrow("authorization differs");
    expect(f.trace).toHaveLength(1);
  });
  it("refuses a frame outside its plan", async () => {
    const f = fixture(0); f.args.taskIndex = f.plan.entries.length; await expect(f.loadJob()).rejects.toThrow("outside the retained plan");
  });
  it.each([
    ["engagement_synthesis_generation_authorizations", "id"],
    ["engagement_synthesis_generation_attempts", "id"], ["engagement_synthesis_generation_attempts", "request_id"],
    ["engagement_synthesis_generation_attempts", "task_index"], ["engagement_synthesis_generation_attempts", "authorization_id"],
    ["engagement_synthesis_generation_attempts", "previous_attempt_id"],
    ["engagement_synthesis_context_attempt_inputs", "attempt_id"],
    ["engagement_synthesis_generation_dispatches", "attempt_id"], ["engagement_synthesis_generation_dispatches", "expires_at"],
    ["engagement_synthesis_generation_outputs", "attempt_id"],
  ])("refuses inconsistent returned %s %s", async (table, field) => {
    const f = fixture();
    f.options.returnedPatch = { table, key: table.endsWith("authorizations") || table.endsWith("attempts") ? "id" : "attempt_id",
      value: table.endsWith("authorizations") ? f.args.authorizationId : f.history[0].attempt.id,
      patch: { [field]: field === "task_index" ? 1 : field === "expires_at" ? "2098-01-01T00:00:00Z" : randomUUID() } };
    await expect(f.loadJob()).rejects.toThrow("predecessor or authorization differs");
  });
  it("refuses a changed dynamic attempt binding", async () => {
    const f = fixture(), prior = f.history[0]; prior.attempt.binding_text = JSON.stringify({ ...prior.binding, taskSha256: "0".repeat(64) });
    await expect(f.loadJob()).rejects.toThrow("predecessor or authorization differs");
  });
  it.each(["maxOutputTokens", "responseByteLimit", "expiresAt"])("refuses rehashed dispatch beyond its grant %s", async field => {
    const f = fixture(), prior = f.history[1];
    if (field === "maxOutputTokens") prior.dispatch.maxOutputTokens++;
    if (field === "responseByteLimit") prior.dispatch.responseByteLimit++;
    if (field === "expiresAt") prior.dispatch.expiresAt = "2100-01-01T00:00:00Z";
    prior.recapture(); await expect(f.loadJob()).rejects.toThrow("predecessor or authorization differs");
  });
  it("refuses a predecessor authorized for a different request", async () => {
    const f = fixture(), prior = f.history[1], other = { ...f.grant, id: randomUUID(), request_id: randomUUID() };
    f.rows.get("engagement_synthesis_generation_authorizations")!.push(other);
    prior.attempt.authorization_id = other.id; prior.selection.authorizationId = other.id;
    prior.dispatch.authorizationId = other.id; prior.recapture();
    await expect(f.loadJob()).rejects.toThrow("predecessor or authorization differs");
  });
  it.each(["missing", "corruptChecksum", "changeSequence"] as const)("refuses changed selection inventory %s", async mode => {
    const f = fixture(); f.selectionOptions[mode] = true; await expect(f.loadJob()).rejects.toThrow("predecessor or authorization differs");
  });
  it.each(["requestId", "afterTaskIndex"])("refuses foreign page %s", async field => {
    const f = fixture(); f.selectionOptions.pagePatch = { [field]: field === "requestId" ? randomUUID() : 0 };
    await expect(f.loadJob()).rejects.toThrow("predecessor or authorization differs");
  });
  it.each(["requestId", "actorId", "taskIndex", "sequence", "attemptId", "authorizationId", "previousSelectionId"])("refuses changed selected receipt %s", async field => {
    const f = fixture(), selected = f.history[0].selection;
    Object.assign(selected, { [field]: field === "taskIndex" ? 1 : field === "sequence" ? 99 : field === "attemptId" || field === "authorizationId" ? null : randomUUID() });
    await expect(f.loadJob()).rejects.toThrow("predecessor or authorization differs");
  });
  it.each(["task_text", "task_sha256", "task_bytes", "predecessor_attempt_id", "predecessor_selection_id", "predecessor_capture_sha256", "previous_result_sha256"])("refuses retained predecessor input drift %s", async field => {
    const f = fixture(), input = f.history[1].input;
    input[field] = field === "task_text" ? " " + input[field] : field === "task_bytes" ? Number(input[field]) + 1 : field.endsWith("_id") ? randomUUID() : "0".repeat(64);
    await expect(f.loadJob()).rejects.toThrow("predecessor or authorization differs");
  });
  it("refuses a new choice of an unchanged prior capture when the later task pins the old choice", async () => {
    const f = fixture(); f.history[0].selection.id = randomUUID();
    await expect(f.loadJob()).rejects.toThrow("predecessor or authorization differs");
  });
  it("refuses repeated selection identities across frame pages", async () => {
    const f = fixture(); f.history[1].selection.id = f.history[0].selection.id;
    await expect(f.loadJob()).rejects.toThrow("predecessor or authorization differs");
  });
  it("refuses a staff choice falsely attributed to resource authorization", async () => {
    const f = fixture(); f.history[0].selection.origin = "staff";
    await expect(f.loadJob()).rejects.toThrow("predecessor or authorization differs");
  });
  it("checks selection receipt UTF8 bytes independently of string length", async () => {
    const f = fixture(); f.history[0].selection.reason = "漢".repeat(3500); f.selectionOptions.receiptPrefix = " ".repeat(23500);
    const text = f.selectionOptions.receiptPrefix + JSON.stringify(f.history[0].selection);
    expect(text.length).toBeLessThan(32768); expect(Buffer.byteLength(text)).toBeGreaterThan(32768);
    await expect(f.loadJob()).rejects.toThrow("predecessor or authorization differs");
  });
  it("refuses a self-hashed rewrite of original provider output", async () => {
    const f = fixture(), row = f.history[0].outputRow, capture = JSON.parse(String(row.capture_text));
    capture.outputText = "SYNTHETIC replacement"; row.capture_text = JSON.stringify(capture); row.capture_sha256 = hash(String(row.capture_text));
    await expect(f.loadJob()).rejects.toThrow("capture differs from its original response");
  });
  it.each(["truncated", "coverage", "prior-state"])("refuses unusable original response %s", async mode => {
    const f = fixture(), prior = f.history[mode === "prior-state" ? 1 : 0];
    if (mode === "coverage") prior.output.coveredPartIds = [];
    if (mode === "prior-state") prior.output.uncertainties = [];
    prior.recapture(undefined, mode === "truncated" ? "length" : "stop");
    await expect(f.loadJob()).rejects.toThrow(/truncated|coverage|preceding state/);
  });
  it.each(["engagement_synthesis_context_attempt_inputs", "engagement_synthesis_generation_outputs"])("refuses failed native %s read", async table => {
    const f = fixture(); f.options.failTable = table; await expect(f.loadJob()).rejects.toThrow("unavailable");
  });
  it("refuses denied selections and interrupted execution reads", async () => {
    const f = fixture(); f.options.failRpc = "read_engagement_synthesis_context_selections";
    await expect(f.loadJob()).rejects.toThrow("selection unavailable");
    f.options.failRpc = ""; f.options.abortTable = "engagement_synthesis_context_attempt_inputs";
    await expect(f.loadJob()).rejects.toMatchObject({ name: "AbortError" });
  });
});
