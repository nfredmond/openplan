import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { readSynthesisGenerationSelections, readSynthesisGenerationHistoricalSelections, readSynthesisContextParentSelections } from "@/lib/engagement/synthesis-generation-selections-server";
import { createSynthesisGenerationPlan } from "@/lib/engagement/synthesis-generation-plan";
import { makeSourceSnapshot, savedSource, sourceScope, sourceHash } from "./fixtures/engagement/synthesis-source";

const saved = savedSource(makeSourceSnapshot(2));
const intentText = JSON.stringify({ schemaVersion: 1, sourceId: sourceScope.requestId, sourceSha256: saved.snapshotSha256,
  connectionId: "e0000000-0000-4000-8000-000000000001", configurationRevisionId: "e0000000-0000-4000-8000-000000000002",
  configurationHash: "a".repeat(64), modelId: "synthetic", taskByteLimit: 4096 });
const request = { id: "f0000000-0000-4000-8000-000000000001", intentText, intentSha256: sourceHash(intentText) };
const actorId = "a0000000-0000-4000-8000-000000000001", grantId = "a1000000-0000-4000-8000-000000000001";
const args = { request, saved, scope: sourceScope, actorId };
const plan = createSynthesisGenerationPlan(request, saved, sourceScope);
const identity = (prefix: string, index: number) => `${prefix}-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
function receipt(index = 0, patch = {}) {
  const receiptText = JSON.stringify({ schemaVersion: 1, id: identity("a4000000", index), requestId: request.id, taskIndex: index,
    attemptId: identity("a2000000", index), previousSelectionId: null, sequence: index + 1, actorId, origin: "authorization", authorizationId: grantId,
    reason: "SYNTHETIC initial choice", selectedAt: "2026-09-30T00:00:00Z", ...patch });
  return { receiptText, receiptSha256: sourceHash(receiptText) };
}
const page = (patch = {}) => ({ schemaVersion: 1, requestId: request.id, throughSequence: 2, afterTaskIndex: -1,
  hasMore: false, entries: [receipt(0), receipt(1)], ...patch });
function fixture(pages: unknown[] = [page()], error: unknown = null) {
  const abortSignal = vi.fn().mockReturnThis(); let index = 0;
  const rpc = vi.fn(() => Object.assign(Promise.resolve({ data: pages[index++], error }), { abortSignal }));
  return { service: { rpc } as unknown as Pick<SupabaseClient, "rpc">, rpc, abortSignal };
}
describe("retained synthesis selection inventory", () => {
  const childId = "f0000000-0000-4000-8000-000000000010";
  it("reads the context parent's fixed snapshot through child authority across pages", async () => {
    const f = fixture([page({ entries: [receipt(0)], hasMore: true }), page({ afterTaskIndex: 0, entries: [receipt(1)] })]);
    const result = await readSynthesisContextParentSelections(f.service, childId, { ...args, throughSequence: 2 });
    expect(result.requestId).toBe(request.id); expect(result.throughSequence).toBe(2);
    expect(result.entries.map(entry => entry.receipt.actorId)).toEqual([actorId, actorId]);
    expect(result.entries.map(entry => entry.receiptText)).toEqual([receipt(0).receiptText, receipt(1).receiptText]);
    expect(f.rpc.mock.calls).toEqual([
      ["read_engagement_synthesis_context_parent_selections", { p_request: childId, p_after_task_index: -1, p_limit: 128 }],
      ["read_engagement_synthesis_context_parent_selections", { p_request: childId, p_after_task_index: 0, p_limit: 128 }],
    ]);
    expect(f.abortSignal).toHaveBeenCalledTimes(2);
  });
  it("refuses an invalid child identity before reading parent selections", async () => {
    const f = fixture();
    await expect(readSynthesisContextParentSelections(f.service, "invalid", args)).rejects.toThrow();
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it.each([{ requestId: childId }, { throughSequence: 3 }])("rejects a different context parent snapshot %j", async patch => {
    const f = fixture([page(patch)]);
    await expect(readSynthesisContextParentSelections(f.service, childId, { ...args, throughSequence: 2 })).rejects.toThrow("selections differ");
  });
  it("keeps context parent access failure and interruption unavailable", async () => {
    const denied = fixture([page()], { code: "42501" });
    await expect(readSynthesisContextParentSelections(denied.service, childId, args)).rejects.toThrow("inventory unavailable");
    const aborted = fixture();
    await expect(readSynthesisContextParentSelections(aborted.service, childId, args, AbortSignal.abort())).rejects.toMatchObject({ name: "AbortError" });
    expect(aborted.rpc).not.toHaveBeenCalled();
  });
  it("replays an explicit earlier sequence instead of reading current choices", async () => {
    const f = fixture([page({ throughSequence: 1, entries: [receipt(0)] })]);
    const result = await readSynthesisGenerationSelections(f.service, { ...args, throughSequence: 1 });
    expect(result.throughSequence).toBe(1); expect(result.entries).toHaveLength(1);
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("read_engagement_synthesis_generation_selections", {
      p_request: request.id, p_through_sequence: 1, p_after_task_index: -1, p_limit: 128,
    });
    await expect(readSynthesisGenerationSelections(fixture().service, { ...args, throughSequence: 1 })).rejects.toThrow("selections differ");
  });
  it("preserves explicit sequence zero and rejects invalid saved sequence values before querying", async () => {
    const f = fixture([page({ throughSequence: 0, entries: [] })]);
    expect((await readSynthesisGenerationSelections(f.service, { ...args, throughSequence: 0 })).entries).toEqual([]);
    expect(f.rpc).toHaveBeenCalledWith("read_engagement_synthesis_generation_selections", expect.objectContaining({ p_through_sequence: 0 }));
    for (const throughSequence of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN]) {
      const invalid = fixture(); await expect(readSynthesisGenerationSelections(invalid.service, { ...args, throughSequence })).rejects.toThrow();
      expect(invalid.rpc).not.toHaveBeenCalled();
    }
  });
  it("uses the authenticated history command and retains original receipt actors", async () => {
    const f = fixture(); const result = await readSynthesisGenerationHistoricalSelections(f.service, { ...args, throughSequence: 2 });
    expect(result.entries.every(entry => entry.receipt.actorId === actorId)).toBe(true);
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("read_engagement_synthesis_generation_selection_history", {
      p_campaign: sourceScope.campaignId, p_request: request.id, p_through_sequence: 2, p_after_task_index: -1, p_limit: 128,
    });
  });
  it("uses explicit receipt choices and preserves an anchored cursor across pages", async () => {
    const f = fixture([page({ entries: [receipt(0)], hasMore: true }), page({ afterTaskIndex: 0, entries: [receipt(1)] })]);
    const result = await readSynthesisGenerationSelections(f.service, args);
    expect(result.plan).toEqual(plan); expect(result.throughSequence).toBe(2);
    expect(result.entries.map(({ receiptText, receiptSha256 }) => ({ receiptText, receiptSha256 }))).toEqual([receipt(0), receipt(1)]);
    expect(result.selections).toEqual([0, 1].map(index => ({ taskSha256: plan.entries[index].sha256, attemptId: identity("a2000000", index) })));
    expect(f.rpc.mock.calls).toEqual([
      ["read_engagement_synthesis_generation_selections", { p_request: request.id, p_through_sequence: null, p_after_task_index: -1, p_limit: 128 }],
      ["read_engagement_synthesis_generation_selections", { p_request: request.id, p_through_sequence: 2, p_after_task_index: 0, p_limit: 128 }],
    ]);
    expect(f.abortSignal).toHaveBeenCalledTimes(2);
  });
  it("keeps cleared tasks in the complete source plan", async () => {
    const f = fixture([page({ throughSequence: 3, entries: [receipt(0), receipt(1, {
      origin: "staff", authorizationId: null, previousSelectionId: identity("a4000000", 99), sequence: 3, attemptId: null,
    })] })]);
    const result = await readSynthesisGenerationSelections(f.service, args);
    expect(result.selections).toEqual([{ taskSha256: plan.entries[0].sha256, attemptId: identity("a2000000", 0) }]);
    expect(result.plan.header).toEqual(plan.header); expect(result.entries[1].receipt.attemptId).toBeNull();
  });
  it("allows a genuinely empty historical selection inventory", async () => {
    const f = fixture([page({ throughSequence: 0, entries: [] })]);
    const result = await readSynthesisGenerationSelections(f.service, args);
    expect(result.selections).toEqual([]); expect(result.plan.header.contributionCount).toBeGreaterThan(0);
  });
  it.each([
    { requestId: grantId }, { afterTaskIndex: 0 }, { hasMore: true, entries: [] }, { entries: [] }, { extra: true }, { schemaVersion: 2 },
  ])("refuses an inconsistent page %j", async patch => {
    await expect(readSynthesisGenerationSelections(fixture([page(patch)]).service, args)).rejects.toThrow();
  });
  it("refuses a revision change between pages", async () => {
    const f = fixture([page({ entries: [receipt(0)], hasMore: true }), page({ throughSequence: 3, afterTaskIndex: 0, entries: [receipt(1)] })]);
    await expect(readSynthesisGenerationSelections(f.service, args)).rejects.toThrow("selections differ");
  });
  it("refuses an empty continuing page before another query", async () => {
    const f = fixture([page({ entries: [], hasMore: true })]);
    await expect(readSynthesisGenerationSelections(f.service, args)).rejects.toThrow("selections differ");
    expect(f.rpc).toHaveBeenCalledOnce();
  });
  it("refuses an unknown cleared task even when no attempt needs mapping", async () => {
    const f = fixture([page({ entries: [receipt(0, { taskIndex: plan.entries.length, origin: "staff", authorizationId: null, attemptId: null })] })]);
    await expect(readSynthesisGenerationSelections(f.service, args)).rejects.toThrow("selections differ");
  });
  it.each([
    { requestId: grantId }, { actorId: grantId }, { taskIndex: plan.entries.length }, { sequence: 3 },
    { origin: "authorization", authorizationId: null }, { previousSelectionId: grantId }, { attemptId: null },
    { origin: "staff", authorizationId: grantId }, { reason: " " }, { extra: true },
  ])("refuses a foreign or inconsistent receipt %j", async patch => {
    await expect(readSynthesisGenerationSelections(fixture([page({ entries: [receipt(0, patch)] })]).service, args)).rejects.toThrow();
  });
  it.each([
    { taskIndex: 0 }, { id: identity("a4000000", 0) }, { sequence: 1 }, { attemptId: identity("a2000000", 0) },
  ])("refuses duplicate task, receipt, sequence or attempt %j", async patch => {
    const f = fixture([page({ entries: [receipt(0), receipt(1, patch)] })]);
    await expect(readSynthesisGenerationSelections(f.service, args)).rejects.toThrow("selections differ");
  });
  it("refuses corrupted bytes and UTF8-oversized receipts without changing them", async () => {
    const raw = receipt(0), corrupted = { ...raw, receiptText: " " + raw.receiptText };
    await expect(readSynthesisGenerationSelections(fixture([page({ entries: [corrupted] })]).service, args)).rejects.toThrow("selections differ");
    const text = " ".repeat(24000) + receipt(0, { reason: "漢".repeat(4000) }).receiptText;
    expect(text.length).toBeLessThan(32768); expect(Buffer.byteLength(text)).toBeGreaterThan(32768);
    await expect(readSynthesisGenerationSelections(fixture([page({ entries: [{ receiptText: text, receiptSha256: sourceHash(text) }] })]).service, args)).rejects.toThrow("selections differ");
  });
  it("does not return a partial inventory after a database failure", async () => {
    const f = fixture([page()], { code: "42501", message: "SYNTHETIC private detail" });
    await expect(readSynthesisGenerationSelections(f.service, args)).rejects.toThrow("inventory unavailable");
  });
  it("stops between pages when the caller aborts", async () => {
    const controller = new AbortController();
    const f = fixture([page({ entries: [receipt(0)], hasMore: true }), page({ afterTaskIndex: 0, entries: [receipt(1)] })]);
    f.abortSignal.mockImplementationOnce(function (this: unknown) { controller.abort(); return this; });
    await expect(readSynthesisGenerationSelections(f.service, args, controller.signal)).rejects.toThrow();
    expect(f.rpc).toHaveBeenCalledOnce();
  });
  it("refuses a page above its declared task limit even when every entry is otherwise valid", async () => {
    const largeSaved = savedSource(makeSourceSnapshot(140));
    const largeIntentText = JSON.stringify({ ...JSON.parse(intentText), sourceSha256: largeSaved.snapshotSha256 });
    const largeRequest = { ...request, intentText: largeIntentText, intentSha256: sourceHash(largeIntentText) };
    expect(createSynthesisGenerationPlan(largeRequest, largeSaved, sourceScope).entries.length).toBeGreaterThan(128);
    const f = fixture([page({ throughSequence: 129, entries: Array.from({ length: 129 }, (_, index) => receipt(index)) })]);
    await expect(readSynthesisGenerationSelections(f.service, { ...args, request: largeRequest, saved: largeSaved })).rejects.toThrow();
  });
  it("refuses a changed source or aborted operation before reading native selections", async () => {
    const f = fixture();
    await expect(readSynthesisGenerationSelections(f.service, { ...args, request: { ...request, intentSha256: "b".repeat(64) } })).rejects.toThrow();
    await expect(readSynthesisGenerationSelections(f.service, args, AbortSignal.abort())).rejects.toThrow();
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("honors an abort before reconstructing even a changed source", async () => {
    const f = fixture();
    await expect(readSynthesisGenerationSelections(f.service, { ...args, request: { ...request, intentSha256: "b".repeat(64) } },
      AbortSignal.abort(new Error("SYNTHETIC stop before reconstruction")))).rejects.toThrow("SYNTHETIC stop before reconstruction");
    expect(f.rpc).not.toHaveBeenCalled();
  });
});
