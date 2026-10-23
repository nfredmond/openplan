import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderChatPanel } from "@/components/assistant/provider-chat-panel";
import { canonicalChat, chatGrantDigest, chatHash } from "@/lib/assistant/provider-chat-task";
import type { ChatIntentReview } from "@/lib/assistant/provider-chat-intents";
import { ChatReviewCancelled } from "@/lib/assistant/chat-stream";
import { chatFixture, chatIds as id } from "./fixtures/provider-chat-fixture";
const fetchMock = vi.fn(), reply = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function open(saved: unknown[] = [], progress: unknown = {}) {
 fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
  if (init?.method === "POST") throw new Error("Unexpected generation/approval POST during replay");
  if (url.includes("operation=options")) return reply({ options: [] });
  if (url.includes("operation=history")) return reply({ turns: saved });
  return reply(progress);
 });
 const review = vi.fn(); render(<ProviderChatPanel workspaceId={id.workspace} projectId={id.project} onReview={review} />);
 fireEvent.click(screen.getByRole("button", { name: /Saved API chat · shared context/ }));
 await screen.findByText(/No saved API\/model has an admitted/); return review;
}
describe("normal saved API chat panel", () => {
 // This checks rendered semantic tokens. jsdom cannot assess computed CSS,
 // contrast, native control painting, scrolling or geometry in either theme.
 it("pairs the actual panel and form controls with semantic theme tokens", async () => {
  await open([{ id: id.turn, state: "succeeded" }]);
  const panel = screen.getByRole("region", { name: "Saved API Planner Agent chat" });
  expect(panel.tagName).toBe("SECTION");
  expect(panel).toHaveClass("bg-background", "text-foreground", "border-border");
  expect(panel).not.toHaveClass("text-slate-200");
  for (const [name, tag] of [["Saved API and model", "SELECT"], ["Additional selected project IDs", "INPUT"], ["Saved API chat question", "TEXTAREA"], ["Retained chat turns", "SELECT"]]) {
   const control = screen.getByLabelText(name);
   expect(control.tagName).toBe(tag);
   expect(panel).toContainElement(control);
   expect(control).toHaveClass("bg-background", "text-foreground", "border", "border-border");
   expect(control).not.toHaveClass("bg-slate-900");
  }
 });
 it("requires an explicit admitted selection and defaults the workspace index off", async () => {
  await open(); expect(screen.getByRole("button", { name: "Preview exact disclosure" })).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: /separate project list here/ })).not.toBeChecked();
  expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
 });
 it("reopens retained progress using GET without new generation or approval", async () => {
  const review = await open([{ id: id.turn, state: "succeeded" }], { released: true, turnId: id.turn, state: "succeeded", cursor: 0, complete: true, events: [],
   texts: [{ stepId: id.step, text: "Original retained answer", terminal: "stop", receiptHash: "a".repeat(64) }],
   intents: [{ intentId: id.call, state: "reconciling", executionState: "uncertain", receiptState: "unavailable", originalApprovalId: id.accept, recoveryHref: "/assistant-activity" }] });
  fireEvent.change(screen.getByLabelText("Retained chat turns"), { target: { value: id.turn } });
  await screen.findByText("Original retained answer");
  expect(screen.queryByRole("button", { name: "Review exact draft submittal" })).toBeNull(); expect(review).not.toHaveBeenCalled();
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toEqual([]);
 });
 it("removes source text and actionable proposals after access loss", async () => {
  await open([{ id: id.turn, state: "access_lost" }], { released: false, turnId: id.turn, state: "access_lost", cursor: 0, texts: [{ text: "Hidden source canary" }], intents: [{ intentId: id.call }] });
  fireEvent.change(screen.getByLabelText("Retained chat turns"), { target: { value: id.turn } });
  await screen.findByText(/Source text, answers and draft bodies are withheld/);
  expect(screen.queryByText("Hidden source canary")).toBeNull(); expect(screen.queryByRole("button", { name: "Review exact draft submittal" })).toBeNull();
 });
 it("does not present text-bearing response loss as completion", async () => {
  await open([{ id: id.turn, state: "running" }]);
  fetchMock.mockImplementation(async () => new Response("{\"text\":\"Incomplete"));
  fireEvent.change(screen.getByLabelText("Retained chat turns"), { target: { value: id.turn } });
  await waitFor(() => expect(screen.getByText(/No complete answer is confirmed/)).toBeInTheDocument());
  expect(screen.queryByText("Checked completion retained.")).toBeNull();
 });
});

