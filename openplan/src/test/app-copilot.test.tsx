import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AssistantPreview, AssistantQuickLink, AssistantResponse } from "@/lib/assistant/catalog";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { AppCopilot } from "@/components/assistant/app-copilot";

const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";

const approvalQuickLink: AssistantQuickLink = {
  id: "create-funding-opportunity",
  label: "Create the SS4A opportunity record",
  href: "/funding",
  targetKind: "workspace",
  actionClass: "review_controls",
  executionMode: "future_agent_action",
  priority: "primary",
  executeAction: {
    kind: "create_funding_opportunity",
    title: "SS4A Implementation Grant",
  },
};

const previewFixture: AssistantPreview = {
  kind: "workspace",
  title: "Foothill COG",
  summary: "Grounded workspace summary.",
  stats: [],
  facts: ["One project is active."],
  suggestedActions: [],
  quickLinks: [approvalQuickLink],
};

const deterministicResponse: AssistantResponse = {
  workflowId: "workspace-overview",
  label: "Workspace overview",
  title: "Deterministic workspace brief",
  summary: "Templated summary of the workspace.",
  findings: ["Finding one"],
  nextSteps: ["Next step one"],
  evidence: ["Evidence one"],
};

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

type FetchRoute = (input: string, init?: RequestInit) => Promise<Response> | Response | null;

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Build a UI-message-protocol SSE response body from chunk objects. */
function sseResponse(chunks: Array<Record<string, unknown>>, options?: { omitDone?: boolean }) {
  const body =
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + (options?.omitDone ? "" : "data: [DONE]\n\n");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function textReplyResponse(text: string) {
  return sseResponse([
    { type: "start" },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: text },
    { type: "text-end", id: "t1" },
    { type: "finish" },
  ]);
}

