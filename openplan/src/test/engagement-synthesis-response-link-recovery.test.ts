import { event, fixture, packet, id } from "./fixtures/engagement/synthesis-response-link";
import { describe, expect, it, vi } from "vitest";
import { emptyResponseLinkWorkingCopy, freezeResponseLinkRequest, listPreservedResponseLinkCopies, preserveResponseLinkWorkingCopy, readResponseLinkWorkingCopy,
  sendResponseLinkRequest, writeResponseLinkWorkingCopy, type ResponseLinkClientScope, type ResponseLinkDraft, type ResponseLinkStorage, type ResponseLinkWorkingCopy } from "@/lib/engagement/synthesis-response-link-recovery";
import type { SynthesisResponseLinkIntent } from "@/lib/engagement/synthesis-response-link";

const saved = event(fixture());
const intent: SynthesisResponseLinkIntent = { ...saved.intent, operation: "link" };
const scope: ResponseLinkClientScope = { userId: intent.actorId, workspaceId: intent.workspaceId, campaignId: intent.campaignId, reviewId: intent.reviewId };
const draft: ResponseLinkDraft = { responseId: intent.responseId, groupId: intent.groupId, reason: intent.reason };
function storage() {
  const rows = new Map<string, string>();
  const store: ResponseLinkStorage = { getItem: vi.fn(key => rows.get(key) ?? null), setItem: vi.fn((key, value) => { rows.set(key, value); }),
    removeItem: vi.fn(key => { rows.delete(key); }), key: index => [...rows.keys()][index] ?? null, get length() { return rows.size; } };
  return { rows, store };
}
function pending(store: ResponseLinkStorage) {
  const empty = emptyResponseLinkWorkingCopy(scope), edited = writeResponseLinkWorkingCopy(store, empty, { ...empty, draft });
  return freezeResponseLinkRequest(store, edited, intent);
}
function receipt(command = intent, replayed = false) { return { event: packet({ ...saved, intent: command }), replayed }; }
const response = (value = receipt(), status = 201) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

