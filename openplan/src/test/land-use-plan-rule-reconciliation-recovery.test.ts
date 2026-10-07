import { beforeEach, describe, expect, it, vi } from "vitest";
import { acknowledgeRuleReconciliation, preserveRuleReconciliation, readRuleReconciliationRecovery, restoreRuleReconciliation, retainRuleReconciliation, sendRuleReconciliation, type PendingRuleReconciliation, type RuleReconciliationStorage } from "@/lib/land-use-plans/rule-reconciliation-recovery";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { actorId: id(1), workspaceId: id(2), planId: id(3) };
const command = { operation: "reconcile", commandId: id(4), versionId: id(5), expectedDraftRevision: 7, expectedDescriptorHash: "a".repeat(64) };
const pending: PendingRuleReconciliation = { ...scope, schemaVersion: 1, versionNumber: 2, savedAt: "2026-10-07T00:00:00Z", commandText: ` \n${JSON.stringify(command)}\n` };
const receipt = { ...scope, replayed: false, commandId: command.commandId, versionId: command.versionId,
  previousDraftRevision: 7, draftRevision: 8, descriptorHash: command.expectedDescriptorHash,
  addedSections: [{ id: id(6), requirementKey: "required" }], applicableRequirementKeys: ["required"], reconciledAt: "2026-10-07T00:00:00+00:00" };
let storage: RuleReconciliationStorage;
let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  storage = { get length() { return values.size; }, key: n => Array.from(values.keys())[n] ?? null,
    getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
});

