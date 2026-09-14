import { describe, expect, it, vi } from "vitest";
import native from "./fixtures/decision-link-native.json";
import { finishPendingDecision, pendingDecisionKey, readPendingDecisions, retainPendingDecision, sendPendingDecision } from "@/lib/engagement/pending-decision-link";
import type { DecisionStorage, PendingDecisionLink } from "@/lib/engagement/pending-decision-link";
import { decisionLinkIntentSchema } from "@/lib/engagement/decision-links";

function fixture(row: typeof native.withdrawn.entries[number] = native.initial.entries[0]): PendingDecisionLink {
  const { campaignId: _campaign, ...intent } = row.payload_json;
  return { version: 1, ...native.scope, phase: "unconfirmed", intent: decisionLinkIntentSchema.parse({ ...intent, requestId: row.id }),
    context: { contextText: row.context_text, contextSha256: row.context_sha256 } };
}
function storage(): DecisionStorage {
  const records = new Map<string, string>();
  return { get length() { return records.size; }, key: index => [...records.keys()][index] ?? null,
    getItem: key => records.get(key) ?? null, setItem: (key, value) => { records.set(key, value); }, removeItem: key => { records.delete(key); } };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("decision link recovery", () => {
  it("retains exact requests and clears only their verified receipt", async () => {
    const store = storage(), pending = fixture();
    await retainPendingDecision(store, pending);
    expect((await readPendingDecisions(store, native.scope)).pending).toEqual([pending]);
    await finishPendingDecision(store, pending, { link: native.initial.entries[0], replayed: true });
    expect(store.length).toBe(0);
  });
  it("retries a lost acknowledgement with the original ID, headers and complete intent", async () => {
    const store = storage(), pending = fixture();
    await retainPendingDecision(store, pending);
    const transport = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("Lost acknowledgement")).mockResolvedValueOnce(json({ link: native.initial.entries[0], replayed: true }));
    expect((await sendPendingDecision(store, pending, transport)).confirmed).toBe(false);
    const loaded = (await readPendingDecisions(store, native.scope)).pending[0];
    expect((await sendPendingDecision(store, loaded, transport)).confirmed).toBe(true);
    for (const [url, init] of transport.mock.calls) {
      expect(url).toBe(`/api/engagement/campaigns/${pending.campaignId}/decision-links`);
      expect(JSON.parse(String(init?.body))).toEqual(pending.intent);
      expect(init?.headers).toMatchObject({ "x-openplan-expected-user": pending.actorId, "x-openplan-expected-workspace": pending.workspaceId });
    }
    expect(store.length).toBe(0);
  });
  it("does not send when storage fails or silently discards the copy", async () => {
    for (const broken of [() => { throw new Error("Storage full"); }, () => {}]) {
      const store = storage(), pending = fixture();
      await retainPendingDecision(store, pending);
      const transport = vi.fn<typeof fetch>();
      store.setItem = broken;
      // Make the readback differ when a write silently disappears.
      store.getItem = () => JSON.stringify({ ...pending, phase: "conflict" });
      await expect(sendPendingDecision(store, pending, transport)).rejects.toThrow();
      expect(transport).not.toHaveBeenCalled();
    }
  });
  it("does not recreate a request removed in another tab", async () => {
    const transport = vi.fn<typeof fetch>();
    await expect(sendPendingDecision(storage(), fixture(), transport)).rejects.toThrow("changed in another tab");
    expect(transport).not.toHaveBeenCalled();
  });
  it("retains original bytes after a definite conflict and keeps later attempts separate", async () => {
    const store = storage(), pending = fixture(); await retainPendingDecision(store, pending);
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json({ kind: "conflict" }, 409));
    await sendPendingDecision(store, pending, transport);
    const retained = (await readPendingDecisions(store, native.scope)).pending[0];
    expect(retained).toEqual({ ...pending, phase: "conflict" });
    const next = { ...pending, intent: { ...pending.intent, requestId: crypto.randomUUID(), reason: "SYNTHETIC reviewed change" } };
    await retainPendingDecision(store, next);
    expect(store.length).toBe(2);
    expect(JSON.parse(store.getItem(pendingDecisionKey(pending))!)).toEqual(retained);
  });
  it("keeps malformed replies, permission changes and contradictory refusals unconfirmed", async () => {
    for (const [status, body] of [[403, { kind: "forbidden" }], [401, {}], [503, { kind: "conflict" }], [409, { kind: "unavailable" }], [200, {}]] as const) {
      const store = storage(), pending = fixture(); await retainPendingDecision(store, pending);
      const result = await sendPendingDecision(store, pending, vi.fn<typeof fetch>().mockResolvedValue(json(body, status)));
      expect(result.confirmed).toBe(false);
      expect((await readPendingDecisions(store, native.scope)).pending[0].phase).toBe("unconfirmed");
    }
  });
  it("isolates accounts, workspaces and campaigns without deleting their copies", async () => {
    const store = storage(), pending = fixture(); await retainPendingDecision(store, pending);
    for (const field of ["actorId", "workspaceId", "campaignId"] as const) {
      expect(await readPendingDecisions(store, { ...native.scope, [field]: crypto.randomUUID() })).toEqual({ pending: [], unreadable: [] });
    }
    expect(store.length).toBe(1);
    const wrong = { ...pending, actorId: crypto.randomUUID() };
    store.setItem(pendingDecisionKey(pending), JSON.stringify(wrong));
    const result = await readPendingDecisions(store, native.scope);
    expect(result.pending).toEqual([]); expect(result.unreadable).toHaveLength(1); expect(store.length).toBe(1);
  });
  it("keeps corrupt bytes and mismatched keys available for recovery", async () => {
    const store = storage(), pending = fixture(), key = pendingDecisionKey(pending);
    for (const raw of ["{broken", JSON.stringify({ ...pending, context: { ...pending.context, contextText: pending.context.contextText + " " } }), JSON.stringify({ ...pending, intent: { ...pending.intent, requestId: crypto.randomUUID() } })]) {
      store.setItem(key, raw);
      expect(await readPendingDecisions(store, native.scope)).toEqual({ pending: [], unreadable: [{ key, raw }] });
      expect(store.getItem(key)).toBe(raw);
    }
  });
  it("refuses a different intent sharing a recovery key", async () => {
    const store = storage(), pending = fixture(); await retainPendingDecision(store, pending);
    await expect(retainPendingDecision(store, { ...pending, intent: { ...pending.intent, reason: "SYNTHETIC replacement" } })).rejects.toThrow("different request");
    expect((await readPendingDecisions(store, native.scope)).pending).toEqual([pending]);
  });
  it("refuses a nonwithdrawal whose reviewed hash differs from the intent", async () => {
    const store = storage(), pending = fixture();
    pending.intent.expectedContextSha256 = "0".repeat(64);
    await expect(retainPendingDecision(store, pending)).rejects.toThrow("Local source version differs");
    expect(store.length).toBe(0);
  });
  it("does not overwrite a request replaced while its old bytes are being checked", async () => {
    const store = storage(), pending = fixture(); await retainPendingDecision(store, pending);
    const realGet = store.getItem.bind(store), key = pendingDecisionKey(pending);
    let reads = 0;
    store.getItem = name => { if (++reads === 2) store.setItem(key, "SYNTHETIC concurrent bytes"); return realGet(name); };
    await expect(retainPendingDecision(store, { ...pending, phase: "conflict" }, true)).rejects.toThrow("changed in another tab");
    expect(realGet(key)).toBe("SYNTHETIC concurrent bytes");
  });
  it("does not delete changed local intent or a copy replaced during cleanup", async () => {
    const receipt = { link: native.initial.entries[0], replayed: true }, pending = fixture(), key = pendingDecisionKey(pending);
    const changed = storage(); await retainPendingDecision(changed, { ...pending, intent: { ...pending.intent, reason: "SYNTHETIC replaced reason" } });
    await expect(finishPendingDecision(changed, pending, receipt)).rejects.toThrow("local recovery copy changed");
    expect(changed.length).toBe(1);
    const store = storage(); await retainPendingDecision(store, pending);
    const realGet = store.getItem.bind(store); let reads = 0;
    store.getItem = name => { if (++reads === 2) store.setItem(key, "SYNTHETIC concurrent bytes"); return realGet(name); };
    await expect(finishPendingDecision(store, pending, receipt)).rejects.toThrow("local recovery copy changed");
    expect(realGet(key)).toBe("SYNTHETIC concurrent bytes");
  });
  it("reports cleanup failure without treating a retained copy as cleared", async () => {
    const store = storage(), pending = fixture(); await retainPendingDecision(store, pending);
    store.removeItem = () => {};
    await expect(finishPendingDecision(store, pending, { link: native.initial.entries[0], replayed: true })).rejects.toThrow("cleanup needs another attempt");
    expect(store.length).toBe(1);
  });
  it("keeps the local request after a receipt for another actor or request", async () => {
    for (const pending of [fixture(), { ...fixture(), actorId: crypto.randomUUID() }]) {
      const store = storage(); await retainPendingDecision(store, pending);
      const link = { ...native.initial.entries[0], id: crypto.randomUUID() };
      await expect(finishPendingDecision(store, pending, { link: pending.actorId === native.scope.actorId ? link : native.initial.entries[0], replayed: true })).rejects.toThrow("does not match the request");
      expect(store.length).toBe(1);
    }
  });
  it("withdraws using retained context after current records disappear", async () => {
    const row = native.withdrawn.entries[1], pending = fixture(row), store = storage();
    await retainPendingDecision(store, pending);
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json({ link: row, replayed: true }));
    expect((await sendPendingDecision(store, pending, transport)).confirmed).toBe(true);
    expect(transport).toHaveBeenCalledTimes(1); expect(store.length).toBe(0);
  });
  it("refuses a withdrawal receipt with a different valid original context", async () => {
    const pending = fixture(native.withdrawn.entries[1]), store = storage();
    // Different valid original bytes are possible even when semantic fields match.
    const { createHash } = await import("node:crypto");
    pending.context.contextText += " ";
    pending.context.contextSha256 = createHash("sha256").update(pending.context.contextText).digest("hex");
    await retainPendingDecision(store, pending);
    await expect(finishPendingDecision(store, pending, { link: native.withdrawn.entries[1], replayed: true })).rejects.toThrow("different retained sources");
    expect(store.length).toBe(1);
  });
});
