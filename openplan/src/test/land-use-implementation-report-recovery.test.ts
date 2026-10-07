import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { acknowledgeImplementationReport, preserveImplementationReport, readImplementationReportRecovery, restoreImplementationReport, retainImplementationReport, sendImplementationReport, type PendingImplementationReport, type ImplementationReportStorage } from "@/lib/land-use-plans/implementation-report-recovery";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { actorId: id(1), workspaceId: id(2), planId: id(3) };
const command = { operation: "generate", commandId: id(4), versionId: id(5), expectedVersionHash: "a".repeat(64), reportingPeriodStart: "2026-01-01", reportingPeriodEnd: "2026-10-07", title: "SYNTHETIC report", summary: null };
const pending: PendingImplementationReport = { ...scope, schemaVersion: 1, versionNumber: 2, savedAt: "2026-10-07T00:00:00Z", commandText: ` \n${JSON.stringify(command)}\n` };
const receipt = { ...scope, replayed: false, commandId: command.commandId, versionId: command.versionId,
  commandSha256: createHash("sha256").update(pending.commandText).digest("hex"), adoptedVersionContentHash: command.expectedVersionHash,
  reportId: id(10), artifactId: id(11), implementationReportId: id(12), contentHash: "b".repeat(64),
  reportingPeriodStart: command.reportingPeriodStart, reportingPeriodEnd: command.reportingPeriodEnd, title: command.title, summary: null,
  generatedAt: "2026-10-07T00:00:00+00:00" };
let storage: ImplementationReportStorage;
let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  storage = { get length() { return values.size; }, key: n => Array.from(values.keys())[n] ?? null,
    getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
});