describe("checklist request recovery", () => {
  it("sends retained exact bytes and scope, then clears only the confirmed command", async () => {
    retainRuleReconciliation(storage, pending);
    const newer = { ...pending, commandText: JSON.stringify({ ...command, commandId: id(7) }) };
    retainRuleReconciliation(storage, newer);
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json(receipt, { status: 201 }));
    expect(await sendRuleReconciliation(storage, pending, transport)).toEqual(receipt);
    expect(transport).toHaveBeenCalledWith(`/api/land-use-plans/${scope.planId}/reconcile-rules`, expect.objectContaining({
      method: "POST", body: pending.commandText, cache: "no-store",
      headers: { "Content-Type": "application/json", "x-openplan-expected-user": scope.actorId, "x-openplan-expected-workspace": scope.workspaceId },
    }));
    expect(readRuleReconciliationRecovery(storage, scope)).toHaveLength(2);
    acknowledgeRuleReconciliation(storage, pending);
    expect(readRuleReconciliationRecovery(storage, scope).map(record => record.pending)).toEqual([newer]);
  });
  it("accepts exact recovered receipts", async () => {
    retainRuleReconciliation(storage, pending);
    expect((await sendRuleReconciliation(storage, pending, vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...receipt, replayed: true }, { status: 200 })))).replayed).toBe(true);
  });
  it("refuses transport before retention and after changed retention", async () => {
    const transport = vi.fn<typeof fetch>();
    await expect(sendRuleReconciliation(storage, pending, transport)).rejects.toThrow("saved request changed");
    retainRuleReconciliation(storage, pending); const record = readRuleReconciliationRecovery(storage, scope)[0];
    values.set(record.key, "altered original");
    await expect(sendRuleReconciliation(storage, pending, transport)).rejects.toThrow("saved request changed");
    expect(transport).not.toHaveBeenCalled();
    expect(() => acknowledgeRuleReconciliation(storage, pending)).toThrow("copy changed");
    expect(values.get(record.key)).toBe("altered original");
  });
  it("refuses overwrites, quota failures and missing storage readback", () => {
    retainRuleReconciliation(storage, pending);
    expect(() => retainRuleReconciliation(storage, { ...pending, versionNumber: 3 })).toThrow("different saved copy");
    expect(readRuleReconciliationRecovery(storage, scope)[0].pending).toEqual(pending);
    storage.setItem = () => { throw new Error("quota"); };
    expect(() => retainRuleReconciliation(storage, pending)).toThrow("quota");
    values.clear(); storage.setItem = () => {};
    expect(() => retainRuleReconciliation(storage, pending)).toThrow("could not be saved");
  });
  it.each([401, 403, 409, 500, 503])("keeps the request after HTTP %s", async status => {
    retainRuleReconciliation(storage, pending);
    await expect(sendRuleReconciliation(storage, pending, vi.fn<typeof fetch>().mockResolvedValue(Response.json({}, { status })))).rejects.toThrow();
    expect(readRuleReconciliationRecovery(storage, scope)[0].pending).toEqual(pending);
  });
  it.each([
    { actorId: id(8) }, { workspaceId: id(8) }, { planId: id(8) }, { commandId: id(8) }, { versionId: id(8) },
    { previousDraftRevision: 8 }, { draftRevision: 6 }, { descriptorHash: "b".repeat(64) },
    { reconciledAt: "yesterday" }, { addedSections: [{ id: "invalid", requirementKey: "required" }] },
    { replayed: true }, { unexpected: true },
  ])("keeps requests with mismatched or malformed replies %j", async patch => {
    retainRuleReconciliation(storage, pending);
    await expect(sendRuleReconciliation(storage, pending, vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...receipt, ...patch }, { status: 201 })))).rejects.toThrow();
    expect(readRuleReconciliationRecovery(storage, scope)[0].pending).toEqual(pending);
  });
  it("keeps the original through lost, unreadable and aborted replies", async () => {
    retainRuleReconciliation(storage, pending);
    await expect(sendRuleReconciliation(storage, pending, vi.fn<typeof fetch>().mockRejectedValue(new Error("lost reply")))).rejects.toThrow("lost reply");
    await expect(sendRuleReconciliation(storage, pending, vi.fn<typeof fetch>().mockResolvedValue(new Response("{")))).rejects.toThrow();
    const controller = new AbortController();
    const reply = Response.json(receipt, { status: 201 }); const readReply = vi.spyOn(reply, "json");
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => { controller.abort(); return reply; });
    await expect(sendRuleReconciliation(storage, pending, transport, controller.signal)).rejects.toThrow();
    expect(readReply).not.toHaveBeenCalled();
    const never = vi.fn<typeof fetch>();
    await expect(sendRuleReconciliation(storage, pending, never, controller.signal)).rejects.toThrow();
    expect(never).not.toHaveBeenCalled();
    expect(readRuleReconciliationRecovery(storage, scope)[0].pending).toEqual(pending);
  });
  it("preserves unreadable exact originals and refuses to send or restore them", () => {
    retainRuleReconciliation(storage, pending); const key = readRuleReconciliationRecovery(storage, scope)[0].key;
    values.set(key, "{broken original");
    const record = readRuleReconciliationRecovery(storage, scope)[0]; expect(record.pending).toBeNull();
    preserveRuleReconciliation(storage, scope, record);
    expect(readRuleReconciliationRecovery(storage, scope)).toEqual([{ key: expect.stringContaining(":copy:"), raw: "{broken original", pending: null, archived: true }]);
    expect(() => restoreRuleReconciliation(storage, scope, record.raw)).toThrow();
  });
  it("keeps a request when cancellation arrives while reading its receipt", async () => {
    retainRuleReconciliation(storage, pending); const controller = new AbortController();
    const reply = Response.json(receipt, { status: 201 });
    vi.spyOn(reply, "json").mockImplementation(async () => { controller.abort(); return receipt; });
    await expect(sendRuleReconciliation(storage, pending, vi.fn<typeof fetch>().mockResolvedValue(reply), controller.signal)).rejects.toThrow();
    expect(readRuleReconciliationRecovery(storage, scope)[0].pending).toEqual(pending);
  });
  it("copies before removing and refuses an unverified copy", () => {
    retainRuleReconciliation(storage, pending); const record = readRuleReconciliationRecovery(storage, scope)[0];
    storage.setItem = () => {};
    expect(() => preserveRuleReconciliation(storage, scope, record)).toThrow("could not be verified");
    expect(storage.getItem(record.key)).toBe(record.raw);
  });
  it("restores locally and isolates accounts, workspaces and plans", () => {
    retainRuleReconciliation(storage, pending); const record = readRuleReconciliationRecovery(storage, scope)[0];
    preserveRuleReconciliation(storage, scope, record);
    expect(restoreRuleReconciliation(storage, scope, record.raw)).toEqual(pending);
    expect(readRuleReconciliationRecovery(storage, scope).filter(value => !value.archived)).toHaveLength(1);
    for (const key of ["actorId", "workspaceId", "planId"] as const) {
      const other = { ...scope, [key]: id(9) };
      expect(readRuleReconciliationRecovery(storage, other)).toEqual([]);
      expect(() => restoreRuleReconciliation(storage, other, record.raw)).toThrow("another account");
      expect(() => preserveRuleReconciliation(storage, other, record)).toThrow();
    }
    expect(() => restoreRuleReconciliation(storage, scope, " ".repeat(32769))).toThrow("larger");
  });
  it("reports failed cleanup without removing a different request", () => {
    retainRuleReconciliation(storage, pending); storage.removeItem = () => {};
    expect(() => acknowledgeRuleReconciliation(storage, pending)).toThrow("could not be cleared");
    expect(readRuleReconciliationRecovery(storage, scope)[0].pending).toEqual(pending);
  });
});
