import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSynthesisContextStagingPlan, synthesisContextFrameBatch, verifySynthesisContextPlanState } from "@/lib/engagement/synthesis-context-plan";
import { retainSynthesisContextPlan } from "@/lib/engagement/synthesis-context-plan-server";
import { contextInputFixture } from "./fixtures/engagement/synthesis-context";
import { sourceHash } from "./fixtures/engagement/synthesis-source";

function fixture() {
  const f = contextInputFixture(), args: Parameters<typeof createSynthesisContextStagingPlan> = [f.request, f.scope, f.args];
  const plan = createSynthesisContextStagingPlan(...args);
  const initial = { schemaVersion: 1 as const, requestId: plan.header.requestId, headerText: plan.headerText,
    headerSha256: plan.headerSha256, nextIndex: 0, frameBytes: 0, tailSha256: plan.seedSha256, cancelled: false,
    seal: null as null | { receiptText: string; receiptSha256: string } };
  const prefix = (count: number) => ({ ...initial, nextIndex: count,
    frameBytes: plan.entries[count - 1]?.cumulativeBytes ?? 0, tailSha256: plan.entries[count - 1]?.chainSha256 ?? plan.seedSha256 });
  const sealed = () => {
    const receiptText = JSON.stringify({ schemaVersion: 1, requestId: plan.header.requestId, headerSha256: plan.headerSha256,
      frameCount: plan.entries.length, frameBytes: plan.header.frameBytes, tailSha256: plan.header.tailSha256,
      sealedAt: "2026-09-30T00:00:00Z" });
    return { ...prefix(plan.entries.length), seal: { receiptText, receiptSha256: sourceHash(receiptText) } };
  };
  return { f, args, plan, initial, prefix, sealed };
}

describe("context native staging protocol", () => {
  it("chains every original frame under a separate staging header", () => {
    const { f, plan } = fixture();
    expect(plan.header).toMatchObject({ purpose: "private_synthesis_context_frame_plan", requestId: f.scope.requestId,
      schemaVersion: 1, actorId: f.request.request.actorId, intentSha256: f.request.request.intentSha256,
      recipeId: plan.continuation.header.recipeId, recipeSha256: plan.continuation.header.recipeSha256,
      contextRequestSha256: f.request.context.contextSha256,
      continuationHeaderSha256: plan.continuation.headerSha256, contentManifestSha256: f.content.manifestSha256,
      contextManifestSha256: f.f.context.manifestSha256, targetRecordId: f.content.targetRecordId,
      frameByteLimit: f.content.frameByteLimit, frameCount: f.content.frames.length });
    let tail = sourceHash(`synthesis-context-frames-v1:${f.scope.requestId}:${plan.continuation.headerSha256}:${f.request.context.contextSha256}`), bytes = 0;
    expect(plan.seedSha256).toBe(tail);
    for (const [index, frame] of plan.entries.entries()) {
      expect(frame.previousSha256).toBe(tail); expect(frame.canonical).toBe(f.content.frames[index].canonical);
      bytes += Buffer.byteLength(frame.canonical, "utf8");
      tail = sourceHash(`${tail}:${index}:${sourceHash(frame.canonical)}:${Buffer.byteLength(frame.canonical, "utf8")}`);
      expect(frame.cumulativeBytes).toBe(bytes); expect(frame.chainSha256).toBe(tail);
    }
    expect(plan.header.frameBytes).toBe(bytes); expect(plan.header.tailSha256).toBe(tail);
    expect(JSON.parse(plan.headerText)).toEqual(plan.header);
    expect(plan.headerSha256).toBe(sourceHash(plan.headerText));
  });

  it("checks partial cursors and exact complete seals", () => {
    const f = fixture(); expect(verifySynthesisContextPlanState(f.plan, f.initial)).toEqual(f.initial);
    expect(verifySynthesisContextPlanState(f.plan, f.prefix(1))).toEqual(f.prefix(1));
    expect(verifySynthesisContextPlanState(f.plan, f.sealed())).toEqual(f.sealed());
    for (const patch of [{ schemaVersion: 2 }, { extra: true }, { cancelled: "false" }, { requestId: f.f.scope.workspaceId }, { headerText: f.plan.headerText + " " }, { headerSha256: "0".repeat(64) },
      { nextIndex: f.plan.entries.length + 1 }, { nextIndex: -1 }, { frameBytes: 1 }, { tailSha256: "0".repeat(64) }]) {
      expect(() => verifySynthesisContextPlanState(f.plan, { ...f.initial, ...patch })).toThrow();
    }
    expect(() => verifySynthesisContextPlanState(f.plan, { ...f.initial, seal: f.sealed().seal })).toThrow("incomplete or corrupt");
    const corrupt = f.sealed(); corrupt.seal.receiptSha256 = "0".repeat(64);
    expect(() => verifySynthesisContextPlanState(f.plan, corrupt)).toThrow("incomplete or corrupt");
    for (const patch of [{ schemaVersion: 2 }, { requestId: f.f.scope.workspaceId }, { headerSha256: "0".repeat(64) }, { frameCount: 0 },
      { frameBytes: 0 }, { tailSha256: "0".repeat(64) }, { sealedAt: "invalid" }, { extra: true }]) {
      const state = f.sealed(), receiptText = JSON.stringify({ ...JSON.parse(state.seal.receiptText), ...patch });
      state.seal = { receiptText, receiptSha256: sourceHash(receiptText) };
      expect(() => verifySynthesisContextPlanState(f.plan, state)).toThrow();
    }
  });

  it("bounds complete encoded batches by count and escaped UTF-8 bytes", () => {
    const { plan } = fixture(), first = synthesisContextFrameBatch(plan, 0)!;
    expect(JSON.parse(first.framesText)).toEqual(plan.entries.slice(0, first.nextIndex).map(frame => frame.canonical));
    expect(first.previousSha256).toBe(plan.seedSha256);
    expect(synthesisContextFrameBatch(plan, plan.entries.length)).toBeNull();
    for (const start of [-1, 0.5, plan.entries.length + 1]) expect(() => synthesisContextFrameBatch(plan, start)).toThrow();
    // These packets isolate transport sizing, not source reconstruction or native acceptance.
    const many = { ...plan, entries: Array.from({ length: 129 }, (_, index) => ({ ...plan.entries[0], index })) };
    expect(synthesisContextFrameBatch(many, 0)!.nextIndex).toBe(128);
    const canonical = JSON.stringify({ text: '"😀'.repeat(160_000) });
    const large = { ...plan, entries: Array.from({ length: 5 }, (_, index) => ({ ...plan.entries[0], index, canonical })) };
    const batch = synthesisContextFrameBatch(large, 0)!;
    expect(Buffer.byteLength(batch.framesText)).toBeLessThanOrEqual(4_194_304); expect(batch.nextIndex).toBeLessThan(5);
    expect(Buffer.byteLength(JSON.stringify(large.entries.slice(0, batch.nextIndex + 1).map(frame => frame.canonical)))).toBeGreaterThan(4_194_304);
    const oversized = { ...plan, entries: [{ ...plan.entries[0], canonical: '"'.repeat(4_194_304) }] };
    expect(() => synthesisContextFrameBatch(oversized, 0)).toThrow("packet limit");
  });
});