// These mounted checks use mocked transport. They do not establish native
// select painting, browser focus, live access decisions or provider behavior.
describe("active retained history identity", () => {
 const olderId = "88888888-8888-4888-8888-888888888888";
 const older = { id: olderId, state: "cancelled" };
 const retained = (state = "running", turnId = id.turn) => ({ released: true, turnId, state, cursor: 0, events: [] });
 const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(String(init.body)));
 function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return { promise, resolve };
 }
 async function start({ saved = [older], lost = "", read = async () => reply(retained()) }: {
  saved?: Array<{ id: string; state: string }>; lost?: string; read?: (turnId: string) => Promise<Response>;
 } = {}) {
  const grant = chatFixture();
  const onReview = vi.fn();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
   if (url.includes("operation=options")) return reply({ options: [{ id: id.capability, selection: grant.selection }] });
   if (url.includes("operation=history")) return reply({ turns: saved });
   if (init?.method === "POST") {
    const body = JSON.parse(String(init.body));
    if (body.operation === lost) throw new Error(`Synthetic lost ${lost} reply`);
    if (body.operation === "prepare") return reply({ canonical: canonicalChat(grant), digest: chatGrantDigest(grant), turnId: id.turn });
    if (body.operation === "accept") return reply({ released: true, turnId: id.turn, state: "accepted" });
    if (body.operation === "drive") return reply({ turnId: id.turn, state: "running" });
    throw new Error("Unexpected chat write");
   }
   return read(new URL(url, "http://localhost").searchParams.get("turnId")!);
  });
  render(<ProviderChatPanel workspaceId={id.workspace} projectId={id.project} onReview={onReview} />);
  fireEvent.click(screen.getByRole("button", { name: /Saved API chat · shared context/ }));
  await screen.findByRole("option", { name: /synthetic-model/ });
  fireEvent.change(screen.getByLabelText("Saved API and model"), { target: { value: id.capability } });
  fireEvent.change(screen.getByLabelText("Saved API chat question"), { target: { value: grant.packet.question } });
  fireEvent.click(screen.getByRole("button", { name: "Preview exact disclosure" }));
  await screen.findByLabelText("Exact API chat disclosure");
  fireEvent.click(screen.getByRole("checkbox", { name: /I accept this exact disclosure/ }));
  fireEvent.click(screen.getByRole("button", { name: "Accept disclosure and start once" }));
  return onReview;
 }
 async function expectSelected(state: string) {
  const turns = await screen.findByLabelText("Retained chat turns");
  await waitFor(() => {
   expect(turns, "the exact new retained ID stays visibly selected").toHaveValue(id.turn);
   expect(within(turns).getByRole("option", { name: `${id.turn} · ${state}`, selected: true })).toBeInTheDocument();
  });
  return turns;
 }
 function expectWrites(lost = "") {
  expect(posts().map(body => body.operation)).toEqual(lost === "accept" ? ["prepare", "accept"] : ["prepare", "accept", "drive"]);
  for (const body of posts().filter(body => body.operation !== "prepare")) expect(body.turnId).toBe(id.turn);
 }
 it.each(["older history", "empty history"])("keeps the new exact ID and read state with %s and preserves prior options", async history => {
  const onReview = await start({ saved: history === "older history" ? [older] : [], read: async turn => reply(retained(turn === olderId ? "cancelled" : "running", turn)) });
  const turns = await expectSelected("running");
  if (history === "older history") {
   expect(within(turns).getByRole("option", { name: `${olderId} · cancelled` })).toBeInTheDocument();
   fireEvent.change(turns, { target: { value: olderId } });
   await screen.findByText(/Status: cancelled/);
   expect(turns).toHaveValue(olderId);
   expect(within(turns).getByRole("option", { name: `${id.turn} · running` })).toBeInTheDocument();
   fireEvent.change(turns, { target: { value: id.turn } });
   await expectSelected("running");
  }
  expectWrites(); expect(onReview).not.toHaveBeenCalled();
 });
 it.each(["accept", "drive"])("uses retained state after an uncertain %s reply without another POST", async lost => {
  const state = lost === "accept" ? "prepared" : "uncertain";
  const onReview = await start({ lost, read: async () => reply(retained(state)) });
  await expectSelected(state);
  expect(screen.getByRole("alert")).toHaveTextContent("Possible provider usage remains unknown");
  fireEvent.click(screen.getByRole("button", { name: /Saved API chat · shared context/ }));
  fireEvent.click(screen.getByRole("button", { name: /Saved API chat · shared context/ }));
  await expectSelected(state);
  expectWrites(lost); expect(onReview).not.toHaveBeenCalled();
 });
 it("keeps the exact pending ID without claiming acceptance or completion before its retained read", async () => {
  const pending = deferred();
  await start({ saved: [], read: () => pending.promise });
  await expectSelected("unassessed");
  expect(screen.queryByText(/Checked completion retained/)).toBeNull();
  expect(screen.queryByRole("option", { name: `${id.turn} · accepted` })).toBeNull();
  await act(async () => pending.resolve(reply(retained("running"))));
  await expectSelected("running"); expectWrites();
 });
 it("keeps newer authorized read state when an older history listing arrives later", async () => {
  await start(); await expectSelected("running");
  const pendingHistory = deferred(); const prior = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
   if (url.includes("operation=history")) return pendingHistory.promise;
   if (!init?.method && url.includes("?turnId=")) return reply({ ...retained("succeeded"), complete: true,
    texts: [{ stepId: id.step, text: "Checked retained answer", terminal: "stop", receiptHash: "a".repeat(64) }] });
   return prior(url, init);
  });
  fireEvent.click(screen.getByRole("button", { name: /Saved API chat · shared context/ }));
  fireEvent.click(screen.getByRole("button", { name: /Saved API chat · shared context/ }));
  await expectSelected("succeeded");
  await act(async () => pendingHistory.resolve(reply({ turns: [older] })));
  const turns = await expectSelected("succeeded");
  expect(screen.getByText("Checked retained answer")).toBeInTheDocument();
  expect(within(turns).getAllByRole("option").map(option => (option as HTMLOptionElement).value)).toEqual(["", olderId, id.turn]);
  expectWrites();
 });
 it.each(["released_false", "failed", "wrong_identity"])("keeps truthful selected metadata and withholds bodies after a %s read", async failure => {
  await start({ read: async () => {
   if (failure === "failed") throw new Error("Synthetic failed retained read");
   return reply({ ...retained("access_lost", failure === "wrong_identity" ? olderId : id.turn), released: failure !== "released_false",
    texts: [{ stepId: id.step, text: "Withheld history canary", terminal: "stop", receiptHash: "a".repeat(64) }], intents: [{ intentId: id.call }] });
  } });
  await expectSelected(failure === "released_false" ? "access_lost" : "unavailable");
  expect(screen.getByText(/Source text, answers and draft bodies are withheld/)).toBeInTheDocument();
  expect(screen.queryByText("Withheld history canary")).toBeNull();
  expect(screen.queryByLabelText("Exact API chat disclosure")).toBeNull();
  expect(screen.queryByRole("button", { name: "Review exact draft submittal" })).toBeNull();
  expect(within(screen.getByLabelText("Retained chat turns")).getByRole("option", { name: `${olderId} · cancelled` })).toBeInTheDocument();
  expectWrites();
 });
 it.each(["released", "failed"])("ignores a late %s read for the earlier selected turn", async outcome => {
  const pending = deferred(); let holdOlder = false, olderRead = false;
  await start({ read: async turn => {
   if (turn === olderId && holdOlder) { olderRead = true; return pending.promise; }
   return reply(retained(turn === olderId ? "cancelled" : "running", turn));
  } });
  const turns = await expectSelected("running"); holdOlder = true;
  fireEvent.change(turns, { target: { value: olderId } });
  await waitFor(() => expect(olderRead).toBe(true));
  fireEvent.change(turns, { target: { value: id.turn } });
  await act(async () => pending.resolve(outcome === "released" ? reply(retained("succeeded", olderId)) : new Response(JSON.stringify({ error: "Synthetic late denied read" }), { status: 403 })));
  await expectSelected("running");
  expect(screen.queryByText(/Status: succeeded/)).toBeNull();
  expect(screen.queryByText(/Synthetic late denied read/)).toBeNull();
  expect(within(turns).getByRole("option", { name: `${olderId} · cancelled` })).toBeInTheDocument();
  expectWrites();
 });
});

