// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { TranslationStorage } from "@/lib/engagement/pending-translation";
import { pendingGenerationSchema, pendingGenerationKey } from "@/lib/engagement/translation-generation-editor";
import { archiveResolvedGeneration, pendingResolutionKey, pendingResolutionSchema, preparePendingResolution,
  readResolutionRecovery, resolutionArchiveKey, resolutionHasCopy, resolutionPendingPrefix, resolutionRequestId,
  retainPendingResolution, verifyBrowserResolution, type PendingResolution } from "@/lib/engagement/translation-resolution-recovery";

const id = (n: number) => `76000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { userId: id(1), workspaceId: id(2), campaignId: id(3) };
const sourceKey = `openplan:translation-generation:${scope.userId}:${scope.campaignId}:${id(4)}`;
const original = "damaged\0\ud800 browser string";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function storage() {
  const values = new Map<string, string>();
  const api: TranslationStorage = {
    get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); },
  };
  return { values, api };
}
function fixture(pageCopy?: string) {
  const f = storage(); f.values.set(sourceKey, original);
  const bundle = preparePendingResolution(f.api, scope, sourceKey, "Resolve interrupted recovery", pageCopy);
  retainPendingResolution(f.api, bundle);
  return { ...f, bundle, key: pendingResolutionKey(bundle), archive: resolutionArchiveKey(bundle) };
}
function packet(bundle: PendingResolution, index = 0) {
  const intent = bundle.intents[index], bound = { campaignId: bundle.campaignId, workspaceId: bundle.workspaceId, actorId: bundle.userId };
  const payloadText = JSON.stringify({ schema: 1, ...bound, ...intent });
  const resultText = JSON.stringify({ schema: 1, ...bound, resolutionId: intent.resolutionId, requestId: intent.requestId,
    requestExisted: false, fields: [], resolvedAt: "2026-09-13T12:00:00.000Z" });
  return { payloadText, payloadSha256: hash(payloadText), resultText, resultSha256: hash(resultText), replayed: false };
}
const packets = (bundle: PendingResolution) => bundle.intents.map((_, index) => packet(bundle, index));
const current = () => {};

describe("resolution recovery custody", () => {
  it("freezes both exact copies including whitespace and damaged strings", () => {
    const f = fixture("page held\0\udfff copy");
    expect(f.bundle.intents.map(intent => JSON.parse(intent.copyJson))).toEqual([original, "page held\0\udfff copy"]);
    expect(new Set(f.bundle.intents.map(intent => intent.resolutionId)).size).toBe(2);
    expect(f.bundle.intents.every(intent => intent.requestId === id(4))).toBe(true);
    expect(resolutionHasCopy(f.bundle, original)).toBe(true);
    expect(resolutionHasCopy(f.bundle, "different")).toBe(false);
    const s = storage(); s.values.set(sourceKey, '{"a":1}');
    const b = preparePendingResolution(s.api, scope, sourceKey, "Keep raw copies", '{ "a": 1 }');
    expect(b.intents).toHaveLength(2);
    expect(resolutionHasCopy(b, '{"a": 1}')).toBe(false);
  });
  it("deduplicates only identical copies", () => { expect(fixture(original).bundle.intents).toHaveLength(1); });
  it("preserves a page-held copy when storage has lost the source", () => {
    const f = storage(), b = preparePendingResolution(f.api, scope, sourceKey, "Resolve missing storage", original);
    expect(b.intents.map(intent => JSON.parse(intent.copyJson))).toEqual([original]);
    expect(() => preparePendingResolution(f.api, scope, sourceKey, "No surviving copy")).toThrow("unavailable");
  });
  it.each([sourceKey.replace(scope.userId, id(98)), sourceKey.replace(scope.campaignId, id(98)), sourceKey + ":extra",
    resolutionPendingPrefix({ ...scope, workspaceId: id(98) }) + id(4) + ":" + id(5),
    resolutionPendingPrefix(scope) + id(4) + ":bad", "unrelated:" + id(4)])("refuses unowned or malformed source key %s", key => {
    expect(() => resolutionRequestId(key, scope)).toThrow();
  });
  it("can retain a damaged earlier resolution bundle using its original request key", () => {
    const f = storage(), key = resolutionPendingPrefix(scope) + id(4) + ":" + id(5);
    f.values.set(key, "broken bundle");
    expect(preparePendingResolution(f.api, scope, key, "Resolve damaged bundle").intents[0].requestId).toBe(id(4));
  });
  it.each(["stored", "page"])("refuses a readable generation from another workspace in the %s copy", which => {
    const pending = pendingGenerationSchema.parse({ version: 1, ...scope, workspaceId: id(99), createdAt: "2026-09-13T12:00:00.000Z", phase: "refused",
      intent: { requestId: id(4), locale: "es", fields: [{ id: id(6), address: { entityType: "campaign", entityId: scope.campaignId, field: "title",
        expectedSource: { text: "Synthetic title", sourceLocale: "en", available: true }, expectedTranslation: null } }] } });
    expect(pendingGenerationKey(pending)).toBe(sourceKey);
    const f = storage(); f.values.set(sourceKey, which === "stored" ? JSON.stringify(pending) : original);
    expect(() => preparePendingResolution(f.api, scope, sourceKey, "Wrong scope", which === "page" ? JSON.stringify(pending) : undefined)).toThrow("scope differs");
  });
  it.each(["source-collision", "request", "resolution", "copy"])("rejects incoherent bundle %s", kind => {
    const f = fixture("second"), b = structuredClone(f.bundle);
    if (kind === "source-collision") b.sourceKey = pendingResolutionKey(b);
    if (kind === "request") b.intents[1].requestId = id(99);
    if (kind === "resolution") b.intents[1].resolutionId = b.intents[0].resolutionId;
    if (kind === "copy") b.intents[1].copyJson = b.intents[0].copyJson;
    expect(pendingResolutionSchema.safeParse(b).success).toBe(false);
  });
  it("retains exact intent for retry and refuses overwriting another retained intent", () => {
    const f = fixture(); expect(retainPendingResolution(f.api, f.bundle)).toEqual(f.bundle);
    const changed = structuredClone(f.bundle); changed.intents[0].reason = "Changed reason";
    expect(() => retainPendingResolution(f.api, changed)).toThrow("different recovery bundle");
    expect(JSON.parse(f.values.get(f.key)!)).toEqual(f.bundle);
  });
  it.each(["quota", "readback"])("refuses unretained dispatch intent on %s failure", kind => {
    const f = fixture(); f.values.delete(f.key);
    f.api.setItem = () => { if (kind === "quota") throw new Error("quota"); };
    expect(() => retainPendingResolution(f.api, f.bundle)).toThrow(kind === "quota" ? "quota" : "not retained");
    expect(f.values.get(sourceKey)).toBe(original);
  });
  it("reads only current scope and retains unreadable and mismatched bundles", () => {
    const f = fixture(), broken = resolutionPendingPrefix(scope) + id(4) + ":" + id(99);
    f.values.set(broken, JSON.stringify(f.bundle));
    const unreadable = resolutionPendingPrefix(scope) + "broken"; f.values.set(unreadable, "bad json");
    f.values.set(resolutionPendingPrefix({ ...scope, userId: id(98) }) + "hidden", "private");
    f.values.set(f.archive, "unchecked archive");
    expect(readResolutionRecovery(f.api, scope)).toEqual({ pending: [f.bundle], unreadable: [broken, unreadable], archives: [{ key: f.archive, raw: "unchecked archive" }] });
  });
  it.each(["payloadSha256", "resultSha256"] as const)("rejects invalid %s before touching originals", async key => {
    const f = fixture(), p = { ...packet(f.bundle), [key]: "a".repeat(64) }, before = [...f.values];
    await expect(archiveResolvedGeneration(f.api, f.bundle, [p], current)).rejects.toThrow("checksum differs");
    expect([...f.values]).toEqual(before);
  });
  it("rejects a correctly hashed receipt from another intent", async () => {
    const f = fixture(), other = structuredClone(f.bundle); other.intents[0].reason = "Different request";
    await expect(verifyBrowserResolution(packet(other), f.bundle, 0)).rejects.toThrow("differs from the retained request");
  });
  it("requires every copy receipt before creating an archive", async () => {
    const f = fixture("second"), before = [...f.values];
    await expect(archiveResolvedGeneration(f.api, f.bundle, [packet(f.bundle)], current)).rejects.toThrow("inventory differs");
    expect([...f.values]).toEqual(before);
  });
  it("archives verified receipts and exact copies before retiring both source and intent", async () => {
    const f = fixture("second");
    const remove = f.api.removeItem; f.api.removeItem = key => {
      expect(JSON.parse(f.values.get(f.archive)!)).toEqual({ version: 1, request: f.bundle, receipts: packets(f.bundle) }); remove(key);
    };
    expect(await archiveResolvedGeneration(f.api, f.bundle, packets(f.bundle), current)).toEqual({ archive: f.archive, sourceChanged: false });
    expect(f.values.has(sourceKey)).toBe(false); expect(f.values.has(f.key)).toBe(false);
  });
  it.each(["different", null])("preserves changed or absent original %s", async changed => {
    const f = fixture(); if (changed === null) f.values.delete(sourceKey); else f.values.set(sourceKey, changed);
    expect((await archiveResolvedGeneration(f.api, f.bundle, packets(f.bundle), current)).sourceChanged).toBe(changed !== null);
    expect(f.api.getItem(sourceKey)).toBe(changed);
  });
  it.each(["missing", "different"])("refuses a %s pending bundle before archiving", async kind => {
    const f = fixture(); if (kind === "missing") f.values.delete(f.key); else { const changed = structuredClone(f.bundle); changed.intents[0].reason = "New reason"; f.values.set(f.key, JSON.stringify(changed)); }
    await expect(archiveResolvedGeneration(f.api, f.bundle, packets(f.bundle), current)).rejects.toThrow("Retained resolution request changed");
    expect(f.values.has(f.archive)).toBe(false); expect(f.values.get(sourceKey)).toBe(original);
  });
  it("refuses replacing an existing different archive", async () => {
    const f = fixture(); f.values.set(f.archive, "earlier archive");
    await expect(archiveResolvedGeneration(f.api, f.bundle, packets(f.bundle), current)).rejects.toThrow("earlier resolution archive differs");
    expect(f.values.get(f.archive)).toBe("earlier archive"); expect(f.values.get(sourceKey)).toBe(original);
  });
  it.each(["quota", "readback", "pending-changed"])("preserves originals when archive write has %s failure", async kind => {
    const f = fixture(), set = f.api.setItem;
    f.api.setItem = (key, value) => { if (key !== f.archive) return set(key, value);
      if (kind === "quota") throw new Error("quota");
      if (kind === "readback") return;
      set(key, value); f.values.set(f.key, "changed during archive");
    };
    await expect(archiveResolvedGeneration(f.api, f.bundle, packets(f.bundle), current)).rejects.toThrow(kind === "quota" ? "quota" : "archive readback differs");
    expect(f.values.get(sourceKey)).toBe(original); expect(f.values.has(f.key)).toBe(true);
  });
  it.each([1, 2])("aborts stale lifecycle at checkpoint %s before retiring originals", async stop => {
    const f = fixture(); let calls = 0;
    await expect(archiveResolvedGeneration(f.api, f.bundle, packets(f.bundle), () => { if (++calls === stop) throw new Error("scope changed"); })).rejects.toThrow("scope changed");
    expect(calls).toBe(stop); expect(f.values.get(sourceKey)).toBe(original); expect(f.values.has(f.key)).toBe(true);
    expect(f.values.has(f.archive)).toBe(stop === 2);
  });
  it.each(["source", "pending"])("retries after failed %s retirement using replay receipts and the existing archive", async kind => {
    const f = fixture(), remove = f.api.removeItem, denied = kind === "source" ? sourceKey : f.key;
    f.api.removeItem = key => { if (key !== denied) remove(key); };
    await expect(archiveResolvedGeneration(f.api, f.bundle, packets(f.bundle), current)).rejects.toThrow("could not be retired");
    const retainedArchive = f.values.get(f.archive); expect(retainedArchive).toBeDefined(); expect(f.values.has(f.key)).toBe(true);
    f.api.removeItem = remove;
    await archiveResolvedGeneration(f.api, f.bundle, packets(f.bundle).map(p => ({ ...p, replayed: true })), current);
    expect(f.values.get(f.archive)).toBe(retainedArchive); expect(f.values.has(f.key)).toBe(false);
  });
  it("preserves a pending bundle changed during source retirement", async () => {
    const f = fixture(), remove = f.api.removeItem;
    f.api.removeItem = key => { remove(key); if (key === sourceKey) f.values.set(f.key, "changed at retirement"); };
    await expect(archiveResolvedGeneration(f.api, f.bundle, packets(f.bundle), current)).rejects.toThrow("changed before retirement");
    expect(f.values.get(f.key)).toBe("changed at retirement"); expect(f.values.has(f.archive)).toBe(true);
  });
});
