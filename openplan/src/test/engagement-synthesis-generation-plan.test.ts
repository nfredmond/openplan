import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { createSynthesisGenerationPlan, synthesisGenerationPlanBatch, verifySynthesisGenerationPlanState, SYNTHESIS_PLAN_BATCH_BYTES, SYNTHESIS_PLAN_BATCH_TASKS } from "@/lib/engagement/synthesis-generation-plan";
import { makeSourceSnapshot, savedSource, sourceScope, sourceHash } from "./fixtures/engagement/synthesis-source";

const saved = savedSource(makeSourceSnapshot(2));
const intent = { schemaVersion: 1, sourceId: sourceScope.requestId, sourceSha256: saved.snapshotSha256,
  connectionId: "e0000000-0000-4000-8000-000000000001", configurationRevisionId: "e0000000-0000-4000-8000-000000000002",
  configurationHash: "a".repeat(64), modelId: "synthetic", taskByteLimit: 4096 };
const request = (patch = {}) => {
  const intentText = JSON.stringify({ ...intent, ...patch });
  return { id: "f0000000-0000-4000-8000-000000000001", intentText, intentSha256: sourceHash(intentText) };
};
const plan = createSynthesisGenerationPlan(request(), saved, sourceScope);
const state = (nextIndex = 0) => ({ schemaVersion: 1, requestId: plan.header.requestId, headerText: plan.headerText,
  headerSha256: plan.headerSha256, nextIndex, taskBytes: plan.entries[nextIndex - 1]?.cumulativeBytes ?? 0,
  tailSha256: plan.entries[nextIndex - 1]?.chainSha256 ?? plan.seedSha256, cancelled: false, seal: null });
const seal = () => {
  const receiptText = JSON.stringify({ schemaVersion: 1, requestId: plan.header.requestId, headerSha256: plan.headerSha256,
    taskCount: plan.entries.length, taskBytes: plan.header.taskBytes, tailSha256: plan.header.tailSha256, sealedAt: "2026-09-30T12:00:00+00:00" });
  return { receiptText, receiptSha256: sourceHash(receiptText) };
};

describe("durable synthesis plan protocol", () => {
  it("binds every task byte in order and reconstructs every retained prefix", () => {
    expect(plan).toEqual(createSynthesisGenerationPlan(request(), saved, sourceScope));
    expect(plan.header.contributionCount).toBe(3);
    expect(plan.header.taskManifestSha256).toBe(plan.taskPlan.manifestSha256);
    expect(plan.headerSha256).toBe(sourceHash(plan.headerText));
    let tail = sourceHash(`synthesis-plan-v1:${request().id}:${request().intentSha256}:${plan.header.recipeSha256}:${plan.taskPlan.manifestSha256}`), bytes = 0;
    for (const entry of plan.entries) {
      expect(entry.previousSha256).toBe(tail);
      expect(entry.sha256).toBe(sourceHash(entry.canonical));
      expect(entry.utf8Bytes).toBe(Buffer.byteLength(entry.canonical));
      bytes += entry.utf8Bytes; tail = sourceHash(`${tail}:${entry.index}:${entry.sha256}:${entry.utf8Bytes}`);
      expect(entry.chainSha256).toBe(tail); expect(entry.cumulativeBytes).toBe(bytes);
      expect(verifySynthesisGenerationPlanState(plan, state(entry.index))).toEqual(state(entry.index));
    }
    expect(plan.header.taskBytes).toBe(bytes); expect(plan.header.tailSha256).toBe(tail);
    const complete = { ...state(plan.entries.length), seal: seal() };
    expect(verifySynthesisGenerationPlanState(plan, complete)).toEqual(complete);
    expect(verifySynthesisGenerationPlanState(plan, { ...complete, cancelled: true }).cancelled).toBe(true);
  });
  it("refuses an unrelated request or corrupted retained source", () => {
    expect(() => createSynthesisGenerationPlan({ ...request(), intentSha256: "0".repeat(64) }, saved, sourceScope)).toThrow("request checksum");
    for (const patch of [{ sourceId: request().id }, { sourceSha256: "0".repeat(64) }]) {
      expect(() => createSynthesisGenerationPlan(request(patch), saved, sourceScope)).toThrow("request source");
    }
    expect(() => createSynthesisGenerationPlan(request(), { ...saved, snapshotText: saved.snapshotText + " " }, sourceScope)).toThrow("source checksum");
    expect(() => createSynthesisGenerationPlan(request({ taskByteLimit: 4095 }), saved, sourceScope)).toThrow();
  });
  it.each([
    ["request identity", { requestId: sourceScope.requestId }], ["header bytes", { headerText: " " + plan.headerText }],
    ["header checksum", { headerSha256: "0".repeat(64) }], ["cursor beyond inventory", { nextIndex: plan.entries.length + 1 }],
    ["byte prefix", { taskBytes: 1 }], ["chain prefix", { tailSha256: "0".repeat(64) }],
    ["premature seal", { seal: seal() }],
  ])("refuses %s", (_name, patch) => {
    expect(() => verifySynthesisGenerationPlanState(plan, { ...state(), ...patch })).toThrow();
  });
  it("refuses a self-hashed seal for a different plan and a damaged receipt", () => {
    const receiptText = seal().receiptText.replace(plan.headerSha256, "b".repeat(64));
    expect(() => verifySynthesisGenerationPlanState(plan, { ...state(plan.entries.length), seal: { receiptText, receiptSha256: sourceHash(receiptText) } })).toThrow();
    expect(() => verifySynthesisGenerationPlanState(plan, { ...state(plan.entries.length), seal: { ...seal(), receiptSha256: "0".repeat(64) } })).toThrow("corrupt");
  });
  it("batches the full sequence with bounded packets and explicit completion", () => {
    let start = 0; const texts: string[] = [];
    while (start < plan.entries.length) {
      const batch = synthesisGenerationPlanBatch(plan, start)!;
      expect(batch.start).toBe(start); expect(batch.previousSha256).toBe(plan.entries[start].previousSha256);
      const rows: string[] = JSON.parse(batch.tasksText);
      expect(rows.length).toBeGreaterThan(0); expect(rows.length).toBeLessThanOrEqual(SYNTHESIS_PLAN_BATCH_TASKS);
      expect(Buffer.byteLength(batch.tasksText)).toBeLessThanOrEqual(SYNTHESIS_PLAN_BATCH_BYTES);
      texts.push(...rows); start = batch.nextIndex;
    }
    expect(texts).toEqual(plan.entries.map(entry => entry.canonical));
    expect(synthesisGenerationPlanBatch(plan, start)).toBeNull();
    for (const invalid of [-1, 0.5, start + 1]) expect(() => synthesisGenerationPlanBatch(plan, invalid)).toThrow(ZodError);
    // A large authorized task can exceed the old translation worker packet limit.
    const large = { ...plan, entries: Array.from({ length: 129 }, (_, index) => ({ ...plan.entries[0], index, canonical: "é".repeat(500_000) })) };
    const batch = synthesisGenerationPlanBatch(large, 0)!;
    expect(JSON.parse(batch.tasksText)).toHaveLength(4);
    const small = { ...large, entries: large.entries.map(entry => ({ ...entry, canonical: "{}" })) };
    expect(JSON.parse(synthesisGenerationPlanBatch(small, 0)!.tasksText)).toHaveLength(128);
    expect(() => synthesisGenerationPlanBatch({ ...large, entries: [{ ...large.entries[0], canonical: "x".repeat(SYNTHESIS_PLAN_BATCH_BYTES) }] }, 0)).toThrow("packet limit");
  });
});
