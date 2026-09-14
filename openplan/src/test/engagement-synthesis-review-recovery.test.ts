import { describe, expect, it, vi } from "vitest";
import { emptyReviewWorkingCopy, freezeReviewRequest, listPreservedReviewCopies, preserveReviewWorkingCopy, readReviewWorkingCopy, sendReviewRequest, writeReviewWorkingCopy, type ReviewDraft } from "@/lib/engagement/synthesis-review-recovery";
import { sourceActor, sourceDate, sourceScope } from "./fixtures/engagement/synthesis-source";

const reviewId = "e0000000-0000-4000-8000-000000000001", correctionId = "e0000000-0000-4000-8000-000000000002";
const scope = { userId: sourceActor, workspaceId: sourceScope.workspaceId, campaignId: sourceScope.campaignId, sourceId: sourceScope.requestId, sourceSha256: "a".repeat(64) };
const create = { operation: "create" as const, actorId: sourceActor, workspaceId: scope.workspaceId, requestId: reviewId, sourceId: scope.sourceId, sourceSha256: scope.sourceSha256 };
const receipt = { requestId: reviewId, reviewId, campaignId: scope.campaignId, workspaceId: scope.workspaceId, sourceId: scope.sourceId, sourceSha256: scope.sourceSha256,
  preparationSha256: "b".repeat(64), revisionNo: 1, revisionSha256: "c".repeat(64), createdAt: sourceDate, replayed: false };
const draft: ReviewDraft = { reviewId, parentId: reviewId, parentSha256: "c".repeat(64), parentNumber: 1, kind: "notes", groupId: "category-1", title: "SYNTHETIC title", notes: "SYNTHETIC complete note é ".repeat(80) + "RECOVERY TAIL", label: "", summary: "", sentiment: "not_assessed", members: [], reason: "" };
class Store {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  getItem = vi.fn((key: string) => this.data.get(key) ?? null);
  setItem = vi.fn((key: string, raw: string) => { this.data.set(key, raw); });
  removeItem = vi.fn((key: string) => { this.data.delete(key); });
}
const response = (body: unknown = receipt, status = 201) => new Response(JSON.stringify(body), { status });

