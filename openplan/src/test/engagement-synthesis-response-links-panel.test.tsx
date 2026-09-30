import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SynthesisResponseLinksPanel } from "@/components/engagement/synthesis-response-links-panel";
import { readSynthesisResponseLinkAcknowledgement, synthesisResponseLinkIntentSchema } from "@/lib/engagement/synthesis-response-link";
import { readResponseLinkWorkingCopy, listPreservedResponseLinkCopies, type ResponseLinkWorkingCopy } from "@/lib/engagement/synthesis-response-link-recovery";
import { fixture, packet, id, type Context } from "./fixtures/engagement/synthesis-response-link";
import { sourceHash } from "./fixtures/engagement/synthesis-source";
const original = fixture(), userId = JSON.parse(original.approval.eventText).intent.actorId as string;
const scope = { userId, workspaceId: original.workspaceId, campaignId: original.campaignId, reviewId: original.reviewId };
const address = { responseId: original.responseId, groupId: original.groupId };
const revision = { id: original.revision.id, number: original.revision.number, sha256: original.revision.contentSha256 };
const groups = JSON.parse(original.revision.contentText).groups as Array<{ id: string; label: string }>;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const contextPacket = (context: Context) => { const contextText = JSON.stringify(context); return { contextText, contextSha256: sourceHash(contextText) }; };
function secondContext() {
  const value = structuredClone(original); value.responseId = id(99); value.responseHistory.response_id = id(99);
  value.responseHistory.recordText = JSON.stringify({ ...JSON.parse(value.responseHistory.recordText), id: id(99), theme_title: "SYNTHETIC second response", we_did: "SYNTHETIC second explanation" });
  value.responseHistory.record_sha256 = sourceHash(value.responseHistory.recordText); return value;
}
let current: Context | null, events: Map<string, ReturnType<typeof packet>>, loseAck: boolean, choices: Array<Record<string, unknown>>;
let transport: ReturnType<typeof vi.fn<typeof fetch>>, memory: { current: ResponseLinkWorkingCopy | null };
const onAccessLost = vi.fn();
const props = () => ({ scope, revision, groups, hasUnsavedReview: false, memory, onAccessLost });
function selectedEvents(responseId = address.responseId, groupId = address.groupId) {
  return [...events.values()].filter(row => { const value = JSON.parse(row.eventText); return value.intent.responseId === responseId && value.intent.groupId === groupId; });
}
/** Synthetic transport retains exact protocol packets; native tests separately establish authorization and transaction behavior. */
async function server(url: RequestInfo | URL, options?: RequestInit) {
  const query = new URL(String(url), "http://localhost").searchParams;
  if (options?.method !== "POST") {
    if ([...query.keys()].some(key => !["mode", "reviewId", "responseId", "groupId"].includes(key))) return json({}, 400);
    const responseId = query.get("responseId")!, groupId = query.get("groupId")!, rows = selectedEvents(responseId, groupId), head = rows.at(-1);
    if (query.get("mode") === "index") {
      const addresses = [...new Map([...events.values()].map(row => { const { responseId, groupId } = JSON.parse(row.eventText).intent; return [`${responseId}:${groupId}`, { responseId, groupId }]; })).entries()].sort(([a], [b]) => a < b ? -1 : 1).map(([, row]) => row);
      return json({ index: { campaignId: scope.campaignId, workspaceId: scope.workspaceId, reviewId: scope.reviewId, entryCount: addresses.length, entries: addresses } });
    }
    if (query.get("mode") === "responses") return json({ campaignId: scope.campaignId, workspaceId: scope.workspaceId, reviewId: scope.reviewId, responseCount: choices.length, responses: choices });
    if (query.get("mode") === "history") return json({ history: { campaignId: scope.campaignId, workspaceId: scope.workspaceId, reviewId: scope.reviewId, responseId, groupId,
      eventCount: rows.length, headId: head ? JSON.parse(head.eventText).intent.requestId : null, headSha256: head?.eventSha256 ?? null, entries: rows } });
    if (query.get("mode") === "context") {
      if (!current) return json({}, 409);
      return json({ context: contextPacket(responseId === id(99) ? secondContext() : current) });
    }
    throw new Error("Unexpected synthetic read");
  }
  const intent = synthesisResponseLinkIntentSchema.parse(JSON.parse(String(options.body))), old = events.get(intent.requestId);
  if (old) { await readSynthesisResponseLinkAcknowledgement({ event: old, replayed: true }, intent); return json({ event: old, replayed: true }); }
  const rows = selectedEvents(intent.responseId, intent.groupId), previous = rows.at(-1), head = previous ? JSON.parse(previous.eventText) : null;
  if (intent.predecessorId !== (head?.intent.requestId ?? null) || intent.predecessorSha256 !== (previous?.eventSha256 ?? null)) return json({}, 409);
  const evidence = intent.operation === "withdraw" ? head?.context : current ? contextPacket(current) : null;
  if (!evidence || (intent.operation !== "withdraw" && evidence.contextSha256 !== intent.expectedContextSha256)) return json({}, 409);
  const retained = packet({ schemaVersion: 1, purpose: "private_synthesis_response_link", eventNo: rows.length + 1, createdAt: "2026-09-30T00:00:00Z", intent, context: evidence });
  events.set(intent.requestId, retained);
  if (loseAck) { loseAck = false; throw new Error("SYNTHETIC lost acknowledgement"); }
  return json({ event: retained, replayed: false }, 201);
}
beforeEach(() => {
  localStorage.clear(); current = structuredClone(original); events = new Map(); loseAck = false; memory = { current: null };
  choices = [JSON.parse(original.responseHistory.recordText), JSON.parse(secondContext().responseHistory.recordText)];
  onAccessLost.mockReset(); transport = vi.fn<typeof fetch>().mockImplementation(server); vi.stubGlobal("fetch", transport);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const reason = () => screen.getByRole("textbox", { name: "Reason for this response link" });
const posts = () => transport.mock.calls.filter(([, options]) => options?.method === "POST");
async function inspect(responseId = address.responseId) {
  await screen.findByRole("combobox", { name: "Response to link" });
  fireEvent.change(screen.getByRole("combobox", { name: "Response to link" }), { target: { value: responseId } });
  fireEvent.change(screen.getByRole("combobox", { name: "Reviewed group" }), { target: { value: address.groupId } });
  fireEvent.click(screen.getByRole("button", { name: "Inspect response link" }));
  await screen.findByRole("heading", { name: "Current approved evidence" });
  await waitFor(() => expect(screen.queryByText("Complete link history is unavailable. New changes remain disabled.")).toBeNull());
}
async function save() {
  await inspect(); fireEvent.change(reason(), { target: { value: "SYNTHETIC staff linkage reason" } });
  fireEvent.click(screen.getByRole("button", { name: "Save response link" }));
  await screen.findByText("Response link saved. Event 1."); await screen.findByText("The active link already retains this evidence.");
}
describe("staff synthesis response links", () => {
  it("connects choices, exact save, complete retained evidence and immutable history", async () => {
    render(<SynthesisResponseLinksPanel {...props()} />); await inspect();
    expect(screen.getByRole("button", { name: "Save response link" })).toBeDisabled();
    await save(); fireEvent.change(reason(), { target: { value: "SYNTHETIC no evidence changes" } }); expect(screen.getByRole("button", { name: "Save updated response link" })).toBeDisabled(); expect(events.size).toBe(1); expect(readResponseLinkWorkingCopy(localStorage, scope).pending).toBeNull();
    const command = JSON.parse(String(posts()[0][1]?.body)); expect(command).toMatchObject({ ...address, actorId: userId, workspaceId: scope.workspaceId, campaignId: scope.campaignId, reviewId: scope.reviewId, expectedContextSha256: contextPacket(original).contextSha256 });
    expect(command).not.toHaveProperty("contextText"); expect(screen.getByText(/Event 1: link/)).toBeTruthy();
    const originalBytes = [...events.values()][0].eventText;
    current!.responseHistory.recordText = JSON.stringify({ ...JSON.parse(current!.responseHistory.recordText), we_did: "SYNTHETIC corrected response" });
    current!.responseHistory.record_sha256 = sourceHash(current!.responseHistory.recordText); current!.responseHistory.revision++;
    await inspect(); fireEvent.change(reason(), { target: { value: "SYNTHETIC refresh corrected response" } });
    fireEvent.click(screen.getByRole("button", { name: "Save updated response link" })); await screen.findByText("Response link saved. Event 2.");
    expect([...events.values()][0].eventText).toBe(originalBytes); expect(events.size).toBe(2);
  });
  it("recovers an exact committed request after interruption, remount and loss of current evidence", async () => {
    const mounted = render(<SynthesisResponseLinksPanel {...props()} />); await inspect(); loseAck = true;
    fireEvent.change(reason(), { target: { value: "SYNTHETIC interrupted reason" } }); fireEvent.click(screen.getByRole("button", { name: "Save response link" }));
    await screen.findByText("SYNTHETIC lost acknowledgement"); const retained = readResponseLinkWorkingCopy(localStorage, scope); expect(retained.pending).not.toBeNull();
    mounted.unmount(); current = null; choices = []; render(<SynthesisResponseLinksPanel {...props()} groups={[]} />);
    const retry = await screen.findByRole("button", { name: "Retry exact response-link request" }); await waitFor(() => expect(retry).toBeEnabled());
    fireEvent.click(retry); await screen.findByText("Response link saved from its original request. Event 1.");
    expect(events.size).toBe(1); expect(posts()[0][1]?.body).toBe(posts()[1][1]?.body); expect(readResponseLinkWorkingCopy(localStorage, scope).pending).toBeNull();
  });
  it("finds and withdraws a retained link after the live response and group disappear", async () => {
    const mounted = render(<SynthesisResponseLinksPanel {...props()} />); await save(); const first = [...events.values()][0];
    mounted.unmount(); current = null; choices = []; render(<SynthesisResponseLinksPanel {...props()} groups={[]} />);
    fireEvent.click(await screen.findByRole("button", { name: /Open link: retained response/ }));
    await screen.findByText(/Current approved evidence is unavailable/); await screen.findByText(/Event 1: link/);
    fireEvent.change(reason(), { target: { value: "SYNTHETIC withdrawn after removal" } }); fireEvent.click(screen.getByRole("button", { name: "Withdraw response link" }));
    await screen.findByText("Response link saved. Event 2."); expect(events.size).toBe(2);
    expect(JSON.parse([...events.values()][1].eventText).context).toEqual(JSON.parse(first.eventText).context);
  });
  it.each(["unfinished", "old revision"])("does not link %s evidence", async mode => {
    render(<SynthesisResponseLinksPanel {...props()} hasUnsavedReview={mode === "unfinished"} revision={mode === "old revision" ? { ...revision, id: id(98) } : revision} />);
    await inspect(); fireEvent.change(reason(), { target: { value: "SYNTHETIC reason" } });
    expect(screen.getByRole("button", { name: "Save response link" })).toBeDisabled(); expect(posts()).toHaveLength(0);
  });
  it("holds quota-failed text across unmount and preserves it before another draft", async () => {
    const mounted = render(<SynthesisResponseLinksPanel {...props()} />); await inspect();
    fireEvent.change(reason(), { target: { value: "SYNTHETIC old saved reason" } });
    const quota = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("SYNTHETIC quota"); });
    fireEvent.change(reason(), { target: { value: "SYNTHETIC newest unsaved reason" } }); expect(memory.current?.draft?.reason).toContain("newest");
    mounted.unmount(); render(<SynthesisResponseLinksPanel {...props()} />);
    await screen.findByText(/The latest response-link reason could not be stored/); await screen.findByRole("textbox", { name: "Reason for this response link" });
    expect(reason()).toHaveValue("SYNTHETIC newest unsaved reason"); expect(reason()).toBeDisabled();
    quota.mockRestore(); fireEvent.click(screen.getByRole("button", { name: "Preserve response-link copy and start another" }));
    await waitFor(() => expect(reason()).toBeEnabled()); expect(memory.current).toBeNull();
    expect(listPreservedResponseLinkCopies(localStorage, scope).map(row => row.value?.draft?.reason)).toEqual(["SYNTHETIC old saved reason", "SYNTHETIC newest unsaved reason"]); expect(posts()).toHaveLength(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Restore preserved response-link copy", hidden: true }).at(-1)!);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save response link" })).toBeEnabled());
    expect(reason()).toHaveValue("SYNTHETIC newest unsaved reason");
    const reads = transport.mock.calls.filter(([, options]) => options?.method !== "POST");
    expect(reads.every(([url]) => !new URL(String(url), "http://localhost").searchParams.has("reason"))).toBe(true);

  });
  it.each([401, 403])("clears private presentation when a current read returns %s", async status => {
    render(<SynthesisResponseLinksPanel {...props()} />); await save();
    transport.mockImplementation(async () => json({}, status)); fireEvent.click(screen.getByRole("button", { name: "Refresh response choices and links" }));
    await screen.findByText("Current staff access is required. Reopen the consultation to inspect response links.");
    expect(screen.queryByText(/SYNTHETIC staff linkage reason/)).toBeNull(); expect(onAccessLost).toHaveBeenCalledTimes(1); expect(memory.current).toBeNull();
  });
  it("ignores a late denied read after unmount", async () => {
    let finish: (value: Response) => void = () => {};
    transport.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const mounted = render(<SynthesisResponseLinksPanel {...props()} />); mounted.unmount();
    await act(async () => { finish(json({}, 403)); }); expect(onAccessLost).not.toHaveBeenCalled();
  });
  it("ignores stale denied evidence after a newer response selection succeeds", async () => {
    render(<SynthesisResponseLinksPanel {...props()} />); await screen.findByRole("combobox", { name: "Response to link" });
    let finish: (value: Response) => void = () => {};
    transport.mockImplementation(async (url, options) => {
      const query = new URL(String(url), "http://localhost").searchParams;
      if (query.get("mode") === "history" && query.get("responseId") === address.responseId) return new Promise(resolve => { finish = resolve; });
      return server(url, options);
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Response to link" }), { target: { value: address.responseId } });
    fireEvent.change(screen.getByRole("combobox", { name: "Reviewed group" }), { target: { value: address.groupId } });
    fireEvent.click(screen.getByRole("button", { name: "Inspect response link" }));
    await inspect(id(99)); await screen.findByText("We did: SYNTHETIC second explanation");
    await act(async () => { finish(json({}, 403)); }); expect(onAccessLost).not.toHaveBeenCalled(); expect(screen.getByText("We did: SYNTHETIC second explanation")).toBeTruthy();
  });
  it("sends only one write for repeated clicks during an acknowledgement wait", async () => {
    render(<SynthesisResponseLinksPanel {...props()} />); await inspect();
    let finish: (value: Response) => void = () => {}; let receipt: Response | null = null;
    transport.mockImplementation(async (url, options) => {
      const result = await server(url, options); if (options?.method !== "POST") return result;
      receipt = result; return new Promise(resolve => { finish = resolve; });
    });
    fireEvent.change(reason(), { target: { value: "SYNTHETIC one click command" } }); const button = screen.getByRole("button", { name: "Save response link" });
    fireEvent.click(button); fireEvent.click(button); await waitFor(() => expect(posts()).toHaveLength(1));
    await act(async () => { finish(receipt!); }); await screen.findByText("Response link saved. Event 1."); expect(events.size).toBe(1);
  });
  it("keeps another selected link's unfinished reason intact", async () => {
    render(<SynthesisResponseLinksPanel {...props()} />); await inspect(); fireEvent.change(reason(), { target: { value: "SYNTHETIC first response reason" } });
    await inspect(id(99)); expect(reason()).toBeDisabled(); expect(readResponseLinkWorkingCopy(localStorage, scope).draft?.responseId).toBe(address.responseId);
    expect(screen.getByText(/An unfinished reason belongs to another response/)).toBeTruthy(); expect(posts()).toHaveLength(0);
  });
});
