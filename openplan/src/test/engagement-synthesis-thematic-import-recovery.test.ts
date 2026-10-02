import { describe, expect, it, vi } from "vitest";
import { emptyThematicImportCopy, freezeThematicImport, listPreservedThematicImports, preserveThematicImportCopy,
  readThematicImportCopy, sendThematicImport, writeThematicImportCopy, type ThematicImportDraft } from "@/lib/engagement/synthesis-thematic-import-recovery";
import { sourceActor, sourceDate, sourceScope } from "./fixtures/engagement/synthesis-source";

const reviewId = "e0000000-0000-4000-8000-000000000001", requestId = "e0000000-0000-4000-8000-000000000002", otherId = "e0000000-0000-4000-8000-000000000003";
const scope = { userId: sourceActor, workspaceId: sourceScope.workspaceId, campaignId: sourceScope.campaignId,
  sourceId: sourceScope.requestId, sourceSha256: "a".repeat(64), reviewId, preparationSha256: "b".repeat(64) };
const proposal = { requestId: otherId, selectionSequence: 9, historyManifestSha256: "c".repeat(64), proposalSha256: "d".repeat(64), finalCaptureSha256: "e".repeat(64) };
const draft: ThematicImportDraft = { parentId: reviewId, parentSha256: "f".repeat(64), parentNumber: 2, proposal,
  reason: "SYNTHETIC retained reason 日本語 é ".repeat(90) + "RECOVERY TAIL" };
const receipt = { requestId, reviewId, campaignId: scope.campaignId, workspaceId: scope.workspaceId, sourceId: scope.sourceId,
  sourceSha256: scope.sourceSha256, preparationSha256: scope.preparationSha256, revisionNo: 3, revisionSha256: "9".repeat(64), createdAt: sourceDate, replayed: false };
class Store {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  getItem = vi.fn((key: string) => this.data.get(key) ?? null);
  setItem = vi.fn((key: string, value: string) => { this.data.set(key, value); });
  removeItem = vi.fn((key: string) => { this.data.delete(key); });
}
function prepared(storage = new Store()) {
  const empty = emptyThematicImportCopy(scope), edited = writeThematicImportCopy(storage, empty, { ...empty, draft });
  return { storage, empty, edited };
}
function frozen(storage = new Store()) {
  const { edited } = prepared(storage);
  return { storage, working: freezeThematicImport(storage, edited, requestId) };
}
const response = (body: unknown = receipt, status = 201) => new Response(JSON.stringify(body), { status });

