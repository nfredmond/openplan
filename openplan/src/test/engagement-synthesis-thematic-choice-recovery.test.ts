// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { freezeThematicChoice, parsePendingThematicChoice, preservePendingThematicChoice, readPendingThematicChoice,
  sendThematicChoice, listPreservedThematicChoices, type ThematicChoiceScope } from "@/lib/engagement/synthesis-thematic-choice-recovery";
import type { ReviewStorage } from "@/lib/engagement/synthesis-review-recovery";

const id = (n: number) => `c7740000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const scope = { campaignId: id(1), workspaceId: id(2), userId: id(3), requestId: id(4), targetRecordId: `item:${id(5)}` };
function command(contextRequestId = id(6)) {
  const choiceText = JSON.stringify({ schemaVersion: 1, contextRequestId, targetRecordId: scope.targetRecordId, selectionSequence: 7,
    historyManifestSha256: hash("history"), finalCaptureSha256: hash("capture"), finalResultSha256: hash("result") });
  return { requestId: scope.requestId, contextRequestId, throughSequence: 7, targetRecordId: scope.targetRecordId,
    expected: { requestIntentSha256: hash("intent"), thematicSha256: hash("thematic"), choiceText } };
}
const receipt = { schemaVersion: 1, campaignId: scope.campaignId, workspaceId: scope.workspaceId, requestId: scope.requestId,
  targetRecordId: scope.targetRecordId, choiceText: command().expected.choiceText, choiceSha256: hash(command().expected.choiceText),
  createdBy: scope.userId, createdAt: "2026-10-07T08:00:00Z", replayed: false };
function fixture() {
  const rows = new Map<string, string>(), options = { read: false, write: false, remove: false, dropWrite: false,
    afterSet: null as null | ((name: string, raw: string) => void) };
  const storage: ReviewStorage = { get length() { return rows.size; }, key: index => [...rows.keys()][index] ?? null,
    getItem(name) { if (options.read) throw Error("Storage refused"); return rows.get(name) ?? null; },
    setItem(name, value) { if (options.write) throw Error("Storage full"); if (!options.dropWrite) rows.set(name, value); options.afterSet?.(name, value); },
    removeItem(name) { if (options.remove) throw Error("Cleanup refused"); rows.delete(name); } };
  const transport = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(receipt), { status: 201 }));
  return { rows, options, storage, transport, freeze: () => freezeThematicChoice(storage, scope, command()) };
}

describe("thematic choice browser custody", () => {
  it("lists exact preserved bytes only within the selected account and contribution", () => {
    const f = fixture(); f.freeze(); const name = [...f.rows.keys()][0];
    f.rows.set(name, "UNREADABLE original"); const copy = preservePendingThematicChoice(f.storage, scope)!;
    f.freeze(); f.rows.set("unrelated:preserved:copy", "private other record");
    expect(listPreservedThematicChoices(f.storage, scope)).toEqual([copy]);
    for (const field of ["userId", "workspaceId", "campaignId", "requestId", "targetRecordId"] as const) {
      expect(listPreservedThematicChoices(f.storage, { ...scope, [field]: field === "targetRecordId" ? `item:${id(99)}` : id(99) })).toEqual([]);
    }
  });
  it("retains exact inspected bytes, reopens without a write, and clears only after verified save", async () => {
    const f = fixture(), pending = f.freeze();
    expect(readPendingThematicChoice(f.storage, scope)).toEqual(pending); expect(f.transport).not.toHaveBeenCalled();
    const result = await sendThematicChoice(f.storage, pending, { transport: f.transport });
    expect(result).toEqual({ receipt, cleanupError: null }); expect(readPendingThematicChoice(f.storage, scope)).toBeNull();
    expect(f.transport).toHaveBeenCalledExactlyOnceWith(`/api/engagement/campaigns/${scope.campaignId}/synthesis/thematic-choices`,
      expect.objectContaining({ method: "POST", body: pending.commandText, cache: "no-store", headers: { "Content-Type": "application/json",
        "x-openplan-expected-user": scope.userId, "x-openplan-expected-workspace": scope.workspaceId } }));
  });
  it("recovers the same command after a lost acknowledgement and a remount", async () => {
    const f = fixture(), pending = f.freeze();
    f.transport.mockRejectedValueOnce(new Error("SYNTHETIC reply lost after server save"));
    await expect(sendThematicChoice(f.storage, pending, { transport: f.transport })).rejects.toThrow("reply lost");
    const restored = readPendingThematicChoice(f.storage, scope)!;
    f.transport.mockResolvedValueOnce(new Response(JSON.stringify({ ...receipt, replayed: true })));
    expect((await sendThematicChoice(f.storage, restored, { transport: f.transport })).receipt.replayed).toBe(true);
    expect(f.transport.mock.calls.map(call => call[1]?.body)).toEqual([pending.commandText, pending.commandText]);
  });
  it("preserves original JSON formatting across an exact retry", async () => {
    const f = fixture(), pending = f.freeze(), name = [...f.rows.keys()][0];
    pending.commandText = "\n" + pending.commandText + "\n"; f.rows.set(name, JSON.stringify(pending));
    const restored = readPendingThematicChoice(f.storage, scope)!;
    await sendThematicChoice(f.storage, restored, { transport: f.transport });
    expect(f.transport.mock.calls[0][1]?.body).toBe(pending.commandText);
  });
  it("refuses to replace an unconfirmed inspected choice", () => {
    const f = fixture(), pending = f.freeze();
    expect(() => freezeThematicChoice(f.storage, scope, command(id(90)))).toThrow("original unconfirmed");
    expect(readPendingThematicChoice(f.storage, scope)).toEqual(pending);
  });
  it.each(["userId", "workspaceId", "campaignId", "requestId", "targetRecordId"] as const)("separates %s slots and refuses substituted scope", key => {
    const f = fixture(), pending = f.freeze();
    const changed: ThematicChoiceScope = { ...scope, [key]: key === "targetRecordId" ? `item:${id(90)}` : id(90) };
    expect(readPendingThematicChoice(f.storage, changed)).toBeNull();
    expect(() => parsePendingThematicChoice(pending, changed)).toThrow("belongs to another");
    expect(f.rows.size).toBe(1);
  });
  it.each(["read", "write", "dropWrite"] as const)("refuses storage %s failure before transport", async fault => {
    const f = fixture(), pending = f.freeze(); f.options[fault] = true;
    if (fault === "dropWrite") f.rows.set([...f.rows.keys()][0], JSON.stringify({ ...pending, version: 1 }, null, 2));
    await expect(sendThematicChoice(f.storage, pending, { transport: f.transport })).rejects.toThrow();
    expect(f.transport).not.toHaveBeenCalled(); expect(f.rows.size).toBe(1);
  });
  it("refuses missing and unreadable copies before transport and preserves their raw bytes", async () => {
    const f = fixture(), pending = f.freeze(), name = [...f.rows.keys()][0]; f.rows.clear();
    await expect(sendThematicChoice(f.storage, pending, { transport: f.transport })).rejects.toThrow("Reopen");
    f.rows.set(name, "{UNREADABLE");
    expect(() => f.freeze()).toThrow();
    await expect(sendThematicChoice(f.storage, pending, { transport: f.transport })).rejects.toThrow();
    expect(f.rows.get(name)).toBe("{UNREADABLE"); expect(f.transport).not.toHaveBeenCalled();
  });
  it.each([400, 401, 403, 409, 503])("keeps pending custody after HTTP %i", async status => {
    const f = fixture(), pending = f.freeze(); f.transport.mockResolvedValueOnce(new Response("{}", { status }));
    await expect(sendThematicChoice(f.storage, pending, { transport: f.transport })).rejects.toMatchObject({ status });
    expect(readPendingThematicChoice(f.storage, scope)).toEqual(pending);
  });
  it.each(["choiceSha256", "choiceText", "createdBy", "requestId", "workspaceId"])("keeps custody after an altered receipt %s", async field => {
    const f = fixture(), pending = f.freeze();
    const value = field === "choiceSha256" ? hash("wrong") : field === "choiceText" ? receipt.choiceText + " " : id(99);
    f.transport.mockResolvedValueOnce(new Response(JSON.stringify({ ...receipt, [field]: value })));
    await expect(sendThematicChoice(f.storage, pending, { transport: f.transport })).rejects.toThrow("differs");
    expect(readPendingThematicChoice(f.storage, scope)).toEqual(pending);
  });
  it("keeps newer commands during delayed receipt cleanup", async () => {
    const f = fixture(), pending = f.freeze(), name = [...f.rows.keys()][0];
    const newer = { ...pending, commandText: JSON.stringify(command(id(90))) };
    f.transport.mockImplementationOnce(async () => { f.rows.set(name, JSON.stringify(newer)); return new Response(JSON.stringify(receipt)); });
    const result = await sendThematicChoice(f.storage, pending, { transport: f.transport });
    expect(result.receipt).toEqual(receipt); expect(result.cleanupError).toContain("Newer edits remain retained");
    expect(readPendingThematicChoice(f.storage, scope)).toEqual(newer);
  });
  it("reports a confirmed save separately from cleanup failure", async () => {
    const f = fixture(), pending = f.freeze(); f.options.remove = true;
    const result = await sendThematicChoice(f.storage, pending, { transport: f.transport });
    expect(result.receipt).toEqual(receipt); expect(result.cleanupError).not.toBeNull();
    expect(readPendingThematicChoice(f.storage, scope)).toEqual(pending);
  });
  it.each(["before", "during"])("retains custody when account selection changes %s transport", async when => {
    const f = fixture(), pending = f.freeze(); let current = when !== "before";
    f.transport.mockImplementationOnce(async () => { current = false; return new Response(JSON.stringify(receipt)); });
    await expect(sendThematicChoice(f.storage, pending, { transport: f.transport, isCurrent: () => current })).rejects.toThrow("account or context changed");
    expect(f.transport).toHaveBeenCalledTimes(when === "before" ? 0 : 1); expect(readPendingThematicChoice(f.storage, scope)).toEqual(pending);
  });
  it("keeps a reply from an aborted inspection from clearing custody", async () => {
    const f = fixture(), pending = f.freeze(), controller = new AbortController();
    f.transport.mockImplementationOnce(async () => { controller.abort(); return new Response(JSON.stringify(receipt)); });
    await expect(sendThematicChoice(f.storage, pending, { transport: f.transport, signal: controller.signal })).rejects.toThrow("account or context changed");
    expect(readPendingThematicChoice(f.storage, scope)).toEqual(pending);
  });
  it("preserves unreadable originals before freeing the slot", () => {
    const f = fixture(); f.freeze(); const name = [...f.rows.keys()][0]; f.rows.set(name, "UNREADABLE original");
    const result = preservePendingThematicChoice(f.storage, scope)!;
    expect(result.raw).toBe("UNREADABLE original"); expect(f.rows.get(result.key)).toBe(result.raw); expect(f.rows.has(name)).toBe(false);
    expect(preservePendingThematicChoice(f.storage, scope)).toBeNull();
  });
  it.each(["write", "dropWrite", "remove"] as const)("does not discard an original when preservation %s fails", fault => {
    const f = fixture(), pending = f.freeze(); f.options[fault] = true;
    expect(() => preservePendingThematicChoice(f.storage, scope)).toThrow();
    expect(readPendingThematicChoice(f.storage, scope)).toEqual(pending);
  });
  it("keeps a newer active copy when preservation overlaps a change", () => {
    const f = fixture(), pending = f.freeze(), name = [...f.rows.keys()][0];
    const newer = { ...pending, commandText: JSON.stringify(command(id(90))) };
    f.options.afterSet = () => f.rows.set(name, JSON.stringify(newer));
    expect(() => preservePendingThematicChoice(f.storage, scope)).toThrow("changed or could not");
    expect(readPendingThematicChoice(f.storage, scope)).toEqual(newer);
    expect([...f.rows.entries()].find(([key]) => key.includes(":preserved:"))?.[1]).toBe(JSON.stringify(pending));
  });
});
