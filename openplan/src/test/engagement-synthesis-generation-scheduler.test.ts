// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acquireConnectorLock } from "../../../workers/planner_agent_connector/connector-worker.mjs";
import type { SynthesisWorkerOutcome } from "@/lib/engagement/synthesis-generation-worker";
import { runSynthesisGenerationSchedule } from "@/lib/engagement/synthesis-generation-scheduler";
import { synthesisWorkerFixture } from "./fixtures/engagement/synthesis-worker";

type Fixture = Awaited<ReturnType<typeof synthesisWorkerFixture>>;
const fixtures: Fixture[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); vi.unstubAllEnvs(); });

async function fixture(sourceCount = 2) {
  const f = await synthesisWorkerFixture(sourceCount); fixtures.push(f);
  const initial: Array<Record<string, unknown>> = [];
  const inventoryTrace: Array<{ columns: string; filters: Record<string, unknown>; cursor: number; limit: number; order: unknown; signal?: AbortSignal }> = [];
  const controls = { error: false, pageLimit: 128, forcedPages: null as Array<unknown[]> | null };
  const original = f.service.from.bind(f.service);
  const from = vi.fn((table: string) => {
    if (table !== "engagement_synthesis_generation_attempts") return original(table);
    const trace = { columns: "", filters: {} as Record<string, unknown>, cursor: -1, limit: 0, order: undefined as unknown, signal: undefined as AbortSignal | undefined };
    inventoryTrace.push(trace);
    const query = {
      select(columns: string) { trace.columns = columns; return query; },
      eq(column: string, value: unknown) { trace.filters[column] = value; return query; },
      is(column: string, value: unknown) { trace.filters[column] = value; return query; },
      gt(column: string, value: number) { trace.filters[column] = value; trace.cursor = value; return query; },
      order(column: string, value: unknown) { trace.order = { column, value }; return query; },
      limit(value: number) { trace.limit = value; return query; },
      abortSignal(signal: AbortSignal) {
        trace.signal = signal;
        return Promise.resolve({ data: controls.forcedPages ? controls.forcedPages.shift() : initial.filter(row => Number(row.task_index) > trace.cursor).slice(0, controls.pageLimit),
          error: controls.error ? { code: "SYNTHETIC" } : null });
      },
    };
    return query;
  });
  const calls: Array<{ taskIndex: number; directory: string; authorizationId: string; target: string }> = [];
  const runAttempt = vi.fn(async (args: Parameters<NonNullable<Parameters<typeof runSynthesisGenerationSchedule>[0]["runAttempt"]>>[0]): Promise<SynthesisWorkerOutcome> => {
    // A saved exact list must precede every dispatch, including the first.
    const schedule = JSON.parse(await readFile(join(f.args.directory, "schedule/pending.json"), "utf8"));
    expect(schedule.taskIndices).toContain(args.taskIndex);
    expect(args.signal).toBeInstanceOf(AbortSignal);
    calls.push(args);
    return { state: "delivered" as const, attemptId: randomUUID(), captureSha256: "b".repeat(64) };
  });
  const args = { ...f.args, service: { from, rpc: f.service.rpc } as unknown as typeof f.service, runAttempt };
  function addInitial(taskIndex: number, authorizationId = randomUUID()) {
    const attemptId = randomUUID(), task = f.plan.entries[taskIndex];
    const binding = { jobId: f.plan.header.requestId, planSha256: f.plan.header.taskManifestSha256,
      configurationRevisionId: f.revision.revisionId, configurationHash: f.revision.configurationHash,
      provider: "api_connection", modelId: "synthetic", taskSha256: task.sha256, attemptId };
    const row = { id: attemptId, request_id: f.plan.header.requestId, authorization_id: authorizationId,
      task_index: taskIndex, binding_text: JSON.stringify(binding) };
    initial.push(row); initial.sort((a, b) => Number(a.task_index) - Number(b.task_index)); return row;
  }
  const run = () => runSynthesisGenerationSchedule(args);
  const journal = async () => JSON.parse(await readFile(join(f.args.directory, "schedule/pending.json"), "utf8"));
  const save = async (raw: unknown) => writeFile(join(f.args.directory, "schedule/pending.json"), JSON.stringify(raw), { mode: 0o600 });
  return { ...f, args, run, journal, save, initial, inventoryTrace, controls, calls, runAttempt, addInitial };
}