describe("staff review browser recovery", () => {
  it("retains incomplete full text and scopes it to the exact account, source and workspace", () => {
    const storage = new Store(), empty = emptyReviewWorkingCopy(scope), edited = { ...empty, activeReviewId: reviewId, draft };
    expect(readReviewWorkingCopy(storage, scope)).toEqual(empty);
    expect(writeReviewWorkingCopy(storage, empty, edited)).toEqual(edited);
    expect(readReviewWorkingCopy(storage, scope).draft?.notes).toBe(draft.notes);
    for (const key of ["userId", "workspaceId", "campaignId", "sourceId"] as const) expect(readReviewWorkingCopy(storage, { ...scope, [key]: correctionId }).draft).toBeNull();
    expect(() => readReviewWorkingCopy(storage, { ...scope, sourceSha256: "f".repeat(64) })).toThrow("another source or session");
    for (const key of Object.keys(scope) as Array<keyof typeof scope>) {
      expect(() => writeReviewWorkingCopy(storage, edited, { ...edited, [key]: key === "sourceSha256" ? "f".repeat(64) : correctionId })).toThrow();
    }
  });
  it("refuses another tab's edits and failed readback without overwriting its request", () => {
    const storage = new Store(), empty = emptyReviewWorkingCopy(scope), edited = writeReviewWorkingCopy(storage, empty, { ...empty, draft });
    expect(() => writeReviewWorkingCopy(storage, empty, { ...empty, activeReviewId: reviewId })).toThrow("another tab");
    expect(readReviewWorkingCopy(storage, scope)).toEqual(edited);
    storage.setItem.mockImplementationOnce(() => undefined);
    expect(() => writeReviewWorkingCopy(storage, edited, { ...edited, draft: { ...draft, notes: "SYNTHETIC next edit" } })).toThrow("could not be retained");
    expect(readReviewWorkingCopy(storage, scope)).toEqual(edited);
  });
  it("freezes the parent and refuses changing or clearing an unconfirmed request", () => {
    const storage = new Store(), empty = emptyReviewWorkingCopy(scope), edited = writeReviewWorkingCopy(storage, empty, { ...empty, draft });
    const correct = { operation: "correct" as const, requestId: correctionId, actorId: scope.userId, workspaceId: scope.workspaceId, reviewId,
      expectedRevisionId: reviewId, expectedRevisionSha256: draft.parentSha256, reason: "SYNTHETIC reason", change: { kind: "notes" as const, title: draft.title, notes: draft.notes } };
    for (const patch of [{ actorId: correctionId }, { workspaceId: correctionId }, { expectedRevisionId: correctionId }, { expectedRevisionSha256: "b".repeat(64) }, { reviewId: correctionId }]) expect(() => freezeReviewRequest(storage, edited, { ...correct, ...patch }, 2)).toThrow();
    expect(() => freezeReviewRequest(storage, edited, correct, 3)).toThrow("retained parent");
    const frozen = freezeReviewRequest(storage, edited, correct, 2);
    expect(() => freezeReviewRequest(storage, frozen, correct, 2)).toThrow("already pending");
    expect(() => writeReviewWorkingCopy(storage, frozen, { ...frozen, pending: null })).toThrow("exact pending");
    expect(() => writeReviewWorkingCopy(storage, frozen, { ...frozen, pending: { intent: { ...correct, reason: "SYNTHETIC changed reason" }, revisionNo: 2 } })).toThrow("exact pending");
  });
  it("checks create source identity and revision before freezing", () => {
    const storage = new Store(), empty = emptyReviewWorkingCopy(scope);
    for (const patch of [{ actorId: correctionId }, { workspaceId: correctionId }, { sourceId: correctionId }, { sourceSha256: "f".repeat(64) }]) expect(() => freezeReviewRequest(storage, empty, { ...create, ...patch }, 1)).toThrow();
    expect(() => freezeReviewRequest(storage, empty, create, 2)).toThrow();
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it("keeps exact requests after interruption and reuses their bytes on retry", async () => {
    const storage = new Store(), frozen = freezeReviewRequest(storage, emptyReviewWorkingCopy(scope), create, 1);
    const transport = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("SYNTHETIC lost response")).mockResolvedValueOnce(response({ ...receipt, replayed: true }, 200));
    await expect(sendReviewRequest(storage, frozen, transport)).rejects.toThrow("lost response");
    expect(readReviewWorkingCopy(storage, scope)).toEqual(frozen);
    const recovered = readReviewWorkingCopy(storage, scope), result = await sendReviewRequest(storage, recovered, transport);
    expect(transport.mock.calls[0]).toEqual(transport.mock.calls[1]);
    expect(transport).toHaveBeenCalledWith(`/api/engagement/campaigns/${scope.campaignId}/synthesis/reviews`, { method: "POST", headers: { "Content-Type": "application/json", "x-openplan-expected-user": scope.userId, "x-openplan-expected-workspace": scope.workspaceId }, body: JSON.stringify(frozen.pending?.intent), cache: "no-store" });
    expect(result.receipt.replayed).toBe(true); expect(result.cleanupError).toBeNull();
    expect(readReviewWorkingCopy(storage, scope)).toMatchObject({ activeReviewId: reviewId, draft: null, pending: null });
  });
  it("does not send a missing, changed or unretainable recovery copy", async () => {
    const storage = new Store(), empty = emptyReviewWorkingCopy(scope), transport = vi.fn<typeof fetch>().mockResolvedValue(response());
    await expect(sendReviewRequest(storage, empty, transport)).rejects.toThrow();
    const frozen = freezeReviewRequest(storage, empty, create, 1);
    storage.data.clear(); await expect(sendReviewRequest(storage, frozen, transport)).rejects.toThrow();
    const replacement = freezeReviewRequest(storage, empty, { ...create, requestId: correctionId }, 1);
    await expect(sendReviewRequest(storage, frozen, transport)).rejects.toThrow();
    storage.setItem.mockImplementationOnce(() => { throw new Error("SYNTHETIC storage denied"); });
    await expect(sendReviewRequest(storage, replacement, transport)).rejects.toThrow("storage denied");
    expect(transport).not.toHaveBeenCalled();
  });
  it("retains requests for refused, malformed and foreign receipts", async () => {
    const storage = new Store(), frozen = freezeReviewRequest(storage, emptyReviewWorkingCopy(scope), create, 1);
    for (const status of [400, 401, 403, 409, 503]) {
      await expect(sendReviewRequest(storage, frozen, vi.fn<typeof fetch>().mockResolvedValue(response({}, status)))).rejects.toMatchObject({ status });
      expect(readReviewWorkingCopy(storage, scope)).toEqual(frozen);
    }
    for (const patch of [{ requestId: correctionId }, { reviewId: correctionId }, { campaignId: correctionId }, { workspaceId: correctionId }, { sourceId: correctionId }, { sourceSha256: "f".repeat(64) }, { revisionNo: 2 }]) {
      await expect(sendReviewRequest(storage, frozen, vi.fn<typeof fetch>().mockResolvedValue(response({ ...receipt, ...patch })))).rejects.toThrow("receipt differs");
      expect(readReviewWorkingCopy(storage, scope)).toEqual(frozen);
    }
    await expect(sendReviewRequest(storage, frozen, vi.fn<typeof fetch>().mockResolvedValue(response({})))).rejects.toThrow();
    expect(readReviewWorkingCopy(storage, scope)).toEqual(frozen);
  });
  it("keeps confirmation after cleanup failure and preserves another tab's copy", async () => {
    const storage = new Store(), frozen = freezeReviewRequest(storage, emptyReviewWorkingCopy(scope), create, 1);
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => { storage.setItem.mockImplementationOnce(() => { throw new Error("SYNTHETIC cleanup blocked"); }); return response(); });
    const result = await sendReviewRequest(storage, frozen, transport);
    expect(result.receipt).toEqual(receipt); expect(result.cleanupError).toContain("Review saved"); expect(readReviewWorkingCopy(storage, scope)).toEqual(frozen);
    const changed = { ...frozen, activeReviewId: correctionId };
    const concurrent = await sendReviewRequest(storage, frozen, vi.fn<typeof fetch>().mockImplementation(async () => { storage.data.set(storage.key(0)!, JSON.stringify(changed)); return response(); }));
    expect(concurrent.cleanupError).toContain("Review saved"); expect(readReviewWorkingCopy(storage, scope)).toEqual(changed);
  });
  it("preserves unreadable and newest unsaved bytes and can restore a readable edit", () => {
    const storage = new Store(), empty = emptyReviewWorkingCopy(scope), latest = { ...empty, draft };
    writeReviewWorkingCopy(storage, empty, empty); const active = storage.key(0)!; storage.data.set(active, "SYNTHETIC unreadable original bytes");
    expect(() => readReviewWorkingCopy(storage, scope)).toThrow();
    expect(() => preserveReviewWorkingCopy(storage, scope, { ...latest, userId: correctionId })).toThrow("another source");
    preserveReviewWorkingCopy(storage, scope, latest);
    const copies = listPreservedReviewCopies(storage, scope);
    expect(copies.map(row => row.raw)).toContain("SYNTHETIC unreadable original bytes");
    expect(copies.find(row => row.value)?.value).toEqual(latest); expect(readReviewWorkingCopy(storage, scope)).toEqual(empty);
    expect(listPreservedReviewCopies(storage, { ...scope, userId: correctionId })).toEqual([]);
    const restored = writeReviewWorkingCopy(storage, empty, copies.find(row => row.value)!.value!);
    expect(restored.draft?.notes).toBe(draft.notes); expect(listPreservedReviewCopies(storage, scope)).toHaveLength(2);
  });
  it("refuses failed preservation readback, changed originals and failed removal", () => {
    for (const fault of ["write", "race", "remove"]) {
      const storage = new Store(), empty = emptyReviewWorkingCopy(scope), edited = writeReviewWorkingCopy(storage, empty, { ...empty, draft }), active = storage.key(0)!;
      if (fault === "write") storage.setItem.mockImplementationOnce(() => undefined);
      if (fault === "race") storage.setItem.mockImplementationOnce((key, value) => { storage.data.set(key, value); storage.data.set(active, "SYNTHETIC concurrent edit"); });
      if (fault === "remove") storage.removeItem.mockImplementationOnce(() => undefined);
      expect(() => preserveReviewWorkingCopy(storage, scope, edited)).toThrow(/could not be preserved|could not be moved/);
      expect(storage.getItem(active)).not.toBeNull();
    }
  });
});
