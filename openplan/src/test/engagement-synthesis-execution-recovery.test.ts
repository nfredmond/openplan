import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { readPendingSynthesisExecution, retainPendingSynthesisExecution, sendPendingSynthesisExecution,
  preservePendingSynthesisExecution, listPreservedSynthesisExecution, type PendingSynthesisExecution,
} from "@/lib/engagement/synthesis-execution-recovery";

const id = (n: number) => `c7400000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { actorId: id(1), workspaceId: id(2), campaignId: id(3), requestId: id(4), sourceId: id(5),
  sourceSha256: "a".repeat(64), requestIntentSha256: "b".repeat(64), stage: "segment" as const };
const intent = { schemaVersion: 1, headerSha256: "c".repeat(64), maxAttempts: 2, maxOutputTokens: 2048,
  responseByteLimit: 65536, expiresAt: "2026-01-01T00:00:00Z", chargesAcknowledged: true, retryTaskIndex: null, retryOfAttemptId: null };
const intentText = JSON.stringify(intent, null, 2) + "\n";
const pending: PendingSynthesisExecution = { version: 1, ...scope, command: { authorizationId: id(6), intentText } };
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const receipt = { schemaVersion: 1, id: id(6), requestId: scope.requestId, intentText, intentSha256: hash(intentText) };
const json = (body: unknown = receipt, status = 200) => new Response(JSON.stringify(body), { status });
class Store {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  getItem = vi.fn((key: string) => this.data.get(key) ?? null);
  setItem = vi.fn((key: string, value: string) => { this.data.set(key, value); });
  removeItem = vi.fn((key: string) => { this.data.delete(key); });
}
const read = (store: Store) => readPendingSynthesisExecution(store, scope);
function retained() { const store = new Store(); retainPendingSynthesisExecution(store, pending); return store; }

describe("exact execution allowance recovery", () => {
  it("retains original whitespace and separates staff, campaign, request and stage", () => {
    const store = retained(); expect(read(store)).toEqual(pending);
    for (const field of ["actorId", "workspaceId", "campaignId", "requestId"] as const) {
      expect(readPendingSynthesisExecution(store, { ...scope, [field]: id(99) })).toBeNull();
    }
    expect(readPendingSynthesisExecution(store, { ...scope, stage: "context" })).toBeNull();
    for (const changed of [{ sourceId: id(99) }, { sourceSha256: "d".repeat(64) }, { requestIntentSha256: "d".repeat(64) }]) {
      expect(() => readPendingSynthesisExecution(store, { ...scope, ...changed })).toThrow("another source");
    }
    expect(() => retainPendingSynthesisExecution(store, { ...pending, command: { ...pending.command, authorizationId: id(99) } })).toThrow("Another execution");
  });
  it("retries an expired original command after a lost reply and keeps it after confirmation", async () => {
    const store = retained(), transport = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("SYNTHETIC lost reply")).mockResolvedValueOnce(json());
    await expect(sendPendingSynthesisExecution(store, pending, transport)).rejects.toThrow("lost reply");
    expect(read(store)).toEqual(pending);
    const result = await sendPendingSynthesisExecution(store, read(store)!, transport);
    expect(result.receipt).toEqual(receipt); expect(read(store)).toEqual(pending); expect(store.removeItem).not.toHaveBeenCalled();
    const { actorId, workspaceId, campaignId, ...bodyScope } = scope;
    for (const args of transport.mock.calls) expect(args).toEqual([`/api/engagement/campaigns/${campaignId}/synthesis/execution`, {
      method: "POST", cache: "no-store", signal: expect.any(AbortSignal),
      headers: { "Content-Type": "application/json", "x-openplan-expected-user": actorId, "x-openplan-expected-workspace": workspaceId },
      body: JSON.stringify({ ...bodyScope, ...pending.command }),
    }]);
    expect(() => retainPendingSynthesisExecution(store, { ...pending, command: { ...pending.command, authorizationId: id(99) } })).toThrow();
  });
  it("never sends an absent, replaced, unreadable or failed-readback command", async () => {
    const store = retained(), key = store.key(0)!, transport = vi.fn<typeof fetch>();
    for (const raw of [null, "{", JSON.stringify({ ...pending, command: { ...pending.command, authorizationId: id(99) } })]) {
      if (raw === null) store.data.clear(); else store.data.set(key, raw);
      await expect(sendPendingSynthesisExecution(store, pending, transport)).rejects.toThrow();
    }
    store.data.set(key, JSON.stringify(pending));
    store.setItem.mockImplementationOnce(() => { throw new Error("SYNTHETIC quota"); });
    await expect(sendPendingSynthesisExecution(store, pending, transport)).rejects.toThrow("quota");
    store.setItem.mockImplementationOnce(() => { store.data.set(key, "unreadable"); });
    await expect(sendPendingSynthesisExecution(store, pending, transport)).rejects.toThrow("retained for recovery");
    expect(transport).not.toHaveBeenCalled();
  });
  it.each(["source", "allowance", "hash", "bytes"])("rejects a mismatched acknowledgement: %s", async kind => {
    const store = retained(), changed = { ...receipt };
    if (kind === "source") changed.requestId = id(99);
    if (kind === "allowance") changed.id = id(99);
    if (kind === "hash") changed.intentSha256 = "d".repeat(64);
    if (kind === "bytes") { changed.intentText = JSON.stringify(intent); changed.intentSha256 = hash(changed.intentText); }
    await expect(sendPendingSynthesisExecution(store, pending, vi.fn<typeof fetch>().mockResolvedValue(json(changed)))).rejects.toThrow();
    expect(read(store)).toEqual(pending);
  });
  it.each([401, 403, 409, 503])("keeps the exact command on HTTP %s", async status => {
    const store = retained();
    await expect(sendPendingSynthesisExecution(store, pending, vi.fn<typeof fetch>().mockResolvedValue(json({ error: "PRIVATE" }, status)))).rejects.toMatchObject({ status });
    expect(read(store)).toEqual(pending);
  });
  it("preserves a newer command when an older response arrives", async () => {
    const store = retained(), key = store.key(0)!, newer = { ...pending, command: { ...pending.command, authorizationId: id(99) } };
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => { store.data.set(key, JSON.stringify(newer)); return json(); });
    await expect(sendPendingSynthesisExecution(store, pending, transport)).rejects.toThrow("changed during acknowledgement");
    expect(read(store)).toEqual(newer);
  });
  it("does not disclose a reply after abort and retains recovery", async () => {
    const store = retained(), controller = new AbortController();
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => { controller.abort(); return json(); });
    await expect(sendPendingSynthesisExecution(store, pending, transport, controller.signal)).rejects.toThrow();
    expect(read(store)).toEqual(pending);
  });
  it("refuses invalid limits, unacknowledged charges, unmatched retries and oversized bytes", () => {
    for (const changed of [{ ...intent, chargesAcknowledged: false }, { ...intent, maxAttempts: 0 },
      { ...intent, retryTaskIndex: 0 }, { ...intent, retryTaskIndex: 0, retryOfAttemptId: id(10) },
      { ...intent, expiresAt: "not a date" }]) {
      expect(() => retainPendingSynthesisExecution(new Store(), { ...pending, command: { ...pending.command, intentText: JSON.stringify(changed) } })).toThrow();
    }
    expect(() => retainPendingSynthesisExecution(new Store(), { ...pending, command: { ...pending.command, intentText: intentText.padEnd(4097, " ") } })).toThrow();
  });
  it("archives unreadable originals and in-memory authority before releasing the slot", () => {
    const store = retained(), key = store.key(0)!; store.data.set(key, "{broken original");
    preservePendingSynthesisExecution(store, scope, pending);
    expect(read(store)).toBeNull();
    const copies = listPreservedSynthesisExecution(store, scope);
    expect(copies.map(copy => copy.raw)).toEqual(["{broken original", JSON.stringify(pending)]);
    expect(copies.map(copy => copy.value)).toEqual([null, pending]);
  });
  it("does not clear active authority when archive storage fails", () => {
    const store = retained(); store.setItem.mockImplementationOnce(() => { throw new Error("SYNTHETIC quota"); });
    expect(() => preservePendingSynthesisExecution(store, scope, pending)).toThrow("quota"); expect(read(store)).toEqual(pending);
    expect(store.removeItem).not.toHaveBeenCalled();
  });
  it("refuses an archive overwrite race and does not clear the newer command", () => {
    const store = retained(), active = store.key(0)!;
    store.setItem.mockImplementationOnce((key, value) => { store.data.set(key, value); store.data.set(active, "newer command"); });
    expect(() => preservePendingSynthesisExecution(store, scope, pending)).toThrow("could not be preserved");
    expect(store.data.get(active)).toBe("newer command"); expect(store.removeItem).not.toHaveBeenCalled();
  });
});
