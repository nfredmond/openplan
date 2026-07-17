import { render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();
const redirectMock = vi.fn((..._args: unknown[]) => {
  throw new Error("redirect");
});
const authGetUserMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();

const executionsLimitMock = vi.fn();
const executionsOrderMock = vi.fn(() => ({ limit: executionsLimitMock }));
const executionsEqMock = vi.fn(() => ({ order: executionsOrderMock }));
const executionsSelectMock = vi.fn(() => ({ eq: executionsEqMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "assistant_action_executions") {
    return { select: executionsSelectMock };
  }

  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirectMock(...args),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/workspaces/current", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspaces/current")>("@/lib/workspaces/current");
  return {
    ...actual,
    loadCurrentWorkspaceMembership: (...args: unknown[]) => loadCurrentWorkspaceMembershipMock(...args),
  };
});

import AssistantActivityPage from "@/app/(app)/assistant-activity/page";

const WORKSPACE_ID = "workspace-1";

const EXECUTIONS = [
  {
    id: "execution-1",
    workspace_id: WORKSPACE_ID,
    user_id: "user-1",
    action_kind: "generate_report_artifact",
    audit_event: "planner_agent.generate_report_artifact",
    approval: "safe",
    regrounding: "refresh_preview",
    outcome: "succeeded",
    error_message: null,
    input_summary: { reportId: "report-1" },
    input_hash: "abc123def4567890abcdef",
    approval_id: null,
    execution_source: "planner_agent_quick_link",
    started_at: "2026-07-16T18:00:00.000Z",
    completed_at: "2026-07-16T18:00:01.000Z",
  },
  {
    id: "execution-2",
    workspace_id: WORKSPACE_ID,
    user_id: "user-1",
    action_kind: "create_funding_opportunity",
    audit_event: "planner_agent.create_funding_opportunity",
    approval: "approval_required",
    regrounding: "none",
    outcome: "failed",
    error_message: "Funding opportunity insert failed",
    input_summary: null,
    input_hash: "fed987cba6543210fedcba",
    approval_id: "approval-1",
    execution_source: "planner_agent_quick_link",
    started_at: "2026-07-16T17:00:00.000Z",
    completed_at: "2026-07-16T17:00:02.000Z",
  },
];

async function renderPage() {
  render(await AssistantActivityPage());
}

describe("AssistantActivityPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    authGetUserMock.mockResolvedValue({
      data: {
        user: { id: "user-1" },
      },
    });

    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: {
        workspace_id: WORKSPACE_ID,
        role: "member",
        workspaces: { name: "OpenPlan QA", plan: "pilot" },
      },
      workspace: { name: "OpenPlan QA", plan: "pilot" },
    });

    executionsLimitMock.mockResolvedValue({ data: EXECUTIONS, error: null });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("renders the audit ledger with action labels, approval class, hash, and failure detail", async () => {
    await renderPage();

    expect(screen.getByRole("heading", { name: "Planner Agent activity" })).toBeInTheDocument();

    // Summary line above the list.
    expect(screen.getByText(/2 actions · 1 approval-gated · 1 failed/)).toBeInTheDocument();

    // Guarantee paragraph (the phrase also appears in the operator card).
    expect(screen.getAllByText(/server-computed input hash/).length).toBeGreaterThan(0);
    expect(screen.getByText(/single-use, time-limited operator approval/)).toBeInTheDocument();

    // Rows: human-readable action kinds.
    expect(screen.getByText("Generate report artifact")).toBeInTheDocument();
    expect(screen.getByText("Create funding opportunity")).toBeInTheDocument();

    // Status and approval-class badges ("Failed" also appears as a summary-card label).
    expect(screen.getByText("Succeeded")).toBeInTheDocument();
    expect(screen.getAllByText("Failed").length).toBeGreaterThan(1);
    expect(screen.getByText("Safe")).toBeInTheDocument();
    expect(screen.getByText("Approval required")).toBeInTheDocument();

    // Truncated input hashes.
    expect(screen.getByText("abc123def456…")).toBeInTheDocument();
    expect(screen.getByText("fed987cba654…")).toBeInTheDocument();

    // Workspace name on rows.
    expect(screen.getAllByText(/OpenPlan QA/).length).toBeGreaterThan(0);

    // Failure message surfaced only for the failed row.
    expect(screen.getByText(/Failed with: Funding opportunity insert failed/)).toBeInTheDocument();

    // Workspace-scoped query.
    expect(executionsEqMock).toHaveBeenCalledWith("workspace_id", WORKSPACE_ID);
    expect(executionsLimitMock).toHaveBeenCalledWith(50);
  });

  it("shows the copilot-focused empty state when no actions are recorded", async () => {
    executionsLimitMock.mockResolvedValue({ data: [], error: null });

    await renderPage();

    expect(screen.getByText("No Planner Agent actions yet")).toBeInTheDocument();
    expect(screen.getByText(/Actions executed from the copilot will appear here/)).toBeInTheDocument();
    expect(screen.getByText(/0 actions · 0 approval-gated · 0 failed/)).toBeInTheDocument();
  });

  it("asks for workspace membership when the account has none", async () => {
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({ membership: undefined, workspace: null });

    await renderPage();

    expect(
      screen.getByText("Planner Agent activity needs a provisioned workspace")
    ).toBeInTheDocument();
    expect(fromMock).not.toHaveBeenCalled();
  });
});
