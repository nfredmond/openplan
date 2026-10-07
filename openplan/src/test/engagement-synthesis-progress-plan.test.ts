import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { readSynthesisProgressPlan } from "@/lib/engagement/synthesis-progress-plan-server";
import { createSynthesisGenerationPlan } from "@/lib/engagement/synthesis-generation-plan";
import { makeSourceSnapshot, savedSource, sourceScope, sourceHash } from "./fixtures/engagement/synthesis-source";

function fixture(items = 2) {
  const saved = savedSource(makeSourceSnapshot(items));
  const intentText = JSON.stringify({ schemaVersion: 1, sourceId: sourceScope.requestId, sourceSha256: saved.snapshotSha256,
    connectionId: "e0000000-0000-4000-8000-000000000001", configurationRevisionId: "e0000000-0000-4000-8000-000000000002",
    configurationHash: "a".repeat(64), modelId: "synthetic", taskByteLimit: 4096 });
  const plan = createSynthesisGenerationPlan({ id: "f0000000-0000-4000-8000-000000000001", intentText, intentSha256: sourceHash(intentText) }, saved, sourceScope);
  const receiptText = JSON.stringify({ schemaVersion: 1, requestId: plan.header.requestId, headerSha256: plan.headerSha256,
    taskCount: plan.entries.length, taskBytes: plan.header.taskBytes, tailSha256: plan.header.tailSha256, sealedAt: "2026-10-06T12:00:00Z" });
  const data: { header: Record<string, unknown> | null; seal: Record<string, unknown> | null; tasks: Array<Record<string, unknown>>; error: string | null } = {
    header: { request_id: plan.header.requestId, header_text: plan.headerText, header_sha256: plan.headerSha256 },
    seal: { request_id: plan.header.requestId, receipt_text: receiptText, receipt_sha256: sourceHash(receiptText) },
    tasks: plan.entries.map(entry => ({ request_id: plan.header.requestId, task_index: entry.index, task_text: entry.canonical,
      task_sha256: entry.sha256, task_bytes: entry.utf8Bytes, cumulative_bytes: entry.cumulativeBytes, chain_sha256: entry.chainSha256 })), error: null,
  };
  const columns = { engagement_synthesis_generation_plan_seals: "request_id,receipt_text,receipt_sha256",
    engagement_synthesis_generation_plans: "request_id,header_text,header_sha256",
    engagement_synthesis_generation_plan_tasks: "request_id,task_index,task_text,task_sha256,task_bytes,cumulative_bytes,chain_sha256" };
  const cursors: number[] = [], tables: string[] = [];
  const service = { from: vi.fn((table: keyof typeof columns) => {
    tables.push(table); let after = -1;
    const query = {
      select(projection: string) { expect(projection).toBe(columns[table]); return query; },
      eq(column: string, value: string) { expect([column, value]).toEqual(["request_id", plan.header.requestId]); return query; },
      gt(column: string, value: number) { expect(column).toBe("task_index"); after = value; cursors.push(value); return query; },
      order(column: string, options: unknown) { expect([column, options]).toEqual(["task_index", { ascending: true }]); return query; },
      limit(limit: number) { expect(limit).toBe(128); return query; },
      abortSignal(signal: AbortSignal): unknown {
        expect(signal.aborted).toBe(false);
        return table.endsWith("_tasks") ? Promise.resolve({ data: data.tasks.filter(row => Number(row.task_index) > after).slice(0, 128), error: data.error }) : query;
      },
      maybeSingle: async () => ({ data: table.endsWith("_seals") ? data.seal : data.header, error: data.error }),
    };
    return query;
  }) };
  const run = () => readSynthesisProgressPlan(service as unknown as Pick<SupabaseClient, "from">, plan, new AbortController().signal);
  return { data, plan, run, cursors, tables };
}

describe("saved segment plan custody for progress", () => {
  it("compares the seal before the header and every exact saved task", async () => {
    const f = fixture(); expect(await f.run()).toBe("sealed");
    expect(f.tables.slice(0, 2)).toEqual(["engagement_synthesis_generation_plan_seals", "engagement_synthesis_generation_plans"]);
    expect(f.cursors).toEqual([-1]);
  });
  it("reads beyond the first task page without a silent limit", async () => {
    const f = fixture(160); expect(f.plan.entries.length).toBeGreaterThan(128);
    expect(await f.run()).toBe("sealed"); expect(f.cursors.slice(0, 2)).toEqual([-1, 127]);
  });
  it("keeps missing and partially staged preparation separate from complete tasks", async () => {
    const f = fixture(); f.data.seal = null; f.data.tasks = f.data.tasks.slice(0, 2);
    expect(await f.run()).toBe("staging"); f.data.header = null;
    expect(await f.run()).toBe("not_prepared");
  });
  it.each(["request_id", "header_text", "header_sha256"])("rejects different header %s even without any selected output", async field => {
    const f = fixture(); f.data.header![field] = field === "header_text" ? "{}" : field === "header_sha256" ? "0".repeat(64) : sourceScope.requestId;
    await expect(f.run()).rejects.toThrow("plan differs");
  });
  it.each(["request_id", "task_index", "task_text", "task_sha256", "task_bytes", "cumulative_bytes", "chain_sha256"])("rejects changed task %s", async field => {
    const f = fixture(), task = f.data.tasks[0];
    task[field] = field === "request_id" ? sourceScope.requestId : field === "task_text" ? "{}" : field.endsWith("sha256") ? "0".repeat(64) : Number(task[field]) + 1;
    await expect(f.run()).rejects.toThrow("task differs");
  });
  it("rejects a sealed missing task, extra task and missing header", async () => {
    const missing = fixture(); missing.data.tasks.pop(); await expect(missing.run()).rejects.toThrow("seal is incomplete");
    const extra = fixture(); extra.data.tasks.push({ ...extra.data.tasks[0], task_index: extra.data.tasks.length }); await expect(extra.run()).rejects.toThrow("task differs");
    const header = fixture(); header.data.header = null; await expect(header.run()).rejects.toThrow("no header");
  });
  it("refuses unavailable rows instead of converting them to unprepared", async () => {
    const f = fixture(); f.data.error = "SYNTHETIC storage failure"; await expect(f.run()).rejects.toThrow("unavailable");
  });
  it("rejects a rehashed seal with altered task accounting", async () => {
    const f = fixture(), seal = JSON.parse(String(f.data.seal!.receipt_text)); seal.taskCount--;
    const text = JSON.stringify(seal); f.data.seal!.receipt_text = text; f.data.seal!.receipt_sha256 = sourceHash(text);
    await expect(f.run()).rejects.toThrow();
  });
});