describe("exact response link browser recovery", () => {
  it("retains incomplete reason text without private source packets or unrelated review edits", () => {
    const { store, rows } = storage(), empty = emptyResponseLinkWorkingCopy(scope);
    expect(readResponseLinkWorkingCopy(store, scope)).toEqual(empty);
    const edited = writeResponseLinkWorkingCopy(store, empty, { ...empty, draft: { ...draft, reason: "" } });
    expect(readResponseLinkWorkingCopy(store, scope)).toEqual(edited);
    expect([...rows.values()][0]).not.toContain("contextText");
    expect([...rows.keys()][0]).toMatch(/^openplan:synthesis-response-link:/);
    expect(() => freezeResponseLinkRequest(store, edited, { ...intent, reason: "" })).toThrow();
  });
  it.each(["userId", "workspaceId", "campaignId", "reviewId"] as const)("keeps %s recovery in a separate storage key", field => {
    const { store } = storage(), old = pending(store), other = { ...scope, [field]: id(90) };
    expect(readResponseLinkWorkingCopy(store, other)).toEqual(emptyResponseLinkWorkingCopy(other));
    expect(readResponseLinkWorkingCopy(store, scope)).toEqual(old);
  });
  it.each(["actorId", "workspaceId", "campaignId", "reviewId", "responseId", "groupId", "reason"] as const)("refuses a pending command that changes %s from its retained draft or scope", field => {
    const { store } = storage(), empty = emptyResponseLinkWorkingCopy(scope), edited = writeResponseLinkWorkingCopy(store, empty, { ...empty, draft });
    const value = field === "reason" ? "Changed reason" : field === "groupId" ? "another-group" : id(90);
    expect(() => freezeResponseLinkRequest(store, edited, { ...intent, [field]: value })).toThrow();
    expect(readResponseLinkWorkingCopy(store, scope)).toEqual(edited);
  });
  it("refuses malformed copies without overwriting their original bytes", () => {
    const { store, rows } = storage(); pending(store); const key = [...rows.keys()][0];
    for (const raw of ["{bad", JSON.stringify({ ...emptyResponseLinkWorkingCopy(scope), unexpected: true }), JSON.stringify({ ...emptyResponseLinkWorkingCopy(scope), version: 2 })]) {
      rows.set(key, raw); expect(() => readResponseLinkWorkingCopy(store, scope)).toThrow(); expect(rows.get(key)).toBe(raw);
    }
  });
  it("refuses stale tab edits and cross-scope writes", () => {
    const { store } = storage(), empty = emptyResponseLinkWorkingCopy(scope), edited = writeResponseLinkWorkingCopy(store, empty, { ...empty, draft });
    expect(() => writeResponseLinkWorkingCopy(store, empty, { ...empty, draft: { ...draft, reason: "Stale overwrite" } })).toThrow("another tab");
    expect(() => writeResponseLinkWorkingCopy(store, edited, { ...edited, reviewId: id(90) })).toThrow("another tab");
    expect(readResponseLinkWorkingCopy(store, scope)).toEqual(edited);
  });
  it("does not replace or clear an unconfirmed pending command", () => {
    const { store } = storage(), retained = pending(store);
    expect(() => freezeResponseLinkRequest(store, retained, intent)).toThrow("already pending");
    expect(() => writeResponseLinkWorkingCopy(store, retained, { ...retained, pending: { ...intent, requestId: id(90) } })).toThrow("exact pending");
    expect(() => writeResponseLinkWorkingCopy(store, retained, { ...retained, pending: null, draft: null })).toThrow("exact pending");
    expect(readResponseLinkWorkingCopy(store, scope)).toEqual(retained);
  });
  it("requires working storage and exact readback before transport", async () => {
    for (const mode of ["quota", "ignored write", "stale copy"]) {
      const { store, rows } = storage(), retained = pending(store), transport = vi.fn();
      if (mode === "quota") vi.mocked(store.setItem).mockImplementation(() => { throw new Error("Synthetic quota"); });
      if (mode === "ignored write") vi.mocked(store.setItem).mockImplementation(key => { rows.set(key, "wrong bytes"); });
      if (mode === "stale copy") rows.clear();
      await expect(sendResponseLinkRequest(store, retained, transport)).rejects.toThrow(); expect(transport).not.toHaveBeenCalled();
    }
  });
  it("sends exact bound bytes and clears only a verified successful request", async () => {
    const { store } = storage(), retained = pending(store), transport = vi.fn().mockResolvedValue(response());
    const result = await sendResponseLinkRequest(store, retained, transport);
    expect(transport).toHaveBeenCalledExactlyOnceWith(`/api/engagement/campaigns/${scope.campaignId}/synthesis/response-links`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-openplan-expected-user": scope.userId, "x-openplan-expected-workspace": scope.workspaceId },
      body: JSON.stringify(retained.pending), cache: "no-store",
    });
    expect(result.receipt.event.intent).toEqual(intent); expect(result.cleanupError).toBeNull();
    expect(result.working).toEqual(emptyResponseLinkWorkingCopy(scope)); expect(readResponseLinkWorkingCopy(store, scope)).toEqual(result.working);
  });
  it("keeps the exact request after a lost acknowledgement and recovers its original event", async () => {
    const { store } = storage(), retained = pending(store);
    const transport = vi.fn().mockRejectedValueOnce(new Error("Synthetic lost acknowledgement")).mockResolvedValueOnce(response(receipt(intent, true), 200));
    await expect(sendResponseLinkRequest(store, retained, transport)).rejects.toThrow("lost acknowledgement");
    expect(readResponseLinkWorkingCopy(store, scope)).toEqual(retained);
    const result = await sendResponseLinkRequest(store, readResponseLinkWorkingCopy(store, scope), transport);
    expect(result.receipt).toMatchObject({ replayed: true, event: { eventText: receipt().event.eventText } });
    expect(transport.mock.calls[0]).toEqual(transport.mock.calls[1]);
  });
  it.each([401, 403, 409, 503])("retains an unconfirmed command after HTTP %s", async status => {
    const { store } = storage(), retained = pending(store);
    await expect(sendResponseLinkRequest(store, retained, vi.fn().mockResolvedValue(response(receipt(), status)))).rejects.toMatchObject({ status });
    expect(readResponseLinkWorkingCopy(store, scope)).toEqual(retained);
  });
  it("rejects a forged or corrupt acknowledgement without clearing recovery", async () => {
    for (const bad of [receipt({ ...intent, actorId: id(90) }), receipt({ ...intent, reason: "Changed reason" }), receipt({ ...intent, expectedContextSha256: "f".repeat(64) }),
      { ...receipt(), event: { ...receipt().event, eventSha256: "0".repeat(64) } }, { ...receipt(), extra: true }]) {
      const { store } = storage(), retained = pending(store);
      await expect(sendResponseLinkRequest(store, retained, vi.fn().mockResolvedValue(response(bad)))).rejects.toThrow();
      expect(readResponseLinkWorkingCopy(store, scope)).toEqual(retained);
    }
  });
  it("keeps a confirmed save true when cleanup fails and preserves another tab's new bytes", async () => {
    for (const mode of ["quota", "other tab"]) {
      const { store, rows } = storage(), retained = pending(store), currentKey = [...rows.keys()][0];
      const later: ResponseLinkWorkingCopy = { ...emptyResponseLinkWorkingCopy(scope), draft: { ...draft, reason: "Other tab preserved and started another" } };
      const transport = vi.fn().mockImplementation(async () => {
        if (mode === "quota") vi.mocked(store.setItem).mockImplementation(() => { throw new Error("Synthetic cleanup quota"); });
        else rows.set(currentKey, JSON.stringify(later));
        return response();
      });
      const result = await sendResponseLinkRequest(store, retained, transport);
      expect(result.receipt.event.intent.requestId).toBe(intent.requestId); expect(result.cleanupError).toContain("Response link saved");
      expect(result.working).toEqual(retained); expect(readResponseLinkWorkingCopy(store, scope)).toEqual(mode === "quota" ? retained : later);
    }
  });
  it("preserves unreadable bytes and newer unsaved text before moving recovery aside", () => {
    const { store, rows } = storage(), retained = pending(store), currentKey = [...rows.keys()][0]; rows.set(currentKey, "{unreadable");
    const latest = { ...emptyResponseLinkWorkingCopy(scope), draft: { ...draft, reason: "Latest on-screen reason" } };
    preserveResponseLinkWorkingCopy(store, scope, latest);
    const copies = listPreservedResponseLinkCopies(store, scope);
    expect(copies).toHaveLength(2); expect(copies.map(row => row.raw)).toEqual(["{unreadable", JSON.stringify(latest)]);
    expect(copies[0].value).toBeNull(); expect(copies[1].value).toEqual(latest);
    expect(readResponseLinkWorkingCopy(store, scope)).toEqual(emptyResponseLinkWorkingCopy(scope));
    expect(listPreservedResponseLinkCopies(store, { ...scope, userId: id(90) })).toEqual([]);
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
      expect(() => preserveResponseLinkWorkingCopy(store, scope, retained)).toThrow(); expect(store.removeItem).not.toHaveBeenCalled();
      expect(rows.get(currentKey)).toBe(mode === "other tab" ? "newer bytes" : raw);
    }
  });
  it("refuses transport when no command is pending", async () => {
    const { store } = storage(), transport = vi.fn();
    await expect(sendResponseLinkRequest(store, emptyResponseLinkWorkingCopy(scope), transport)).rejects.toThrow("retained response link request changed");
    expect(transport).not.toHaveBeenCalled();
  });
  it("refuses to archive the latest text from another account", () => {
    const { store } = storage(), retained = pending(store);
    const foreign = { ...emptyResponseLinkWorkingCopy({ ...scope, userId: id(90) }), draft };
    expect(() => preserveResponseLinkWorkingCopy(store, scope, foreign)).toThrow("another retained review");
    expect(listPreservedResponseLinkCopies(store, scope)).toEqual([]);
    expect(readResponseLinkWorkingCopy(store, scope)).toEqual(retained);
  });
  it("reports when the active copy could not be moved aside", () => {
    const { store } = storage(), retained = pending(store);
    vi.mocked(store.removeItem).mockImplementation(() => {});
    expect(() => preserveResponseLinkWorkingCopy(store, scope, retained)).toThrow("could not be moved aside");
    expect(readResponseLinkWorkingCopy(store, scope)).toEqual(retained);
    expect(listPreservedResponseLinkCopies(store, scope)).toHaveLength(1);
  });

});
