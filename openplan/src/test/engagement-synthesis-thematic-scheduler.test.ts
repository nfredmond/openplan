// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSynthesisThematicSchedule } from "@/lib/engagement/synthesis-thematic-scheduler";
import type { SynthesisWorkerOutcome } from "@/lib/engagement/synthesis-generation-worker";
import { synthesisThematicAuthorityFixture } from "./fixtures/engagement/synthesis-thematic-authority";
import { sourceHash as hash } from "./fixtures/engagement/synthesis-source";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function fixture() {
  const f = await synthesisThematicAuthorityFixture(), directory = await mkdtemp(join(tmpdir(), "openplan-thematic-schedule-")); directories.push(directory);
  const initial: Array<Record<string, unknown>> = [];
  const options = { pageLimit: 128, error: false, forcedPages: null as Array<unknown[]> | null };
  const trace: Array<{ columns: string; filters: Record<string, unknown>; order: unknown; limit: number; cursor: number }> = [];
  const from = vi.fn((table: string) => {
    if (table !== "engagement_synthesis_generation_attempts") return f.from(table);
    const entry = { columns: "", filters: {} as Record<string, unknown>, order: undefined as unknown, limit: 0, cursor: -1 };
    let requestSignal: AbortSignal | undefined;
    const inventory = () => Promise.resolve({ data: options.forcedPages ? options.forcedPages.shift() : initial.filter(row => Number(row.task_index) > entry.cursor).slice(0, options.pageLimit), error: options.error ? { code: "SYNTHETIC" } : null });
    function original() {
      let request = f.from(table).select(entry.columns);
      for (const [key, value] of Object.entries(entry.filters)) request = request.eq(key, value);
      if (requestSignal) request.abortSignal(requestSignal);
      return request;
    }
    const query = {
      select(columns: string) { entry.columns = columns; return query; },
      eq(key: string, value: unknown) { entry.filters[key] = value; return query; },
      is(key: string, value: unknown) { entry.filters[key] = value; return query; },
      gt(key: string, value: number) { entry.filters[key] = value; entry.cursor = value; trace.push(entry); return query; },
      order(key: string, value: unknown) { entry.order = { key, value }; return query; },
      limit(value: number) { entry.limit = value; return query; },
      abortSignal(signal: AbortSignal) { requestSignal = signal; return query; },
      then: (...args: Parameters<ReturnType<typeof inventory>["then"]>) => inventory().then(...args),
      single: () => original().single(), maybeSingle: () => original().maybeSingle(),
    }; return query;
  });
  const calls: number[] = [];
  const runAttempt = vi.fn(async (args: Parameters<NonNullable<Parameters<typeof runSynthesisThematicSchedule>[0]["runAttempt"]>>[0]): Promise<SynthesisWorkerOutcome> => {
    const saved = JSON.parse(await readFile(join(directory, "schedule/pending.json"), "utf8"));
    expect(saved.thematic).toBe(true); expect(saved.taskIndices).toContain(args.taskIndex);
    expect(args.directory).toBe(join(directory, String(args.taskIndex))); expect(args.authorizationId).toBe(f.args.authorizationId);
    calls.push(args.taskIndex); return { state: "delivered", attemptId: randomUUID(), captureSha256: "b".repeat(64) };
  });
  const service = { from, rpc: f.rpc } as unknown as typeof f.service;
  const args = { service, target: "http://127.0.0.1:29821", directory, authorizationId: f.args.authorizationId, signal: f.controller.signal, runAttempt };
  const journal = async () => JSON.parse(await readFile(join(directory, "schedule/pending.json"), "utf8"));
  const save = (raw: unknown) => writeFile(join(directory, "schedule/pending.json"), JSON.stringify(raw), { mode: 0o600 });
  function resealGrant() { f.grant.intent_text = JSON.stringify(f.grantIntent); f.grant.intent_sha256 = hash(f.grant.intent_text); }
  function addInitial(index: number, authorizationId = randomUUID()) {
    const attemptId = randomUUID(), text = JSON.stringify({ syntheticHistoricalIndex: index, text: "é 🌉" });
    const input = { attempt_id: attemptId, task_text: text, task_sha256: hash(text), task_bytes: Buffer.byteLength(text) };
    f.rows.set("engagement_synthesis_thematic_attempt_inputs", [...(f.rows.get("engagement_synthesis_thematic_attempt_inputs") ?? []), input]);
    const intent = JSON.parse(String(f.requestRow.intent_text));
    const binding = { jobId: f.f.scope.requestId, planSha256: f.plan.header.continuationHeaderSha256,
      configurationRevisionId: intent.configurationRevisionId, configurationHash: intent.configurationHash,
      provider: "api_connection", modelId: intent.modelId, taskSha256: input.task_sha256, attemptId };
    const row: Record<string, unknown> = { id: attemptId, request_id: f.f.scope.requestId, authorization_id: authorizationId, task_index: index,
      previous_attempt_id: null, binding_text: JSON.stringify(binding) };
    initial.push(row); initial.sort((a, b) => Number(a.task_index) - Number(b.task_index)); return { row, input, binding };
  }
  return { f, args, from, options, trace, initial, calls, runAttempt, journal, save, resealGrant, addInitial, run: () => runSynthesisThematicSchedule(args) };
}

