import { beforeEach, describe, expect, it, vi } from "vitest";
import { placeOfRecordFromCapturedArea } from "@/lib/geographies/study-area-capture";
import { planContextDraft, contextCommandFromDraft } from "@/lib/land-use-plans/plan-context-draft";
import { serializePlanContextSave, type PlanContextSaveResult } from "@/lib/land-use-plans/plan-context-command";
import { acknowledgePlanContextCommand, loadPlanContext, makePlanContextDraft, planContextDraftMatchesCurrent, preservePlanContextRecord,
  readPlanContextRecovery, restorePlanContextCommand, restorePlanContextDraft, retainPlanContextCommand, retainPlanContextDraft, sendPlanContextCommand,
  type PendingPlanContext, type PlanContextRead, type PlanContextStorage } from "@/lib/land-use-plans/plan-context-recovery";
import type { SavedPlanContext } from "@/lib/land-use-plans/plan-context";
const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { actorId: id(1), workspaceId: id(2), planId: id(3) };
const base = { versionId: id(4), contextHash: "a".repeat(64), descriptorId: "neutral", planKindKey: "general" };
const context: SavedPlanContext = { schemaVersion: 1, savedBy: scope.actorId, savedAt: "2026-10-07T00:00:00Z",
  place: { source: "drawn", kind: null, ref: null, label: "Synthetic study area", countryCode: null, subdivisionCode: null,
    bbox: { minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 }, geometry: { type: "Polygon", coordinates: [[[0,0],[1,0],[1,1],[0,0]]] } },
  assessment: { authorities: [{ id: id(5), label: "Synthetic planning body", role: "Study sponsor", kind: "unassessed", jurisdiction: null, sourceUrls: [] }],
    applicability: { status: "unresolved", explanation: "Scope remains unassessed." } } };
const draft = planContextDraft(context, { authority: "", geography: "" });
const command = contextCommandFromDraft(draft, { versionId: base.versionId, descriptorId: base.descriptorId, planKindKey: base.planKindKey, expectedContextHash: base.contextHash, commandId: id(6) });
const pending: PendingPlanContext = { ...scope, schemaVersion: 1, kind: "pending", savedAt: context.savedAt, base, draft,
  commandText: ` \n${serializePlanContextSave(command)}\n`, retainedPlace: context.place };
