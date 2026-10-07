import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSynthesisGenerationPlan } from "@/lib/engagement/synthesis-generation-plan";
import { retainSynthesisGenerationPlan } from "@/lib/engagement/synthesis-generation-plan-server";
import { makeSourceSnapshot, savedSource, sourceScope, sourceHash } from "./fixtures/engagement/synthesis-source";

const saved = savedSource(makeSourceSnapshot(50));
const intentText = JSON.stringify({ schemaVersion: 1, sourceId: sourceScope.requestId, sourceSha256: saved.snapshotSha256,
  connectionId: "e0000000-0000-4000-8000-000000000001", configurationRevisionId: "e0000000-0000-4000-8000-000000000002",
  configurationHash: "a".repeat(64), modelId: "synthetic", taskByteLimit: 4096 });
const request = { id: "f0000000-0000-4000-8000-000000000001", intentText, intentSha256: sourceHash(intentText) };
const plan = createSynthesisGenerationPlan(request, saved, sourceScope);
function fixture() {
  let next = 0;
  let seal: { receiptText: string; receiptSha256: string } | null = null;
  let cancelled = false;
  const state = () => ({ schemaVersion: 1, requestId: request.id, headerText: plan.headerText, headerSha256: plan.headerSha256,
    nextIndex: next, taskBytes: plan.entries[next - 1]?.cumulativeBytes ?? 0, tailSha256: plan.entries[next - 1]?.chainSha256 ?? plan.seedSha256, cancelled, seal });
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    expect(args.p_request).toBe(request.id);
    if (name === "prepare_engagement_synthesis_generation_plan") {
      expect(args).toEqual({ p_request: request.id, p_header_text: plan.headerText });
    } else if (name === "stage_engagement_synthesis_generation_tasks") {
      expect(args).toEqual({ p_request: request.id, p_start: next, p_previous_sha256: state().tailSha256, p_tasks_text: expect.any(String) });
      const texts = JSON.parse(args.p_tasks_text as string) as string[];
      expect(texts).toEqual(plan.entries.slice(next, next + texts.length).map(entry => entry.canonical));
      next += texts.length;
    } else if (name === "seal_engagement_synthesis_generation_plan") {
      expect(args).toEqual({ p_request: request.id, p_header_sha256: plan.headerSha256 });
      expect(next).toBe(plan.entries.length);
      const receiptText = JSON.stringify({ schemaVersion: 1, requestId: request.id, headerSha256: plan.headerSha256,
        taskCount: next, taskBytes: plan.header.taskBytes, tailSha256: plan.header.tailSha256, sealedAt: "2026-09-30T12:00:00Z" });
      seal = { receiptText, receiptSha256: sourceHash(receiptText) };
    } else throw new Error(`Unexpected RPC ${name}`);
    return { data: state(), error: null as { message: string } | null };
  });
  const signals: AbortSignal[] = [];
  const service = { rpc: (name: string, args: Record<string, unknown>) => {
    const response = rpc(name, args);
    return Object.assign(response, { abortSignal: (signal: AbortSignal) => { signals.push(signal); return response; } });
  } } as unknown as Pick<SupabaseClient, "rpc">;
  return { rpc, state, service, signals, cancel: () => { cancelled = true; } };
}
describe("synthesis plan staging driver", () => {
  afterEach(() => vi.restoreAllMocks());
  it("stages exact packets and reopens the same completion without repeating work", async () => {
    const f = fixture();
    const result = await retainSynthesisGenerationPlan(f.service, request, saved, sourceScope);
    expect(result.state.seal).not.toBeNull();
    expect(f.rpc.mock.calls.filter(([name]) => name === "stage_engagement_synthesis_generation_tasks").length).toBeGreaterThan(1);
    f.rpc.mockClear();
    expect(await retainSynthesisGenerationPlan(f.service, request, saved, sourceScope)).toEqual(result);
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it("stops on an unknown acknowledgement and resumes from the retained prefix", async () => {
    const f = fixture(), actual = f.rpc.getMockImplementation()!;
    f.rpc.mockImplementation(async (name, args) => {
      const result = await actual(name, args);
      if (name === "stage_engagement_synthesis_generation_tasks") return { data: result.data, error: { message: "SYNTHETIC response lost" } };
      return result;
    });
    await expect(retainSynthesisGenerationPlan(f.service, request, saved, sourceScope)).rejects.toThrow("acknowledgement unavailable");
    const next = f.state().nextIndex;
    expect(next).toBeGreaterThan(0); expect(next).toBeLessThan(plan.entries.length);
    expect(f.rpc).toHaveBeenCalledTimes(2);
    f.rpc.mockImplementation(actual); f.rpc.mockClear();
    expect((await retainSynthesisGenerationPlan(f.service, request, saved, sourceScope)).state.seal).not.toBeNull();
    expect(f.rpc.mock.calls[1][1].p_start).toBe(next);
  });
  it("returns cancellation without staging or sealing new work", async () => {
    const f = fixture(); f.cancel();
    expect((await retainSynthesisGenerationPlan(f.service, request, saved, sourceScope)).state.cancelled).toBe(true);
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it("stops when cancellation arrives with a retained batch acknowledgement", async () => {
    const f = fixture(), actual = f.rpc.getMockImplementation()!;
    f.rpc.mockImplementation(async (name, args) => {
      if (name === "stage_engagement_synthesis_generation_tasks") f.cancel();
      return actual(name, args);
    });
    expect((await retainSynthesisGenerationPlan(f.service, request, saved, sourceScope)).state.cancelled).toBe(true);
    expect(f.rpc).toHaveBeenCalledTimes(2);
  });
  it("refuses a corrupt or stalled cursor and a missing completion receipt", async () => {
    for (const defect of ["header", "stalled", "seal"]) {
      const f = fixture(), actual = f.rpc.getMockImplementation()!;
      f.rpc.mockImplementation(async (name, args) => {
        if (defect === "stalled" && f.rpc.mock.calls.length > 3) throw new Error("SYNTHETIC repeated stalled batch");
        if (name === "stage_engagement_synthesis_generation_tasks" && defect === "stalled" || name === "seal_engagement_synthesis_generation_plan" && defect === "seal") return { data: f.state(), error: null };
        const result = await actual(name, args);
        if (defect === "header") result.data.headerSha256 = "0".repeat(64);
        return result;
      });
      await expect(retainSynthesisGenerationPlan(f.service, request, saved, sourceScope)).rejects.toThrow(
        defect === "header" ? "Retained synthesis plan differs" : defect === "stalled" ? "did not retain" : "completion receipt is missing",
      );
    }
  });
  it("honors worker interruption before starting or sending another batch", async () => {
    const f = fixture(), controller = new AbortController(); controller.abort(new Error("SYNTHETIC worker stopped"));
    await expect(retainSynthesisGenerationPlan(f.service, request, saved, sourceScope, controller.signal)).rejects.toThrow("worker stopped");
    expect(f.rpc).not.toHaveBeenCalled();
    const later = new AbortController(), actual = f.rpc.getMockImplementation()!;
    f.rpc.mockImplementation(async (name, args) => { const result = await actual(name, args); later.abort(new Error("SYNTHETIC stop before next packet")); return result; });
    await expect(retainSynthesisGenerationPlan(f.service, request, saved, sourceScope, later.signal)).rejects.toThrow("stop before next packet");
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])("passes a fresh ten-second deadline to every RPC, worker signal %s", async workerSignal => {
    const deadlines: AbortController[] = [];
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      const controller = new AbortController(); deadlines.push(controller); return controller.signal;
    });
    const f = fixture(), worker = new AbortController();
    await retainSynthesisGenerationPlan(f.service, request, saved, sourceScope, workerSignal ? worker.signal : undefined);
    expect(f.signals).toHaveLength(f.rpc.mock.calls.length);
    expect(timeout.mock.calls).toEqual(f.rpc.mock.calls.map(() => [10000]));
    expect(new Set(f.signals).size).toBe(f.signals.length);
    deadlines[0].abort(new Error("SYNTHETIC first deadline"));
    expect(f.signals[0].aborted).toBe(true);
    expect(f.signals.slice(1).every(signal => !signal.aborted)).toBe(true);
    if (workerSignal) {
      worker.abort(new Error("SYNTHETIC worker stop"));
      expect(f.signals.every(signal => signal.aborted)).toBe(true);
    }
  });
  it.each(["cancelled preparation", "seal"])("refuses a late %s acknowledgement after worker stop", async boundary => {
    const f = fixture(), worker = new AbortController(), actual = f.rpc.getMockImplementation()!;
    f.rpc.mockImplementation(async (name, args) => {
      const final = boundary === "cancelled preparation" ? name === "prepare_engagement_synthesis_generation_plan" : name === "seal_engagement_synthesis_generation_plan";
      if (final && boundary === "cancelled preparation") f.cancel();
      const response = await actual(name, args);
      if (final) worker.abort(new Error("SYNTHETIC stop before acknowledgement"));
      return response;
    });
    await expect(retainSynthesisGenerationPlan(f.service, request, saved, sourceScope, worker.signal)).rejects.toThrow("stop before acknowledgement");
    expect(f.signals.at(-1)?.aborted).toBe(true);
    if (boundary === "cancelled preparation") expect(f.rpc).toHaveBeenCalledTimes(1);
    else {
      expect(f.state().seal).not.toBeNull();
      f.rpc.mockImplementation(actual); f.rpc.mockClear();
      expect((await retainSynthesisGenerationPlan(f.service, request, saved, sourceScope)).state.seal).not.toBeNull();
      expect(f.rpc).toHaveBeenCalledTimes(1);
    }
  });
  it("refuses a late seal after its deadline even without a worker signal", async () => {
    const deadlines: AbortController[] = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      const controller = new AbortController(); deadlines.push(controller); return controller.signal;
    });
    const f = fixture(), actual = f.rpc.getMockImplementation()!;
    f.rpc.mockImplementation(async (name, args) => {
      const response = await actual(name, args);
      if (name === "seal_engagement_synthesis_generation_plan") deadlines.at(-1)!.abort(new Error("SYNTHETIC deadline passed"));
      return response;
    });
    await expect(retainSynthesisGenerationPlan(f.service, request, saved, sourceScope)).rejects.toThrow("deadline passed");
    expect(f.state().seal).not.toBeNull();
  });

});