describe("dependent thematic scheduling", () => {
  it("persists every task before processing them in order", async () => {
    const f = await fixture(), count = f.f.plan.header.taskCount, result = await f.run();
    expect(count).toBeGreaterThan(2); expect(result).toMatchObject({ state: "grant_drained", scheduledCount: count, taskCount: count, outsideScheduleCount: 0, stoppedAt: null });
    expect(f.calls).toEqual(Array.from({ length: count }, (_, i) => i));
    expect(f.trace).toEqual([{ columns: "id,request_id,authorization_id,task_index,previous_attempt_id,binding_text",
      filters: { request_id: f.f.f.scope.requestId, previous_attempt_id: null, task_index: -1 }, order: { key: "task_index", value: { ascending: true } }, limit: 128, cursor: -1 }]);
  });
  it("stops at an unobserved predecessor and preserves the exact schedule on retry", async () => {
    const f = await fixture(); f.runAttempt.mockResolvedValueOnce({ state: "unobserved", attemptId: randomUUID() });
    const result = await f.run(), saved = await f.journal();
    expect(result).toMatchObject({ state: "predecessor_unobserved", stoppedAt: 0 }); expect(result.outcomes).toHaveLength(1); expect(f.runAttempt).toHaveBeenCalledOnce();
    f.runAttempt.mockClear(); f.f.options.failRpc = "read_engagement_synthesis_thematic_plan";
    await f.run(); expect(await f.journal()).toEqual(saved); expect(f.runAttempt).toHaveBeenCalledTimes(saved.taskIndices.length);
  });
  it("resumes saved output delivery without checking current plan authority", async () => {
    const f = await fixture(); await f.run(); f.f.rpc.mockClear(); f.trace.splice(0);
    f.f.state.cancelled = true; f.f.options.failRpc = "read_engagement_synthesis_thematic_plan";
    await expect(f.run()).resolves.toMatchObject({ state: "grant_drained" });
    expect(f.f.rpc).not.toHaveBeenCalled(); expect(f.trace).toHaveLength(0);
  });
  it("refuses a new schedule when current authority is unavailable", async () => {
    const f = await fixture(); f.f.options.failRpc = "read_engagement_synthesis_thematic_plan";
    await expect(f.run()).rejects.toThrow("current scope unavailable"); expect(f.runAttempt).not.toHaveBeenCalled();
  });
  it("refuses a new expired grant", async () => {
    const f = await fixture(); f.f.grantIntent.expiresAt = "2000-01-01T00:00:00Z"; f.resealGrant();
    await expect(f.run()).rejects.toThrow("no longer current"); expect(f.runAttempt).not.toHaveBeenCalled();
  });
  it("keeps a limited grant partial and includes its own initial task journals", async () => {
    const f = await fixture(); f.addInitial(0); f.addInitial(1, f.args.authorizationId);
    f.f.grantIntent.maxAttempts = 2; f.resealGrant();
    const result = await f.run(); expect(f.calls).toEqual([1, 2]); expect(result.outsideScheduleCount).toBe(f.f.plan.header.taskCount - 2);
  });
  it("continues through short inventory pages and binds historical input bytes", async () => {
    const f = await fixture(); f.addInitial(0); f.addInitial(1); f.options.pageLimit = 1;
    await f.run(); expect(f.trace.map(row => row.cursor)).toEqual([-1, 0, 1]); expect(f.calls[0]).toBe(2);
    expect(f.f.trace.filter(row => row.table === "engagement_synthesis_thematic_attempt_inputs").map(row => row.columns)).toEqual([
      "attempt_id,task_text,task_sha256,task_bytes", "attempt_id,task_text,task_sha256,task_bytes",
    ]);
  });
  it("schedules only an explicitly authorized retry", async () => {
    const f = await fixture(); f.f.grantIntent.retryTaskIndex = 1; f.f.grantIntent.retryOfAttemptId = randomUUID(); f.f.grantIntent.maxAttempts = 1; f.resealGrant();
    await f.run(); expect(f.calls).toEqual([1]); expect(f.trace).toHaveLength(0);
  });
  it.each(["version", "thematic", "target", "authorizationId", "requestId", "headerSha256", "authorizationIntentSha256", "taskIndices"])("rejects changed saved schedule %s", async field => {
    const f = await fixture(); await f.run(); const saved = await f.journal(); f.runAttempt.mockClear();
    saved[field] = field === "version" ? 2 : field === "thematic" ? false : field === "target" ? "http://127.0.0.1:39821" : field === "taskIndices" ? saved.taskIndices.slice(1) : field.endsWith("Id") ? randomUUID() : "0".repeat(64);
    await f.save(saved); await expect(f.run()).rejects.toThrow(); expect(f.runAttempt).not.toHaveBeenCalled();
  });
  it.each(["request_id", "task_index", "previous_attempt_id", "binding_text"])("rejects initial attempt drift %s", async field => {
    const f = await fixture(), entry = f.addInitial(0);
    if (field === "request_id" || field === "previous_attempt_id") entry.row[field] = randomUUID();
    else if (field === "task_index") entry.row.task_index = f.f.plan.header.taskCount;
    else entry.row.binding_text = JSON.stringify({ ...entry.binding, taskSha256: "0".repeat(64) });
    await expect(f.run()).rejects.toThrow(); expect(f.runAttempt).not.toHaveBeenCalled();
  });
  it.each(["task_text", "task_sha256", "task_bytes", "attempt_id"])("rejects historical input drift %s", async field => {
    const f = await fixture(), entry = f.addInitial(0);
    if (field === "attempt_id") f.f.options.returnedPatch = { table: "engagement_synthesis_thematic_attempt_inputs", key: "attempt_id", value: entry.input.attempt_id, patch: { attempt_id: randomUUID() } };
    else if (field === "task_text") { entry.input.task_text += " "; entry.input.task_bytes = Buffer.byteLength(entry.input.task_text); }
    else if (field === "task_sha256") entry.input.task_sha256 = "0".repeat(64);
    else entry.input.task_bytes++;
    await expect(f.run()).rejects.toThrow("differs"); expect(f.runAttempt).not.toHaveBeenCalled();
  });
  it.each(["inventory", "input"])("refuses failed %s reads", async mode => {
    const f = await fixture(); f.addInitial(0);
    if (mode === "inventory") f.options.error = true; else f.f.options.failTable = "engagement_synthesis_thematic_attempt_inputs";
    await expect(f.run()).rejects.toThrow("unavailable"); expect(f.runAttempt).not.toHaveBeenCalled();
  });
  it("does not start a successor after the worker rejects a malformed predecessor", async () => {
    const f = await fixture(); f.runAttempt.mockRejectedValueOnce(new Error("SYNTHETIC invalid original predecessor"));
    await expect(f.run()).rejects.toThrow("invalid original predecessor"); expect(f.runAttempt).toHaveBeenCalledOnce();
  });
  it("refuses own initial attempts above the grant allowance", async () => {
    const f = await fixture(); f.addInitial(0, f.args.authorizationId); f.addInitial(1, f.args.authorizationId);
    f.f.grantIntent.maxAttempts = 1; f.resealGrant();
    await expect(f.run()).rejects.toThrow("differs"); expect(f.runAttempt).not.toHaveBeenCalled();
  });
  it("refuses repeated saved attempt identities", async () => {
    const f = await fixture(); f.addInitial(0); f.addInitial(1); await f.run();
    const saved = await f.journal(); saved.initialAttempts[1].attemptId = saved.initialAttempts[0].attemptId;
    await f.save(saved); f.runAttempt.mockClear();
    await expect(f.run()).rejects.toThrow("differs"); expect(f.runAttempt).not.toHaveBeenCalled();
  });
  it("refuses a page that repeats the preceding cursor", async () => {
    const f = await fixture(), entry = f.addInitial(0); f.options.forcedPages = [[entry.row], [entry.row], []];
    await expect(f.run()).rejects.toThrow("differs"); expect(f.runAttempt).not.toHaveBeenCalled();
  });
  it("refuses repeated native attempt identities across different frames", async () => {
    const f = await fixture(), first = f.addInitial(0), second = f.addInitial(1);
    second.row.id = first.row.id; second.row.binding_text = first.row.binding_text;
    await expect(f.run()).rejects.toThrow("differs"); expect(f.runAttempt).not.toHaveBeenCalled();
  });
  it("refuses self-hashed original task bytes above the request limit", async () => {
    const f = await fixture(), entry = f.addInitial(0), limit = JSON.parse(String(f.f.requestRow.intent_text)).taskByteLimit;
    entry.input.task_text = "🌉".repeat(Math.floor(limit / 4) + 1);
    entry.input.task_sha256 = hash(entry.input.task_text); entry.input.task_bytes = Buffer.byteLength(entry.input.task_text);
    entry.row.binding_text = JSON.stringify({ ...entry.binding, taskSha256: entry.input.task_sha256 });
    await expect(f.run()).rejects.toThrow("differs"); expect(f.runAttempt).not.toHaveBeenCalled();
  });
  it("does not create a schedule for an already aborted invocation", async () => {
    const f = await fixture(); f.f.controller.abort(); f.from.mockClear();
    await expect(f.run()).rejects.toThrow(); expect(f.from).not.toHaveBeenCalled(); expect(f.runAttempt).not.toHaveBeenCalled();
  });
  it("refuses a retry schedule with initial inventory injected", async () => {
    const f = await fixture(); f.f.grantIntent.retryTaskIndex = 1; f.f.grantIntent.retryOfAttemptId = randomUUID(); f.f.grantIntent.maxAttempts = 1; f.resealGrant();
    await f.run(); const saved = await f.journal();
    saved.initialAttempts = [{ attemptId: randomUUID(), taskIndex: 0, authorizationId: randomUUID() }];
    await f.save(saved); f.runAttempt.mockClear();
    await expect(f.run()).rejects.toThrow("differs"); expect(f.runAttempt).not.toHaveBeenCalled();
  });
  it("schedules a final proposal retry without adding another frame", async () => {
    const f = await fixture(); f.f.grantIntent.retryTaskIndex = f.f.plan.header.frameCount;
    f.f.grantIntent.retryOfAttemptId = randomUUID(); f.f.grantIntent.maxAttempts = 1; f.resealGrant();
    const result = await f.run(); expect(f.calls).toEqual([f.f.plan.header.frameCount]);
    expect(result.taskCount).toBe(f.f.plan.header.frameCount + 1);
  });
  it.each(["segment", "context"])("refuses a saved %s schedule even after cancellation", async mode => {
    const f = await fixture(); await f.run(); const saved = await f.journal(); delete saved.thematic;
    if(mode === "context") saved.context = true;
    await f.save(saved); f.f.state.cancelled = true; f.runAttempt.mockClear();
    await expect(f.run()).rejects.toThrow(); expect(f.runAttempt).not.toHaveBeenCalled();
  });

  it("recovers a complete schedule temporary after current access ends", async () => {
    const f = await fixture(); await f.run(); const saved = await f.journal();
    const temporary = join(f.args.directory, "schedule", `pending-${randomUUID()}.tmp`);
    await rename(join(f.args.directory, "schedule/pending.json"), temporary);
    f.f.state.cancelled = true; f.f.options.failRpc = "read_engagement_synthesis_thematic_plan"; f.f.rpc.mockClear();
    await expect(f.run()).resolves.toMatchObject({ state: "grant_drained" });
    expect(await f.journal()).toEqual(saved); expect(JSON.parse(await readFile(temporary,"utf8"))).toEqual(saved);
    expect(f.f.rpc).not.toHaveBeenCalled();
  });
  it.each([true,false])("preserves a partial temporary with final schedule present=%s", async present => {
    const f = await fixture(); await f.run(); const temporary = join(f.args.directory,"schedule",`pending-${randomUUID()}.tmp`);
    await writeFile(temporary,'{"version":', { mode:0o600 });
    if(!present) await rm(join(f.args.directory,"schedule/pending.json"));
    await expect(f.run()).resolves.toMatchObject({state:"grant_drained"}); expect(await readFile(temporary,"utf8")).toBe('{"version":');
  });
  it.each([true,false])("refuses conflicting complete schedules with final present=%s", async present => {
    const f = await fixture(); await f.run(); const saved = await f.journal();
    const original = join(f.args.directory,"schedule/pending.json");
    if(!present) await rename(original,join(f.args.directory,"schedule",`pending-${randomUUID()}.tmp`));
    const changed = { ...saved, initialAttempts:[{ attemptId:randomUUID(), taskIndex:0, authorizationId:f.args.authorizationId }] };
    const temporary = join(f.args.directory,"schedule",`pending-${randomUUID()}.tmp`);
    await writeFile(temporary,JSON.stringify(changed),{mode:0o600});f.runAttempt.mockClear();
    await expect(f.run()).rejects.toThrow("conflicting saved schedules");expect(f.runAttempt).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(temporary,"utf8"))).toEqual(changed);
  });
  it.each(["target","thematic","taskIndices"])("refuses an incompatible schedule temporary %s",async field=>{
    const f = await fixture();await f.run();const saved=await f.journal();
    await rm(join(f.args.directory,"schedule/pending.json"));
    saved[field]=field==="target"?"http://127.0.0.1:39821":field==="thematic"?false:saved.taskIndices.slice(0,-1);
    await writeFile(join(f.args.directory,"schedule",`pending-${randomUUID()}.tmp`),JSON.stringify(saved),{mode:0o600});
    f.runAttempt.mockClear();await expect(f.run()).rejects.toThrow();expect(f.runAttempt).not.toHaveBeenCalled();
    await expect(f.journal()).rejects.toMatchObject({code:"ENOENT"});
  });
  it("does not infer a schedule from a partial temporary after cancellation",async()=>{
    const f = await fixture();await f.run();await rm(join(f.args.directory,"schedule/pending.json"));
    const temporary=join(f.args.directory,"schedule",`pending-${randomUUID()}.tmp`);
    await writeFile(temporary,'{"version":',{mode:0o600});f.f.state.cancelled=true;f.runAttempt.mockClear();
    await expect(f.run()).rejects.toThrow("active sealed plan");expect(f.runAttempt).not.toHaveBeenCalled();
    expect(await readFile(temporary,"utf8")).toBe('{"version":');
  });

});
