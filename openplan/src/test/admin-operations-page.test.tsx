import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();
const authGetUserMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();

const actionLimitMock = vi.fn();
const actionOrderMock = vi.fn(() => ({ limit: actionLimitMock }));
const actionEqMock = vi.fn(() => ({ order: actionOrderMock }));
const actionSelectMock = vi.fn(() => ({ eq: actionEqMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "assistant_action_executions") {
    return { select: actionSelectMock };
  }

  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("next/navigation", () => ({
  redirect: vi.fn((..._args: unknown[]) => {
    throw new Error("redirect");
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/workspaces/current", () => ({
  loadCurrentWorkspaceMembership: (...args: unknown[]) => loadCurrentWorkspaceMembershipMock(...args),
}));

import AdminOperationsPage from "@/app/(app)/admin/operations/page";
import { summarizeOperationalWarnings } from "@/lib/observability/operational-events";

describe("AdminOperationsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    authGetUserMock.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
        },
      },
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });

    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: {
        workspace_id: "workspace-1",
      },
      workspace: {
        id: "workspace-1",
        name: "OpenPlan QA",
      },
    });

    actionLimitMock.mockResolvedValue({
      data: [
        {
          id: "action-1",
          action_kind: "generate_report_artifact",
          audit_event: "planner_agent.generate_report_artifact",
          approval: "safe",
          regrounding: "refresh_preview",
          outcome: "succeeded",
          error_message: null,
          input_summary: {
            reportId: "report-1234567890",
            artifactId: "artifact-1234567890",
            linkedRunCount: 2,
          },
          started_at: "2026-04-20T07:00:00.000Z",
          completed_at: "2026-04-20T07:01:00.000Z",
        },
      ],
      error: null,
    });
  });

  it("surfaces operational warning events and log queries", async () => {
    render(await AdminOperationsPage());

    expect(screen.getByText("Warning watchboard")).toBeInTheDocument();
    expect(screen.getByText("Oversized API request")).toBeInTheDocument();
    expect(screen.getByText("High-cost AI analysis call")).toBeInTheDocument();
    expect(screen.getByText("CSP report-only violation")).toBeInTheDocument();
    expect(screen.getAllByText(/request_body_too_large/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/analysis_cost_threshold_exceeded/).length).toBeGreaterThan(0);
  });

  it("surfaces recent assistant action execution audit rows", async () => {
    render(await AdminOperationsPage());

    expect(screen.getByText("Assistant action activity")).toBeInTheDocument();
    expect(screen.getByText("Recent audited operator actions")).toBeInTheDocument();
    expect(screen.getByText("Generate Report Artifact")).toBeInTheDocument();
    expect(screen.getByText("planner_agent.generate_report_artifact")).toBeInTheDocument();
    expect(screen.getByText(/report report-1/i)).toBeInTheDocument();
    expect(screen.getByText(/2 linked runs/i)).toBeInTheDocument();
    expect(actionEqMock).toHaveBeenCalledWith("workspace_id", "workspace-1");
    expect(actionOrderMock).toHaveBeenCalledWith("completed_at", { ascending: false });
    expect(actionLimitMock).toHaveBeenCalledWith(8);
  });

  it("keeps the activity lane explicit when no action executions exist", async () => {
    actionLimitMock.mockResolvedValueOnce({ data: [], error: null });

    render(await AdminOperationsPage());

    expect(screen.getByText(/No assistant actions have been recorded for this workspace yet/i)).toBeInTheDocument();
  });

  it("builds a combined query from all configured warning events", () => {
    const summary = summarizeOperationalWarnings();

    expect(summary.totalEvents).toBeGreaterThan(0);
    expect(summary.combinedLogQuery).toContain("\"request_body_too_large\"");
    expect(summary.combinedLogQuery).toContain("\"analysis_cost_threshold_exceeded\"");
  });
});