describe("thematic import browser recovery", () => {
  it("retains incomplete reasons and exact proposal identity across navigation", () => {
    const { storage, edited } = prepared();
    expect(readThematicImportCopy(storage, scope)).toEqual(edited);
    const incomplete = writeThematicImportCopy(storage, edited, { ...edited, draft: { ...draft, reason: "" } });
    expect(readThematicImportCopy(storage, scope).draft?.reason).toBe("");
    expect(() => freezeThematicImport(storage, incomplete, requestId)).toThrow();
    expect(readThematicImportCopy(storage, scope).pending).toBeNull();
  });
  it("separates reviews and accounts and refuses changed immutable scope", () => {
    const { storage, edited } = prepared();
    for (const field of ["userId", "workspaceId", "campaignId", "sourceId", "reviewId"] as const) {
      expect(readThematicImportCopy(storage, { ...scope, [field]: otherId }).draft).toBeNull();
    }
    for (const field of ["sourceSha256", "preparationSha256"] as const) expect(() => readThematicImportCopy(storage, { ...scope, [field]: "0".repeat(64) })).toThrow("another source");
    for (const field of Object.keys(scope) as Array<keyof typeof scope>) expect(() => writeThematicImportCopy(storage, edited,
      { ...edited, [field]: field.endsWith("Sha256") ? "0".repeat(64) : otherId })).toThrow();
  });
  it("refuses stale tabs and failed durable readback", () => {
    const { storage, edited, empty } = prepared();
    expect(() => writeThematicImportCopy(storage, empty, empty)).toThrow("another tab");
    storage.setItem.mockImplementationOnce(() => undefined);
    expect(() => writeThematicImportCopy(storage, edited, { ...edited, draft: null })).toThrow("could not be retained");
    expect(readThematicImportCopy(storage, scope)).toEqual(edited);
  });
  it("freezes a command from the retained parent, proposal and reason", () => {
    const { storage, working } = frozen();
    expect(working.pending).toEqual({ revisionNo: 3, intent: { operation: "import_thematic", requestId, actorId: sourceActor,
      workspaceId: scope.workspaceId, reviewId, expectedRevisionId: draft.parentId, expectedRevisionSha256: draft.parentSha256, reason: draft.reason, proposal } });
    expect(() => freezeThematicImport(storage, working, otherId)).toThrow("before preparing another");
    expect(() => freezeThematicImport(new Store(), emptyThematicImportCopy(scope), requestId)).toThrow("Select a proposal");
    expect(() => writeThematicImportCopy(storage, working, { ...working, pending: null })).toThrow("exact pending");
    const changed = structuredClone(working); changed.pending!.intent.reason = "SYNTHETIC altered reason"; changed.draft!.reason = changed.pending!.intent.reason;
    expect(() => writeThematicImportCopy(storage, working, changed)).toThrow("exact pending");
  });
  it("refuses forged recovered commands that differ from scope or the retained draft", () => {
    const { storage, working } = frozen(), key = storage.key(0)!;
    const changes = [
      (v: typeof working) => { v.pending!.intent.actorId = otherId; },
      (v: typeof working) => { v.pending!.intent.workspaceId = otherId; },
      (v: typeof working) => { v.pending!.intent.reviewId = otherId; },
      (v: typeof working) => { v.draft = null; },
      (v: typeof working) => { v.pending!.intent.expectedRevisionId = otherId; },
      (v: typeof working) => { v.pending!.intent.expectedRevisionSha256 = "0".repeat(64); },
      (v: typeof working) => { v.pending!.revisionNo = 4; },
      (v: typeof working) => { v.pending!.intent.reason = "SYNTHETIC another reason"; },
      (v: typeof working) => { v.pending!.intent.proposal.selectionSequence = 8; },
    ];
    for (const change of changes) {
      const copy = structuredClone(working); change(copy); storage.data.set(key, JSON.stringify(copy));
      expect(() => readThematicImportCopy(storage, scope)).toThrow("differs from its retained");
    }
    storage.data.set(key, JSON.stringify({ ...working, pending: { revisionNo: 1, intent: { operation: "create", requestId,
      actorId: sourceActor, workspaceId: scope.workspaceId, sourceId: scope.sourceId, sourceSha256: scope.sourceSha256 } } }));
    expect(() => readThematicImportCopy(storage, scope)).toThrow("requires a thematic import");
  });
  it("retries identical bytes after a lost acknowledgement and confirms the same revision", async () => {
    const { storage, working } = frozen();
    const transport = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("SYNTHETIC lost reply")).mockResolvedValueOnce(response({ ...receipt, replayed: true }, 200));
    await expect(sendThematicImport(storage, working, transport)).rejects.toThrow("lost reply");
    expect(readThematicImportCopy(storage, scope)).toEqual(working);
    const result = await sendThematicImport(storage, readThematicImportCopy(storage, scope), transport);
    expect(transport.mock.calls[0]).toEqual(transport.mock.calls[1]);
    expect(transport).toHaveBeenCalledWith(`/api/engagement/campaigns/${scope.campaignId}/synthesis/reviews`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-openplan-expected-user": scope.userId,
        "x-openplan-expected-workspace": scope.workspaceId }, body: JSON.stringify(working.pending!.intent), cache: "no-store" });
    expect(result.receipt.replayed).toBe(true); expect(result.cleanupError).toBeNull();
    expect(readThematicImportCopy(storage, scope)).toEqual(emptyThematicImportCopy(scope));
  });
  it("does not transport absent, replaced or unretainable commands", async () => {
    const { storage, working } = frozen(), transport = vi.fn<typeof fetch>();
    await expect(sendThematicImport(storage, emptyThematicImportCopy(scope), transport)).rejects.toThrow("request changed");
    storage.data.clear(); await expect(sendThematicImport(storage, working, transport)).rejects.toThrow("request changed");
    const current = frozen(storage).working;
    storage.setItem.mockImplementationOnce(() => { throw new Error("SYNTHETIC quota"); });
    await expect(sendThematicImport(storage, current, transport)).rejects.toThrow("quota");
    expect(transport).not.toHaveBeenCalled();
  });
  it("retains commands on refusal, malformed receipts or a different save", async () => {
    const { storage, working } = frozen();
    for (const status of [400, 401, 403, 409, 503]) {
      await expect(sendThematicImport(storage, working, vi.fn<typeof fetch>().mockResolvedValue(response({}, status)))).rejects.toMatchObject({ status });
      expect(readThematicImportCopy(storage, scope)).toEqual(working);
    }
    for (const field of ["requestId", "reviewId", "campaignId", "workspaceId", "sourceId", "sourceSha256", "preparationSha256", "revisionNo"] as const) {
      const value = field === "revisionNo" ? 4 : field.endsWith("Sha256") ? "0".repeat(64) : otherId;
      await expect(sendThematicImport(storage, working, vi.fn<typeof fetch>().mockResolvedValue(response({ ...receipt, [field]: value })))).rejects.toThrow("receipt differs");
      expect(readThematicImportCopy(storage, scope)).toEqual(working);
    }
    await expect(sendThematicImport(storage, working, vi.fn<typeof fetch>().mockResolvedValue(response({})))).rejects.toThrow();
    expect(readThematicImportCopy(storage, scope)).toEqual(working);
  });
  it("keeps a successful receipt when cleanup fails or another tab changes", async () => {
    const { storage, working } = frozen();
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => { storage.setItem.mockImplementationOnce(() => { throw new Error("SYNTHETIC cleanup"); }); return response(); });
    const result = await sendThematicImport(storage, working, transport);
    expect(result.receipt).toEqual(receipt); expect(result.cleanupError).toContain("Import saved");
    expect(readThematicImportCopy(storage, scope)).toEqual(working);
    const changed = { ...working, draft: null, pending: null };
    const concurrent = await sendThematicImport(storage, working, vi.fn<typeof fetch>().mockImplementation(async () => {
      storage.data.set(storage.key(0)!, JSON.stringify(changed)); return response();
    }));
    expect(concurrent.cleanupError).toContain("Import saved"); expect(readThematicImportCopy(storage, scope)).toEqual(changed);
  });
  it("preserves unreadable original bytes and newer unsaved reasons", () => {
    const { storage, edited } = prepared(), active = storage.key(0)!;
    storage.data.set(active, "SYNTHETIC unreadable bytes");
    expect(() => preserveThematicImportCopy(storage, scope, { ...edited, userId: otherId })).toThrow("another source");
    preserveThematicImportCopy(storage, scope, edited);
    const copies = listPreservedThematicImports(storage, scope);
    expect(copies.map(row => row.raw)).toContain("SYNTHETIC unreadable bytes");
    expect(copies.find(row => row.value)?.value).toEqual(edited);
    expect(readThematicImportCopy(storage, scope)).toEqual(emptyThematicImportCopy(scope));
    expect(listPreservedThematicImports(storage, { ...scope, userId: otherId })).toEqual([]);
    const restored = writeThematicImportCopy(storage, emptyThematicImportCopy(scope), copies.find(row => row.value)!.value!);
    expect(restored.draft?.reason).toBe(draft.reason);
  });
  it("refuses preservation write loss, concurrent changes and failed removal", () => {
    for (const fault of ["write", "race", "remove"]) {
      const { storage, edited } = prepared(), active = storage.key(0)!;
      if (fault === "write") storage.setItem.mockImplementationOnce(() => undefined);
      if (fault === "race") storage.setItem.mockImplementationOnce((key, value) => { storage.data.set(key, value); storage.data.set(active, "SYNTHETIC concurrent bytes"); });
      if (fault === "remove") storage.removeItem.mockImplementationOnce(() => undefined);
      expect(() => preserveThematicImportCopy(storage, scope, edited)).toThrow(/could not be preserved|could not be moved/);
      expect(storage.getItem(active)).not.toBeNull();
    }
  });
});
