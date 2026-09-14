import { createHash } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import rawNative from "./fixtures/decision-link-native.json";
import { DecisionLinksPanel } from "@/components/engagement/decision-links-panel";
import { EngagementCloseLoopBuilder } from "@/components/engagement/close-loop-builder";
import { decisionLinkIntentSchema, decisionLinkPayload } from "@/lib/engagement/decision-links";
import type { DecisionLinkContext, DecisionLinkSnapshotPacket } from "@/lib/engagement/decision-links";
import { resolutionTestPacket } from "./helpers/decision-resolution-fixture";
import { readDecisionResolutionRecovery } from "@/lib/engagement/decision-resolution-recovery";
import { pendingDecisionKey } from "@/lib/engagement/pending-decision-link";

const native = rawNative as { scope: typeof rawNative.scope; initial: DecisionLinkSnapshotPacket };
const source = native.initial.entries[0];
const context = JSON.parse(source.context_text) as DecisionLinkContext;
const props = { ...native.scope, responses: [context.response], responsesUnavailable: false, revision: 0 };
const empty = (): DecisionLinkSnapshotPacket => ({ ...structuredClone(native.initial), entries: [], entryCount: 0, current: [], currentCount: 0 });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

function server(initial = empty()) {
  let snapshot = structuredClone(initial), posts = 0;
  const intents: unknown[] = [];
  let mode: "save" | "lost" | "conflict" | "badReceipt" = "save";
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (init?.method === "POST") {
      posts++;
      const intent = decisionLinkIntentSchema.parse(JSON.parse(String(init.body))); intents.push(intent);
      const retained = localStorage.getItem(pendingDecisionKey({ version: 1, ...native.scope, intent, phase: "unconfirmed", context: { contextText: source.context_text, contextSha256: source.context_sha256 } }));
      expect(JSON.parse(retained!).intent).toEqual(intent);
      if (mode === "conflict") return json({ kind: "conflict" }, 409);
      if (mode === "badReceipt") return json({ link: source, replayed: true });
      const existing = snapshot.entries.find(row => row.id === intent.requestId);
      const payload = decisionLinkPayload(native.scope, intent), payloadText = JSON.stringify(payload);
      const row = existing ?? { ...structuredClone(source), id: intent.requestId, operation: intent.operation,
        predecessor_id: intent.predecessorId, reason: intent.reason, payload_json: payload, payload_text: payloadText, payload_sha256: hash(payloadText) };
      if (!existing) snapshot = { ...snapshot, entries: [...snapshot.entries, row], entryCount: snapshot.entryCount + 1,
        current: [{ linkId: row.id, sourceState: "unchanged", currentContextSha256: row.context_sha256, unavailableReason: null }], currentCount: 1 };
      if (mode === "lost") { mode = "save"; throw new Error("Committed but acknowledgement lost"); }
      return json({ link: row, replayed: Boolean(existing) }, existing ? 200 : 201);
    }
    if (url.includes("/decision-links/context?")) return json({ packet: { contextText: source.context_text, contextSha256: source.context_sha256 }, actorId: native.scope.actorId });
    if (url.endsWith("/decision-links")) return json({ snapshot, actorId: native.scope.actorId });
    throw new Error(`Unexpected URL ${url}`);
  });
  return { fetcher, intents, get posts() { return posts; }, get snapshot() { return snapshot; }, setMode(value: typeof mode) { mode = value; } };
}

