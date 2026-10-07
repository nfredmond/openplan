import { beforeEach, describe, expect, it, vi } from "vitest";
import { acknowledgePlanFreeze, preservePlanFreeze, readPlanFreezeRecovery, restorePlanFreeze, retainPlanFreeze, sendPlanFreeze, type PendingPlanFreeze, type PlanFreezeStorage } from "@/lib/land-use-plans/freeze-recovery";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { actorId: id(1), workspaceId: id(2), planId: id(3) };
const command = { state: "public_review", commandId: id(4), versionId: id(5), expectedDraftRevision: 7, expectedDescriptorHash: "a".repeat(64) };
const pending: PendingPlanFreeze = { ...scope, schemaVersion: 1, versionNumber: 2, savedAt: "2026-10-07T00:00:00Z", commandText: ` \n${JSON.stringify(command)}\n` };
const receipt = { replayed: false, commandId: command.commandId, versionId: command.versionId, draftRevision: 7, contentHash: "b".repeat(64), frozenAt: "2026-10-07T00:00:00+00:00", reviewEventId: id(6) };
let storage: PlanFreezeStorage;
let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  storage = { get length() { return values.size; }, key: n => Array.from(values.keys())[n] ?? null,
    getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
});

describe("freeze request recovery", () => {
  it("sends retained exact bytes and scope, then clears only the confirmed command", async () => {
    retainPlanFreeze(storage, pending);
    const newer = { ...pending, commandText: JSON.stringify({ ...command, commandId: id(7) }) };
    retainPlanFreeze(storage, newer);
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json(receipt, { status: 201 }));
    expect(await sendPlanFreeze(storage, pending, transport)).toEqual(receipt);
    expect(transport).toHaveBeenCalledWith(`/api/land-use-plans/${scope.planId}/freeze`, expect.objectContaining({
      method: "POST", body: pending.commandText, cache: "no-store",
      headers: { "Content-Type": "application/json", "x-openplan-expected-user": scope.actorId, "x-openplan-expected-workspace": scope.workspaceId },
    }));
    expect(readPlanFreezeRecovery(storage, scope)).toHaveLength(2);
    acknowledgePlanFreeze(storage, pending);
    expect(readPlanFreezeRecovery(storage, scope).map(record => record.pending)).toEqual([newer]);
  });
  it("accepts exact recovered receipts", async () => {
    retainPlanFreeze(storage, pending);
    expect((await sendPlanFreeze(storage, pending, vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...receipt, replayed: true }, { status: 200 })))).replayed).toBe(true);
  });
  it("refuses transport before retention and after changed retention", async () => {
    const transport = vi.fn<typeof fetch>();
    await expect(sendPlanFreeze(storage, pending, transport)).rejects.toThrow("saved request changed");
    retainPlanFreeze(storage, pending); const record = readPlanFreezeRecovery(storage, scope)[0];
    values.set(record.key, "altered original");
    await expect(sendPlanFreeze(storage, pending, transport)).rejects.toThrow("saved request changed");
    expect(transport).not.toHaveBeenCalled();
    expect(() => acknowledgePlanFreeze(storage, pending)).toThrow("copy changed");
    expect(values.get(record.key)).toBe("altered original");
  });
  it("refuses overwrites, quota failures and missing storage readback", () => {
    retainPlanFreeze(storage, pending);
    expect(() => retainPlanFreeze(storage, { ...pending, versionNumber: 3 })).toThrow("different saved copy");
    expect(readPlanFreezeRecovery(storage, scope)[0].pending).toEqual(pending);
    storage.setItem = () => { throw new Error("quota"); };
    expect(() => retainPlanFreeze(storage, pending)).toThrow("quota");
    values.clear(); storage.setItem = () => {};
    expect(() => retainPlanFreeze(storage, pending)).toThrow("could not be saved");
  });
  it.each([401, 403, 409, 500, 503])("keeps the request after HTTP %s", async status => {
    retainPlanFreeze(storage, pending);
    await expect(sendPlanFreeze(storage, pending, vi.fn<typeof fetch>().mockResolvedValue(Response.json({}, { status })))).rejects.toThrow();
    expect(readPlanFreezeRecovery(storage, scope)[0].pending).toEqual(pending);
  });
  it.each([
    { commandId: id(8) }, { versionId: id(8) }, { draftRevision: 8 }, { contentHash: "invalid" },
    { frozenAt: "yesterday" }, { reviewEventId: "invalid" }, { replayed: true }, { unexpected: true },
  ])("keeps requests with mismatched or malformed replies %j", async patch => {
    retainPlanFreeze(storage, pending);
    await expect(sendPlanFreeze(storage, pending, vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...receipt, ...patch }, { status: 201 })))).rejects.toThrow();
    expect(readPlanFreezeRecovery(storage, scope)[0].pending).toEqual(pending);
  });
  it("keeps the original through lost, unreadable and aborted replies", async () => {
    retainPlanFreeze(storage, pending);
    await expect(sendPlanFreeze(storage, pending, vi.fn<typeof fetch>().mockRejectedValue(new Error("lost reply")))).rejects.toThrow("lost reply");
    await expect(sendPlanFreeze(storage, pending, vi.fn<typeof fetch>().mockResolvedValue(new Response("{")))).rejects.toThrow();
    const controller = new AbortController();
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => { controller.abort(); return Response.json(receipt, { status: 201 }); });
    await expect(sendPlanFreeze(storage, pending, transport, controller.signal)).rejects.toThrow();
    const never = vi.fn<typeof fetch>();
    await expect(sendPlanFreeze(storage, pending, never, controller.signal)).rejects.toThrow();
    expect(never).not.toHaveBeenCalled();
    expect(readPlanFreezeRecovery(storage, scope)[0].pending).toEqual(pending);
  });
  it("preserves unreadable exact originals and refuses to send or restore them", () => {
    retainPlanFreeze(storage, pending); const key = readPlanFreezeRecovery(storage, scope)[0].key;
    values.set(key, "{broken original");
    const record = readPlanFreezeRecovery(storage, scope)[0]; expect(record.pending).toBeNull();
    preservePlanFreeze(storage, scope, record);
    expect(readPlanFreezeRecovery(storage, scope)).toEqual([{ key: expect.stringContaining(":copy:"), raw: "{broken original", pending: null, archived: true }]);
    expect(() => restorePlanFreeze(storage, scope, record.raw)).toThrow();
  });
  it("copies before removing and refuses an unverified copy", () => {
    retainPlanFreeze(storage, pending); const record = readPlanFreezeRecovery(storage, scope)[0];
    storage.setItem = () => {};
    expect(() => preservePlanFreeze(storage, scope, record)).toThrow("could not be verified");
    expect(storage.getItem(record.key)).toBe(record.raw);
  });
  it("restores locally and isolates accounts, workspaces and plans", () => {
    retainPlanFreeze(storage, pending); const record = readPlanFreezeRecovery(storage, scope)[0];
    preservePlanFreeze(storage, scope, record);
    expect(restorePlanFreeze(storage, scope, record.raw)).toEqual(pending);
    expect(readPlanFreezeRecovery(storage, scope).filter(value => !value.archived)).toHaveLength(1);
    for (const key of ["actorId", "workspaceId", "planId"] as const) {
      const other = { ...scope, [key]: id(9) };
      expect(readPlanFreezeRecovery(storage, other)).toEqual([]);
      expect(() => restorePlanFreeze(storage, other, record.raw)).toThrow("another account");
      expect(() => preservePlanFreeze(storage, other, record)).toThrow();
    }
    expect(() => restorePlanFreeze(storage, scope, " ".repeat(32769))).toThrow("larger");
  });
  it("reports failed cleanup without removing a different request", () => {
    retainPlanFreeze(storage, pending); storage.removeItem = () => {};
    expect(() => acknowledgePlanFreeze(storage, pending)).toThrow("could not be cleared");
    expect(readPlanFreezeRecovery(storage, scope)[0].pending).toEqual(pending);
  });
});