// SOURCE ONLY, UNRUN. These tests drive the mounted panel through preparation
// and retained reads, rather than starting with an empty disclosure state.
describe("prepared disclosure release and same-intent recovery", () => {
 const status = { intentId: id.call, state: "proposed", executionState: "not_requested", receiptState: "not_checked", originalApprovalId: null, recoveryHref: "/assistant-activity" };
 const review = { intentId: id.call, workspaceId: id.workspace, action: { kind: "create_project_record", projectId: id.project, recordType: "submittal", title: "Draft", submittalType: "other", status: "draft" }, executableHash: "a".repeat(64), grantDigest: "b".repeat(64) };
 const progress = { released: true, turnId: id.turn, state: "succeeded", cursor: 0, complete: true, events: [],
  texts: [{ stepId: id.step, text: "Retained answer canary", terminal: "stop", receiptHash: "a".repeat(64) }], intents: [status] };
 async function prepareAndAccept() {
  const grant = chatFixture(); grant.packet.question = "Synthetic request";
  const content = canonicalChat({ workspaceId: id.workspace, workspaceName: "Prepared source canary" });
  grant.packet.initialEnvelopes[0].canonicalProjectedContent = content; grant.packet.initialEnvelopes[0].contentHash = chatHash(content);
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
   if (url.includes("operation=options")) return reply({ options: [{ id: id.capability, selection: grant.selection }] });
   if (url.includes("operation=history")) return reply({ turns: [] });
   if (init?.method === "POST") {
    const body = JSON.parse(String(init.body));
    return reply(body.operation === "prepare" ? { canonical: canonicalChat(grant), digest: chatGrantDigest(grant), turnId: id.turn } : {});
   }
   return reply(progress);
  });
  render(<ProviderChatPanel workspaceId={id.workspace} projectId={id.project} onReview={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /Saved API chat · shared context/ }));
  await screen.findByRole("option", { name: /synthetic-model/ });
  fireEvent.change(screen.getByLabelText("Saved API and model"), { target: { value: id.capability } });
  fireEvent.change(screen.getByLabelText("Saved API chat question"), { target: { value: "Synthetic request" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview exact disclosure" }));
  await screen.findByText(content);
  fireEvent.click(screen.getByRole("checkbox", { name: /I accept this exact disclosure/ }));
  fireEvent.click(screen.getByRole("button", { name: "Accept disclosure and start once" }));
  await screen.findByText("Retained answer canary");
  await waitFor(() => expect(screen.getByRole("button", { name: "Review exact draft submittal" })).not.toBeDisabled());
 }
 it("retains semantic borders and inherited foreground for disclosure, progress and draft review", async () => {
  await prepareAndAccept();
  const panel = screen.getByRole("region", { name: "Saved API Planner Agent chat" });
  expect(panel).toHaveClass("bg-background", "text-foreground", "border-border");
  const disclosure = screen.getByLabelText("Exact API chat disclosure");
  expect(panel).toContainElement(disclosure);
  expect(disclosure).toHaveClass("border", "border-border");
  expect(disclosure).not.toHaveClass("border-white/20");
  const progress = screen.getByRole("list", { name: "Retained tool and model progress" });
  expect(panel).toContainElement(progress);
  expect(progress.parentElement).toHaveAttribute("aria-live", "polite");
  const draft = screen.getByRole("button", { name: "Review exact draft submittal" }).closest("div");
  expect(panel).toContainElement(draft);
  expect(draft).toHaveClass("border", "border-border");
  expect(draft).not.toHaveClass("border-white/15");
 });
 it.each(["rejected", "401", "released_false"])("withholds both prepared sources and answers after %s", async failure => {
  await prepareAndAccept();
  // Begin fake time after the initial real-timer poll. Its first successor
  // schedules on the fake clock, then the next read consumes this failure.
  vi.useFakeTimers();
  const prior = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
   if (url.includes("operation=options") || url.includes("operation=history")) return prior(url, init);
   if (failure === "rejected") throw new Error("Synthetic unreadable session");
   if (failure === "401") return new Response(JSON.stringify({ error: "Synthetic expired session" }), { status: 401, headers: { "content-type": "application/json" } });
   return reply({ released: false, turnId: id.turn, state: "access_lost", cursor: 0 });
  });
  // Remount the polling effect by toggling its own visibility, without changing
  // turn selection or invalidating the prepared disclosure through navigation.
  fireEvent.click(screen.getByRole("button", { name: /Saved API chat · shared context/ }));
  fireEvent.click(screen.getByRole("button", { name: /Saved API chat · shared context/ }));
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(screen.queryByLabelText("Exact API chat disclosure")).toBeNull();
  expect(screen.queryByText("Retained answer canary")).toBeNull();
  expect(screen.queryByRole("checkbox", { name: /I accept this exact disclosure/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "Review exact draft submittal" })).toBeNull();
  expect(screen.getByText(/Source text, answers and draft bodies are withheld/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open recovery" })).toBeInTheDocument();
 });
 async function openIntent(onReview: (review: ChatIntentReview) => Promise<void>) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
   if (init?.method === "POST") throw new Error("No approval POST is authorized by this fixture");
   if (url.includes("operation=options")) return reply({ options: [] });
   if (url.includes("operation=history")) return reply({ turns: [{ id: id.turn, state: "succeeded" }] });
   if (url.includes("/intents?")) return reply({ status, review });
   return reply(progress);
  });
  render(<ProviderChatPanel workspaceId={id.workspace} projectId={id.project} onReview={onReview} />);
  fireEvent.click(screen.getByRole("button", { name: /Saved API chat · shared context/ }));
  await screen.findByLabelText("Retained chat turns");
  fireEvent.change(screen.getByLabelText("Retained chat turns"), { target: { value: id.turn } });
  await screen.findByRole("button", { name: "Review exact draft submittal" });
 }
 it("reviews the same intent after deliberate cancellation without an approval POST", async () => {
  const onReview = vi.fn().mockRejectedValue(new ChatReviewCancelled()); await openIntent(onReview);
  fireEvent.click(screen.getByRole("button", { name: "Review exact draft submittal" }));
  await waitFor(() => expect(onReview).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole("button", { name: "Review exact draft submittal" })).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "Review exact draft submittal" }));
  await waitFor(() => expect(onReview).toHaveBeenCalledTimes(2));
  expect(onReview.mock.calls.map(([r]) => r.intentId)).toEqual([id.call, id.call]);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toEqual([]);
 });
 it.each(["unbound", "bound", "uncertain", "unavailable"])("restores review only after authoritative released %s status", async outcome => {
  const onReview = vi.fn().mockRejectedValue(new Error("Synthetic lost issuance reply")); await openIntent(onReview);
  const prior = fetchMock.getMockImplementation()!; let failedRead = true;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
   if (url.includes("/intents?")) {
    if (failedRead) { failedRead = false; return reply({ status, review }); }
    throw new Error("Synthetic unavailable original approval status");
   }
   return prior(url, init);
  });
  fireEvent.click(screen.getByRole("button", { name: "Review exact draft submittal" }));
  await screen.findByText(/Checking the original approval is unavailable/);
  expect(screen.queryByRole("button", { name: "Review exact draft submittal" })).toBeNull();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
   if (url.includes("/intents?")) {
    expect(url).toContain("review=true");
    if (outcome === "unavailable") throw new Error("Still unavailable");
    const next = outcome === "bound" ? { ...status, state: "approved", originalApprovalId: id.accept } : outcome === "uncertain" ? { ...status, executionState: "uncertain" } : status;
    return reply({ status: next, review: outcome === "unbound" ? review : null });
   }
   return prior(url, init);
  });
  fireEvent.click(screen.getByRole("button", { name: "Check original approval" }));
  await waitFor(() => {
   if (outcome === "unbound") expect(screen.getByRole("button", { name: "Review exact draft submittal" })).not.toBeDisabled();
   else expect(screen.queryByRole("button", { name: "Review exact draft submittal" })).toBeNull();
  });
  expect(onReview).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toEqual([]);
 });
});

