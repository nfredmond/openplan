import { act, fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EngagementSynthesisSources } from "@/components/engagement/engagement-synthesis-sources";
import { makeSourceSnapshot, sourceActor, sourceReceipt, sourceScope } from "./fixtures/engagement/synthesis-source";
import { retainPendingSynthesisSource } from "@/lib/engagement/pending-synthesis-source";
const mocks = vi.hoisted(() => ({ changed: null as null | ((event: string, session: { user: { id: string } } | null) => void) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { onAuthStateChange: (callback: typeof mocks.changed) => { mocks.changed = callback; return { data: { subscription: { unsubscribe() {} } } }; } } }) }));
const props = { userId: sourceActor, workspaceId: sourceScope.workspaceId, campaignId: sourceScope.campaignId, categories: [] };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const history = { campaignId: sourceScope.campaignId, workspaceId: sourceScope.workspaceId, pageSize: 25, entries: [], nextCursor: null };
const inspection = () => ({ ...sourceReceipt(), snapshot: makeSourceSnapshot() });
beforeEach(() => { localStorage.clear(); mocks.changed = null; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("retained source panel", () => {
  it.each([200, 403, 503, "stale denial"] as const)("revalidates access after focus and handles unsent choices after a %s source response", async focusStatus => {
    const { replayed: _, ...receipt } = sourceReceipt();
    const connectionId = "518aef0d-8dbd-4dcf-ab87-205a84e8bb29", revisionId = "123ea180-c69d-43bc-90e4-999a12b26a2a";
    const date = "2026-10-06T12:00:00Z";
    const revision = { id: revisionId, connection_id: connectionId, workspace_id: props.workspaceId, previous_revision_id: null,
      configuration: { label: "Synthetic focus API", protocol: "openai_chat_completions", endpoint: "http://synthetic.invalid/v1", modelIds: ["synthetic-model"], structuredOutput: true, authMode: "none", timeoutSeconds: 120 },
      configuration_hash: "b".repeat(64), configured_by: props.userId, created_at: date };
    const connection = { id: connectionId, workspace_id: props.workspaceId, current_revision_id: revisionId, created_by: props.userId, created_at: date, revoked_at: null, current_revision: revision };
    let inspections = 0, finish!: (value: Response) => void;
    const transport = vi.fn<typeof fetch>().mockImplementation(async url => {
      if (String(url).includes("provider-api-connections")) return json({ connections: [connection], total: 1, offset: 0, nextOffset: null });
      if (String(url).includes("?requestId=")) {
        if (++inspections === 2) return new Promise(resolve => { finish = resolve; });
        return json(inspection());
      }
      return json({ ...history, entries: [{ ...receipt, selection: makeSourceSnapshot().selection }] });
    });
    vi.stubGlobal("fetch", transport); render(<EngagementSynthesisSources {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: /Open saved source/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Optional generated analysis" }));
    await screen.findByRole("option", { name: "Synthetic focus API" });
    fireEvent.change(screen.getByLabelText("Saved API connection"), { target: { value: connectionId } });
    fireEvent.change(screen.getByLabelText("Analysis model"), { target: { value: "synthetic-model" } });
    fireEvent.focus(window);
    expect(screen.queryByLabelText("Saved source inspection")).toBeNull();
    expect(screen.queryByLabelText("Analysis model")).toBeNull();
    if (focusStatus === "stale denial") {
      fireEvent.focus(window);
      await waitFor(() => expect(screen.getByRole("button", { name: "Save analysis request" })).toBeEnabled());
      await act(async () => finish(json({}, 403)));
      fireEvent.focus(window);
    } else {
      await act(async () => finish(json(focusStatus === 200 ? inspection() : {}, focusStatus)));
    }
    if (focusStatus !== 200 && focusStatus !== "stale denial") {
      expect(screen.queryByLabelText("Saved source inspection")).toBeNull();
      fireEvent.click(await screen.findByRole("button", { name: "Retry opening saved source" }));
    }
    if (focusStatus === 403) {
      expect(await screen.findByRole("button", { name: "Optional generated analysis" })).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByLabelText("Analysis model")).toBeNull();
      expect(transport.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
      return;
    }
    await waitFor(() => expect(screen.getByRole("button", { name: "Save analysis request" })).toBeEnabled());
    expect(screen.getByLabelText("Saved API connection")).toHaveValue(connectionId);
    expect(screen.getByLabelText("Analysis model")).toHaveValue("synthetic-model");
    expect(transport.mock.calls.filter(([url]) => String(url).includes("provider-api-connections"))).toHaveLength(focusStatus === "stale denial" ? 3 : 2);
    expect(transport.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
  });
  it("opens complete original sources and searches beyond the 300th comment", async () => {
    const { replayed: _, ...receipt } = sourceReceipt();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async url => String(url).includes("?requestId=") ? json(inspection()) : json({ ...history, entries: [{ ...receipt, selection: makeSourceSnapshot().selection }] })));
    render(<EngagementSynthesisSources {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: /Open saved source/ }));
    expect(await screen.findByLabelText("Saved source inspection")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search all retained contributions"), { target: { value: "FINAL SOURCE TAIL" } });
    expect(screen.getByText(/SYNTHETIC long concern é/, { selector: "p" }).textContent).toContain("FINAL SOURCE TAIL");
    expect(screen.getByText(/1 matching contributions/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Comment: SYNTHETIC retained category" })).toBeTruthy();
  });
  it("restores an interrupted save and keeps confirmation after inspection fails", async () => {
    const intent = { requestId: sourceScope.requestId, actorId: sourceActor, workspaceId: sourceScope.workspaceId, selection: { ...makeSourceSnapshot().selection, statuses: ["pending" as const], includeItems: false } };
    retainPendingSynthesisSource(localStorage, { version: 1, userId: props.userId, workspaceId: props.workspaceId, campaignId: props.campaignId, intent });
    const transport = vi.fn<typeof fetch>().mockImplementation(async (url, options) => options?.method === "POST" ? json(sourceReceipt(true)) : String(url).includes("?requestId=") ? json({}, 503) : json(history));
    vi.stubGlobal("fetch", transport); render(<EngagementSynthesisSources {...props} />);
    await screen.findByRole("button", { name: "Retry retained source request" });
    expect(screen.getByLabelText("Comments and replies")).not.toBeChecked();
    expect(screen.getByLabelText("Pending")).toBeChecked();
    expect(screen.getByLabelText("Approved")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Retry retained source request" }));
    expect(await screen.findByText(/^Source saved: 301/)).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Retry opening saved source" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry opening saved source" }));
    await waitFor(() => expect(transport.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1));
    expect(JSON.parse(String(transport.mock.calls.find(([, init]) => init?.method === "POST")![1]?.body))).toEqual(intent);
    expect(localStorage.length).toBe(0);
  });
  it("shows the source controls when no approved comments exist and captures survey-only selection", async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => options?.method === "POST" ? json({}, 503) : json(history));
    vi.stubGlobal("fetch", transport); render(<EngagementSynthesisSources {...props} />);
    await screen.findByText("No saved sources were found.");
    fireEvent.click(screen.getByLabelText("Comments and replies"));
    fireEvent.click(screen.getByRole("button", { name: "Save selected sources" }));
    await screen.findByText(/The save is unconfirmed/);
    const body = JSON.parse(String(transport.mock.calls.find(([, init]) => init?.method === "POST")![1]?.body));
    expect(body.selection).toMatchObject({ includeItems: false, includeSurveys: true });
    expect(localStorage.length).toBe(1);
  });
  it("erases private content on account change and ignores an in-flight read", async () => {
    const { replayed: _, ...receipt } = sourceReceipt();
    let resolve: (response: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async url => String(url).includes("?requestId=") ? new Promise<Response>(done => { resolve = done; }) : json({ ...history, entries: [{ ...receipt, selection: makeSourceSnapshot().selection }] })));
    render(<EngagementSynthesisSources {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: /Open saved source/ }));
    act(() => { mocks.changed?.("SIGNED_OUT", null); });
    await act(async () => { resolve(json(inspection())); });
    expect(screen.getByRole("alert").textContent).toContain("signed-in account changed");
    expect(screen.queryByLabelText("Saved source inspection")).toBeNull();
    expect(screen.queryByRole("button", { name: /Open saved source/ })).toBeNull();
  });
});
