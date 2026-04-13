import { render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();
const notFoundMock = vi.fn(() => {
  throw new Error("notFound");
});
const redirectMock = vi.fn(() => {
  throw new Error("redirect");
});

const authGetUserMock = vi.fn();

const projectSingleMock = vi.fn();
const projectEqMock = vi.fn(() => ({ single: projectSingleMock }));
const projectSelectMock = vi.fn(() => ({ eq: projectEqMock }));

const workspaceSingleMock = vi.fn();
const workspaceEqMock = vi.fn(() => ({ single: workspaceSingleMock }));
const workspaceSelectMock = vi.fn(() => ({ eq: workspaceEqMock }));

const runsLimitMock = vi.fn();
const runsOrderMock = vi.fn(() => ({ limit: runsLimitMock }));
const runsEqMock = vi.fn(() => ({ order: runsOrderMock }));
const runsSelectMock = vi.fn(() => ({ eq: runsEqMock }));

const reportsLimitMock = vi.fn();
const reportsOrderMock = vi.fn(() => ({ limit: reportsLimitMock }));
const reportsEqMock = vi.fn(() => ({ order: reportsOrderMock }));
const reportsSelectMock = vi.fn(() => ({ eq: reportsEqMock }));

const reportArtifactsOrderMock = vi.fn();
const reportArtifactsInMock = vi.fn(() => ({ order: reportArtifactsOrderMock }));
const reportArtifactsSelectMock = vi.fn(() => ({ in: reportArtifactsInMock }));

const stageGateLimitMock = vi.fn();
const stageGateOrderMock = vi.fn(() => ({ limit: stageGateLimitMock }));
const stageGateEqMock = vi.fn(() => ({ order: stageGateOrderMock }));
const stageGateSelectMock = vi.fn(() => ({ eq: stageGateEqMock }));

const milestonesLimitMock = vi.fn();
const milestonesOrderMock = vi.fn(() => ({ limit: milestonesLimitMock }));
const milestonesEqMock = vi.fn(() => ({ order: milestonesOrderMock }));
const milestonesSelectMock = vi.fn(() => ({ eq: milestonesEqMock }));

const submittalsLimitMock = vi.fn();
const submittalsOrderMock = vi.fn(() => ({ limit: submittalsLimitMock }));
const submittalsEqMock = vi.fn(() => ({ order: submittalsOrderMock }));
const submittalsSelectMock = vi.fn(() => ({ eq: submittalsEqMock }));

const deliverablesLimitMock = vi.fn();
const deliverablesOrderMock = vi.fn(() => ({ limit: deliverablesLimitMock }));
const deliverablesEqMock = vi.fn(() => ({ order: deliverablesOrderMock }));
const deliverablesSelectMock = vi.fn(() => ({ eq: deliverablesEqMock }));

const risksLimitMock = vi.fn();
const risksOrderMock = vi.fn(() => ({ limit: risksLimitMock }));
const risksEqMock = vi.fn(() => ({ order: risksOrderMock }));
const risksSelectMock = vi.fn(() => ({ eq: risksEqMock }));

const issuesLimitMock = vi.fn();
const issuesOrderMock = vi.fn(() => ({ limit: issuesLimitMock }));
const issuesEqMock = vi.fn(() => ({ order: issuesOrderMock }));
const issuesSelectMock = vi.fn(() => ({ eq: issuesEqMock }));

const decisionsLimitMock = vi.fn();
const decisionsOrderMock = vi.fn(() => ({ limit: decisionsLimitMock }));
const decisionsEqMock = vi.fn(() => ({ order: decisionsOrderMock }));
const decisionsSelectMock = vi.fn(() => ({ eq: decisionsEqMock }));

const meetingsLimitMock = vi.fn();
const meetingsOrderMock = vi.fn(() => ({ limit: meetingsLimitMock }));
const meetingsEqMock = vi.fn(() => ({ order: meetingsOrderMock }));
const meetingsSelectMock = vi.fn(() => ({ eq: meetingsEqMock }));

const invoicesLimitMock = vi.fn();
const invoicesOrderMock = vi.fn(() => ({ limit: invoicesLimitMock }));
const invoicesEqMock = vi.fn(() => ({ order: invoicesOrderMock }));
const invoicesSelectMock = vi.fn(() => ({ eq: invoicesEqMock }));

const datasetLinksOrderMock = vi.fn();
const datasetLinksEqMock = vi.fn(() => ({ order: datasetLinksOrderMock }));
const datasetLinksSelectMock = vi.fn(() => ({ eq: datasetLinksEqMock }));

const projectRtpLinksOrderMock = vi.fn();
const projectRtpLinksEqMock = vi.fn(() => ({ order: projectRtpLinksOrderMock }));
const projectRtpLinksSelectMock = vi.fn(() => ({ eq: projectRtpLinksEqMock }));

const rtpCyclesOrderMock = vi.fn();
const rtpCyclesEqMock = vi.fn(() => ({ order: rtpCyclesOrderMock }));
const rtpCyclesInMock = vi.fn();
const rtpCyclesSelectMock = vi.fn(() => ({ eq: rtpCyclesEqMock, in: rtpCyclesInMock }));

const projectFundingProfileMaybeSingleMock = vi.fn();
const projectFundingProfileLimitMock = vi.fn();
const projectFundingProfileEqMock = vi.fn(() => ({ maybeSingle: projectFundingProfileMaybeSingleMock, limit: projectFundingProfileLimitMock }));
const projectFundingProfileSelectMock = vi.fn(() => ({ eq: projectFundingProfileEqMock }));

const fundingAwardsLimitMock = vi.fn();
const fundingAwardsOrderMock = vi.fn(() => ({ limit: fundingAwardsLimitMock }));
const fundingAwardsEqMock = vi.fn(() => ({ order: fundingAwardsOrderMock }));
const fundingAwardsSelectMock = vi.fn(() => ({ eq: fundingAwardsEqMock }));

const fundingOpportunitiesLimitMock = vi.fn();
const fundingOpportunitiesOrderMock = vi.fn(() => ({ limit: fundingOpportunitiesLimitMock }));
const fundingOpportunitiesEqMock = vi.fn(() => ({ order: fundingOpportunitiesOrderMock }));
const fundingOpportunitiesSelectMock = vi.fn(() => ({ eq: fundingOpportunitiesEqMock }));

const datasetsInMock = vi.fn();
const datasetsSelectMock = vi.fn(() => ({ in: datasetsInMock }));

const connectorsInMock = vi.fn();
const connectorsSelectMock = vi.fn(() => ({ in: connectorsInMock }));

const loadWorkspaceOperationsSummaryForWorkspaceMock = vi.fn();

const buildProjectControlsSummaryMock = vi.fn();
const summarizeBillingInvoiceRecordsMock = vi.fn();
const buildProjectStageGateSummaryMock = vi.fn();

const fromMock = vi.fn((table: string) => {
  if (table === "projects") {
    return { select: projectSelectMock };
  }
  if (table === "workspaces") {
    return { select: workspaceSelectMock };
  }
  if (table === "runs") {
    return { select: runsSelectMock };
  }
  if (table === "reports") {
    return { select: reportsSelectMock };
  }
  if (table === "report_artifacts") {
    return { select: reportArtifactsSelectMock };
  }
  if (table === "stage_gate_decisions") {
    return { select: stageGateSelectMock };
  }
  if (table === "project_milestones") {
    return { select: milestonesSelectMock };
  }
  if (table === "project_submittals") {
    return { select: submittalsSelectMock };
  }
  if (table === "project_deliverables") {
    return { select: deliverablesSelectMock };
  }
  if (table === "project_risks") {
    return { select: risksSelectMock };
  }
  if (table === "project_issues") {
    return { select: issuesSelectMock };
  }
  if (table === "project_decisions") {
    return { select: decisionsSelectMock };
  }
  if (table === "project_meetings") {
    return { select: meetingsSelectMock };
  }
  if (table === "billing_invoice_records") {
    return { select: invoicesSelectMock };
  }
  if (table === "data_dataset_project_links") {
    return { select: datasetLinksSelectMock };
  }
  if (table === "project_rtp_cycle_links") {
    return { select: projectRtpLinksSelectMock };
  }
  if (table === "rtp_cycles") {
    return { select: rtpCyclesSelectMock };
  }
  if (table === "project_funding_profiles") {
    return { select: projectFundingProfileSelectMock };
  }
  if (table === "funding_awards") {
    return { select: fundingAwardsSelectMock };
  }
  if (table === "funding_opportunities") {
    return { select: fundingOpportunitiesSelectMock };
  }
  if (table === "data_datasets") {
    return { select: datasetsSelectMock };
  }
  if (table === "data_connectors") {
    return { select: connectorsSelectMock };
  }

  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
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

vi.mock("@/components/projects/project-record-composer", () => ({
  ProjectRecordComposer: () => <div data-testid="project-record-composer" />,
}));

vi.mock("@/components/projects/project-rtp-linker", () => ({
  ProjectRtpLinker: () => <div data-testid="project-rtp-linker" />,
}));

vi.mock("@/components/projects/project-funding-profile-editor", () => ({
  ProjectFundingProfileEditor: () => <div data-testid="project-funding-profile-editor" />,
}));

vi.mock("@/components/projects/project-funding-award-creator", () => ({
  ProjectFundingAwardCreator: () => <div data-testid="project-funding-award-creator" />,
}));

vi.mock("@/components/programs/funding-opportunity-decision-controls", () => ({
  FundingOpportunityDecisionControls: () => <div data-testid="funding-opportunity-decision-controls" />,
}));

vi.mock("@/lib/projects/controls", () => ({
  buildProjectControlsSummary: (...args: unknown[]) => buildProjectControlsSummaryMock(...args),
}));

vi.mock("@/lib/billing/invoice-records", () => ({
  summarizeBillingInvoiceRecords: (...args: unknown[]) => summarizeBillingInvoiceRecordsMock(...args),
}));

vi.mock("@/lib/stage-gates/summary", () => ({
  buildProjectStageGateSummary: (...args: unknown[]) => buildProjectStageGateSummaryMock(...args),
}));

vi.mock("@/lib/operations/workspace-summary", async () => {
  const actual = await vi.importActual<typeof import("@/lib/operations/workspace-summary")>("@/lib/operations/workspace-summary");
  return {
    ...actual,
    loadWorkspaceOperationsSummaryForWorkspace: (...args: unknown[]) =>
      loadWorkspaceOperationsSummaryForWorkspaceMock(...args),
  };
});

import ProjectDetailPage from "@/app/(app)/projects/[projectId]/page";

async function renderPage() {
  render(
    await ProjectDetailPage({
      params: Promise.resolve({ projectId: "project-1" }),
    })
  );
}

describe("ProjectDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    authGetUserMock.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
        },
      },
    });

    projectSingleMock.mockResolvedValue({
      data: {
        id: "project-1",
        workspace_id: "workspace-1",
        name: "Downtown Mobility Plan",
        summary: "Planning effort focused on corridor safety and access.",
        status: "active",
        plan_type: "corridor_plan",
        delivery_phase: "analysis",
        created_at: "2026-03-28T18:00:00.000Z",
        updated_at: "2026-03-28T21:10:00.000Z",
      },
      error: null,
    });

    workspaceSingleMock.mockResolvedValue({
      data: {
        id: "workspace-1",
        name: "OpenPlan QA",
        plan: "starter",
        slug: "openplan-qa",
        stage_gate_template_id: "ca_stage_gates_v0_1",
        stage_gate_template_version: "0.1.0",
        created_at: "2026-03-28T18:00:00.000Z",
      },
      error: null,
    });

    runsLimitMock.mockResolvedValue({ data: [], error: null });
    reportArtifactsOrderMock.mockResolvedValue({
      data: [
        {
          report_id: "report-1",
          generated_at: "2026-03-28T20:00:00.000Z",
          metadata_json: {
            sourceContext: {
              evidenceChainSummary: {
                linkedRunCount: 2,
                scenarioSetLinkCount: 1,
                projectRecordGroupCount: 3,
                totalProjectRecordCount: 5,
                engagementLabel: "Active",
                engagementItemCount: 9,
                engagementReadyForHandoffCount: 4,
                stageGateLabel: "Hold present",
                stageGatePassCount: 1,
                stageGateHoldCount: 1,
                stageGateBlockedGateLabel:
                  "G02 · Agreements, Procurement, and Civil Rights Setup",
              },
            },
          },
        },
        {
          report_id: "report-2",
          generated_at: "2026-03-28T19:00:00.000Z",
          metadata_json: {
            sourceContext: {
              evidenceChainSummary: {
                linkedRunCount: 1,
                scenarioSetLinkCount: 1,
                projectRecordGroupCount: 2,
                totalProjectRecordCount: 3,
                engagementLabel: "Active",
                engagementItemCount: 4,
                engagementReadyForHandoffCount: 4,
                stageGateLabel: "Complete",
                stageGatePassCount: 2,
                stageGateHoldCount: 0,
                stageGateBlockedGateLabel: null,
              },
            },
          },
        },
      ],
      error: null,
    });
    stageGateLimitMock.mockResolvedValue({ data: [], error: null });
    milestonesLimitMock.mockResolvedValue({ data: [], error: null });
    submittalsLimitMock.mockResolvedValue({ data: [], error: null });
    deliverablesLimitMock.mockResolvedValue({ data: [], error: null });
    risksLimitMock.mockResolvedValue({ data: [], error: null });
    issuesLimitMock.mockResolvedValue({ data: [], error: null });
    decisionsLimitMock.mockResolvedValue({ data: [], error: null });
    meetingsLimitMock.mockResolvedValue({ data: [], error: null });
    invoicesLimitMock.mockResolvedValue({ data: [], error: null });
    datasetLinksOrderMock.mockResolvedValue({ data: [], error: null });
    projectRtpLinksOrderMock.mockResolvedValue({ data: [], error: null });
    rtpCyclesOrderMock.mockResolvedValue({ data: [], error: null });
    rtpCyclesInMock.mockResolvedValue({ data: [], error: null });
    projectFundingProfileMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    projectFundingProfileLimitMock.mockResolvedValue({ data: [], error: null });
    fundingAwardsLimitMock.mockResolvedValue({ data: [], error: null });
    fundingOpportunitiesLimitMock.mockResolvedValue({ data: [], error: null });
    datasetsInMock.mockResolvedValue({ data: [], error: null });
    connectorsInMock.mockResolvedValue({ data: [], error: null });

    reportsLimitMock.mockResolvedValue({
      data: [
        {
          id: "report-1",
          title: "Downtown Safety Packet",
          summary: "Packet with corridor safety recommendations.",
          report_type: "project_status",
          status: "generated",
          updated_at: "2026-03-28T21:10:00.000Z",
          generated_at: "2026-03-28T20:00:00.000Z",
          latest_artifact_kind: "html",
        },
        {
          id: "report-2",
          title: "Board Packet",
          summary: null,
          report_type: "board_packet",
          status: "generated",
          updated_at: "2026-03-28T19:00:00.000Z",
          generated_at: "2026-03-28T19:00:00.000Z",
          latest_artifact_kind: "html",
        },
      ],
      count: 2,
      error: null,
    });

    buildProjectControlsSummaryMock.mockReturnValue({
      controlHealth: "attention",
      milestoneCount: 0,
      completedMilestoneCount: 0,
      blockedMilestoneCount: 0,
      pendingSubmittalCount: 0,
      overdueSubmittalCount: 0,
      overdueMilestoneCount: 0,
      nextMilestone: null,
      nextSubmittal: null,
      deadlineSummary: {
        totalCount: 0,
        overdueCount: 0,
        upcomingCount: 0,
        nextDeadline: null,
        items: [],
      },
      recommendedNextAction: {
        label: "No immediate controls action",
        detail: "Controls are clear right now.",
        tone: "info",
        targetId: null,
        targetRowId: null,
      },
      attentionSummary: {
        reportPackets: { count: 0, targetId: null, targetRowId: null },
        blockedMilestones: { count: 0, targetId: null, targetRowId: null },
        overdueMilestones: { count: 0, targetId: null, targetRowId: null },
        overdueSubmittals: { count: 0, targetId: null, targetRowId: null },
        overdueInvoices: { count: 0, targetId: null, targetRowId: null },
      },
    });

    summarizeBillingInvoiceRecordsMock.mockReturnValue({
      outstandingNetAmount: 0,
      submittedCount: 0,
      totalCount: 0,
      paidNetAmount: 0,
      overdueCount: 0,
      totalNetAmount: 0,
    });

    buildProjectStageGateSummaryMock.mockReturnValue({
      passCount: 0,
      holdCount: 0,
      notStartedCount: 0,
      nextGate: null,
      blockedGate: null,
      gates: [],
    });

    loadWorkspaceOperationsSummaryForWorkspaceMock.mockResolvedValue({
      posture: "stable",
      headline: "Everything is queued correctly",
      detail: "No workspace-wide follow-up is currently blocking the project spine.",
      counts: {
        projects: 1,
        activeProjects: 1,
        plans: 0,
        plansNeedingSetup: 0,
        programs: 0,
        activePrograms: 0,
        reports: 2,
        reportRefreshRecommended: 1,
        reportNoPacket: 0,
        reportPacketCurrent: 1,
        rtpFundingReviewPackets: 0,
        comparisonBackedReports: 0,
        fundingOpportunities: 0,
        openFundingOpportunities: 0,
        closingSoonFundingOpportunities: 0,
        projectFundingNeedAnchorProjects: 0,
        projectFundingSourcingProjects: 0,
        projectFundingDecisionProjects: 0,
        projectFundingAwardRecordProjects: 0,
        projectFundingReimbursementStartProjects: 0,
        projectFundingReimbursementActiveProjects: 0,
        projectFundingGapProjects: 0,
        queueDepth: 0,
      },
      nextCommand: null,
      commandQueue: [],
      fullCommandQueue: [],
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("surfaces project-linked report freshness guidance", async () => {
    await renderPage();

    expect(screen.getByText(/Packet freshness and regeneration cues/i)).toBeInTheDocument();
    expect(screen.getByText(/Downtown Safety Packet needs attention/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Next action: open this report and regenerate the packet\./i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Showing 2 most recent report records/i)).toBeInTheDocument();
    expect(screen.getAllByText(/^2$/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Evidence-backed/i)).toBeInTheDocument();
    expect(screen.getByText(/Governance holds/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Blocked gate: G02/i).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /^Open report$/i })[0]).toHaveAttribute(
      "href",
      "/reports/report-1#drift-since-generation"
    );
  });

  it("shows an empty reporting state when no reports are linked", async () => {
    reportsLimitMock.mockResolvedValueOnce({ data: [], count: 0, error: null });

    await renderPage();

    expect(
      screen.getByText(/No reports are linked to this project yet\./i)
    ).toBeInTheDocument();
  });
});
