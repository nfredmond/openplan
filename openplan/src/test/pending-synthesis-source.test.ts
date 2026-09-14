import { describe, expect, it, vi } from "vitest";
import { archivePendingSynthesisSource, clearPendingSynthesisSource, readPendingSynthesisSource, retainPendingSynthesisSource, sendPendingSynthesisSource } from "@/lib/engagement/pending-synthesis-source";
import { sourceActor, sourceScope, makeSourceSnapshot, sourceReceipt } from "./fixtures/engagement/synthesis-source";
const pending = () => ({ version: 1 as const, userId: sourceActor, workspaceId: sourceScope.workspaceId, campaignId: sourceScope.campaignId,
  intent: { requestId: sourceScope.requestId, actorId: sourceActor, workspaceId: sourceScope.workspaceId, selection: makeSourceSnapshot().selection } });
function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
describe("pending synthesis source recovery", () => {
  it("recovers lost acknowledgements with exactly the original request", async () => {
    const store = storage(), original = pending(); retainPendingSynthesisSource(store, original);
    const transport = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("Lost acknowledgement")).mockResolvedValueOnce(json(sourceReceipt(true)));
    await expect(sendPendingSynthesisSource(store, original, transport)).rejects.toThrow("Lost acknowledgement");
    const restored = readPendingSynthesisSource(store, original)!;
    expect(restored).toEqual(original);
    expect((await sendPendingSynthesisSource(store, restored, transport)).receipt).toEqual(sourceReceipt(true));
    for (const [url, init] of transport.mock.calls) {
      expect(url).toBe(`/api/engagement/campaigns/${sourceScope.campaignId}/synthesis/sources`);
      expect(JSON.parse(String(init?.body))).toEqual(original.intent);
    }
    expect(store.values.size).toBe(0);
  });
  it("refuses changed or missing recovery copies before transport", async () => {
    for (const changed of [null, { ...pending(), intent: { ...pending().intent, requestId: crypto.randomUUID() } }]) {
      const store = storage(), transport = vi.fn<typeof fetch>(); if (changed) retainPendingSynthesisSource(store, changed);
      await expect(sendPendingSynthesisSource(store, pending(), transport)).rejects.toThrow("changed in another tab");
      expect(transport).not.toHaveBeenCalled();
    }
  });
  it("refuses storage that throws or silently loses the retained bytes", async () => {
    for (const write of [() => { throw new Error("Full"); }, () => {}]) {
      const store = storage(), transport = vi.fn<typeof fetch>(); retainPendingSynthesisSource(store, pending());
      store.setItem = write; store.getItem = () => JSON.stringify(pending()) + " ";
      // A serialization mismatch on readback must stop sending even when parsed intent matches.
      await expect(sendPendingSynthesisSource(store, pending(), transport)).rejects.toThrow();
      expect(transport).not.toHaveBeenCalled();
    }
  });
  it.each([403, 409, 503])("keeps refusals and interruptions unconfirmed: %s", async status => {
    const store = storage(); retainPendingSynthesisSource(store, pending());
    await expect(sendPendingSynthesisSource(store, pending(), vi.fn<typeof fetch>().mockResolvedValue(json({}, status)))).rejects.toThrow("unconfirmed");
    expect(readPendingSynthesisSource(store, pending())).toEqual(pending());
  });
  it("keeps malformed and foreign receipts for recovery", async () => {
    for (const receipt of [{}, { ...sourceReceipt(), requestId: crypto.randomUUID() }, { ...sourceReceipt(), campaignId: crypto.randomUUID() }, { ...sourceReceipt(), workspaceId: crypto.randomUUID() }]) {
      const store = storage(); retainPendingSynthesisSource(store, pending());
      await expect(sendPendingSynthesisSource(store, pending(), vi.fn<typeof fetch>().mockResolvedValue(json(receipt)))).rejects.toThrow();
      expect(readPendingSynthesisSource(store, pending())).toEqual(pending());
    }
  });
  it("keeps a confirmed save distinct from cleanup failure", async () => {
    const store = storage(); retainPendingSynthesisSource(store, pending()); store.removeItem = () => {};
    const result = await sendPendingSynthesisSource(store, pending(), vi.fn<typeof fetch>().mockResolvedValue(json(sourceReceipt())));
    expect(result.receipt).toEqual(sourceReceipt()); expect(result.cleanupError).toContain("Source saved");
    expect(readPendingSynthesisSource(store, pending())).toEqual(pending());
  });
  it("isolates users, workspaces and campaigns without erasing other copies", () => {
    const store = storage(); retainPendingSynthesisSource(store, pending());
    for (const field of ["userId", "workspaceId", "campaignId"]) expect(readPendingSynthesisSource(store, { ...pending(), [field]: crypto.randomUUID() })).toBeNull();
    expect(store.values.size).toBe(1);
    const key = [...store.values.keys()][0];
    store.setItem(key, JSON.stringify({ ...pending(), campaignId: crypto.randomUUID() }));
    expect(() => readPendingSynthesisSource(store, pending())).toThrow("another session");
  });
  it("refuses mismatched account intent and replacement or clearing of another pending request", () => {
    const store = storage(); retainPendingSynthesisSource(store, pending());
    expect(() => retainPendingSynthesisSource(store, { ...pending(), userId: crypto.randomUUID() })).toThrow();
    const other = { ...pending(), intent: { ...pending().intent, requestId: crypto.randomUUID() } };
    expect(() => retainPendingSynthesisSource(store, other)).toThrow("Another source request");
    expect(() => clearPendingSynthesisSource(store, other)).toThrow("Another source request");
    expect(readPendingSynthesisSource(store, pending())).toEqual(pending());
  });
  it("archives unreadable bytes only after a verified recovery copy", () => {
    const store = storage(); retainPendingSynthesisSource(store, pending()); const key = [...store.values.keys()][0]; store.setItem(key, "{broken");
    expect(() => readPendingSynthesisSource(store, pending())).toThrow();
    const write = store.setItem; store.setItem = () => {};
    expect(() => archivePendingSynthesisSource(store, pending())).toThrow("recovery copy");
    expect(store.getItem(key)).toBe("{broken"); store.setItem = write;
    archivePendingSynthesisSource(store, pending());
    expect(store.getItem(key)).toBeNull(); expect([...store.values.values()]).toEqual(["{broken"]);
    expect([...store.values.keys()][0]).toContain(":preserved:");
  });
});