describe("synthesis authorized corpus scheduling", () => {
  it("persists the complete task list before sequential attempts and reuses single-task directories", async () => {
    const f = await fixture(), count = f.plan.entries.length;
    expect(count).toBeGreaterThan(2);
    const result = await f.run();
    expect(result).toMatchObject({ state: "grant_drained", taskCount: count, scheduledCount: count, outsideScheduleCount: 0 });
    expect(f.calls.map(call => call.taskIndex)).toEqual(f.plan.entries.map(task => task.index));
    for (const call of f.calls) expect(call).toMatchObject({ directory: join(f.args.directory, String(call.taskIndex)),
      authorizationId: f.args.authorizationId, target: f.args.target });
    expect(f.inventoryTrace).toEqual([{ columns: "id,request_id,authorization_id,task_index,binding_text",
      filters: { request_id: f.plan.header.requestId, previous_attempt_id: null, task_index: -1 }, cursor: -1, limit: 128,
      order: { column: "task_index", value: { ascending: true } }, signal: expect.any(AbortSignal) }]);
  });
  it("schedules every retained contribution beyond 300 without clipping the last long source", async () => {
    const f = await fixture(301); const result = await f.run();
    expect(f.plan.header.contributionCount).toBe(302);
    expect(result.scheduledCount).toBe(f.plan.entries.length);
    expect(f.calls.map(call => call.taskIndex)).toEqual(f.plan.entries.map(task => task.index));
    expect(f.plan.entries.some(task => task.canonical.includes("FINAL SOURCE TAIL"))).toBe(true);
  });
  it("refuses an unavailable current plan before preparing a new schedule", async () => {
    const f = await fixture(); f.options.failPlan = true;
    await expect(f.run()).rejects.toThrow("plan unavailable"); expect(f.runAttempt).not.toHaveBeenCalled();
  });
  it("refuses an inconsistent own-attempt count above its allowance", async () => {
    const f = await fixture(); f.authorizationIntent.maxAttempts = 1; f.resealGrant();
    f.addInitial(0, f.args.authorizationId); f.addInitial(1, f.args.authorizationId);
    await expect(f.run()).rejects.toThrow("differs"); expect(f.runAttempt).not.toHaveBeenCalled();
  });
  it("continues after short inventory pages and excludes earlier grants without calling them complete", async () => {
    const f = await fixture(); f.controls.pageLimit = 1; f.addInitial(0); f.addInitial(1);
    const result = await f.run();
    expect(f.inventoryTrace.map(trace => trace.cursor)).toEqual([-1, 0, 1]);
    expect(result.outsideScheduleCount).toBe(2);
    expect(f.calls.map(call => call.taskIndex)).toEqual(f.plan.entries.slice(2).map(task => task.index));
  });
  it("reserves allowance for its own later existing attempt before assigning fresh earlier tasks", async () => {
    const f = await fixture(), last = f.plan.entries.length - 1;
    f.authorizationIntent.maxAttempts = 2; f.resealGrant(); f.addInitial(last, f.args.authorizationId);
    const result = await f.run();
    expect(f.calls.map(call => call.taskIndex)).toEqual([0, last]);
    expect(result.outsideScheduleCount).toBe(f.plan.entries.length - 2);
  });
  it("retains a partial allowance without treating the remainder as processed", async () => {
    const f = await fixture(); f.authorizationIntent.maxAttempts = 1; f.resealGrant();
    expect(await f.run()).toMatchObject({ scheduledCount: 1, outsideScheduleCount: f.plan.entries.length - 1 });
    expect(f.calls.map(call => call.taskIndex)).toEqual([0]);
  });
  it("schedules only the explicit retry task and reads no initial-attempt inventory", async () => {
    const f = await fixture(); Object.assign(f.authorizationIntent, { maxAttempts: 1, retryTaskIndex: 2, retryOfAttemptId: randomUUID() }); f.resealGrant();
    await f.run(); expect(f.calls.map(call => call.taskIndex)).toEqual([2]); expect(f.inventoryTrace).toEqual([]);
  });
  it("preserves its frozen schedule across interruption and reconfirms earlier task custody", async () => {
    const f = await fixture(); const original = f.runAttempt.getMockImplementation()!;
    f.runAttempt.mockImplementationOnce(original).mockRejectedValueOnce(new Error("SYNTHETIC interrupted"));
    await expect(f.run()).rejects.toThrow("interrupted"); const saved = await f.journal();
    f.initial.push({ invalid: "a new read would fail" });
    f.calls.length = 0; await f.run();
    expect(f.calls.map(call => call.taskIndex)).toEqual(saved.taskIndices);
    expect(await f.journal()).toEqual(saved); expect(f.inventoryTrace).toHaveLength(1);
  });
  it("retains an unknown outcome without scheduling a replacement", async () => {
    const f = await fixture(); f.runAttempt.mockResolvedValueOnce({ state: "unobserved", attemptId: randomUUID() });
    const result = await f.run(); expect(result.outcomes[0].state).toBe("unobserved");
    expect(f.runAttempt).toHaveBeenCalledTimes(f.plan.entries.length);
  });
  it("permits existing-journal custody recovery after cancellation and expiry", async () => {
    const f = await fixture(); await f.run(); f.planState.cancelled = true;
    // The immutable grant stays unchanged. Advance the clock beyond its expiry.
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(f.authorizationIntent.expiresAt) + 1);
    try { await f.run(); expect(f.runAttempt).toHaveBeenCalledTimes(f.plan.entries.length * 2); }
    finally { vi.restoreAllMocks(); }
  });
  it.each(["cancelled", "expired"])("refuses a new schedule when %s", async state => {
    const f = await fixture();
    if (state === "cancelled") f.planState.cancelled = true;
    else { f.authorizationIntent.expiresAt = new Date(Date.now() - 1000).toISOString(); f.resealGrant(); }
    await expect(f.run()).rejects.toThrow("no longer current"); expect(f.runAttempt).not.toHaveBeenCalled();
  });
  it("stops between tasks when the caller cancels", async () => {
    const f = await fixture(); const original = f.runAttempt.getMockImplementation()!;
    f.runAttempt.mockImplementationOnce(async args => { const result = await original(args); f.controller.abort(); return result; });
    await expect(f.run()).rejects.toThrow(); expect(f.runAttempt).toHaveBeenCalledTimes(1);
  });
  it("takes an exclusive scheduling lock", async () => {
    const f = await fixture(), lock = await acquireConnectorLock(join(f.args.directory, "schedule"));
    try { await expect(f.run()).rejects.toThrow(); expect(f.runAttempt).not.toHaveBeenCalled(); }
    finally { await lock.release(); }
  });
  it("refuses an unavailable inventory before starting a task", async () => {
    const f = await fixture(); f.controls.error = true;
    await expect(f.run()).rejects.toThrow("inventory unavailable"); expect(f.runAttempt).not.toHaveBeenCalled();
  });
  it.each(["request", "task", "binding", "duplicate", "unordered"])("refuses %s corruption in initial attempts", async kind => {
    const f = await fixture(), a = f.addInitial(0), b = f.addInitial(1);
    if (kind === "request") a.request_id = randomUUID();
    if (kind === "task") a.task_index = f.plan.entries.length;
    if (kind === "binding") a.binding_text = JSON.stringify({ ...JSON.parse(String(a.binding_text)), modelId: "foreign" });
    if (kind === "duplicate") { b.id = a.id; b.binding_text = JSON.stringify({ ...JSON.parse(String(b.binding_text)), attemptId: a.id }); }
    if (kind === "unordered") f.initial.reverse();
    f.controls.forcedPages = [f.initial, []];
    await expect(f.run()).rejects.toThrow("differs"); expect(f.runAttempt).not.toHaveBeenCalled();
    if (kind === "unordered") expect(f.inventoryTrace).toHaveLength(1);
  });
  it.each(["target", "authorizationId", "requestId", "headerSha256", "authorizationIntentSha256", "taskIndices", "initialAttempts"])("refuses a changed saved %s", async field => {
    const f = await fixture(); await f.run(); const saved = await f.journal(); f.runAttempt.mockClear();
    if (field === "target") saved[field] = "http://127.0.0.1:9999";
    else if (field.endsWith("Sha256")) saved[field] = "e".repeat(64);
    else if (field === "taskIndices") saved[field] = saved[field].slice(1);
    else if (field === "initialAttempts") saved[field] = [{ taskIndex: f.plan.entries.length, authorizationId: randomUUID() }];
    else saved[field] = randomUUID();
    await f.save(saved); await expect(f.run()).rejects.toThrow("differs"); expect(f.runAttempt).not.toHaveBeenCalled();
  });
  it("does not treat a malformed existing journal as permission to replan", async () => {
    const f = await fixture(); await f.run(); f.runAttempt.mockClear(); await f.save({ invalid: true });
    await expect(f.run()).rejects.toThrow(); expect(f.runAttempt).not.toHaveBeenCalled();
  });
});
