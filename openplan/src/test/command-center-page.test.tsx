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

  it("shows cross-domain operational surfaces for workspace members", async () => {
    render(await CommandCenterPage());

    expect(screen.getByText("Command Center")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-runtime-cue")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-command-board")).toBeInTheDocument();
    expect(screen.getByText("Assistant action activity")).toBeInTheDocument();
    expect(screen.getByText("Generate Report Artifact")).toBeInTheDocument();
    expect(screen.getByText("planner_agent.generate_report_artifact")).toBeInTheDocument();
    expect(screen.getByText(/report report-1/i)).toBeInTheDocument();
    expect(screen.getByText(/1 linked run/i)).toBeInTheDocument();

    // Domain jump links — pins the planner-voiced heading and rejects the old
    // dev-voiced "Jump into a lane".
    expect(screen.getByText("Jump into a module")).toBeInTheDocument();
    expect(screen.queryByText("Jump into a lane")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /RTP/i })).toHaveAttribute("href", "/rtp");

    // The founder-era buyer-demo / sales rehearsal / operator-console scaffolding
    // was removed with /admin; none of it may resurface on a planner surface.
    expect(screen.queryByText("Buyer demo handoff")).not.toBeInTheDocument();
    expect(screen.queryByText("Demo rehearsal checklist")).not.toBeInTheDocument();
    expect(screen.queryByText("90-second opening script")).not.toBeInTheDocument();
    expect(screen.queryByText("Release proof packet")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/Nevada County/i);
    expect(document.body).not.toHaveTextContent(/\/admin\//i);

    expect(actionEqMock).toHaveBeenCalledWith("workspace_id", "workspace-1");
    expect(actionOrderMock).toHaveBeenCalledWith("completed_at", { ascending: false });
    expect(actionLimitMock).toHaveBeenCalledWith(8);
  });

  it("offers a jump lane for every module the operations summary reads", async () => {
    loadWorkspaceOperationsSummaryForWorkspaceMock.mockResolvedValue({
      ...summary,
      moduleObservations: {
        engagement: {
          campaigns: 2,
          activeCampaigns: 1,
          moderationActionableItems: 4,
          approvedItems: 11,
          leadActiveCampaign: { id: "campaign-1", title: "Corridor listening sessions" },
        },
        safety: {
          crashIngests: 3,
          readyCrashIngests: 2,
          failedCrashIngests: 0,
          uncoveredCrashIngests: 1,
        },
        modeling: {
          modelRuns: 6,
          activeModelRuns: 1,
          failedModelRuns: 0,
          succeededModelRuns: 5,
          scenarioSets: 2,
          activeScenarioSets: 1,
          countyRuns: 1,
          validatedScreeningCountyRuns: 1,
        },
        evidence: {
          datasets: 4,
          datasetsNeedingAttention: 0,
          knowledgeDocuments: 3,
          readyKnowledgeDocuments: 3,
          failedKnowledgeDocuments: 0,
        },
        receivables: {
          clientInvoices: 2,
          draftClientInvoices: 1,
          awaitingPaymentClientInvoices: 1,
        },
        unreadable: [],
      },
    });

    render(await CommandCenterPage());

    // The page badge says "Cross-domain view". These are the domains.
    for (const [name, href] of [
      ["Engagement", "/engagement"],
      ["Safety", "/safety"],
      ["Models", "/models"],
      ["Scenarios", "/scenarios"],
      ["County Validation", "/county-runs"],
      ["Data Hub", "/data-hub"],
      ["Knowledge Base", "/knowledge-base"],
      ["Invoicing", "/invoicing"],
    ] as const) {
      expect(screen.getByRole("link", { name: new RegExp(name, "i") })).toHaveAttribute("href", href);
    }

    expect(screen.getByText(/4 comments awaiting moderation/i)).toBeInTheDocument();
    expect(screen.getByText(/2 ready crash data pulls/i)).toBeInTheDocument();
    expect(screen.getByText(/6 model runs/i)).toBeInTheDocument();
  });

  it("says a lane count was not measured rather than showing it as zero", async () => {
    loadWorkspaceOperationsSummaryForWorkspaceMock.mockResolvedValue({
      ...summary,
      moduleObservations: {
        engagement: {
          campaigns: null,
          activeCampaigns: null,
          moderationActionableItems: null,
          approvedItems: null,
          leadActiveCampaign: null,
        },
        safety: {
          crashIngests: null,
          readyCrashIngests: null,
          failedCrashIngests: null,
          uncoveredCrashIngests: null,
        },
        modeling: {
          modelRuns: null,
          activeModelRuns: null,
          failedModelRuns: null,
          succeededModelRuns: null,
          scenarioSets: null,
          activeScenarioSets: null,
          countyRuns: null,
          validatedScreeningCountyRuns: null,
        },
        evidence: {
          datasets: null,
          datasetsNeedingAttention: null,
          knowledgeDocuments: null,
          readyKnowledgeDocuments: null,
          failedKnowledgeDocuments: null,
        },
        receivables: {
          clientInvoices: null,
          draftClientInvoices: null,
          awaitingPaymentClientInvoices: null,
        },
        unreadable: [{ label: "model runs", message: "permission denied for table model_runs" }],
      },
    });

    render(await CommandCenterPage());

    expect(screen.getByText(/model runs not measured/i)).toBeInTheDocument();
    expect(screen.getByText(/datasets not measured/i)).toBeInTheDocument();
    expect(screen.getByText(/comments awaiting moderation not measured/i)).toBeInTheDocument();
    expect(screen.queryByText(/^0 model runs$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^0 datasets$/i)).not.toBeInTheDocument();
  });

  it("keeps the activity lane visible before any audited actions run", async () => {
    actionLimitMock.mockResolvedValueOnce({ data: [], error: null });

    render(await CommandCenterPage());

    expect(screen.getByText("Assistant action activity")).toBeInTheDocument();
    expect(screen.getByText(/Nothing has been recorded in this workspace yet/i)).toBeInTheDocument();
  });
});