describe("retained page polling", () => {
 it.each([100, 101, 205])("drains %i events after terminal state, replay, append and reconnect with GET only", async total => {
  let count = total, replayed = false;
  const offsets: number[] = [];
  const event = (sequence: number) => ({ sequence, kind: "retained_event", body: { sequence },
   bodyHash: sequence.toString(16).padStart(64, "0"), previousHash: sequence > 1 ? (sequence - 1).toString(16).padStart(64, "0") : null });
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
   if (init?.method === "POST") throw new Error("Unexpected POST during page draining");
   if (url.includes("operation=options")) return reply({ options: [] });
   if (url.includes("operation=history")) return reply({ turns: [{ id: id.turn, state: "succeeded" }] });
   const requested = Number(new URL(url, "http://localhost").searchParams.get("afterSequence")); offsets.push(requested);
   // A delayed duplicate response must not duplicate the chain or poison polling.
   const after = requested === 100 && !replayed ? (replayed = true, 0) : requested;
   const events = Array.from({ length: Math.min(100, Math.max(0, count - after)) }, (_, n) => event(after + n + 1));
   return reply({ released: true, turnId: id.turn, state: "succeeded", complete: true, cursor: events.at(-1)?.sequence ?? after, events,
    texts: [{ stepId: id.step, text: "Checked terminal remains available", terminal: "stop", receiptHash: "a".repeat(64) }] });
  });
  const onReview = vi.fn();
  async function mount() {
   const mounted = render(<ProviderChatPanel workspaceId={id.workspace} projectId={id.project} onReview={onReview} />);
   fireEvent.click(screen.getByRole("button", { name: /Saved API chat · shared context/ }));
   await act(async () => { await Promise.resolve(); });
   await act(async () => { fireEvent.change(screen.getByLabelText("Retained chat turns"), { target: { value: id.turn } }); });
   return mounted;
  }
  vi.useFakeTimers();
  const first = await mount();
  for (let n = 0; n < 5; n++) await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(within(screen.getByRole("list", { name: "Retained tool and model progress" })).getAllByRole("listitem")).toHaveLength(total);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(offsets[0]).toBe(0); expect(offsets).toContain(total);
  count++;
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(within(screen.getByRole("list", { name: "Retained tool and model progress" })).getAllByRole("listitem")).toHaveLength(total + 1);
  first.unmount(); const beforeReconnect = offsets.length;
  await mount();
  for (let n = 0; n < 3; n++) await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(offsets[beforeReconnect], "a new mount drains from the original chain start").toBe(0);
  expect(within(screen.getByRole("list", { name: "Retained tool and model progress" })).getAllByRole("listitem")).toHaveLength(total + 1);
  expect(screen.queryByRole("alert")).toBeNull(); expect(onReview).not.toHaveBeenCalled();
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toEqual([]);
 });
});