describe("implementation report request recovery", () => {
  it("sends retained exact bytes and scope, then clears only the confirmed command", async () => {
    retainImplementationReport(storage, pending);
    const newer = { ...pending, commandText: JSON.stringify({ ...command, commandId: id(7) }) };
    retainImplementationReport(storage, newer);
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json(receipt, { status: 201 }));
    expect(await sendImplementationReport(storage, pending, transport)).toEqual(receipt);
    expect(transport).toHaveBeenCalledWith(`/api/land-use-plans/${scope.planId}/implementation-reports`, expect.objectContaining({
      method: "POST", body: pending.commandText, cache: "no-store",
      headers: { "Content-Type": "application/json", "x-openplan-expected-user": scope.actorId, "x-openplan-expected-workspace": scope.workspaceId },
    }));
    expect(readImplementationReportRecovery(storage, scope)).toHaveLength(2);
    acknowledgeImplementationReport(storage, pending);
    expect(readImplementationReportRecovery(storage, scope).map(record => record.pending)).toEqual([newer]);
  });
  it("accepts exact recovered receipts", async () => {
    retainImplementationReport(storage, pending);
    expect((await sendImplementationReport(storage, pending, vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...receipt, replayed: true }, { status: 200 })))).replayed).toBe(true);
  });
  it("refuses transport before retention and after changed retention", async () => {
    const transport = vi.fn<typeof fetch>();
    await expect(sendImplementationReport(storage, pending, transport)).rejects.toThrow("saved request changed");
    retainImplementationReport(storage, pending); const record = readImplementationReportRecovery(storage, scope)[0];
    values.set(record.key, "altered original");
    await expect(sendImplementationReport(storage, pending, transport)).rejects.toThrow("saved request changed");
    expect(transport).not.toHaveBeenCalled();
    expect(() => acknowledgeImplementationReport(storage, pending)).toThrow("copy changed");
    expect(values.get(record.key)).toBe("altered original");
  });
  it("refuses overwrites, quota failures and missing storage readback", () => {
    retainImplementationReport(storage, pending);
    expect(() => retainImplementationReport(storage, { ...pending, versionNumber: 3 })).toThrow("different saved copy");
    expect(readImplementationReportRecovery(storage, scope)[0].pending).toEqual(pending);
    storage.setItem = () => { throw new Error("quota"); };
    expect(() => retainImplementationReport(storage, pending)).toThrow("quota");
    values.clear(); storage.setItem = () => {};
    expect(() => retainImplementationReport(storage, pending)).toThrow("could not be saved");
  });
  it.each([401, 403, 409, 500, 503])("keeps the request after HTTP %s", async status => {
    retainImplementationReport(storage, pending);
    await expect(sendImplementationReport(storage, pending, vi.fn<typeof fetch>().mockResolvedValue(Response.json({}, { status })))).rejects.toThrow();
    expect(readImplementationReportRecovery(storage, scope)[0].pending).toEqual(pending);
  });
  it.each([
    { actorId: id(8) }, { workspaceId: id(8) }, { planId: id(8) }, { commandId: id(8) }, { versionId: id(8) },
    { adoptedVersionContentHash: "b".repeat(64) }, { commandSha256: "b".repeat(64) },
    { reportingPeriodStart: "2026-01-02" }, { reportingPeriodEnd: "2026-10-08" }, { title: "changed" }, { summary: "changed" },
    { generatedAt: "yesterday" }, { reportId: "invalid" }, { artifactId: "invalid" }, { implementationReportId: "invalid" },
    { replayed: true }, { unexpected: true },
  ])("keeps requests with mismatched or malformed replies %j", async patch => {
    retainImplementationReport(storage, pending);
    await expect(sendImplementationReport(storage, pending, vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...receipt, ...patch }, { status: 201 })))).rejects.toThrow();
    expect(readImplementationReportRecovery(storage, scope)[0].pending).toEqual(pending);
  });
  it("keeps the original through lost, unreadable and aborted replies", async () => {
    retainImplementationReport(storage, pending);
    await expect(sendImplementationReport(storage, pending, vi.fn<typeof fetch>().mockRejectedValue(new Error("lost reply")))).rejects.toThrow("lost reply");
    await expect(sendImplementationReport(storage, pending, vi.fn<typeof fetch>().mockResolvedValue(new Response("{")))).rejects.toThrow();
    const controller = new AbortController();
    const reply = Response.json(receipt, { status: 201 }); const readReply = vi.spyOn(reply, "json");
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => { controller.abort(); return reply; });
    await expect(sendImplementationReport(storage, pending, transport, controller.signal)).rejects.toThrow();
    expect(readReply).not.toHaveBeenCalled();
    const never = vi.fn<typeof fetch>();
    await expect(sendImplementationReport(storage, pending, never, controller.signal)).rejects.toThrow();
    expect(never).not.toHaveBeenCalled();
    expect(readImplementationReportRecovery(storage, scope)[0].pending).toEqual(pending);
  });
  it("preserves unreadable exact originals and refuses to send or restore them", () => {
    retainImplementationReport(storage, pending); const key = readImplementationReportRecovery(storage, scope)[0].key;
    values.set(key, "{broken original");
    const record = readImplementationReportRecovery(storage, scope)[0]; expect(record.pending).toBeNull();
    preserveImplementationReport(storage, scope, record);
    expect(readImplementationReportRecovery(storage, scope)).toEqual([{ key: expect.stringContaining(":copy:"), raw: "{broken original", pending: null, archived: true }]);
    expect(() => restoreImplementationReport(storage, scope, record.raw)).toThrow();
  });
  it("keeps a request when cancellation arrives while reading its receipt", async () => {
    retainImplementationReport(storage, pending); const controller = new AbortController();
    const reply = Response.json(receipt, { status: 201 });
    vi.spyOn(reply, "json").mockImplementation(async () => { controller.abort(); return receipt; });
    await expect(sendImplementationReport(storage, pending, vi.fn<typeof fetch>().mockResolvedValue(reply), controller.signal)).rejects.toThrow();
    expect(readImplementationReportRecovery(storage, scope)[0].pending).toEqual(pending);
  });
  it("copies before removing and refuses an unverified copy", () => {
    retainImplementationReport(storage, pending); const record = readImplementationReportRecovery(storage, scope)[0];
    storage.setItem = () => {};
    expect(() => preserveImplementationReport(storage, scope, record)).toThrow("could not be verified");
    expect(storage.getItem(record.key)).toBe(record.raw);
  });
  it("restores locally and isolates accounts, workspaces and plans", () => {
    retainImplementationReport(storage, pending); const record = readImplementationReportRecovery(storage, scope)[0];
    preserveImplementationReport(storage, scope, record);
    expect(restoreImplementationReport(storage, scope, record.raw)).toEqual(pending);
    expect(readImplementationReportRecovery(storage, scope).filter(value => !value.archived)).toHaveLength(1);
    for (const key of ["actorId", "workspaceId", "planId"] as const) {
      const other = { ...scope, [key]: id(9) };
      expect(readImplementationReportRecovery(storage, other)).toEqual([]);
      expect(() => restoreImplementationReport(storage, other, record.raw)).toThrow("another account");
      expect(() => preserveImplementationReport(storage, other, record)).toThrow();
    }
    expect(() => restoreImplementationReport(storage, scope, " ".repeat(262145) + JSON.stringify(pending))).toThrow("larger");
  });
  it("reports failed cleanup without removing a different request", () => {
    retainImplementationReport(storage, pending); storage.removeItem = () => {};
    expect(() => acknowledgeImplementationReport(storage, pending)).toThrow("could not be cleared");
    expect(readImplementationReportRecovery(storage, scope)[0].pending).toEqual(pending);
  });
});


it("rejects multibyte overflow and round-trips a large exact request copy", () => {
  const raw = JSON.stringify({ ...command, summary: "歩".repeat(20000) }) + " ".repeat(39000);
  expect(() => retainImplementationReport(storage, { ...pending, commandText: raw })).toThrow("too large");
  const padded = { ...pending, commandText: "\n".repeat(95000) + JSON.stringify(command) };
  retainImplementationReport(storage, padded);
  const record = readImplementationReportRecovery(storage, scope)[0];
  expect(record.raw.length).toBeGreaterThan(131072);
  preserveImplementationReport(storage, scope, record);
  expect(restoreImplementationReport(storage, scope, record.raw).commandText).toBe(padded.commandText);
});
it("does not mistake a command under another key for a retryable request", () => {
  retainImplementationReport(storage, pending); const record = readImplementationReportRecovery(storage, scope)[0];
  values.delete(record.key); values.set(record.key.replace(command.commandId, id(9)), record.raw);
  expect(readImplementationReportRecovery(storage, scope)[0].pending).toBeNull();
});
it("checks copy identity before preserving or clearing", () => {
  retainImplementationReport(storage, pending); const record = readImplementationReportRecovery(storage, scope)[0];
  values.set(record.key, "changed");
  expect(() => preserveImplementationReport(storage, scope, record)).toThrow("changed");
  expect(values.get(record.key)).toBe("changed");
});