describe("AppCopilot", () => {
  const fetchMock = vi.fn();
  let chatRoute: FetchRoute;

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("fetch", fetchMock);

    chatRoute = () => textReplyResponse("Here is a grounded AI reply.");

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/assistant/context")) {
        return jsonResponse({ preview: previewFixture });
      }
      if (url.startsWith("/api/assistant/chat")) {
        const routed = await chatRoute(url, init);
        if (routed) return routed;
      }
      if (url.startsWith("/api/assistant/actions/approvals")) {
        return jsonResponse({ approvalId: "approval-1", inputHash: "hash-1" });
      }
      if (url.startsWith("/api/assistant")) {
        return jsonResponse({ response: deterministicResponse });
      }
      if (url.startsWith("/api/funding-opportunities")) {
        return jsonResponse({ opportunity: { id: "new-opportunity" } }, 201);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
  });

  function proposalReplyResponse() {
    return sseResponse([
      { type: "start" },
      { type: "tool-input-start", toolCallId: "call-2", toolName: "propose_create_funding_opportunity" },
      {
        type: "tool-output-available",
        toolCallId: "call-2",
        output: {
          status: "proposed",
          kind: "create_funding_opportunity",
          payload: { kind: "create_funding_opportunity", title: "SS4A Implementation Grant" },
          approval: "approval_required",
          description: "Creates a new funding opportunity record in this workspace.",
        },
      },
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "I prepared a proposal for your approval." },
      { type: "text-end", id: "t1" },
      { type: "finish" },
    ]);
  }

  async function streamProposalReply() {
    chatRoute = () => proposalReplyResponse();

    await openPanel();

    fireEvent.change(screen.getByPlaceholderText(/Ask about project status/), {
      target: { value: "Create the SS4A opportunity" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Approve & run" })).toBeInTheDocument();
    });
  }

  async function openPanel() {
    render(<AppCopilot workspaceId={WORKSPACE_ID} workspaceName="Foothill COG" />);

    fireEvent.click(screen.getByRole("button", { name: "Planner Agent" }));

    await waitFor(() => {
      expect(screen.getAllByText("Grounded workspace summary.").length).toBeGreaterThan(0);
    });
  }

  it("streams a free-text reply into the chat area", async () => {
    await openPanel();

    fireEvent.change(screen.getByPlaceholderText(/Ask about project status/), {
      target: { value: "Where should I focus this week?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send/ }));

    await waitFor(() => {
      expect(screen.getByText("Here is a grounded AI reply.")).toBeInTheDocument();
    });

    const chatCall = fetchMock.mock.calls.find((call) => String(call[0]).startsWith("/api/assistant/chat"));
    expect(chatCall).toBeDefined();
    const chatBody = JSON.parse(String((chatCall![1] as RequestInit).body)) as { question: string; kind: string };
    expect(chatBody.question).toBe("Where should I focus this week?");
    expect(chatBody.kind).toBe("workspace");
    expect(screen.queryByText(/no AI key is set up/)).not.toBeInTheDocument();
  });

  it("shows the offline state and falls back to the deterministic response on 503 ai_offline", async () => {
    chatRoute = () => jsonResponse({ error: "ai_offline" }, 503);

    await openPanel();

    fireEvent.change(screen.getByPlaceholderText(/Ask about project status/), {
      target: { value: "Where should I focus this week?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send/ }));

    await waitFor(() => {
      expect(
        screen.getByText(/The Planner Agent can't chat yet because no AI key is set up/)
      ).toBeInTheDocument();
    });
    // The honest state links straight to the dashboard step where an
    // owner/admin adds the key — not to a dead end.
    expect(
      screen.getByRole("link", { name: /Turn on your AI assistant from the dashboard checklist/ })
    ).toHaveAttribute("href", "/dashboard#workspace-ai-key");

    await waitFor(() => {
      expect(screen.getByText("Deterministic workspace brief")).toBeInTheDocument();
    });

    const deterministicCall = fetchMock.mock.calls.find(
      (call) => String(call[0]) === "/api/assistant" && (call[1] as RequestInit | undefined)?.method === "POST"
    );
    expect(deterministicCall).toBeDefined();
  });

  it("shows a retry affordance when the stream fails mid-reply", async () => {
    const failingStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode('data: {"type":"text-delta","id":"t1","delta":"Partial rep"}\n\n')
        );
        controller.error(new Error("network dropped"));
      },
    });
    chatRoute = () => new Response(failingStream, { status: 200, headers: { "content-type": "text/event-stream" } });

    await openPanel();

    fireEvent.change(screen.getByPlaceholderText(/Ask about project status/), {
      target: { value: "Where should I focus this week?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    });

    // Retrying issues a fresh chat request without duplicating the user prompt.
    chatRoute = () => textReplyResponse("Recovered reply.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(screen.getByText("Recovered reply.")).toBeInTheDocument();
    });
    expect(screen.getAllByText("Where should I focus this week?")).toHaveLength(1);
  });

  it("surfaces an explicit error frame with retry (no more silent empty body)", async () => {
    chatRoute = () =>
      sseResponse([{ type: "start" }, { type: "error", errorText: "The Planner Agent reply failed mid-stream — the model may be busy. Try again." }]);

    await openPanel();

    fireEvent.change(screen.getByPlaceholderText(/Ask about project status/), {
      target: { value: "Where should I focus this week?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send/ }));

    await waitFor(() => {
      expect(
        screen.getByText("The Planner Agent reply failed mid-stream — the model may be busy. Try again.")
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("treats a finished stream with no text and no proposals as a retryable empty reply", async () => {
    chatRoute = () => sseResponse([{ type: "start" }, { type: "finish" }]);

    await openPanel();

    fireEvent.change(screen.getByPlaceholderText(/Ask about project status/), {
      target: { value: "Where should I focus this week?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send/ }));

    await waitFor(() => {
      expect(screen.getByText(/came back empty/)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("renders compact tool-activity chips for tool calls in the streaming bubble", async () => {
    chatRoute = () =>
      sseResponse([
        { type: "start" },
        { type: "tool-input-start", toolCallId: "call-1", toolName: "list_funding_opportunities" },
        {
          type: "tool-output-available",
          toolCallId: "call-1",
          output: { status: "ok", opportunityCount: 3, opportunities: [] },
        },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "Three opportunities are open." },
        { type: "text-end", id: "t1" },
        { type: "finish" },
      ]);

    await openPanel();

    fireEvent.change(screen.getByPlaceholderText(/Ask about project status/), {
      target: { value: "What funding is open?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send/ }));

    await waitFor(() => {
      expect(screen.getByText("Three opportunities are open.")).toBeInTheDocument();
    });
    expect(screen.getByText("Looked up: 3 funding opportunities")).toBeInTheDocument();
  });

  it("renders a proposal card from a propose_* tool output without executing anything", async () => {
    chatRoute = () =>
      sseResponse([
        { type: "start" },
        { type: "tool-input-start", toolCallId: "call-2", toolName: "propose_create_funding_opportunity" },
        {
          type: "tool-output-available",
          toolCallId: "call-2",
          output: {
            status: "proposed",
            kind: "create_funding_opportunity",
            payload: { kind: "create_funding_opportunity", title: "SS4A Implementation Grant" },
            approval: "approval_required",
            description: "Creates a new funding opportunity record in this workspace.",
          },
        },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "I prepared a proposal for your approval." },
        { type: "text-end", id: "t1" },
        { type: "finish" },
      ]);

    await openPanel();

    fireEvent.change(screen.getByPlaceholderText(/Ask about project status/), {
      target: { value: "Create the SS4A opportunity" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send/ }));

    await waitFor(() => {
      expect(screen.getByRole("group", { name: /Proposed action: create funding opportunity/ })).toBeInTheDocument();
    });
    expect(screen.getAllByText("Creates a new funding opportunity record in this workspace.").length).toBeGreaterThan(0);
    expect(screen.getByText("SS4A Implementation Grant")).toBeInTheDocument();
    // Proposing must not have executed anything: no mutation endpoints were hit.
    const mutatingCall = fetchMock.mock.calls.find((call) => {
      const url = String(call[0]);
      const method = (call[1] as RequestInit | undefined)?.method ?? "GET";
      return url.startsWith("/api/funding-opportunities") && method !== "GET";
    });
    expect(mutatingCall).toBeUndefined();
  });

  it("shows model-authored free text in full on the card and echoes the whole payload in the approval sheet", async () => {
    const projectId = "44444444-4444-4444-8444-444444444444";
    const longNotes =
      "First sentence of the model-authored submittal notes. Second sentence carrying a substantive claim the planner is accountable for. Third sentence that a truncated chip would have hidden entirely from review.";
    chatRoute = () =>
      sseResponse([
        { type: "start" },
        { type: "tool-input-start", toolCallId: "call-3", toolName: "propose_create_project_record" },
        {
          type: "tool-output-available",
          toolCallId: "call-3",
          output: {
            status: "proposed",
            kind: "create_project_record",
            payload: {
              kind: "create_project_record",
              projectId,
              recordType: "submittal",
              title: "Authorization packet",
              notes: longNotes,
            },
            approval: "approval_required",
            description: "Creates a delivery record on a project in this workspace.",
          },
        },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "I prepared a submittal record proposal." },
        { type: "text-end", id: "t1" },
        { type: "finish" },
      ]);

    await openPanel();

    fireEvent.change(screen.getByPlaceholderText(/Ask about project status/), {
      target: { value: "Record the authorization packet submittal" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Approve & run" })).toBeInTheDocument();
    });

    // The proposal card renders the model-authored free text in full, unclamped.
    expect(screen.getByText(longNotes)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Approve & run" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Approve Planner Agent action" })).toBeInTheDocument();
    });
    // The approval sheet echoes EVERY payload field in full before the Approve
    // button — the planner never approves text they were not shown.
    const sheet = within(screen.getByRole("dialog", { name: "Approve Planner Agent action" }));
    expect(sheet.getByText("Exactly what you are approving")).toBeInTheDocument();
    expect(sheet.getByText(longNotes)).toBeInTheDocument();
    expect(sheet.getByText("Authorization packet")).toBeInTheDocument();
    expect(sheet.getByText(projectId)).toBeInTheDocument();
    expect(sheet.getByText("submittal")).toBeInTheDocument();

    // Nothing executed while the disclosure was on screen.
    fireEvent.click(sheet.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Approve Planner Agent action" })).not.toBeInTheDocument();
    });
    const approvalCall = fetchMock.mock.calls.find((call) => String(call[0]).startsWith("/api/assistant/actions/approvals"));
    expect(approvalCall).toBeUndefined();
  });

  it("opens the in-panel approval sheet with the action description and cancels on Escape", async () => {
    await openPanel();

    fireEvent.click(screen.getByRole("button", { name: /Execute now · create-funding-opportunity/ }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Approve Planner Agent action" })).toBeInTheDocument();
    });
    const sheet = within(screen.getByRole("dialog", { name: "Approve Planner Agent action" }));
    expect(sheet.getByText("Create the SS4A opportunity record")).toBeInTheDocument();
    expect(sheet.getByText("Creates a new funding opportunity record in this workspace.")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Approve Planner Agent action" })).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getAllByText("Planner Agent action approval was cancelled.").length).toBeGreaterThan(0);
    });
  });

  it("runs an approved chat proposal through the existing approval modal and registry dispatch", async () => {
    await streamProposalReply();

    fireEvent.click(screen.getByRole("button", { name: "Approve & run" }));

    // The EXISTING in-panel approval sheet gates the proposal.
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Approve Planner Agent action" })).toBeInTheDocument();
    });
    const sheet = within(screen.getByRole("dialog", { name: "Approve Planner Agent action" }));
    expect(sheet.getByText("Chat proposal · create funding opportunity")).toBeInTheDocument();
    expect(sheet.getByText("Creates a new funding opportunity record in this workspace.")).toBeInTheDocument();

    fireEvent.click(sheet.getByRole("button", { name: "Approve action" }));

    await waitFor(() => {
      expect(screen.getByText(/Approved and executed/)).toBeInTheDocument();
    });

    // Approval evidence was minted for the exact proposal payload.
    const approvalCall = fetchMock.mock.calls.find((call) => String(call[0]).startsWith("/api/assistant/actions/approvals"));
    expect(approvalCall).toBeDefined();
    const approvalBody = JSON.parse(String((approvalCall![1] as RequestInit).body)) as {
      workspaceId: string;
      requireApproval: boolean;
      action: { kind: string; title: string };
    };
    expect(approvalBody.workspaceId).toBe(WORKSPACE_ID);
    expect(approvalBody.requireApproval).toBe(true);
    expect(approvalBody.action).toEqual({ kind: "create_funding_opportunity", title: "SS4A Implementation Grant" });

    // The registry effect executed with the proposal payload and approval headers.
    const executeCall = fetchMock.mock.calls.find(
      (call) => String(call[0]) === "/api/funding-opportunities" && (call[1] as RequestInit | undefined)?.method === "POST"
    );
    expect(executeCall).toBeDefined();
    const executeInit = executeCall![1] as RequestInit;
    expect(JSON.parse(String(executeInit.body))).toMatchObject({ title: "SS4A Implementation Grant" });
    const headers = executeInit.headers as Record<string, string>;
    expect(headers["x-openplan-assistant-approval-id"]).toBe("approval-1");
    expect(headers["x-openplan-assistant-input-hash"]).toBe("hash-1");
    expect(headers["x-openplan-assistant-execution-source"]).toBe("planner_agent_quick_link");
  });

  it("leaves no execution behind a rejected proposal approval", async () => {
    await streamProposalReply();

    fireEvent.click(screen.getByRole("button", { name: "Approve & run" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Approve Planner Agent action" })).toBeInTheDocument();
    });
    fireEvent.click(within(screen.getByRole("dialog", { name: "Approve Planner Agent action" })).getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Approve Planner Agent action" })).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getAllByText("Planner Agent action approval was cancelled.").length).toBeGreaterThan(0);
    });

    // The card returns to pending — approvable again, nothing executed.
    expect(screen.getByRole("button", { name: "Approve & run" })).toBeInTheDocument();
    const approvalCall = fetchMock.mock.calls.find((call) => String(call[0]).startsWith("/api/assistant/actions/approvals"));
    expect(approvalCall).toBeUndefined();
    const executeCall = fetchMock.mock.calls.find(
      (call) => String(call[0]) === "/api/funding-opportunities" && (call[1] as RequestInit | undefined)?.method === "POST"
    );
    expect(executeCall).toBeUndefined();
  });

  it("dismissing a proposal records the dismissal and executes nothing", async () => {
    await streamProposalReply();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    await waitFor(() => {
      expect(screen.getByText(/Dismissed — no change was made\./)).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Approve & run" })).not.toBeInTheDocument();
    const executeCall = fetchMock.mock.calls.find(
      (call) => String(call[0]) === "/api/funding-opportunities" && (call[1] as RequestInit | undefined)?.method === "POST"
    );
    expect(executeCall).toBeUndefined();
  });

  it("surfaces the cost-threshold warning from finish metadata as a final annotation", async () => {
    chatRoute = () =>
      sseResponse([
        { type: "start" },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "A heavy but complete answer." },
        { type: "text-end", id: "t1" },
        {
          type: "finish",
          messageMetadata: {
            costWarning: { thresholdKind: "single_call", thresholdUsd: 0.5, estimatedCostUsd: 0.75 },
          },
        },
      ]);

    await openPanel();

    fireEvent.change(screen.getByPlaceholderText(/Ask about project status/), {
      target: { value: "Audit everything at once" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send/ }));

    await waitFor(() => {
      expect(screen.getByText("A heavy but complete answer.")).toBeInTheDocument();
    });
    expect(screen.getByText(/estimated at ~\$0\.75/)).toBeInTheDocument();
    expect(screen.getByText(/\$0\.50 review threshold/)).toBeInTheDocument();
  });

  it("cancels the approval sheet from the Cancel button", async () => {
    await openPanel();

    fireEvent.click(screen.getByRole("button", { name: /Execute now · create-funding-opportunity/ }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Approve Planner Agent action" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Approve Planner Agent action" })).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getAllByText("Planner Agent action approval was cancelled.").length).toBeGreaterThan(0);
    });
  });
});