function transport() {
  const f = fixture(), controller = new AbortController(); let stored = f.initial;
  const options = { loseAt: "", abortAt: "", noProgress: false, noSeal: false, cancelled: false };
  const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
    // A missing progress guard must fail promptly instead of hanging the suite.
    if (rpc.mock.calls.length > 20) throw new Error("Synthetic transport call budget exceeded");
    let error: { code: string } | null = null;
    if (name === "prepare_engagement_synthesis_context_plan") {
      expect(args).toEqual({ p_request: f.plan.header.requestId, p_header_text: f.plan.headerText }); stored.cancelled = options.cancelled;
    } else if (name === "stage_engagement_synthesis_context_frames") {
      const batch = synthesisContextFrameBatch(f.plan, stored.nextIndex)!;
      expect(args).toEqual({ p_request: f.plan.header.requestId, p_start: batch.start, p_previous_sha256: batch.previousSha256, p_frames_text: batch.framesText });
      if (!options.noProgress) stored = f.prefix(batch.nextIndex);
    } else if (name === "seal_engagement_synthesis_context_plan") {
      expect(args).toEqual({ p_request: f.plan.header.requestId, p_header_sha256: f.plan.headerSha256 });
      if (!options.noSeal) stored = f.sealed();
    } else throw new Error(`Unexpected native context RPC ${name}`);
    if (name === options.loseAt) { error = { code: "SYNTHETIC_LOST_ACK" }; options.loseAt = ""; }
    if (name === options.abortAt) controller.abort();
    const result = Promise.resolve({ data: error ? null : structuredClone(stored), error });
    return Object.assign(result, { abortSignal(signal: AbortSignal) { expect(signal).toBeInstanceOf(AbortSignal); return result; } });
  });
  const service = { rpc } as unknown as Pick<SupabaseClient, "rpc">;
  return { ...f, options, rpc, controller, stored: () => structuredClone(stored), run: () => retainSynthesisContextPlan(service, f.args, controller.signal) };
}
describe("resumable context staging driver", () => {
  it.each(["prepare_engagement_synthesis_context_plan", "stage_engagement_synthesis_context_frames", "seal_engagement_synthesis_context_plan"])("recovers saved %s after a lost acknowledgement", async name => {
    const f = transport(); f.options.loseAt = name;
    await expect(f.run()).rejects.toThrow("acknowledgement unavailable");
    const calls = f.rpc.mock.calls.length; expect(f.rpc.mock.calls.at(-1)![0]).toBe(name);
    const resumed = await f.run(); expect(resumed.state.seal).not.toBeNull();
    expect(f.rpc.mock.calls[calls][0]).toBe("prepare_engagement_synthesis_context_plan");
    if (name !== "prepare_engagement_synthesis_context_plan") expect(f.rpc.mock.calls.slice(calls).some(([rpc]) => rpc === "stage_engagement_synthesis_context_frames")).toBe(false);
    expect(await f.run()).toEqual(resumed);
  });
  it("stops on cancellation, interrupted acknowledgements and missing progress", async () => {
    const cancelled = transport(); cancelled.options.cancelled = true;
    expect((await cancelled.run()).state.cancelled).toBe(true); expect(cancelled.rpc).toHaveBeenCalledTimes(1);
    const aborted = transport(); aborted.controller.abort(); await expect(aborted.run()).rejects.toThrow(); expect(aborted.rpc).not.toHaveBeenCalled();
    for (const name of ["prepare_engagement_synthesis_context_plan", "stage_engagement_synthesis_context_frames", "seal_engagement_synthesis_context_plan"]) {
      const f = transport(); f.options.abortAt = name; await expect(f.run()).rejects.toThrow(); expect(f.rpc.mock.calls.at(-1)![0]).toBe(name);
    }
    const stuck = transport(); stuck.options.noProgress = true; await expect(stuck.run()).rejects.toThrow("did not retain");
    const noSeal = transport(); noSeal.options.noSeal = true; await expect(noSeal.run()).rejects.toThrow("completion receipt is missing");
  });
});
