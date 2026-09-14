import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applySynthesisReviewChange, createSynthesisReviewContent, type SynthesisReviewIntent } from "@/lib/engagement/synthesis-review";
import { loadSynthesisReview, retainSynthesisReview } from "@/lib/engagement/synthesis-review-server";
import type { SynthesisReviewRecord } from "@/lib/engagement/synthesis-review-records";
import { makeSourceSnapshot, savedSource, sourceActor, sourceDate, sourceHash, sourceScope } from "./fixtures/engagement/synthesis-source";

const reviewId = "e0000000-0000-4000-8000-000000000001", correctionId = "e0000000-0000-4000-8000-000000000002";
const scope = { campaignId: sourceScope.campaignId, workspaceId: sourceScope.workspaceId, reviewId };
const snapshot = makeSourceSnapshot(), source = savedSource(snapshot), initial = createSynthesisReviewContent(snapshot, source.snapshotSha256);
const create: SynthesisReviewIntent = { operation: "create", requestId: reviewId, actorId: sourceActor, workspaceId: scope.workspaceId, sourceId: source.requestId, sourceSha256: source.snapshotSha256 };
function original(): SynthesisReviewRecord {
  const preparationText = JSON.stringify(initial.preparation), contentText = JSON.stringify(initial.content);
  return { ...scope, sourceId: source.requestId, sourceSha256: source.snapshotSha256, preparationText, preparationSha256: sourceHash(preparationText),
    createdAt: sourceDate, createdBy: sourceActor, currentRevisionId: reviewId,
    revision: { requestId: reviewId, revisionNo: 1, parentId: null, parentSha256: null, actorId: sourceActor, reason: null, intent: create, contentText, contentSha256: sourceHash(contentText), createdAt: sourceDate } };
}
function correction(): SynthesisReviewRecord {
  const first = original();
  const intent: SynthesisReviewIntent = { operation: "correct", requestId: correctionId, actorId: sourceActor, workspaceId: scope.workspaceId, reviewId,
    expectedRevisionId: reviewId, expectedRevisionSha256: first.revision.contentSha256, reason: "SYNTHETIC reason for correction",
    change: { kind: "notes", title: "SYNTHETIC revised title", notes: "SYNTHETIC full é note ".repeat(80) + "END OF NOTE" } };
  const contentText = JSON.stringify(applySynthesisReviewChange(initial.content, intent.change, snapshot, source.snapshotSha256));
  return { ...first, currentRevisionId: correctionId, revision: { requestId: correctionId, revisionNo: 2, parentId: reviewId,
    parentSha256: first.revision.contentSha256, actorId: sourceActor, reason: intent.reason, intent, contentText, contentSha256: sourceHash(contentText), createdAt: sourceDate } };
}
const rpc = vi.fn(), persist = vi.fn();
const client = { rpc } as unknown as Pick<SupabaseClient, "rpc">, service = { rpc: persist } as unknown as Pick<SupabaseClient, "rpc">;
let records: Map<string, SynthesisReviewRecord>;
let head: string;
beforeEach(() => {
  records = new Map(); head = reviewId; rpc.mockReset(); persist.mockReset();
  rpc.mockImplementation(async (name: string, args: Record<string, string | null>) => {
    if (name === "read_engagement_synthesis_sources") return { data: source, error: null };
    if (name !== "read_engagement_synthesis_review") throw new Error("Unexpected RPC");
    return { data: records.get(args.p_revision ?? head) ?? null, error: null };
  });
  persist.mockImplementation(async (_name: string, args: { p_intent: SynthesisReviewIntent; p_content_text: string; p_preparation_text: string | null }) => ({
    data: { ...scope, requestId: args.p_intent.requestId, sourceId: source.requestId, sourceSha256: source.snapshotSha256,
      preparationSha256: original().preparationSha256, revisionNo: args.p_intent.operation === "create" ? 1 : 2,
      revisionSha256: sourceHash(args.p_content_text), createdAt: sourceDate, replayed: false }, error: null,
  }));
});
function seed() { records.set(reviewId, original()); records.set(correctionId, correction()); head = correctionId; }
describe("retained review server custody", () => {
  it("reads a complete original and replays reasoned corrections without rewriting historical bytes", async () => {
    seed(); const before = JSON.stringify([...records]);
    const saved = await loadSynthesisReview(client, scope);
    expect(saved?.content.notes.endsWith("END OF NOTE")).toBe(true);
    expect(saved?.content.assignedSourceCount).toBe(302); expect(saved?.source.snapshot.items[300].body).toContain("FINAL SOURCE TAIL");
    expect(saved?.preparation).toEqual(initial.preparation);
    const old = await loadSynthesisReview(client, { ...scope, revisionId: reviewId });
    expect(old?.content).toEqual(initial.content); expect(JSON.stringify([...records])).toBe(before);
    expect(rpc).toHaveBeenCalledWith("read_engagement_synthesis_review", { p_campaign: scope.campaignId, p_review: reviewId, p_revision: null });
    expect(rpc).toHaveBeenCalledWith("read_engagement_synthesis_sources", { p_campaign: scope.campaignId, p_request: source.requestId });
  });
  it("refuses foreign records and altered exact bytes before using their content", async () => {
    for (const patch of [{ campaignId: sourceActor }, { workspaceId: sourceActor }, { reviewId: sourceActor },
      { preparationText: original().preparationText + " " }, { revision: { ...original().revision, contentText: original().revision.contentText + " " } }]) {
      records.set(reviewId, { ...original(), ...patch });
      await expect(loadSynthesisReview(client, scope)).rejects.toThrow(/scope differs|checksum differs/);
    }
    records.set(reviewId, original());
    rpc.mockResolvedValueOnce({ data: original(), error: null });
    await expect(loadSynthesisReview(client, { ...scope, revisionId: correctionId })).rejects.toThrow("Saved review scope differs");
  });
  it("refuses dishonest preparation or content even when their checksums were recomputed", async () => {
    const first = original(), preparation = { ...initial.preparation, interpretation: "neutral" };
    first.preparationText = JSON.stringify(preparation); first.preparationSha256 = sourceHash(first.preparationText); records.set(reviewId, first);
    await expect(loadSynthesisReview(client, scope)).rejects.toThrow("Saved review preparation differs from its source");
    const changed = original(); changed.revision.contentText = JSON.stringify({ ...initial.content, notes: "SYNTHETIC uncommanded edit" });
    changed.revision.contentSha256 = sourceHash(changed.revision.contentText); records.set(reviewId, changed);
    await expect(loadSynthesisReview(client, scope)).rejects.toThrow("Saved review content differs from its command");
    seed(); const second = correction(); second.revision.contentText = JSON.stringify(initial.content); second.revision.contentSha256 = sourceHash(second.revision.contentText); records.set(correctionId, second);
    await expect(loadSynthesisReview(client, scope)).rejects.toThrow("Saved review content differs from its command");
  });
  it("binds source checksums, authorship, original identity and reasoned lineage", async () => {
    const cases: Array<[SynthesisReviewRecord, string]> = [];
    const checksum = original(); checksum.sourceSha256 = "a".repeat(64);
    checksum.revision.intent = { ...create, sourceSha256: checksum.sourceSha256 }; cases.push([checksum, "Saved review source checksum differs"]);
    for (const patch of [{ actorId: sourceScope.requestId }, { workspaceId: sourceActor }, { requestId: sourceActor }]) {
      const first = original(); first.revision.intent = { ...create, ...patch }; cases.push([first, "Saved review authorship differs"]);
    }
    for (const patch of [{ reason: "SYNTHETIC invalid original reason" }, { revisionNo: 2 }, { parentId: correctionId }, { parentSha256: "a".repeat(64) }]) {
      const first = original(); Object.assign(first.revision, patch); cases.push([first, "Saved review original differs"]);
    }
    const actor = original(); actor.createdBy = sourceScope.requestId; cases.push([actor, "Saved review original differs"]);
    for (const [record, error] of cases) {
      records.set(reviewId, record); await expect(loadSynthesisReview(client, scope)).rejects.toThrow(error);
    }
    seed(); const second = correction(); second.revision.reason = "SYNTHETIC different reason"; records.set(correctionId, second);
    await expect(loadSynthesisReview(client, scope)).rejects.toThrow("Saved review correction lineage differs");
  });
  it("refuses missing or discontinuous parents and any failed source or review query", async () => {
    seed(); records.delete(reviewId); await expect(loadSynthesisReview(client, scope)).rejects.toThrow("Saved review parent differs");
    for (const fault of ["number", "hash", "preparation", "scope"]) {
      seed(); const second = correction(), intent = second.revision.intent;
      if (intent.operation !== "correct") throw new Error("Wrong fixture");
      if (fault === "number") second.revision.revisionNo = 3;
      if (fault === "hash") { second.revision.parentSha256 = "a".repeat(64); intent.expectedRevisionSha256 = "a".repeat(64); }
      if (fault === "preparation") { const first = original(); first.preparationText += " "; first.preparationSha256 = sourceHash(first.preparationText); records.set(reviewId, first); }
      if (fault === "scope") { const first = original(); first.createdAt = "2026-01-01T00:00:00.000Z"; records.set(reviewId, first); }
      records.set(correctionId, second); await expect(loadSynthesisReview(client, scope)).rejects.toThrow("Saved review parent differs");
    }
    seed(); rpc.mockResolvedValueOnce({ data: null, error: { code: "PT503" } }); await expect(loadSynthesisReview(client, scope)).rejects.toMatchObject({ kind: "unavailable" });
    rpc.mockResolvedValueOnce({ data: correction(), error: null }).mockResolvedValueOnce({ data: null, error: { code: "XX000" } });
    await expect(loadSynthesisReview(client, scope)).rejects.toThrow("Saved synthesis source is unavailable");
    records.clear(); expect(await loadSynthesisReview(client, scope)).toBeNull();
  });
  it("computes complete original and corrected bytes for the service-only writer", async () => {
    const first = await retainSynthesisReview(client, service, scope.campaignId, create);
    expect(first).toMatchObject({ requestId: reviewId, revisionNo: 1, replayed: false });
    expect(persist).toHaveBeenLastCalledWith("retain_engagement_synthesis_review", { p_campaign: scope.campaignId, p_actor: sourceActor, p_workspace: scope.workspaceId,
      p_intent: create, p_source: source.requestId, p_source_sha256: source.snapshotSha256, p_preparation_text: original().preparationText, p_content_text: original().revision.contentText });
    records.set(reviewId, original());
    const second = await retainSynthesisReview(client, service, scope.campaignId, correction().revision.intent);
    expect(second).toMatchObject({ requestId: correctionId, revisionNo: 2, revisionSha256: correction().revision.contentSha256 });
    expect(persist.mock.calls.at(-1)?.[1]).toMatchObject({ p_preparation_text: null, p_content_text: correction().revision.contentText });
  });
  it("recovers exact original and correction requests after newer revisions without writing again", async () => {
    seed();
    for (const intent of [create, correction().revision.intent]) {
      expect(await retainSynthesisReview(client, service, scope.campaignId, intent)).toMatchObject({ requestId: intent.requestId, replayed: true });
    }
    expect(persist).not.toHaveBeenCalled();
    const changed = correction().revision.intent;
    if (changed.operation !== "correct") throw new Error("Wrong fixture");
    changed.reason = "SYNTHETIC different retry reason";
    await expect(retainSynthesisReview(client, service, scope.campaignId, changed)).rejects.toMatchObject({ kind: "conflict" });
  });
  it("recovers the same request when another tab commits between lookup and the parent check", async () => {
    seed(); rpc.mockResolvedValueOnce({ data: null, error: null });
    const result = await retainSynthesisReview(client, service, scope.campaignId, correction().revision.intent);
    expect(result).toMatchObject({ requestId: correctionId, revisionNo: 2, replayed: true });
    expect(persist).not.toHaveBeenCalled();
    records.delete(correctionId); head = reviewId;
    persist.mockImplementationOnce(async () => { seed(); return { data: null, error: { code: "PT409" } }; });
    const fenced = await retainSynthesisReview(client, service, scope.campaignId, correction().revision.intent);
    expect(fenced).toMatchObject({ requestId: correctionId, revisionNo: 2, replayed: true });
  });
  it("refuses stale parents, changed source selection and invalid membership before any persistence", async () => {
    records.set(reviewId, original());
    const intent = correction().revision.intent;
    if (intent.operation !== "correct") throw new Error("Wrong fixture");
    for (const patch of [{ expectedRevisionId: sourceActor }, { expectedRevisionSha256: "a".repeat(64) }]) {
      await expect(retainSynthesisReview(client, service, scope.campaignId, { ...intent, ...patch })).rejects.toMatchObject({ kind: "conflict" });
    }
    await expect(retainSynthesisReview(client, service, scope.campaignId, { ...intent, change: { kind: "group_remove", groupId: "missing" } })).rejects.toMatchObject({ kind: "invalid" });
    records.clear(); await expect(retainSynthesisReview(client, service, scope.campaignId, { ...create, sourceSha256: "a".repeat(64) })).rejects.toMatchObject({ kind: "conflict" });
    expect(persist).not.toHaveBeenCalled();
  });
  it("refuses failed, foreign or inconsistent persistence receipts", async () => {
    for (const [code, kind] of [["PT409", "conflict"], ["42501", "forbidden"], ["22023", "invalid"], ["PT503", "unavailable"]]) {
      persist.mockResolvedValueOnce({ data: null, error: { code } });
      await expect(retainSynthesisReview(client, service, scope.campaignId, create)).rejects.toMatchObject({ kind });
    }
    const good = await retainSynthesisReview(client, service, scope.campaignId, create);
    for (const patch of [{ requestId: sourceActor }, { campaignId: sourceActor }, { workspaceId: sourceActor }, { reviewId: sourceActor }, { sourceId: sourceActor },
      { sourceSha256: "a".repeat(64) }, { preparationSha256: "a".repeat(64) }, { revisionNo: 2 }, { revisionSha256: "a".repeat(64) }]) {
      persist.mockResolvedValueOnce({ data: { ...good, ...patch }, error: null });
      await expect(retainSynthesisReview(client, service, scope.campaignId, create)).rejects.toThrow("Saved review receipt differs");
    }
    persist.mockResolvedValueOnce({ data: null, error: null });
    await expect(retainSynthesisReview(client, service, scope.campaignId, create)).rejects.toThrow();
    rpc.mockResolvedValueOnce({ data: null, error: { code: "PT503" } }); persist.mockClear();
    await expect(retainSynthesisReview(client, service, scope.campaignId, create)).rejects.toMatchObject({ kind: "unavailable" });
    expect(persist).not.toHaveBeenCalled();
  });
});
