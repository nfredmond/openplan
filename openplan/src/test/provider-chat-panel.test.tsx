import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
 fireEvent.click(screen.getByRole("button", { name: /Saved API chat · workspace/ }));
 await screen.findByText(/No saved API\/model has an admitted/); return review;
}
describe("normal saved API chat panel", () => {
 it("requires an explicit admitted selection and defaults the workspace index off", async () => {
  await open(); expect(screen.getByRole("button", { name: "Preview exact disclosure" })).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: /separate workspace-wide project index/ })).not.toBeChecked();
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
  fireEvent.click(screen.getByRole("button", { name: /Saved API chat · workspace/ }));
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
  fireEvent.click(screen.getByRole("button", { name: /Saved API chat · workspace/ }));
  fireEvent.click(screen.getByRole("button", { name: /Saved API chat · workspace/ }));
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
  fireEvent.click(screen.getByRole("button", { name: /Saved API chat · workspace/ }));
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
