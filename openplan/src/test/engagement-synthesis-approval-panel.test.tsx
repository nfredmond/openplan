import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SynthesisApprovalPanel } from "@/components/engagement/synthesis-approval-panel";
import { checkSynthesisApprovalIntent, readSynthesisApprovalEvent, readSynthesisApprovalReceipt, synthesisApprovalIntentSchema,
  type SynthesisApprovalContext, type SynthesisApprovalPacket } from "@/lib/engagement/synthesis-approval";
import { listPreservedApprovalCopies, readApprovalWorkingCopy, type ApprovalWorkingCopy } from "@/lib/engagement/synthesis-approval-recovery";
const id = (n: number) => `b7000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { userId: id(1), workspaceId: id(2), campaignId: id(3), sourceId: id(4), sourceSha256: "a".repeat(64), reviewId: id(5), preparationSha256: "b".repeat(64) };
const { userId: _userId, ...reviewScope } = scope;
const original: SynthesisApprovalContext = { ...reviewScope, revisionId: id(5), revisionNo: 1, revisionSha256: "c".repeat(64) };
const corrected: SynthesisApprovalContext = { ...reviewScope, revisionId: id(7), revisionNo: 2, revisionSha256: "d".repeat(64) };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
let current: SynthesisApprovalContext, events: Map<string, SynthesisApprovalPacket>, loseAck: boolean;
let transport: ReturnType<typeof vi.fn<typeof fetch>>, memory: { current: ApprovalWorkingCopy | null };
const onAccessLost = vi.fn();
function props(revision = original) { return { scope, revision, hasUnsavedReview: false, memory, onAccessLost }; }
function history() {
  const last = [...events.entries()].at(-1);
  return { ...reviewScope, headId: last?.[0] ?? null, headSha256: last?.[1].eventSha256 ?? null, eventCount: events.size, entries: [...events.values()] };
}
/** Synthetic transport uses the real approval protocol; native and HTTP route tests cover those other boundaries. */
async function server(_url: RequestInfo | URL, options?: RequestInit) {
  if (options?.method !== "POST") return json({ current, history: history() });
  const intent = synthesisApprovalIntentSchema.parse(JSON.parse(String(options.body))), old = events.get(intent.requestId);
  if (old) { await readSynthesisApprovalReceipt({ event: old, replayed: true }, intent); return json({ event: old, replayed: true }); }
  const last = [...events.values()].at(-1);
  checkSynthesisApprovalIntent(intent, current, last ? await readSynthesisApprovalEvent(last, reviewScope) : null);
  const eventText = JSON.stringify({ schemaVersion: 1, purpose: "internal_staff_synthesis", eventNo: events.size + 1, createdAt: "2026-09-27T00:00:00Z", intent });
  const packet = { eventText, eventSha256: createHash("sha256").update(eventText).digest("hex") }; events.set(intent.requestId, packet);
  if (loseAck) { loseAck = false; throw new Error("SYNTHETIC lost acknowledgement"); }
  return json({ event: packet, replayed: false }, 201);
}
beforeEach(() => { localStorage.clear(); current = original; events = new Map(); loseAck = false; memory = { current: null }; onAccessLost.mockReset(); transport = vi.fn<typeof fetch>().mockImplementation(server); vi.stubGlobal("fetch", transport); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const reason = () => screen.getByRole("textbox", { name: "Reason for approval or withdrawal" });
async function ready(number = 1) { await screen.findByText(`Revision ${number} is unapproved.`); }
async function approve() {
  await ready(); fireEvent.change(reason(), { target: { value: "SYNTHETIC checked the complete retained draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Approve revision 1" })); await screen.findByText("Revision 1 is approved.");
}
describe("exact revision approval panel", () => {
  it("recovers a busy approval read without sending an approval", async () => {
    transport.mockResolvedValueOnce(json({}, 503));
    render(<SynthesisApprovalPanel {...props()} />); await ready();
    expect(transport).toHaveBeenCalledTimes(2);
    expect(events.size).toBe(0); expect(screen.queryByRole("alert")).toBeNull();
    expect(transport.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });
  it("clears a recovered history error without clearing a pending save failure", async () => {
    transport.mockResolvedValueOnce(json({}, 503)).mockResolvedValueOnce(json({}, 503)).mockResolvedValueOnce(json({}, 503));
    render(<SynthesisApprovalPanel {...props()} />);
    await screen.findByText("Approval history is unavailable. Keep any pending request and retry this read.");
    expect(screen.getByRole("button", { name: "Approve revision 1" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Refresh approval history" }));
    await ready();
    expect(screen.queryByText("Approval history is unavailable. Keep any pending request and retry this read.")).toBeNull();
    loseAck = true;
    fireEvent.change(reason(), { target: { value: "SYNTHETIC save remains unconfirmed" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve revision 1" }));
    await screen.findByText("SYNTHETIC lost acknowledgement");
    fireEvent.click(screen.getByRole("button", { name: "Refresh approval history" }));
    await screen.findByText("Revision 1 is approved.");
    expect(screen.getByText("SYNTHETIC lost acknowledgement")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry retained approval request" })).toBeEnabled();
    expect(readApprovalWorkingCopy(localStorage, scope).pending).not.toBeNull();
  });
  it("requires a reason, approves exact bytes and shows private history without altering the revision", async () => {
    const unchanged = JSON.stringify(original); render(<SynthesisApprovalPanel {...props()} />); await ready();
    fireEvent.click(screen.getByRole("button", { name: "Approve revision 1" }));
    await screen.findByText("Record a reason of at most 2000 characters before approval or withdrawal."); expect(events.size).toBe(0);
    await approve(); expect(JSON.stringify(original)).toBe(unchanged); expect(events.size).toBe(1);
    expect(screen.getByText("SYNTHETIC checked the complete retained draft")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve revision 1" })).toBeDisabled();
    expect(readApprovalWorkingCopy(localStorage, scope).pending).toBeNull();
    const command = JSON.parse(String(transport.mock.calls.find(([, options]) => options?.method === "POST")![1]?.body));
    expect(command).toMatchObject({ ...original, actorId: scope.userId, operation: "approve" });
    expect(transport.mock.calls[0][1]).toMatchObject({ cache: "no-store", headers: { "x-openplan-expected-user": scope.userId, "x-openplan-expected-workspace": scope.workspaceId } });
  });
  it("leaves a correction unapproved and permits explicit withdrawal of the original approval", async () => {
    const view = render(<SynthesisApprovalPanel {...props()} />); await approve();
    current = corrected; view.rerender(<SynthesisApprovalPanel {...props(corrected)} />); await ready(2);
    expect(screen.getByRole("button", { name: "Approve revision 2" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Withdraw approval of revision 2" })).toBeDisabled();
    expect(screen.getByText(/Approved revision 1/)).toBeTruthy();
    view.rerender(<SynthesisApprovalPanel {...props()} />); await screen.findByText("Revision 1 is approved.");
    expect(screen.getByRole("button", { name: "Approve revision 1" })).toBeDisabled();
    fireEvent.change(reason(), { target: { value: "SYNTHETIC withdrawn after correction" } });
    fireEvent.click(screen.getByRole("button", { name: "Withdraw approval of revision 1" }));
    await screen.findByText("Revision 1 is withdrawn."); expect(events.size).toBe(2);
    expect(screen.getByRole("button", { name: "Approve revision 1" })).toBeDisabled();
    expect(screen.getByText(/Approved revision 1/)).toBeTruthy(); expect(screen.getByText(/Withdrawn revision 1/)).toBeTruthy();
  });
  it("recovers an old exact request after an interrupted acknowledgement and a later correction", async () => {
    const view = render(<SynthesisApprovalPanel {...props()} />); await ready(); loseAck = true;
    fireEvent.change(reason(), { target: { value: "SYNTHETIC interrupted exact approval" } }); fireEvent.click(screen.getByRole("button", { name: "Approve revision 1" }));
    await screen.findByText("SYNTHETIC lost acknowledgement");
    expect(screen.getByRole("button", { name: "Approve revision 1" })).toBeDisabled();
    const saved = readApprovalWorkingCopy(localStorage, scope); expect(saved.pending).not.toBeNull();
    view.unmount(); current = corrected; render(<SynthesisApprovalPanel {...props(corrected)} />); await ready(2);
    fireEvent.click(screen.getByRole("button", { name: "Retry retained approval request" }));
    await screen.findByText("Recovered approval for revision 1."); await ready(2);
    const writes = transport.mock.calls.filter(([, init]) => init?.method === "POST"); expect(writes).toHaveLength(2); expect(writes[0][1]?.body).toBe(writes[1][1]?.body);
    expect(events.size).toBe(1); expect(readApprovalWorkingCopy(localStorage, scope).pending).toBeNull();
  });
  it("keeps quota-failed reason text across inspector unmount and preserves it before continuing", async () => {
    const view = render(<SynthesisApprovalPanel {...props()} />); await ready();
    const quota = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("SYNTHETIC quota"); });
    fireEvent.change(reason(), { target: { value: "SYNTHETIC latest unsaved approval reason" } }); expect(memory.current?.draft?.reason).toBe("SYNTHETIC latest unsaved approval reason");
    expect(reason()).toHaveValue("SYNTHETIC latest unsaved approval reason"); view.unmount(); render(<SynthesisApprovalPanel {...props()} />);
    await screen.findByText("This approval reason could not be stored. Preserve or copy the latest text before continuing."); await ready();
    expect(reason()).toHaveValue("SYNTHETIC latest unsaved approval reason"); expect(reason()).toBeDisabled();
    quota.mockRestore(); fireEvent.click(screen.getByRole("button", { name: "Preserve approval reason and start another" }));
    await waitFor(() => expect(reason()).toBeEnabled()); expect(memory.current).toBeNull();
    expect(listPreservedApprovalCopies(localStorage, scope)[0].value?.draft?.reason).toBe("SYNTHETIC latest unsaved approval reason");
    expect(transport.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
  it("does not approve an unfinished review correction", async () => {
    render(<SynthesisApprovalPanel {...props()} hasUnsavedReview />); await ready();
    expect(screen.getByRole("button", { name: "Approve revision 1" })).toBeDisabled();
    expect(screen.getByText(/A review correction or proposal import is unfinished/)).toBeTruthy(); expect(events.size).toBe(0);
  });
  it.each([401, 403])("clears private history after current access fails with %s", async status => {
    render(<SynthesisApprovalPanel {...props()} />); await approve();
    transport.mockResolvedValueOnce(json({}, status)); fireEvent.click(screen.getByRole("button", { name: "Refresh approval history" }));
    await screen.findByText("Staff access changed. Reopen the consultation before viewing approvals.");
    expect(screen.queryByText("SYNTHETIC checked the complete retained draft")).toBeNull(); expect(onAccessLost).toHaveBeenCalledTimes(1); expect(memory.current).toBeNull();
  });
  it("refuses malformed current context without enabling approval", async () => {
    transport.mockResolvedValueOnce(json({ current: { ...original, campaignId: id(90) }, history: history() }));
    render(<SynthesisApprovalPanel {...props()} />); await screen.findByText("Approval source or review scope differs");
    expect(screen.getByRole("button", { name: "Approve revision 1" })).toBeDisabled();
  });
  it("ignores a late denied read after unmount", async () => {
    let finish: (value: Response) => void = () => {};
    transport.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    const view = render(<SynthesisApprovalPanel {...props()} />); view.unmount();
    await act(async () => { finish(json({}, 403)); }); expect(onAccessLost).not.toHaveBeenCalled();
  });
  it("ignores a late denied write after unmount while keeping its pending request", async () => {
    let finish: (value: Response) => void = () => {};
    transport.mockImplementation((url, options) => options?.method === "POST" ? new Promise<Response>(resolve => { finish = resolve; }) : server(url, options));
    const view = render(<SynthesisApprovalPanel {...props()} />); await ready();
    fireEvent.change(reason(), { target: { value: "SYNTHETIC still pending during navigation" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve revision 1" }));
    await waitFor(() => expect(transport.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
    view.unmount(); await act(async () => { finish(json({}, 403)); });
    expect(onAccessLost).not.toHaveBeenCalled(); expect(readApprovalWorkingCopy(localStorage, scope).pending).not.toBeNull();
  });

  it("finishes an in-flight exact approval after selecting a corrected revision", async () => {
    let finish: (value: Response) => void = () => {};
    let response: Response | undefined;
    transport.mockImplementation(async (url, options) => {
      if (options?.method !== "POST") return server(url, options);
      response = await server(url, options);
      return new Promise<Response>(resolve => { finish = resolve; });
    });
    const view = render(<SynthesisApprovalPanel {...props()} />); await ready();
    fireEvent.change(reason(), { target: { value: "SYNTHETIC approval before selecting correction" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve revision 1" }));
    await waitFor(() => expect(response).toBeDefined());
    current = corrected; view.rerender(<SynthesisApprovalPanel {...props(corrected)} />); await ready(2);
    await act(async () => { finish(response!); });
    await screen.findByText("Saved approval for revision 1."); await ready(2);
    expect(screen.getByRole("button", { name: "Approve revision 2" })).toBeEnabled();
    expect(readApprovalWorkingCopy(localStorage, scope).pending).toBeNull(); expect(events.size).toBe(1);
  });

});