const receipt: PlanContextSaveResult = { replayed: false, context, contextHash: "b".repeat(64), commandId: id(6), versionId: base.versionId };
const current: PlanContextRead = { ...scope, ...base, contextState: { status: "retained", context }, canWrite: true };
let values: Map<string,string>, storage: PlanContextStorage;
const transportWith = (value: unknown, status = 200) => vi.fn<typeof fetch>().mockResolvedValue(Response.json(value, { status }));
beforeEach(() => {
  values = new Map(); storage = { get length() { return values.size; }, key: n => [...values.keys()][n] ?? null,
    getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
});
describe("context recovery", () => {
  it("reads a scoped retained or explicitly historical context without caching", async () => {
    const transport = transportWith(current);
    expect(await loadPlanContext(scope, transport)).toEqual(current);
    expect(transport).toHaveBeenCalledWith(`/api/land-use-plans/${scope.planId}/context`, expect.objectContaining({ cache: "no-store" }));
    const legacy = { ...current, contextHash: null, contextState: { status: "legacy" }, versionId: null, canWrite: false };
    expect(await loadPlanContext(scope, transportWith(legacy))).toEqual(legacy);
  });
  it.each(["actorId", "workspaceId", "planId"] as const)("refuses another %s on reads and recovered copies", async field => {
    const other = { ...scope, [field]: id(20) };
    await expect(loadPlanContext(other, transportWith(current))).rejects.toThrow("another account");
    retainPlanContextCommand(storage, pending);
    expect(readPlanContextRecovery(storage, other)).toEqual([]);
    expect(() => restorePlanContextCommand(storage, other, JSON.stringify(pending))).toThrow("another account");
    expect(() => restorePlanContextDraft(storage, other, JSON.stringify(pending), id(30), context.savedAt)).toThrow("another account");
  });
  it.each([
    { contextState: { status: "invalid" } }, { contextHash: null }, { contextState: { status: "legacy" } }, { versionId: "bad" },
    { contextState: { status: "retained", context: { ...context, assessment: { ...context.assessment, authorities: [{ ...context.assessment.authorities[0], label: " padded " }] } } } },
    { unknown: true }, { canWrite: undefined },
  ])("preserves unreadable current state as failure %j", async patch => {
    await expect(loadPlanContext(scope, transportWith({ ...current, ...patch }))).rejects.toThrow();
  });
  it.each([201, 401, 403, 404, 500])("refuses read status %s", async status => {
    await expect(loadPlanContext(scope, transportWith(current, status))).rejects.toThrow("could not be read");
  });
  it("owns mutable drafts separately and preserves a stale base when restoring", () => {
    const owned = makePlanContextDraft(scope, base, draft, id(10));
    const first = retainPlanContextDraft(storage, owned, null);
    const other = retainPlanContextDraft(storage, { ...owned, instanceId: id(11) }, null);
    const changed = { ...owned, draft: { ...draft, applicability: { ...draft.applicability, explanation: "Incomplete revision " } } };
    expect(() => retainPlanContextDraft(storage, changed, null)).toThrow("copy changed");
    const second = retainPlanContextDraft(storage, changed, first.raw);
    expect(values.get(other.key)).toBe(other.raw);
    expect(values.get(second.key)).toBe(second.raw);
    const restored = restorePlanContextDraft(storage, scope, first.raw, id(12), context.savedAt);
    expect(restored.value.base).toEqual(base);
    expect(restored.value.draft).toEqual(draft);
    expect(values.get(first.key)).toBe(second.raw);
    expect(() => restorePlanContextDraft(storage, scope, first.raw, id(10), context.savedAt)).toThrow("copy changed");
    expect(planContextDraftMatchesCurrent(restored.value, current)).toBe(true);
    for (const patch of [{ versionId: id(40) }, { contextHash: "c".repeat(64) }, { descriptorId: "other" }, { planKindKey: "other" }, { actorId: id(40) }, { workspaceId: id(40) }, { planId: id(40) }]) {
      expect(planContextDraftMatchesCurrent(restored.value, { ...current, ...patch })).toBe(false);
    }
  });
  it("retains incomplete text and refuses failed draft storage readback", () => {
    const incomplete = { ...draft, authorities: [{ ...draft.authorities[0], label: "", sourceText: "https://unfinished " }] };
    const owned = makePlanContextDraft(scope, base, incomplete, id(10));
    expect(retainPlanContextDraft(storage, owned, null).value.draft).toEqual(incomplete);
    values.clear(); storage.setItem = () => {};
    expect(() => retainPlanContextDraft(storage, owned, null)).toThrow("could not be retained");
  });
  it("sends exact bytes and current-account headers and clears only the confirmed command", async () => {
    const ownDraft = retainPlanContextDraft(storage, makePlanContextDraft(scope, base, draft, id(10)), null);
    retainPlanContextCommand(storage, pending);
    const newer = { ...pending, commandText: serializePlanContextSave({ ...command, commandId: id(7) }) };
    retainPlanContextCommand(storage, newer);
    const transport = transportWith(receipt, 201);
    expect(await sendPlanContextCommand(storage, pending, transport)).toEqual(receipt);
    expect(transport).toHaveBeenCalledWith(`/api/land-use-plans/${scope.planId}/context`, expect.objectContaining({ method: "POST", body: pending.commandText, cache: "no-store",
      headers: { "Content-Type": "application/json", "x-openplan-expected-user": scope.actorId, "x-openplan-expected-workspace": scope.workspaceId } }));
    acknowledgePlanContextCommand(storage, pending, receipt);
    expect(readPlanContextRecovery(storage, scope).map(r => r.value)).toEqual([ownDraft.value, newer]);
    expect((await sendPlanContextCommand(storage, newer, transportWith({ ...receipt, commandId: id(7), replayed: true }, 200))).replayed).toBe(true);
  });
  it("refuses sending before retention, changed originals and duplicate command overwrites", async () => {
    const transport = vi.fn<typeof fetch>();
    await expect(sendPlanContextCommand(storage, pending, transport)).rejects.toThrow("retained request changed");
    retainPlanContextCommand(storage, pending);
    expect(() => retainPlanContextCommand(storage, { ...pending, savedAt: "2026-10-08T00:00:00Z" })).toThrow("different saved copy");
    const record = readPlanContextRecovery(storage, scope)[0]; values.set(record.key, "changed original");
    await expect(sendPlanContextCommand(storage, pending, transport)).rejects.toThrow("retained request changed");
    expect(() => acknowledgePlanContextCommand(storage, pending, receipt)).toThrow("browser copy changed");
    expect(transport).not.toHaveBeenCalled(); expect(values.get(record.key)).toBe("changed original");
  });
  it("refuses missing pending readback and quota errors before transport", () => {
    storage.setItem = () => {};
    expect(() => retainPlanContextCommand(storage, pending)).toThrow("Nothing was sent");
    storage.setItem = () => { throw new Error("quota"); };
    expect(() => retainPlanContextCommand(storage, pending)).toThrow("quota");
  });
  it.each([
    { base: { ...base, versionId: id(30) } }, { base: { ...base, contextHash: "c".repeat(64) } },
    { base: { ...base, descriptorId: "changed" } }, { base: { ...base, planKindKey: "changed" } },
    { draft: { ...draft, authorities: [{ ...draft.authorities[0], label: "Changed body" }] } },
    { retainedPlace: null }, { base: { ...base, contextHash: null }, commandText: serializePlanContextSave({ ...command, expectedContextHash: null }) },
    { commandText: JSON.stringify({ ...command, assessment: { ...command.assessment, authorities: [{ ...command.assessment.authorities[0], label: " padded " }] } }) },
  ])("refuses commands that diverge from retained draft and base %j", patch => {
    expect(() => retainPlanContextCommand(storage, { ...pending, ...patch })).toThrow(); expect(values.size).toBe(0);
  });
  it("bounds command bytes including multibyte text and recovery file bytes", () => {
    // Legal individual fields can collectively exceed the route byte limit.
    const large = structuredClone(draft);
    large.authorities = Array.from({ length: 30 }, (_, i) => ({ ...large.authorities[0], id: id(100 + i), sourceText: Array.from({ length: 30 }, () => `https://example.test/${"é".repeat(1300)}`).join("\n") }));
    const oversized = { ...pending, draft: large, commandText: serializePlanContextSave(contextCommandFromDraft(large, { ...command })) };
    expect(oversized.commandText.length).toBeLessThan(2_000_000);
    expect(new TextEncoder().encode(oversized.commandText).length).toBeGreaterThan(2_000_000);
    expect(() => retainPlanContextCommand(storage, oversized)).toThrow("size limit");
    expect(() => restorePlanContextCommand(storage, scope, "é".repeat(6_000_001))).toThrow("size limit");
  });
  it.each([401,403,409,500,503])("keeps requests after save status %s", async status => {
    retainPlanContextCommand(storage, pending);
    await expect(sendPlanContextCommand(storage, pending, transportWith({}, status))).rejects.toThrow();
    expect(readPlanContextRecovery(storage, scope)[0].value).toEqual(pending);
  });
  it.each([
    { commandId: id(20) }, { versionId: id(20) }, { context: { ...context, savedBy: id(20) } },
    { context: { ...context, assessment: { ...context.assessment, applicability: { status: "unresolved", explanation: "Different assessment" } } } },
    { context: { ...context, place: { ...context.place, label: "Different boundary" } } },
    { context: { ...context, place: { ...context.place, geometry: { type: "Polygon", coordinates: [[[0,0],[2,0],[2,1],[0,0]]] } } } },
    { context: { ...context, place: { ...context.place, label: " padded " } } }, { contextHash: "invalid" }, { unexpected: true }, { replayed: true },
  ])("keeps malformed or mismatched save replies %j", async patch => {
    retainPlanContextCommand(storage, pending);
    await expect(sendPlanContextCommand(storage, pending, transportWith({ ...receipt, ...patch },201))).rejects.toThrow();
    expect(readPlanContextRecovery(storage, scope)[0].value).toEqual(pending);
  });
  it.each(["drawn", "uploaded", "place"] as const)("verifies the returned %s study area", async mode => {
    const nextDraft = { ...draft, place: { ...draft.place, mode, kind: "county" as const, geoid: "41051" } };
    const nextCommand = contextCommandFromDraft(nextDraft, { ...command });
    const next = { ...pending, draft: nextDraft, commandText: serializePlanContextSave(nextCommand), retainedPlace: null };
    const place = nextCommand.place.mode === "drawn" || nextCommand.place.mode === "uploaded" ? placeOfRecordFromCapturedArea(nextCommand.place)!
      : { ...context.place, source: "tigerweb", kind: "county", ref: "41051", countryCode: "US", subdivisionCode: "OR" };
    const result = { ...receipt, context: { ...context, place } } as PlanContextSaveResult;
    retainPlanContextCommand(storage, next);
    expect(await sendPlanContextCommand(storage, next, transportWith(result,201))).toEqual(result);
    for (const patch of [{ label: "different" }, { source: "unexpected" }, { geometry: { type: "Polygon", coordinates: [[[0,0],[2,0],[2,1],[0,0]]] } }]) {
      if (mode === "place" && "geometry" in patch) continue; // The server resolves searched geometry; the client has no immutable geometry to compare.
      await expect(sendPlanContextCommand(storage, next, transportWith({ ...result, context: { ...result.context, place: { ...place, ...patch } } },201))).rejects.toThrow();
    }
    if (mode === "place") for (const patch of [{ kind: "place" }, { ref: "06001" }, { countryCode: "CA" }, { subdivisionCode: "CA" }]) {
      await expect(sendPlanContextCommand(storage, next, transportWith({ ...result, context: { ...result.context, place: { ...place, ...patch } } },201))).rejects.toThrow();
    }
    expect(() => retainPlanContextCommand(storage, { ...next, retainedPlace: context.place })).toThrow("matching saved study area");
  });
  it("keeps lost, unreadable and aborted requests, and never starts an aborted request", async () => {
    retainPlanContextCommand(storage,pending);
    await expect(sendPlanContextCommand(storage,pending,vi.fn<typeof fetch>().mockRejectedValue(new Error("lost")))).rejects.toThrow("lost");
    await expect(sendPlanContextCommand(storage,pending,vi.fn<typeof fetch>().mockResolvedValue(new Response("{")))).rejects.toThrow();
    const controller = new AbortController();
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => { controller.abort(); return Response.json(receipt,{status:201}); });
    await expect(sendPlanContextCommand(storage,pending,transport,controller.signal)).rejects.toThrow();
    const never = vi.fn<typeof fetch>();
    await expect(sendPlanContextCommand(storage,pending,never,controller.signal)).rejects.toThrow();
    await expect(loadPlanContext(scope,never,controller.signal)).rejects.toThrow();
    expect(never).not.toHaveBeenCalled(); expect(readPlanContextRecovery(storage,scope)[0].value).toEqual(pending);
  });
  it("preserves malformed originals exactly and restores valid requests without sending", () => {
    retainPlanContextCommand(storage,pending); const first = readPlanContextRecovery(storage,scope)[0];
    preservePlanContextRecord(storage,scope,first);
    expect(restorePlanContextCommand(storage,scope,first.raw)).toEqual(pending);
    values.set(first.key,"{broken original");
    const malformed = readPlanContextRecovery(storage,scope).find(r=>r.key===first.key)!;
    expect(malformed.value).toBeNull(); preservePlanContextRecord(storage,scope,malformed);
    expect([...values.values()]).toContain("{broken original");
    expect(() => restorePlanContextCommand(storage,scope,"{broken original")).toThrow();
    const owned = makePlanContextDraft(scope,base,draft,id(10));
    expect(() => restorePlanContextCommand(storage,scope,JSON.stringify(owned))).toThrow("not a submitted request");
  });
  it("refuses wrong-key records and refuses preservation without verified copy or scope", () => {
    retainPlanContextCommand(storage,pending); const first = readPlanContextRecovery(storage,scope)[0];
    values.set(first.key.replace(id(6),id(8)),first.raw);
    expect(readPlanContextRecovery(storage,scope).find(r=>r.key.endsWith(id(8)))?.value).toBeNull();
    expect(() => preservePlanContextRecord(storage,{...scope,actorId:id(20)},first)).toThrow("copy changed");
    storage.setItem = () => {};
    expect(() => preservePlanContextRecord(storage,scope,first)).toThrow("could not be verified"); expect(values.get(first.key)).toBe(first.raw);
    values.set(first.key,"newer");
    expect(() => preservePlanContextRecord(storage,scope,first)).toThrow("copy changed");
  });
  it("keeps copies when storage enumeration fails and refuses archive nesting or identifier collisions", () => {
    retainPlanContextCommand(storage,pending); const first = readPlanContextRecovery(storage,scope)[0];
    const random = vi.spyOn(crypto,"randomUUID").mockReturnValue(id(90));
    try {
      const collision = first.key.replace(`pending:${id(6)}`,`copy:${id(90)}`);
      values.set(collision,"existing recovery copy");
      expect(() => preservePlanContextRecord(storage,scope,first)).toThrow("already uses");
      expect(values.get(collision)).toBe("existing recovery copy"); values.delete(collision);
      preservePlanContextRecord(storage,scope,first);
      const archived = readPlanContextRecovery(storage,scope)[0];
      expect(() => preservePlanContextRecord(storage,scope,archived)).toThrow("copy changed");
      storage.key = () => { throw new Error("storage unavailable"); };
      expect(() => readPlanContextRecovery(storage,scope)).toThrow("storage unavailable");
      expect(values.get(collision)).toBe(first.raw);
    } finally { random.mockRestore(); }
  });
  it("preserves a concurrently changed original while making its recovery copy", () => {
    retainPlanContextCommand(storage,pending); const first = readPlanContextRecovery(storage,scope)[0];
    storage.setItem = (key,value) => { values.set(key,value); if(key.includes(":copy:")) values.set(first.key,"newer original"); };
    expect(() => preservePlanContextRecord(storage,scope,first)).toThrow("could not be verified");
    expect(values.get(first.key)).toBe("newer original"); expect([...values.values()]).toContain(first.raw);
  });
  it("keeps requests when cancellation arrives during response parsing", async () => {
    retainPlanContextCommand(storage,pending);
    for (const mode of ["load","send"] as const) {
      const controller = new AbortController(), response = Response.json(mode === "load" ? current : receipt, {status:mode === "load" ? 200 : 201});
      response.json = async () => { controller.abort(); return mode === "load" ? current : receipt; };
      const transport = vi.fn<typeof fetch>().mockResolvedValue(response);
      await expect(mode === "load" ? loadPlanContext(scope,transport,controller.signal) : sendPlanContextCommand(storage,pending,transport,controller.signal)).rejects.toThrow();
    }
    expect(readPlanContextRecovery(storage,scope)[0].value).toEqual(pending);
  });
  it("requires a matching receipt and reports failed cleanup without losing originals", () => {
    retainPlanContextCommand(storage,pending);
    expect(() => acknowledgePlanContextCommand(storage,pending,{...receipt,commandId:id(30)})).toThrow("does not confirm");
    storage.removeItem = () => {};
    expect(() => acknowledgePlanContextCommand(storage,pending,receipt)).toThrow("could not be cleared");
    const first = readPlanContextRecovery(storage,scope)[0];
    expect(() => preservePlanContextRecord(storage,scope,first)).toThrow("could not be moved aside");
    expect(values.get(first.key)).toBe(first.raw);
  });
});
