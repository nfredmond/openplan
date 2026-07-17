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

describe("AppCopilot", () => {
  const fetchMock = vi.fn();
  let chatRoute: FetchRoute;

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("fetch", fetchMock);

    chatRoute = () => new Response("Here is a grounded AI reply.", { status: 200 });

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
      throw new Error(`Unexpected fetch: ${url}`);
    });
  });

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
    expect(screen.queryByText(/AI chat is offline/)).not.toBeInTheDocument();
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
        screen.getByText("AI chat is offline — no API key configured. Suggested actions below still work.")
      ).toBeInTheDocument();
    });

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
        controller.enqueue(new TextEncoder().encode("Partial rep"));
        controller.error(new Error("network dropped"));
      },
    });
    chatRoute = () => new Response(failingStream, { status: 200 });

    await openPanel();

    fireEvent.change(screen.getByPlaceholderText(/Ask about project status/), {
      target: { value: "Where should I focus this week?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    });

    // Retrying issues a fresh chat request without duplicating the user prompt.
    chatRoute = () => new Response("Recovered reply.", { status: 200 });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(screen.getByText("Recovered reply.")).toBeInTheDocument();
    });
    expect(screen.getAllByText("Where should I focus this week?")).toHaveLength(1);
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
