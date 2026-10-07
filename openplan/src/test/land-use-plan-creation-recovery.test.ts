import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmCreationRequest, confirmCreationStop, creationCommandFromDraft, importCreationRecord, readCreationRecords, retainCreationRequest, retainCreationStop, saveCreationDraft, sendCreationRequest, sendCreationStop } from "@/lib/land-use-plans/create-recovery";
import { creationCommandFixture, creationDraftFixture, creationId, creationReceiptFixture, creationScope } from "./fixtures/land-use-plans/creation";

beforeEach(() => localStorage.clear());
describe("creation request recovery", () => {
  it("keeps incomplete drafts separate from executable commands and preserves exact earlier bytes", () => {
    const draft = creationDraftFixture(); draft.fields.title = ""; draft.fields.context.place.geometryText = "unfinished";
    const saved = saveCreationDraft(localStorage, draft, null); expect(readCreationRecords(localStorage, creationScope)).toEqual([saved]);
    expect(() => retainCreationRequest(localStorage, draft, creationId(3))).toThrow();
    expect(() => saveCreationDraft(localStorage, { ...draft, fields: { ...draft.fields, title: "New" } }, null)).toThrow(/changed/);
    expect(localStorage.getItem(saved.key)).toBe(saved.raw);
    const next = { ...draft, fields: { ...draft.fields, title: "New" } };
    expect(saveCreationDraft(localStorage, next, saved.raw).value).toEqual(next);
  });
  it("normalizes before request retention and refuses retained boundaries before a plan exists", () => {
    const draft = creationDraftFixture(); draft.fields.title = "  SYNTHETIC plan  ";
    expect(creationCommandFromDraft(draft, creationId(3))).toEqual(creationCommandFixture());
    draft.fields.context.place.mode = "retained"; expect(() => retainCreationRequest(localStorage, draft, creationId(3))).toThrow();
  });
  it("retains before sending and sends the exact original request with scope headers", async () => {
    const pending = retainCreationRequest(localStorage, creationDraftFixture(), creationId(3));
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(creationReceiptFixture()), { status: 201 }));
    expect(await sendCreationRequest(localStorage, pending, transport)).toEqual(creationReceiptFixture());
    expect(transport).toHaveBeenCalledWith("/api/land-use-plans", expect.objectContaining({ method: "POST", cache: "no-store", body: pending.commandText,
      headers: { "Content-Type": "application/json", "x-openplan-expected-user": creationScope.actorId, "x-openplan-expected-workspace": creationScope.workspaceId } }));
    expect(readCreationRecords(localStorage, creationScope)[0].value?.kind).toBe("pending");
  });
  it("preserves a lost reply for an explicit byte-identical replay and retains the confirmed receipt", async () => {
    const pending = retainCreationRequest(localStorage, creationDraftFixture(), creationId(3));
    const transport = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("Lost response"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...creationReceiptFixture(), replayed: true }), { status: 200 }));
    await expect(sendCreationRequest(localStorage, pending, transport)).rejects.toThrow("Lost response");
    const recovered = readCreationRecords(localStorage, creationScope)[0].value;
    expect(recovered).toEqual(pending);
    const result = await sendCreationRequest(localStorage, pending, transport);
    expect(transport.mock.calls.map(call => call[1]?.body)).toEqual([pending.commandText, pending.commandText]);
    const confirmed = confirmCreationRequest(localStorage, pending, result);
    expect(readCreationRecords(localStorage, creationScope)[0].value).toEqual(confirmed);
    await expect(sendCreationRequest(localStorage, pending, transport)).rejects.toThrow(/changed/); expect(transport).toHaveBeenCalledTimes(2);
  });
  it.each([400, 401, 403, 409, 500, 503])("keeps unconfirmed requests on HTTP %s", async status => {
    const pending = retainCreationRequest(localStorage, creationDraftFixture(), creationId(3));
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response("private error", { status }));
    await expect(sendCreationRequest(localStorage, pending, transport)).rejects.toThrow();
    expect(readCreationRecords(localStorage, creationScope)[0].value).toEqual(pending);
  });
  it("refuses changed or missing retained bytes before transport", async () => {
    const pending = retainCreationRequest(localStorage, creationDraftFixture(), creationId(3)), record = readCreationRecords(localStorage, creationScope)[0];
    const transport = vi.fn<typeof fetch>();
    localStorage.setItem(record.key, record.raw + " "); await expect(sendCreationRequest(localStorage, pending, transport)).rejects.toThrow(/changed/);
    localStorage.removeItem(record.key); await expect(sendCreationRequest(localStorage, pending, transport)).rejects.toThrow(/changed/); expect(transport).not.toHaveBeenCalled();
  });
  it("preserves unknown copies, rejects mismatched keys, and never reads another scope", () => {
    const pending = retainCreationRequest(localStorage, creationDraftFixture(), creationId(3)), record = readCreationRecords(localStorage, creationScope)[0];
    localStorage.setItem(record.key, "broken"); expect(readCreationRecords(localStorage, creationScope)[0]).toEqual({ ...record, raw: "broken", value: null });
    localStorage.setItem(record.key, JSON.stringify({ ...pending, commandText: JSON.stringify({ ...creationCommandFixture(), commandId: creationId(9) }) }));
    expect(readCreationRecords(localStorage, creationScope)[0].value).toBeNull();
    expect(readCreationRecords(localStorage, { ...creationScope, actorId: creationId(9) })).toEqual([]);
    expect(readCreationRecords(localStorage, { ...creationScope, workspaceId: creationId(9) })).toEqual([]);
  });
  it.each(["actorId", "workspaceId"] as const)("rejects imported outer or draft %s substitutions", field => {
    const pending = retainCreationRequest(localStorage, creationDraftFixture(), creationId(3)); localStorage.clear();
    expect(() => importCreationRecord(localStorage, creationScope, JSON.stringify({ ...pending, [field]: creationId(9) }))).toThrow(/another/);
    expect(() => importCreationRecord(localStorage, creationScope, JSON.stringify({ ...pending, draft: { ...pending.draft, [field]: creationId(9) } }))).toThrow(/owner/); expect(localStorage.length).toBe(0);
  });
  it("imports pretty-printed copies without changing the inner command and refuses a substituted draft", async () => {
    const pending = retainCreationRequest(localStorage, creationDraftFixture(), creationId(3)); localStorage.clear();
    const modified = { ...pending, commandText: ` \n${pending.commandText}\n` };
    importCreationRecord(localStorage, creationScope, JSON.stringify(modified, null, 2));
    const restored = readCreationRecords(localStorage, creationScope)[0].value; expect(restored).toEqual(modified);
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(creationReceiptFixture()), { status: 201 }));
    await sendCreationRequest(localStorage, modified, transport); expect(transport.mock.calls[0][1]?.body).toBe(modified.commandText);
    expect(() => importCreationRecord(localStorage, creationScope, JSON.stringify({ ...pending, draft: { ...pending.draft, fields: { ...pending.draft.fields, title: "Altered" } } }))).toThrow(/original draft/);
    expect(() => importCreationRecord(localStorage, creationScope, JSON.stringify(pending))).toThrow(/Another saved copy/);
  });
  it.each(["actorId", "workspaceId", "commandId", "descriptorId", "planKindKey", "descriptorHash", "title", "authorityLabel"] as const)("keeps a substituted receipt %s unconfirmed", async field => {
    const pending = retainCreationRequest(localStorage, creationDraftFixture(), creationId(3));
    const result = { ...creationReceiptFixture(), [field]: field.endsWith("Id") ? creationId(9) : "b".repeat(64) };
    await expect(sendCreationRequest(localStorage, pending, vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(result), { status: 201 })))).rejects.toThrow();
    expect(() => confirmCreationRequest(localStorage, pending, result)).toThrow(); expect(readCreationRecords(localStorage, creationScope)[0].value).toEqual(pending);
  });
  it("refuses malformed, altered, or status-mismatched successful responses", async () => {
    const pending = retainCreationRequest(localStorage, creationDraftFixture(), creationId(3));
    const changed = creationReceiptFixture(); changed.context.assessment.authorities[0].label = "Another body";
    for (const [body, status] of [["not json", 201], [JSON.stringify(changed), 201], [JSON.stringify(creationReceiptFixture()), 200], [JSON.stringify({ ...creationReceiptFixture(), extra: true }), 201]] as const) {
      await expect(sendCreationRequest(localStorage, pending, vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status })))).rejects.toThrow();
    }
    expect(readCreationRecords(localStorage, creationScope)[0].value).toEqual(pending);
  });
  it("leaves a newer browser copy untouched when confirming an earlier request", () => {
    const pending = retainCreationRequest(localStorage, creationDraftFixture(), creationId(3)), record = readCreationRecords(localStorage, creationScope)[0];
    localStorage.setItem(record.key, "newer copy"); expect(() => confirmCreationRequest(localStorage, pending, creationReceiptFixture())).toThrow(/changed/); expect(localStorage.getItem(record.key)).toBe("newer copy");
  });
  it("refuses unavailable or silently lost storage writes before transport", () => {
    const unavailable = { length: 0, key: () => null, getItem: () => null, setItem: () => { throw new Error("storage unavailable"); } };
    expect(() => saveCreationDraft(unavailable, creationDraftFixture(), null)).toThrow(); expect(() => retainCreationRequest(unavailable, creationDraftFixture(), creationId(3))).toThrow();
    const lost = { ...unavailable, setItem: () => undefined };
    expect(() => saveCreationDraft(lost, creationDraftFixture(), null)).toThrow(/retain/); expect(() => retainCreationRequest(lost, creationDraftFixture(), creationId(3))).toThrow(/retained/);
  });
  it("does not send an aborted request or acknowledge a late response", async () => {
    const pending = retainCreationRequest(localStorage, creationDraftFixture(), creationId(3)), abort = new AbortController(), transport = vi.fn<typeof fetch>();
    abort.abort(); await expect(sendCreationRequest(localStorage, pending, transport, abort.signal)).rejects.toThrow(); expect(transport).not.toHaveBeenCalled();
    const later = new AbortController(); transport.mockImplementation(async () => { later.abort(); return new Response(JSON.stringify(creationReceiptFixture()), { status: 201 }); });
    await expect(sendCreationRequest(localStorage, pending, transport, later.signal)).rejects.toThrow(); expect(readCreationRecords(localStorage, creationScope)[0].value).toEqual(pending);
  });
});

