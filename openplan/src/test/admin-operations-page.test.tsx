import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const authGetUserMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();
const refreshMock = vi.fn();

const actionLimitMock = vi.fn();
const actionOrderMock = vi.fn(() => ({ limit: actionLimitMock }));
const actionEqMock = vi.fn(() => ({ order: actionOrderMock }));
const actionSelectMock = vi.fn(() => ({ eq: actionEqMock }));

const accessLimitMock = vi.fn();
const accessOrderMock = vi.fn(() => ({ limit: accessLimitMock }));
const accessSelectMock = vi.fn(() => ({ order: accessOrderMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "assistant_action_executions") {
    return { select: actionSelectMock };
  }

  throw new Error(`Unexpected table: ${table}`);
});

const serviceFromMock = vi.fn((table: string) => {
  if (table === "access_requests") {
    return { select: accessSelectMock };
  }

  throw new Error(`Unexpected service table: ${table}`);
});

vi.mock("next/navigation", () => ({
  redirect: vi.fn((..._args: unknown[]) => {
    throw new Error("redirect");
  }),
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

vi.mock("@/lib/workspaces/current", () => ({
  loadCurrentWorkspaceMembership: (...args: unknown[]) => loadCurrentWorkspaceMembershipMock(...args),
}));

import AdminOperationsPage from "@/app/(app)/admin/operations/page";
import { summarizeOperationalWarnings } from "@/lib/observability/operational-events";

describe("AdminOperationsPage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();

    authGetUserMock.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: "operator@openplan.test",
        },
      },
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
    createServiceRoleClientMock.mockReturnValue({ from: serviceFromMock });

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

    accessLimitMock.mockResolvedValue({
      data: [],
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

  it("keeps access request PII locked when the operator is not allowlisted", async () => {
    render(await AdminOperationsPage());

    expect(screen.getByText("Recent supervised onboarding requests")).toBeInTheDocument();
    expect(screen.getByText(/Access request review is locked/i)).toBeInTheDocument();
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
  });

  it("surfaces access request rows only for allowlisted operators", async () => {
    vi.stubEnv("OPENPLAN_ACCESS_REQUEST_REVIEW_EMAILS", "operator@openplan.test");
    accessLimitMock.mockResolvedValueOnce({
      data: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          agency_name: "Nevada County Transportation Commission",
          contact_name: "Nat Ford",
          contact_email: "nat@example.gov",
          role_title: "Planning lead",
          region: "Nevada County",
          use_case: "Screen rural transit corridors for a supervised early-access workflow.",
          expected_workspace_name: "NCTC Pilot",
          status: "new",
          source_path: "/request-access",
          created_at: "2026-04-24T12:00:00.000Z",
          provisioned_workspace_id: null,
        },
      ],
      error: null,
    });

    render(await AdminOperationsPage());

    expect(screen.getByText("Nevada County Transportation Commission")).toBeInTheDocument();
    expect(screen.getByText(/Nat Ford, Planning lead/i)).toBeInTheDocument();
    expect(screen.getByText(/nat@example.gov/i)).toBeInTheDocument();
    expect(screen.getByText(/Screen rural transit corridors/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Mark reviewing/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Defer/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Decline/i })).toBeInTheDocument();
    expect(serviceFromMock).toHaveBeenCalledWith("access_requests");
    expect(accessOrderMock).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(accessLimitMock).toHaveBeenCalledWith(8);
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
