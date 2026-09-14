// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { DecisionStorage } from "@/lib/engagement/pending-decision-link";
import { archiveDecisionResolution, pendingDecisionResolutionKey, pendingDecisionResolutionSchema, prepareDecisionResolution,
  readDecisionResolutionRecovery, decisionResolutionHasCopy, decisionResolutionPrefix, decisionResolutionRequestId,
  retainDecisionResolution, type PendingDecisionResolution } from "@/lib/engagement/decision-resolution-recovery";

import { readDecisionResolution } from "@/lib/engagement/decision-request-resolution";

const id = (n: number) => `76000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { actorId: id(1), workspaceId: id(2), campaignId: id(3) };
const sourceKey = `openplan:decision-link:${scope.actorId}:${scope.workspaceId}:${scope.campaignId}:${id(4)}`;
const archiveKey = (bundle: PendingDecisionResolution) => `openplan:decision-resolution-archive:${bundle.actorId}:${bundle.workspaceId}:${bundle.campaignId}:${bundle.intents[0].requestId}:${bundle.intents[0].resolutionId}`;
const verifyReceipt = (raw: unknown, bundle: PendingDecisionResolution, index: number) => readDecisionResolution(raw, { campaignId: bundle.campaignId, workspaceId: bundle.workspaceId, actorId: bundle.actorId }, bundle.intents[index]);
const original = "damaged\0\ud800 browser string";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function storage() {
  const values = new Map<string, string>();
  const api: DecisionStorage = {
    get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); },
  };
  return { values, api };
}
function fixture(pageCopy?: string) {
  const f = storage(); f.values.set(sourceKey, original);
  const bundle = prepareDecisionResolution(f.api, scope, sourceKey, "Resolve interrupted recovery", pageCopy);
  retainDecisionResolution(f.api, bundle);
  return { ...f, bundle, key: pendingDecisionResolutionKey(bundle), archive: archiveKey(bundle) };
}
function packet(bundle: PendingDecisionResolution, index = 0) {
  const intent = bundle.intents[index], bound = { campaignId: bundle.campaignId, workspaceId: bundle.workspaceId, actorId: bundle.actorId };
  const payloadText = JSON.stringify({ schema: 1, ...bound, ...intent });
  const resultText = JSON.stringify({ schema: 1, ...bound, resolutionId: intent.resolutionId, requestId: intent.requestId,
    state: "cancelled", link: null, resolvedAt: "2026-09-13T12:00:00.000Z" });
  return { payloadText, payloadSha256: hash(payloadText), resultText, resultSha256: hash(resultText), replayed: false };
}
const packets = (bundle: PendingDecisionResolution) => bundle.intents.map((_, index) => packet(bundle, index));
const current = () => {};

describe("resolution recovery custody", () => {
  it("freezes both exact copies including whitespace and damaged strings", () => {
    const f = fixture("page held\0\udfff copy");
    expect(f.bundle.intents.map(intent => JSON.parse(intent.copyJson))).toEqual([original, "page held\0\udfff copy"]);
    expect(new Set(f.bundle.intents.map(intent => intent.resolutionId)).size).toBe(2);
    expect(f.bundle.intents.every(intent => intent.requestId === id(4))).toBe(true);
    expect(decisionResolutionHasCopy(f.bundle, original)).toBe(true);
    expect(decisionResolutionHasCopy(f.bundle, "different")).toBe(false);
    const s = storage(); s.values.set(sourceKey, '{"a":1}');
    const b = prepareDecisionResolution(s.api, scope, sourceKey, "Keep raw copies", '{ "a": 1 }');
    expect(b.intents).toHaveLength(2);
    expect(decisionResolutionHasCopy(b, '{"a": 1}')).toBe(false);
  });
  it("deduplicates only identical copies", () => { expect(fixture(original).bundle.intents).toHaveLength(1); });
  it("preserves a page-held copy when storage has lost the source", () => {
    const f = storage(), b = prepareDecisionResolution(f.api, scope, sourceKey, "Resolve missing storage", original);
    expect(b.intents.map(intent => JSON.parse(intent.copyJson))).toEqual([original]);
    expect(() => prepareDecisionResolution(f.api, scope, sourceKey, "No surviving copy")).toThrow("unavailable");
  });
  it.each([sourceKey.replace(scope.actorId, id(98)), sourceKey.replace(scope.campaignId, id(98)), sourceKey + ":extra",
    decisionResolutionPrefix({ ...scope, workspaceId: id(98) }) + id(4) + ":" + id(5),
    decisionResolutionPrefix(scope) + id(4) + ":bad", "unrelated:" + id(4)])("refuses unowned or malformed source key %s", key => {
    expect(() => decisionResolutionRequestId(key, scope)).toThrow();
  });
  it("can retain a damaged earlier resolution bundle using its original request key", () => {
    const f = storage(), key = decisionResolutionPrefix(scope) + id(4) + ":" + id(5);
    f.values.set(key, "broken bundle");
    expect(prepareDecisionResolution(f.api, scope, key, "Resolve damaged bundle").intents[0].requestId).toBe(id(4));
  });
  it.each(["stored", "page"])("refuses a readable foreign scope in the %s copy", which => {
    const wrong = JSON.stringify({ version: 1, ...scope, workspaceId: id(99), intent: { requestId: id(4) } });
    const f = storage(); f.values.set(sourceKey, which === "stored" ? wrong : original);
    expect(() => prepareDecisionResolution(f.api, scope, sourceKey, "Wrong scope", which === "page" ? wrong : undefined)).toThrow("scope differs");
  });
  it("refuses a readable request identity misplaced under another key", () => {
    const f = storage(); f.values.set(sourceKey, JSON.stringify({ ...scope, intent: { requestId: id(99) } }));
    expect(() => prepareDecisionResolution(f.api, scope, sourceKey, "Wrong identity")).toThrow("request identity differs");
    const bundle = fixture().bundle;
    f.values.set(sourceKey, JSON.stringify(bundle));
    expect(() => prepareDecisionResolution(f.api, scope, sourceKey, "Misplaced resolution")).toThrow("resolution identity differs");
  });
  it.each(["source-collision", "request", "resolution", "copy"])("rejects incoherent bundle %s", kind => {
    const f = fixture("second"), b = structuredClone(f.bundle);
    if (kind === "source-collision") b.sourceKey = pendingDecisionResolutionKey(b);
    if (kind === "request") b.intents[1].requestId = id(99);
    if (kind === "resolution") b.intents[1].resolutionId = b.intents[0].resolutionId;
    if (kind === "copy") b.intents[1].copyJson = b.intents[0].copyJson;
    expect(pendingDecisionResolutionSchema.safeParse(b).success).toBe(false);
  });
  it("retains exact intent for retry and refuses overwriting another retained intent", () => {
    const f = fixture(); expect(retainDecisionResolution(f.api, f.bundle)).toEqual(f.bundle);
    const changed = structuredClone(f.bundle); changed.intents[0].reason = "Changed reason";
    expect(() => retainDecisionResolution(f.api, changed)).toThrow("different decision resolution");
    expect(JSON.parse(f.values.get(f.key)!)).toEqual(f.bundle);
  });
  it.each(["quota", "readback"])("refuses unretained dispatch intent on %s failure", kind => {
    const f = fixture(); f.values.delete(f.key);
    f.api.setItem = () => { if (kind === "quota") throw new Error("quota"); };
    expect(() => retainDecisionResolution(f.api, f.bundle)).toThrow(kind === "quota" ? "quota" : "not retained");
    expect(f.values.get(sourceKey)).toBe(original);
  });
  it("reads only current scope and retains unreadable and mismatched bundles", () => {
    const f = fixture(), broken = decisionResolutionPrefix(scope) + id(4) + ":" + id(99);
    f.values.set(broken, JSON.stringify(f.bundle));
    const unreadable = decisionResolutionPrefix(scope) + "broken"; f.values.set(unreadable, "bad json");
    f.values.set(decisionResolutionPrefix({ ...scope, actorId: id(98) }) + "hidden", "private");
    f.values.set(f.archive, "unchecked archive");
    expect(readDecisionResolutionRecovery(f.api, scope)).toEqual({ pending: [f.bundle], unreadable: [broken, unreadable], archives: [{ key: f.archive, raw: "unchecked archive" }] });
  });
  it.each(["payloadSha256", "resultSha256"] as const)("rejects invalid %s before touching originals", async key => {
    const f = fixture(), p = { ...packet(f.bundle), [key]: "a".repeat(64) }, before = [...f.values];
    await expect(archiveDecisionResolution(f.api, f.bundle, [p], current)).rejects.toThrow("checksum differs");
    expect([...f.values]).toEqual(before);
  });
  it("rejects a correctly hashed receipt from another intent", async () => {
    const f = fixture(), other = structuredClone(f.bundle); other.intents[0].reason = "Different request";
    await expect(verifyReceipt(packet(other), f.bundle, 0)).rejects.toThrow("differs from the retained request");
  });
  it("requires every copy receipt before creating an archive", async () => {
    const f = fixture("second"), before = [...f.values];
    await expect(archiveDecisionResolution(f.api, f.bundle, [packet(f.bundle)], current)).rejects.toThrow("inventory differs");
    expect([...f.values]).toEqual(before);
  });
  it("archives verified receipts and exact copies before retiring both source and intent", async () => {
    const f = fixture("second");
    const remove = f.api.removeItem; f.api.removeItem = key => {
      expect(JSON.parse(f.values.get(f.archive)!)).toEqual({ version: 1, request: f.bundle, receipts: packets(f.bundle) }); remove(key);
    };
    expect(await archiveDecisionResolution(f.api, f.bundle, packets(f.bundle), current)).toEqual({ archive: f.archive, sourceChanged: false });
    expect(f.values.has(sourceKey)).toBe(false); expect(f.values.has(f.key)).toBe(false);
  });
  it.each(["different", null])("preserves changed or absent original %s", async changed => {
    const f = fixture(); if (changed === null) f.values.delete(sourceKey); else f.values.set(sourceKey, changed);
    expect((await archiveDecisionResolution(f.api, f.bundle, packets(f.bundle), current)).sourceChanged).toBe(changed !== null);
    expect(f.api.getItem(sourceKey)).toBe(changed);
  });
  it.each(["missing", "different"])("refuses a %s pending bundle before archiving", async kind => {
    const f = fixture(); if (kind === "missing") f.values.delete(f.key); else { const changed = structuredClone(f.bundle); changed.intents[0].reason = "New reason"; f.values.set(f.key, JSON.stringify(changed)); }
    await expect(archiveDecisionResolution(f.api, f.bundle, packets(f.bundle), current)).rejects.toThrow("Retained decision resolution changed");
    expect(f.values.has(f.archive)).toBe(false); expect(f.values.get(sourceKey)).toBe(original);
  });
  it("refuses replacing an existing different archive", async () => {
    const f = fixture(); f.values.set(f.archive, "earlier archive");
    await expect(archiveDecisionResolution(f.api, f.bundle, packets(f.bundle), current)).rejects.toThrow("earlier decision recovery archive differs");
    expect(f.values.get(f.archive)).toBe("earlier archive"); expect(f.values.get(sourceKey)).toBe(original);
  });
  it.each(["quota", "readback", "pending-changed"])("preserves originals when archive write has %s failure", async kind => {
    const f = fixture(), set = f.api.setItem;
    f.api.setItem = (key, value) => { if (key !== f.archive) return set(key, value);
      if (kind === "quota") throw new Error("quota");
      if (kind === "readback") return;
      set(key, value); f.values.set(f.key, "changed during archive");
    };
    await expect(archiveDecisionResolution(f.api, f.bundle, packets(f.bundle), current)).rejects.toThrow(kind === "quota" ? "quota" : "archive readback differs");
    expect(f.values.get(sourceKey)).toBe(original); expect(f.values.has(f.key)).toBe(true);
  });
  it.each([1, 2])("aborts stale lifecycle at checkpoint %s before retiring originals", async stop => {
    const f = fixture(); let calls = 0;
    await expect(archiveDecisionResolution(f.api, f.bundle, packets(f.bundle), () => { if (++calls === stop) throw new Error("scope changed"); })).rejects.toThrow("scope changed");
    expect(calls).toBe(stop); expect(f.values.get(sourceKey)).toBe(original); expect(f.values.has(f.key)).toBe(true);
    expect(f.values.has(f.archive)).toBe(stop === 2);
  });
  it.each(["source", "pending"])("retries after failed %s retirement using replay receipts and the existing archive", async kind => {
    const f = fixture(), remove = f.api.removeItem, denied = kind === "source" ? sourceKey : f.key;
    f.api.removeItem = key => { if (key !== denied) remove(key); };
    await expect(archiveDecisionResolution(f.api, f.bundle, packets(f.bundle), current)).rejects.toThrow("could not be retired");
    const retainedArchive = f.values.get(f.archive); expect(retainedArchive).toBeDefined(); expect(f.values.has(f.key)).toBe(true);
    f.api.removeItem = remove;
    await archiveDecisionResolution(f.api, f.bundle, packets(f.bundle).map(p => ({ ...p, replayed: true })), current);
    expect(f.values.get(f.archive)).toBe(retainedArchive); expect(f.values.has(f.key)).toBe(false);
  });
  it("preserves a pending bundle changed during source retirement", async () => {
    const f = fixture(), remove = f.api.removeItem;
    f.api.removeItem = key => { remove(key); if (key === sourceKey) f.values.set(f.key, "changed at retirement"); };
    await expect(archiveDecisionResolution(f.api, f.bundle, packets(f.bundle), current)).rejects.toThrow("changed before retirement");
    expect(f.values.get(f.key)).toBe("changed at retirement"); expect(f.values.has(f.archive)).toBe(true);
  });
});