async function open() {
  fireEvent.click(screen.getByRole("button", { name: "Connect responses to decisions" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Reload decision links" })).toBeEnabled());
  await waitFor(() => expect(screen.getByLabelText("Staff response")).toBeEnabled());
}
async function review() {
  fireEvent.change(screen.getByLabelText("Staff response"), { target: { value: source.response_id } });
  fireEvent.change(screen.getByLabelText("Project decision"), { target: { value: source.decision_id } });
  fireEvent.click(screen.getByRole("button", { name: "Review current sources" }));
  await screen.findByText("SYNTHETIC private rationale");
  await waitFor(() => expect(screen.getByLabelText("Reason for this link or change")).toBeEnabled());
}

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

describe("decision link editor", () => {
  it("opens from the actual response builder and retains a reviewed link before sending", async () => {
    const backend = server();
    render(<EngagementCloseLoopBuilder workspaceId={props.workspaceId} userId={props.actorId} campaignId={props.campaignId} categories={[]} initialEntries={props.responses} />);
    expect(backend.fetcher).not.toHaveBeenCalled();
    await open(); await review();
    fireEvent.change(screen.getByLabelText("Reason for this link or change"), { target: { value: "SYNTHETIC crossing decision follows this response" } });
    fireEvent.click(screen.getByRole("button", { name: "Save decision link" }));
    await screen.findByText("Decision link saved. Its original sources and explanation are retained.");
    expect(backend.posts).toBe(1); expect(backend.snapshot.entries).toHaveLength(1); expect(localStorage.length).toBe(0);
    expect(backend.intents[0]).toMatchObject({ responseId: source.response_id, decisionId: source.decision_id, expectedContextSha256: source.context_sha256, operation: "link" });
  });
  it("recovers a lost acknowledgement after remount and retries the exact request", async () => {
    const backend = server(); backend.setMode("lost");
    const view = render(<DecisionLinksPanel {...props} />); await open(); await review();
    fireEvent.change(screen.getByLabelText("Reason for this link or change"), { target: { value: "SYNTHETIC retained through interruption" } });
    fireEvent.click(screen.getByRole("button", { name: "Save decision link" }));
    await screen.findByText(/The save is unconfirmed/); view.unmount();
    render(<DecisionLinksPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect responses to decisions" }));
    await screen.findByRole("button", { name: "Retry exact request" });
    expect(screen.getByLabelText("Staff response")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry exact request" }));
    await screen.findByText(/Decision link saved/);
    expect(backend.intents).toHaveLength(2); expect(backend.intents[1]).toEqual(backend.intents[0]);
    expect(backend.snapshot.entries).toHaveLength(1); expect(localStorage.length).toBe(0);
  });
  it("preserves earlier history when saving a reviewed correction", async () => {
    const backend = server(structuredClone(native.initial));
    render(<DecisionLinksPanel {...props} />); await open();
    fireEvent.click(screen.getByRole("button", { name: "Select this link" }));
    fireEvent.click(screen.getByRole("button", { name: "Review current sources" }));
    await waitFor(() => expect(screen.getByLabelText("Reason for this link or change")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Reason for this link or change"), { target: { value: "SYNTHETIC corrected explanation" } });
    fireEvent.click(screen.getByRole("button", { name: "Save reviewed correction" }));
    await screen.findByText(/Decision link saved/);
    expect(backend.snapshot.entries).toHaveLength(2); expect(backend.snapshot.entries[0]).toEqual(source);
    expect(backend.intents[0]).toMatchObject({ operation: "refresh", predecessorId: source.id });
    await screen.findByText(/Earlier retained version/);
  });
  it("withdraws a retained link when current response and decision records are unavailable", async () => {
    const initial = structuredClone(native.initial); initial.decisions = []; initial.decisionCount = 0;
    initial.current[0] = { linkId: source.id, sourceState: "unavailable", currentContextSha256: null, unavailableReason: "source_unavailable" };
    const backend = server(initial);
    render(<DecisionLinksPanel {...props} responses={[]} responsesUnavailable />); await open();
    fireEvent.click(screen.getByRole("button", { name: "Select this link" }));
    fireEvent.change(screen.getByLabelText("Reason for this link or change"), { target: { value: "SYNTHETIC withdraw removed source" } });
    fireEvent.click(screen.getByRole("button", { name: "Withdraw link, keep history" }));
    await screen.findByText(/Decision link saved/);
    expect(backend.intents[0]).toMatchObject({ operation: "withdraw", expectedContextSha256: null, predecessorId: source.id });
    expect(backend.snapshot.entries[1].context_text).toBe(source.context_text);
    expect(backend.fetcher.mock.calls.filter(([url]) => String(url).includes("/context?"))).toHaveLength(0);
  });
  it("retains a refused explanation and requires a fresh source review for the next attempt", async () => {
    const backend = server(); backend.setMode("conflict");
    render(<DecisionLinksPanel {...props} />); await open(); await review();
    fireEvent.change(screen.getByLabelText("Reason for this link or change"), { target: { value: "SYNTHETIC conflicted explanation" } });
    fireEvent.click(screen.getByRole("button", { name: "Save decision link" }));
    await screen.findByText(/This request was refused/);
    await screen.findByText("Retained request: conflict · link");
    expect(screen.getByRole("button", { name: "Save decision link" })).toBeDisabled();
    backend.setMode("save"); await review();
    fireEvent.change(screen.getByLabelText("Reason for this link or change"), { target: { value: "SYNTHETIC newly reviewed explanation" } });
    fireEvent.click(screen.getByRole("button", { name: "Save decision link" }));
    await screen.findByText(/Decision link saved/);
    expect(backend.intents).toHaveLength(2); expect(backend.intents[0]).not.toEqual(backend.intents[1]);
    expect(localStorage.length).toBe(1); expect(localStorage.getItem(localStorage.key(0)!)).toContain("SYNTHETIC conflicted explanation");
  });
  it("prevents transport when local retention fails", async () => {
    const backend = server(); render(<DecisionLinksPanel {...props} />); await open(); await review();
    fireEvent.change(screen.getByLabelText("Reason for this link or change"), { target: { value: "SYNTHETIC no room" } });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage is full"); });
    fireEvent.click(screen.getByRole("button", { name: "Save decision link" }));
    await screen.findByText("Storage is full"); expect(backend.posts).toBe(0);
    expect(screen.getByLabelText("Reason for this link or change")).toHaveValue("SYNTHETIC no room");
  });
  it("keeps corrupt local requests visible and blocks new writes", async () => {
    const backend = server();
    const key = `openplan:decision-link:${props.actorId}:${props.workspaceId}:${props.campaignId}:${crypto.randomUUID()}`;
    localStorage.setItem(key, "{corrupt"); render(<DecisionLinksPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect responses to decisions" }));
    await screen.findByText(/A local request could not be verified/);
    expect(screen.getByLabelText("Staff response")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Download unreadable request" })).toBeEnabled();
    expect(localStorage.getItem(key)).toBe("{corrupt"); expect(backend.posts).toBe(0);
  });
  it("resolves a damaged request through the actual editor and archives it before new writes", async () => {
    const backend = server();
    const key = `openplan:decision-link:${props.actorId}:${props.workspaceId}:${props.campaignId}:${crypto.randomUUID()}`;
    localStorage.setItem(key, "{SYNTHETIC damaged copy");
    const originalFetch = backend.fetcher.getMockImplementation()!;
    backend.fetcher.mockImplementation(async (url, init) => {
      if (String(url).endsWith("/resolutions")) return json(resolutionTestPacket(native.scope, JSON.parse(String(init?.body))));
      return originalFetch(url, init);
    });
    render(<DecisionLinksPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect responses to decisions" }));
    await screen.findByRole("button", { name: "Review damaged request recovery" });
    fireEvent.click(screen.getByRole("button", { name: "Review damaged request recovery" }));
    expect(screen.getByLabelText("Staff response")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm resolution and preserve copies" }));
    await waitFor(() => expect(localStorage.getItem(key)).toBeNull());
    await waitFor(() => expect(screen.getByLabelText("Staff response")).toBeEnabled());
    const stored = readDecisionResolutionRecovery(localStorage, native.scope);
    expect(stored.pending).toHaveLength(0); expect(stored.archives).toHaveLength(1);
    expect(JSON.parse(JSON.parse(stored.archives[0].raw).request.intents[0].copyJson)).toBe("{SYNTHETIC damaged copy");
    expect(backend.posts).toBe(0);
  });
  it("preserves page-held and corrupted copies when resolving a lost link acknowledgement", async () => {
    const backend = server(); backend.setMode("lost");
    render(<DecisionLinksPanel {...props} />); await open(); await review();
    fireEvent.change(screen.getByLabelText("Reason for this link or change"), { target: { value: "SYNTHETIC uncertain original reason" } });
    fireEvent.click(screen.getByRole("button", { name: "Save decision link" }));
    await screen.findByText(/The save is unconfirmed/);
    await screen.findByRole("button", { name: "Retry exact request" });
    expect(screen.getByText(/The save is unconfirmed/)).toBeVisible();
    const sourceKey = localStorage.key(0)!, originalBytes = localStorage.getItem(sourceKey)!;
    localStorage.setItem(sourceKey, "SYNTHETIC changed stored bytes");
    fireEvent(window, new StorageEvent("storage"));
    await screen.findByRole("button", { name: "Review damaged request recovery" });
    const originalFetch = backend.fetcher.getMockImplementation()!;
    backend.fetcher.mockImplementation(async (url, init) => {
      if (!String(url).endsWith("/resolutions")) return originalFetch(url, init);
      const packet = resolutionTestPacket(native.scope, JSON.parse(String(init?.body)));
      const result = JSON.parse(packet.resultText); result.state = "saved"; result.link = backend.snapshot.entries[0];
      packet.resultText = JSON.stringify(result); packet.resultSha256 = hash(packet.resultText); return json(packet);
    });
    fireEvent.click(screen.getByRole("button", { name: "Review damaged request recovery" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm resolution and preserve copies" }));
    await waitFor(() => expect(localStorage.getItem(sourceKey)).toBeNull());
    await waitFor(() => expect(screen.getByLabelText("Staff response")).toBeEnabled());
    expect(screen.queryByRole("button", { name: "Retry exact request" })).toBeNull();
    expect(screen.queryByText(/The save is unconfirmed/)).toBeNull();
    const saved = readDecisionResolutionRecovery(localStorage, native.scope);
    expect(saved.archives).toHaveLength(1);
    const archive = JSON.parse(saved.archives[0].raw);
    expect(archive.request.intents.map((intent: { copyJson: string }) => JSON.parse(intent.copyJson)))
      .toEqual(["SYNTHETIC changed stored bytes", originalBytes]);
    expect(archive.receipts.every((packet: { resultText: string }) => JSON.parse(packet.resultText).state === "saved")).toBe(true);
    expect(backend.snapshot.entries).toHaveLength(1);
  });
  it("does not let a slow earlier storage read hide a newer damaged copy", async () => {
    const pendingModule = await import("@/lib/engagement/pending-decision-link");
    const { campaignId: _campaign, ...payload } = source.payload_json;
    const request = { version: 1 as const, ...native.scope, phase: "unconfirmed" as const,
      intent: { ...payload, requestId: source.id }, context: { contextText: source.context_text, contextSha256: source.context_sha256 } };
    await pendingModule.retainPendingDecision(localStorage, request);
    let finish!: (value: Awaited<ReturnType<typeof pendingModule.readPendingDecisions>>) => void;
    const oldRead = new Promise<Awaited<ReturnType<typeof pendingModule.readPendingDecisions>>>(resolve => { finish = resolve; });
    const reader = vi.spyOn(pendingModule, "readPendingDecisions").mockImplementationOnce(() => oldRead);
    server(); render(<DecisionLinksPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect responses to decisions" }));
    await waitFor(() => expect(reader).toHaveBeenCalledTimes(1));
    localStorage.setItem(pendingDecisionKey(request), "SYNTHETIC newly damaged bytes");
    fireEvent(window, new StorageEvent("storage"));
    await screen.findByRole("button", { name: "Review damaged request recovery" });
    await act(async () => { finish({ pending: [request], unreadable: [] }); });
    expect(screen.getByRole("button", { name: "Review damaged request recovery" })).toBeVisible();
    expect(localStorage.getItem(pendingDecisionKey(request))).toBe("SYNTHETIC newly damaged bytes");
  });
  it("does not display a snapshot from another signed-in account", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ snapshot: native.initial, actorId: crypto.randomUUID() }));
    render(<DecisionLinksPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect responses to decisions" }));
    await screen.findByText(/Decision history could not be loaded/);
    expect(screen.queryByText("SYNTHETIC private rationale")).toBeNull();
    expect(screen.queryByRole("region", { name: "Decision request recovery" })).toBeNull();
    expect(screen.queryByText(/No decision links have been saved/)).toBeNull();
    expect(screen.getByLabelText("Staff response")).toBeDisabled();
  });
  it("hides local recovery content after a confirmed account mismatch", async () => {
    const { retainPendingDecision } = await import("@/lib/engagement/pending-decision-link");
    const { campaignId: _campaign, ...payload } = source.payload_json;
    await retainPendingDecision(localStorage, { version: 1, ...native.scope, phase: "unconfirmed",
      intent: { ...payload, requestId: source.id, reason: "SYNTHETIC old account private explanation" },
      context: { contextText: source.context_text, contextSha256: source.context_sha256 } });
    const backend = server();
    render(<DecisionLinksPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect responses to decisions" }));
    await screen.findByText("SYNTHETIC old account private explanation");
    await waitFor(() => expect(screen.getByRole("button", { name: "Reload decision links" })).toBeEnabled());
    backend.fetcher.mockResolvedValue(json({ snapshot: native.initial, actorId: crypto.randomUUID() }));
    fireEvent.click(screen.getByRole("button", { name: "Reload decision links" }));
    await screen.findByText(/Decision history could not be loaded/);
    expect(screen.queryByText("SYNTHETIC old account private explanation")).toBeNull();
    expect(screen.queryByRole("button", { name: "Download retained request" })).toBeNull();
    expect(localStorage.length).toBe(1);
  });
});
