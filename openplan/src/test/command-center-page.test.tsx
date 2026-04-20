import { render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();
const redirectMock = vi.fn((..._args: unknown[]) => {
  throw new Error("redirect");
});
const authGetUserMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();
const loadWorkspaceOperationsSummaryForWorkspaceMock = vi.fn();

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

vi.mock("@/lib/workspaces/current", () => ({
  loadCurrentWorkspaceMembership: (...args: unknown[]) => loadCurrentWorkspaceMembershipMock(...args),
}));

vi.mock("@/lib/operations/workspace-summary", async () => {
  const actual = await vi.importActual<typeof import("@/lib/operations/workspace-summary")>(
    "@/lib/operations/workspace-summary"
  );

  return {
    ...actual,
    loadWorkspaceOperationsSummaryForWorkspace: (...args: unknown[]) =>
      loadWorkspaceOperationsSummaryForWorkspaceMock(...args),
  };
});

vi.mock("@/components/operations/workspace-command-board", () => ({
  WorkspaceCommandBoard: ({ children }: { children?: ReactNode }) => (
    <div>
      <div data-testid="workspace-command-board" />
      {children}
    </div>
  ),
}));

vi.mock("@/components/operations/workspace-runtime-cue", () => ({
  WorkspaceRuntimeCue: () => <div data-testid="workspace-runtime-cue" />,
}));

vi.mock("@/components/workspaces/workspace-membership-required", () => ({
  WorkspaceMembershipRequired: () => <div data-testid="workspace-membership-required" />,
}));

import CommandCenterPage from "@/app/(app)/command-center/page";
import type { WorkspaceOperationsSummary } from "@/lib/operations/workspace-summary";

const summary: WorkspaceOperationsSummary = {
  posture: "attention",
  headline: "Run release review on current packets",
  detail: "A current RTP packet still carries linked-project funding follow-up.",
  counts: {
    projects: 1,
    activeProjects: 1,
    plans: 0,
    plansNeedingSetup: 0,
    programs: 0,
    activePrograms: 0,
    reports: 1,
    reportRefreshRecommended: 0,
    reportNoPacket: 0,
    reportPacketCurrent: 1,
    rtpFundingReviewPackets: 1,
    comparisonBackedReports: 0,
    fundingOpportunities: 1,
    openFundingOpportunities: 1,
    closingSoonFundingOpportunities: 0,
    overdueDecisionFundingOpportunities: 0,
    projectFundingNeedAnchorProjects: 0,
    projectFundingSourcingProjects: 0,
    projectFundingDecisionProjects: 0,
    projectFundingAwardRecordProjects: 0,
    projectFundingReimbursementStartProjects: 0,
    projectFundingReimbursementActiveProjects: 0,
    projectFundingGapProjects: 0,
    queueDepth: 1,
    aerialMissions: 0,
    aerialActiveMissions: 0,
    aerialReadyPackages: 0,
  },
  nextCommand: {
    key: "review-current-report-packets",
    moduleKey: "grants",
    moduleLabel: "Grants OS",
    title: "Run release review on current packets",
    detail: "1 current RTP packet still carries funding follow-up from linked projects.",
    href: "/grants#grants-gap-resolution-lane",
    tone: "warning",
    priority: 2.5,
    badges: [
      { label: "Current", value: 1 },
      { label: "Funding review", value: 1 },
    ],
  },
  commandQueue: [],
  fullCommandQueue: [],
};

describe("CommandCenterPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    authGetUserMock.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
        },
      },
    });

    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: {
        workspace_id: "workspace-1",
        role: "owner",
      },
      workspace: {
        id: "workspace-1",
        name: "OpenPlan QA",
      },
    });

    loadWorkspaceOperationsSummaryForWorkspaceMock.mockResolvedValue(summary);

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
            linkedRunCount: 1,
          },
          started_at: "2026-04-20T07:00:00.000Z",
          completed_at: "2026-04-20T07:01:00.000Z",
        },
      ],
      error: null,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("surfaces recent audited actions inside the operator command surface", async () => {
    render(await CommandCenterPage());

    expect(screen.getByText("Command Center")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-runtime-cue")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-command-board")).toBeInTheDocument();
    expect(screen.getByText("Assistant action activity")).toBeInTheDocument();
    expect(screen.getByText("Recent audited operator actions")).toBeInTheDocument();
    expect(screen.getByText("Generate Report Artifact")).toBeInTheDocument();
    expect(screen.getByText("planner_agent.generate_report_artifact")).toBeInTheDocument();
    expect(screen.getByText(/report report-1/i)).toBeInTheDocument();
    expect(screen.getByText(/1 linked run/i)).toBeInTheDocument();
    expect(actionEqMock).toHaveBeenCalledWith("workspace_id", "workspace-1");
    expect(actionOrderMock).toHaveBeenCalledWith("completed_at", { ascending: false });
    expect(actionLimitMock).toHaveBeenCalledWith(8);
  });

  it("keeps the activity lane visible before any audited actions run", async () => {
    actionLimitMock.mockResolvedValueOnce({ data: [], error: null });

    render(await CommandCenterPage());

    expect(screen.getByText("Assistant action activity")).toBeInTheDocument();
    expect(screen.getByText(/No audited operator actions have run in this workspace yet/i)).toBeInTheDocument();
  });
});
