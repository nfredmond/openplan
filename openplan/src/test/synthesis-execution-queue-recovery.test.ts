import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { readPendingSynthesisQueue, retainPendingSynthesisQueue, sendPendingSynthesisQueue } from "../lib/engagement/synthesis-execution-queue-recovery";
const id = (n: number) => `c7400000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { actorId: id(1), workspaceId: id(2), campaignId: id(3), requestId: id(4), sourceId: id(5),
  sourceSha256: "a".repeat(64), requestIntentSha256: "b".repeat(64), stage: "segment" as const,
  authorizationId: id(6), authorizationIntentSha256: "c".repeat(64) };
const commandText = JSON.stringify({ schemaVersion: 1, ...scope, queueId: id(7) }, null, 2) + "\n";
const receipt = { schemaVersion: 1, queueId: id(7), commandText,
  commandSha256: createHash("sha256").update(commandText).digest("hex"), createdAt: "2026-10-07T23:00:00Z" };
class Store {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  getItem = (key: string) => this.data.get(key) ?? null;
  setItem = vi.fn((key: string, value: string) => { this.data.set(key, value); });
  removeItem = vi.fn((key: string) => { this.data.delete(key); });
}
function retained() { const store = new Store(); retainPendingSynthesisQueue(store, scope, commandText); return store; }
const response = (value: unknown = receipt) => new Response(JSON.stringify(value));
describe("browser queue recovery", () => {
  it("replays unchanged bytes after a lost reply and keeps the original after success", async () => {
    const store = retained(), transport = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("lost reply")).mockResolvedValueOnce(response());
    await expect(sendPendingSynthesisQueue(store, scope, commandText, transport)).rejects.toThrow("lost reply");
    expect((await sendPendingSynthesisQueue(store, scope, commandText, transport)).receipt).toEqual(receipt);
    expect(readPendingSynthesisQueue(store, scope)?.commandText).toBe(commandText); expect(store.removeItem).not.toHaveBeenCalled();
    for (const [url, init] of transport.mock.calls) {
      expect(url).toBe(`/api/engagement/campaigns/${scope.campaignId}/synthesis/execution/queue`);
      expect(init).toMatchObject({ method: "POST", cache: "no-store", body: commandText,
        headers: { "x-openplan-expected-user": scope.actorId, "x-openplan-expected-workspace": scope.workspaceId } });
    }
  });
  it("never replaces an existing command for the same allowance", () => {
    const store = retained(); expect(() => retainPendingSynthesisQueue(store, scope, commandText + " ")).toThrow("Another original");
    expect(readPendingSynthesisQueue(store, scope)?.commandText).toBe(commandText);
  });
  it.each(["sourceId", "sourceSha256", "requestIntentSha256", "authorizationIntentSha256"] as const)("rejects changed %s", field => {
    const store = retained(); expect(() => readPendingSynthesisQueue(store, { ...scope, [field]: field === "sourceId" ? id(99) : "f".repeat(64) })).toThrow("another scope");
  });
  it.each(["actorId", "workspaceId", "campaignId", "requestId", "authorizationId"] as const)("separates %s storage", field => {
    expect(readPendingSynthesisQueue(retained(), { ...scope, [field]: id(99) })).toBeNull();
  });
  it("does not send missing or unreadable originals", async () => {
    const store = new Store(), transport = vi.fn<typeof fetch>();
    await expect(sendPendingSynthesisQueue(store, scope, commandText, transport)).rejects.toThrow();
    retainPendingSynthesisQueue(store, scope, commandText); store.data.set(store.key(0)!, "{");
    await expect(sendPendingSynthesisQueue(store, scope, commandText, transport)).rejects.toThrow(); expect(transport).not.toHaveBeenCalled();
  });
  it("requires successful storage readback before transport", async () => {
    const store = retained(), transport = vi.fn<typeof fetch>(); store.setItem.mockImplementation(() => store.data.clear());
    await expect(sendPendingSynthesisQueue(store, scope, commandText, transport)).rejects.toThrow("could not be retained"); expect(transport).not.toHaveBeenCalled();
  });
  it("refuses acknowledgement after another tab changes storage", async () => {
    const store = retained(), transport = vi.fn<typeof fetch>().mockImplementation(async () => { store.data.clear(); return response(); });
    await expect(sendPendingSynthesisQueue(store, scope, commandText, transport)).rejects.toThrow("changed during");
  });
  it("rejects a substituted checksum and preserves recovery", async () => {
    const store = retained(), transport = vi.fn<typeof fetch>().mockResolvedValue(response({ ...receipt, commandSha256: "0".repeat(64) }));
    await expect(sendPendingSynthesisQueue(store, scope, commandText, transport)).rejects.toThrow("checksum");
    expect(readPendingSynthesisQueue(store, scope)?.commandText).toBe(commandText);
  });
  it("refuses an acknowledgement after cancellation", async () => {
    const store = retained(), controller = new AbortController(), transport = vi.fn<typeof fetch>().mockImplementation(async () => { controller.abort(); return response(); });
    await expect(sendPendingSynthesisQueue(store, scope, commandText, transport, controller.signal)).rejects.toThrow();
    expect(readPendingSynthesisQueue(store, scope)?.commandText).toBe(commandText);
  });
});
