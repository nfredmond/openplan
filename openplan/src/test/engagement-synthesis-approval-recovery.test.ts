import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { emptyApprovalWorkingCopy, freezeApprovalRequest, listPreservedApprovalCopies, preserveApprovalWorkingCopy, readApprovalWorkingCopy,
  sendApprovalRequest, writeApprovalWorkingCopy, type ApprovalClientScope, type ApprovalDraft, type ApprovalStorage, type ApprovalWorkingCopy } from "@/lib/engagement/synthesis-approval-recovery";
import type { SynthesisApprovalIntent } from "@/lib/engagement/synthesis-approval";

const id = (n: number) => `b5000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope: ApprovalClientScope = { userId: id(1), workspaceId: id(2), campaignId: id(3), sourceId: id(4), sourceSha256: "a".repeat(64), reviewId: id(5), preparationSha256: "b".repeat(64) };
const draft: ApprovalDraft = { revisionId: id(5), revisionNo: 1, revisionSha256: "c".repeat(64), operation: "approve", reason: "SYNTHETIC exact staff reason 中文 🚲" };
const intent: SynthesisApprovalIntent = { campaignId: scope.campaignId, workspaceId: scope.workspaceId, sourceId: scope.sourceId, sourceSha256: scope.sourceSha256,
  reviewId: scope.reviewId, preparationSha256: scope.preparationSha256, ...draft, requestId: id(6), actorId: scope.userId, predecessorId: null, predecessorSha256: null };
function storage() {
  const rows = new Map<string, string>();
  const store: ApprovalStorage = { getItem: vi.fn(key => rows.get(key) ?? null), setItem: vi.fn((key, value) => { rows.set(key, value); }),
    removeItem: vi.fn(key => { rows.delete(key); }), key: index => [...rows.keys()][index] ?? null, get length() { return rows.size; } };
  return { rows, store };
}
function pending(store: ApprovalStorage) {
  const empty = emptyApprovalWorkingCopy(scope), edited = writeApprovalWorkingCopy(store, empty, { ...empty, draft });
  return freezeApprovalRequest(store, edited, intent);
}
function receipt(command = intent, replayed = false) {
  const eventText = JSON.stringify({ schemaVersion: 1, purpose: "internal_staff_synthesis", eventNo: 1, createdAt: "2026-09-14T00:00:00Z", intent: command });
  return { event: { eventText, eventSha256: createHash("sha256").update(eventText).digest("hex") }, replayed };
}
const response = (value = receipt(), status = 201) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

describe("exact approval browser recovery", () => {
  it("retains incomplete reason text and exact revision context independently of review working copies", () => {
    const { store, rows } = storage(), empty = emptyApprovalWorkingCopy(scope);
    expect(readApprovalWorkingCopy(store, scope)).toEqual(empty);
    const edited = writeApprovalWorkingCopy(store, empty, { ...empty, draft: { ...draft, reason: "" } });
    expect(readApprovalWorkingCopy(store, scope)).toEqual(edited);
    expect([...rows.keys()][0]).toMatch(/^openplan:synthesis-approval:/);
    expect(() => freezeApprovalRequest(store, edited, { ...intent, reason: "" })).toThrow();
  });
  it.each(["userId", "workspaceId", "campaignId", "sourceId", "reviewId"] as const)("keeps %s recovery in a separate storage key", field => {
    const { store } = storage(), old = pending(store), other = { ...scope, [field]: id(90) };
    expect(readApprovalWorkingCopy(store, other)).toEqual(emptyApprovalWorkingCopy(other));
    expect(readApprovalWorkingCopy(store, scope)).toEqual(old);
  });
  it.each(["sourceSha256", "preparationSha256"] as const)("refuses a saved copy with changed %s", field => {
    const { store } = storage(); pending(store);
    expect(() => readApprovalWorkingCopy(store, { ...scope, [field]: "d".repeat(64) })).toThrow("another source, review or session");
  });
  it.each(["actorId", "workspaceId", "campaignId", "sourceId", "reviewId", "sourceSha256", "preparationSha256", "revisionId", "revisionNo", "revisionSha256", "operation", "reason"] as const)("refuses a pending command that changes %s from its retained draft or scope", field => {
    const { store } = storage(), empty = emptyApprovalWorkingCopy(scope), edited = writeApprovalWorkingCopy(store, empty, { ...empty, draft });
    const value = field.endsWith("Sha256") ? "d".repeat(64) : field === "revisionNo" ? 2 : field === "reason" ? "Changed reason" : field === "operation" ? "withdraw" : id(90);
    const changed = { ...intent, [field]: value, ...(field === "operation" ? { predecessorId: id(89), predecessorSha256: "e".repeat(64) } : {}) };
    expect(() => freezeApprovalRequest(store, edited, changed)).toThrow();
    expect(readApprovalWorkingCopy(store, scope)).toEqual(edited);
  });
  it("refuses malformed copies without overwriting their original bytes", () => {
    const { store, rows } = storage(); pending(store); const key = [...rows.keys()][0];
    for (const raw of ["{bad", JSON.stringify({ ...emptyApprovalWorkingCopy(scope), unexpected: true }), JSON.stringify({ ...emptyApprovalWorkingCopy(scope), version: 2 })]) {
      rows.set(key, raw); expect(() => readApprovalWorkingCopy(store, scope)).toThrow(); expect(rows.get(key)).toBe(raw);
    }
  });
  it("refuses stale tab edits and cross-scope writes", () => {
    const { store } = storage(), empty = emptyApprovalWorkingCopy(scope), edited = writeApprovalWorkingCopy(store, empty, { ...empty, draft });
    expect(() => writeApprovalWorkingCopy(store, empty, { ...empty, draft: { ...draft, reason: "Stale overwrite" } })).toThrow("another tab");
    expect(() => writeApprovalWorkingCopy(store, edited, { ...edited, reviewId: id(90) })).toThrow("another tab");
    expect(readApprovalWorkingCopy(store, scope)).toEqual(edited);
  });
  it("does not replace or clear an unconfirmed pending command", () => {
    const { store } = storage(), retained = pending(store);
    expect(() => freezeApprovalRequest(store, retained, intent)).toThrow("already pending");
    expect(() => writeApprovalWorkingCopy(store, retained, { ...retained, pending: { ...intent, requestId: id(90) } })).toThrow("exact pending");
    expect(() => writeApprovalWorkingCopy(store, retained, { ...retained, pending: null, draft: null })).toThrow("exact pending");
    expect(readApprovalWorkingCopy(store, scope)).toEqual(retained);
  });
  it("requires working storage and exact readback before transport", async () => {
    for (const mode of ["quota", "ignored write", "stale copy"]) {
      const { store, rows } = storage(), retained = pending(store), transport = vi.fn();
      if (mode === "quota") vi.mocked(store.setItem).mockImplementation(() => { throw new Error("Synthetic quota"); });
      if (mode === "ignored write") vi.mocked(store.setItem).mockImplementation(key => { rows.set(key, "wrong bytes"); });
      if (mode === "stale copy") rows.clear();
      await expect(sendApprovalRequest(store, retained, transport)).rejects.toThrow(); expect(transport).not.toHaveBeenCalled();
    }
  });
  it("sends exact bound bytes and clears only a verified successful request", async () => {
    const { store } = storage(), retained = pending(store), transport = vi.fn().mockResolvedValue(response());
    const result = await sendApprovalRequest(store, retained, transport);
    expect(transport).toHaveBeenCalledExactlyOnceWith(`/api/engagement/campaigns/${scope.campaignId}/synthesis/approvals`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-openplan-expected-user": scope.userId, "x-openplan-expected-workspace": scope.workspaceId },
      body: JSON.stringify(retained.pending), cache: "no-store",
    });
    expect(result.receipt.event.intent).toEqual(intent); expect(result.cleanupError).toBeNull();
    expect(result.working).toEqual(emptyApprovalWorkingCopy(scope)); expect(readApprovalWorkingCopy(store, scope)).toEqual(result.working);
  });
  it("keeps the exact request after a lost acknowledgement and recovers its original event", async () => {
    const { store } = storage(), retained = pending(store);
    const transport = vi.fn().mockRejectedValueOnce(new Error("Synthetic lost acknowledgement")).mockResolvedValueOnce(response(receipt(intent, true), 200));
    await expect(sendApprovalRequest(store, retained, transport)).rejects.toThrow("lost acknowledgement");
    expect(readApprovalWorkingCopy(store, scope)).toEqual(retained);
    const result = await sendApprovalRequest(store, readApprovalWorkingCopy(store, scope), transport);
    expect(result.receipt).toMatchObject({ replayed: true, event: { eventText: receipt().event.eventText } });
    expect(transport.mock.calls[0]).toEqual(transport.mock.calls[1]);
  });
  it.each([401, 403, 409, 503])("retains an unconfirmed command after HTTP %s", async status => {
    const { store } = storage(), retained = pending(store);
    await expect(sendApprovalRequest(store, retained, vi.fn().mockResolvedValue(response(receipt(), status)))).rejects.toMatchObject({ status });
    expect(readApprovalWorkingCopy(store, scope)).toEqual(retained);
  });
  it("rejects a forged or corrupt acknowledgement without clearing recovery", async () => {
    for (const bad of [receipt({ ...intent, actorId: id(90) }), receipt({ ...intent, reason: "Changed reason" }), receipt({ ...intent, revisionSha256: "f".repeat(64) }),
      { ...receipt(), event: { ...receipt().event, eventSha256: "0".repeat(64) } }, { ...receipt(), extra: true }]) {
      const { store } = storage(), retained = pending(store);
      await expect(sendApprovalRequest(store, retained, vi.fn().mockResolvedValue(response(bad)))).rejects.toThrow();
      expect(readApprovalWorkingCopy(store, scope)).toEqual(retained);
    }
  });
  it("keeps a confirmed save true when cleanup fails and preserves another tab's new bytes", async () => {
    for (const mode of ["quota", "other tab"]) {
      const { store, rows } = storage(), retained = pending(store), currentKey = [...rows.keys()][0];
      const later: ApprovalWorkingCopy = { ...emptyApprovalWorkingCopy(scope), draft: { ...draft, reason: "Other tab preserved and started another" } };
      const transport = vi.fn().mockImplementation(async () => {
        if (mode === "quota") vi.mocked(store.setItem).mockImplementation(() => { throw new Error("Synthetic cleanup quota"); });
        else rows.set(currentKey, JSON.stringify(later));
        return response();
      });
      const result = await sendApprovalRequest(store, retained, transport);
      expect(result.receipt.event.intent.requestId).toBe(intent.requestId); expect(result.cleanupError).toContain("Approval saved");
      expect(result.working).toEqual(retained); expect(readApprovalWorkingCopy(store, scope)).toEqual(mode === "quota" ? retained : later);
    }
  });
  it("preserves unreadable bytes and newer unsaved text before moving recovery aside", () => {
    const { store, rows } = storage(), retained = pending(store), currentKey = [...rows.keys()][0]; rows.set(currentKey, "{unreadable");
    const latest = { ...emptyApprovalWorkingCopy(scope), draft: { ...draft, reason: "Latest on-screen reason" } };
    preserveApprovalWorkingCopy(store, scope, latest);
    const copies = listPreservedApprovalCopies(store, scope);
    expect(copies).toHaveLength(2); expect(copies.map(row => row.raw)).toEqual(["{unreadable", JSON.stringify(latest)]);
    expect(copies[0].value).toBeNull(); expect(copies[1].value).toEqual(latest);
    expect(readApprovalWorkingCopy(store, scope)).toEqual(emptyApprovalWorkingCopy(scope));
    expect(listPreservedApprovalCopies(store, { ...scope, userId: id(90) })).toEqual([]);
    expect(retained.pending?.requestId).toBe(intent.requestId);
  });
  it("does not discard active recovery when archiving is unavailable or another tab changes it", () => {
    for (const mode of ["quota", "bad readback", "other tab"]) {
      const { store, rows } = storage(), retained = pending(store), currentKey = [...rows.keys()][0], raw = rows.get(currentKey)!;
      vi.mocked(store.setItem).mockImplementation((key, value) => {
        if (mode === "quota") throw new Error("Synthetic archive quota");
        rows.set(key, mode === "bad readback" ? "truncated" : value);
        if (mode === "other tab") rows.set(currentKey, "newer bytes");
      });
      expect(() => preserveApprovalWorkingCopy(store, scope, retained)).toThrow(); expect(store.removeItem).not.toHaveBeenCalled();
      expect(rows.get(currentKey)).toBe(mode === "other tab" ? "newer bytes" : raw);
    }
  });
  it("refuses transport when no command is pending", async () => {
    const { store } = storage(), transport = vi.fn();
    await expect(sendApprovalRequest(store, emptyApprovalWorkingCopy(scope), transport)).rejects.toThrow("retained approval request changed");
    expect(transport).not.toHaveBeenCalled();
  });
  it("refuses to archive the latest text from another account", () => {
    const { store } = storage(), retained = pending(store);
    const foreign = { ...emptyApprovalWorkingCopy({ ...scope, userId: id(90) }), draft };
    expect(() => preserveApprovalWorkingCopy(store, scope, foreign)).toThrow("another retained review");
    expect(listPreservedApprovalCopies(store, scope)).toEqual([]);
    expect(readApprovalWorkingCopy(store, scope)).toEqual(retained);
  });
  it("reports when the active copy could not be moved aside", () => {
    const { store } = storage(), retained = pending(store);
    vi.mocked(store.removeItem).mockImplementation(() => {});
    expect(() => preserveApprovalWorkingCopy(store, scope, retained)).toThrow("could not be moved aside");
    expect(readApprovalWorkingCopy(store, scope)).toEqual(retained);
    expect(listPreservedApprovalCopies(store, scope)).toHaveLength(1);
  });

});