describe("creation stop recovery", () => {
  function stopped(commandText: string) {
    return { outcome: "cancelled" as const, replayed: false, ...creationScope, commandId: creationId(3), commandText, cancelledAt: "2026-10-07T14:00:00.123456Z" };
  }
  it("retains stop intent before transport and forbids creation retry while stopping", async () => {
    const pending = retainCreationRequest(localStorage, creationDraftFixture(), creationId(3));
    const transport = vi.fn<typeof fetch>().mockImplementation(async url => new Response(JSON.stringify(String(url).endsWith("/stop") ? stopped(pending.commandText) : creationReceiptFixture()), { status: String(url).endsWith("/stop") ? 200 : 201 })); await expect(sendCreationStop(localStorage, pending, transport)).rejects.toThrow(/retained stop/);
    const stopping = retainCreationStop(localStorage, pending);
    await expect(sendCreationRequest(localStorage, stopping, transport)).rejects.toThrow(/stopped/); expect(transport).not.toHaveBeenCalled();
    transport.mockResolvedValue(new Response(JSON.stringify(stopped(stopping.commandText)), { status: 200 }));
    const receipt = await sendCreationStop(localStorage, stopping, transport);
    expect(transport).toHaveBeenCalledWith(`/api/land-use-plans/creation-requests/${creationId(3)}/stop`, expect.objectContaining({ method: "POST", body: pending.commandText,
      headers: { "Content-Type": "application/json", "x-openplan-expected-user": creationScope.actorId, "x-openplan-expected-workspace": creationScope.workspaceId } }));
    expect(confirmCreationStop(localStorage, stopping, receipt).kind).toBe("cancelled");
    expect(readCreationRecords(localStorage, creationScope)[0].value?.kind).toBe("cancelled");
  });
  it("keeps an uncertain stop for explicit replay and retains an already-created result", async () => {
    const pending = retainCreationRequest(localStorage, creationDraftFixture(), creationId(3)), stopping = retainCreationStop(localStorage, pending);
    const transport = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("Stop reply lost"));
    await expect(sendCreationStop(localStorage, stopping, transport)).rejects.toThrow("Stop reply lost");
    expect(readCreationRecords(localStorage, creationScope)[0].value).toEqual(stopping);
    const created = { outcome: "created" as const, result: { ...creationReceiptFixture(), replayed: true } };
    transport.mockResolvedValue(new Response(JSON.stringify(created), { status: 200 }));
    const receipt = await sendCreationStop(localStorage, stopping, transport);
    expect(confirmCreationStop(localStorage, stopping, receipt).kind).toBe("confirmed");
    expect(transport.mock.calls.map(call => call[1]?.body)).toEqual([pending.commandText, pending.commandText]);
  });
  it.each(["actorId", "workspaceId", "commandId", "commandText", "cancelledAt"] as const)("refuses substituted stop receipt %s", async field => {
    const pending = retainCreationRequest(localStorage, creationDraftFixture(), creationId(3)), stopping = retainCreationStop(localStorage, pending);
    const result = { ...stopped(pending.commandText), [field]: field.endsWith("Id") ? creationId(9) : "invalid" };
    await expect(sendCreationStop(localStorage, stopping, vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(result), { status: 200 })))).rejects.toThrow();
    expect(() => confirmCreationStop(localStorage, stopping, result)).toThrow(); expect(readCreationRecords(localStorage, creationScope)[0].value).toEqual(stopping);
  });
  it("refuses changed copies, lost storage writes and false created outcomes", async () => {
    const pending = retainCreationRequest(localStorage, creationDraftFixture(), creationId(3)), record = readCreationRecords(localStorage, creationScope)[0];
    localStorage.setItem(record.key, "changed"); expect(() => retainCreationStop(localStorage, pending)).toThrow(/changed/);
    localStorage.setItem(record.key, record.raw); const stopping = retainCreationStop(localStorage, pending);
    const lost = { length: 1, key: () => record.key, getItem: () => JSON.stringify(stopping), setItem: () => undefined };
    expect(() => confirmCreationStop(lost, stopping, stopped(pending.commandText))).toThrow(/could not be retained/);
    const lostIntent = { ...lost, getItem: () => record.raw }; expect(() => retainCreationStop(lostIntent, pending)).toThrow(/Nothing was sent/);
    const altered = { outcome: "created" as const, result: { ...creationReceiptFixture(), replayed: true, actorId: creationId(9) } };
    await expect(sendCreationStop(localStorage, stopping, vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(altered), { status: 200 })))).rejects.toThrow(/another/);
    localStorage.setItem(record.key, "newer"); expect(() => confirmCreationStop(localStorage, stopping, stopped(pending.commandText))).toThrow(/changed/); expect(localStorage.getItem(record.key)).toBe("newer");
  });
  it("reconfirms imported terminal receipts through stop, preserving their claims without trusting them", () => {
    const pending = retainCreationRequest(localStorage, creationDraftFixture(), creationId(3));
    const confirmed = confirmCreationRequest(localStorage, pending, creationReceiptFixture()); localStorage.clear();
    const imported = importCreationRecord(localStorage, creationScope, JSON.stringify(confirmed));
    expect(imported.kind).toBe("pending"); expect(imported).toMatchObject({ stopRequested: true, importedResult: creationReceiptFixture() });
    localStorage.clear(); importCreationRecord(localStorage, creationScope, JSON.stringify(pending));
    const stopping = retainCreationStop(localStorage, pending), cancelled = confirmCreationStop(localStorage, stopping, stopped(pending.commandText)); localStorage.clear();
    expect(importCreationRecord(localStorage, creationScope, JSON.stringify(cancelled))).toMatchObject({ kind: "pending", stopRequested: true, importedResult: stopped(pending.commandText) });
  });
  it("preserves stopping through malformed replies, non-200 statuses and aborts", async () => {
    const pending = retainCreationRequest(localStorage, creationDraftFixture(), creationId(3)), stopping = retainCreationStop(localStorage, pending);
    for (const status of [201, 401, 403, 409, 500]) await expect(sendCreationStop(localStorage, stopping, vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(stopped(pending.commandText)), { status })))).rejects.toThrow(/unconfirmed/);
    await expect(sendCreationStop(localStorage, stopping, vi.fn<typeof fetch>().mockResolvedValue(new Response("{", { status: 200 })))).rejects.toThrow();
    const abort = new AbortController(); abort.abort(); const transport = vi.fn<typeof fetch>();
    await expect(sendCreationStop(localStorage, stopping, transport, abort.signal)).rejects.toThrow(); expect(transport).not.toHaveBeenCalled();
    expect(readCreationRecords(localStorage, creationScope)[0].value).toEqual(stopping);
  });
});
