import { render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();
const redirectMock = vi.fn(() => {
  throw new Error("redirect");
});
const authGetUserMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();
const loadWorkspaceOperationsSummaryForWorkspaceMock = vi.fn();

const reportsOrderMock = vi.fn();
const reportsSelectMock = vi.fn(() => ({ order: reportsOrderMock }));

const projectsOrderMock = vi.fn();
const projectsSelectMock = vi.fn(() => ({ order: projectsOrderMock }));

const runsLimitMock = vi.fn();
const runsOrderMock = vi.fn(() => ({ limit: runsLimitMock }));
const runsSelectMock = vi.fn(() => ({ order: runsOrderMock }));

const reportArtifactsOrderMock = vi.fn();
const reportArtifactsInMock = vi.fn(() => ({ order: reportArtifactsOrderMock }));
const reportArtifactsSelectMock = vi.fn(() => ({ in: reportArtifactsInMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "reports") {
    return { select: reportsSelectMock };
  }
  if (table === "projects") {
    return { select: projectsSelectMock };
  }
  if (table === "runs") {
    return { select: runsSelectMock };
  }
  if (table === "report_artifacts") {
    return { select: reportArtifactsSelectMock };
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

vi.mock("@/components/reports/report-creator", () => ({
  ReportCreator: () => <div data-testid="report-creator" />,
}));

vi.mock("@/components/operations/workspace-runtime-cue", () => ({
  WorkspaceRuntimeCue: () => <div data-testid="workspace-runtime-cue" />,
}));

vi.mock("@/components/operations/workspace-command-board", () => ({
  WorkspaceCommandBoard: () => <div data-testid="workspace-command-board" />,
}));

import ReportsPage from "@/app/(app)/reports/page";

async function renderPage() {
  render(await ReportsPage({ searchParams: Promise.resolve({}) }));
}

describe("ReportsPage", () => {
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
      },
      workspace: {
        id: "workspace-1",
        name: "OpenPlan QA",
      },
    });

    loadWorkspaceOperationsSummaryForWorkspaceMock.mockResolvedValue({
      nextCommand: null,
      nextActions: [],
    });

    reportsOrderMock.mockResolvedValue({
      data: [
        {
          id: "report-1",
          workspace_id: "workspace-1",
          project_id: "project-1",
          rtp_cycle_id: null,
          title: "Artifact-backed report",
          report_type: "project_status",
          status: "generated",
          summary: "Report with a real packet artifact.",
          generated_at: null,
          latest_artifact_kind: "html",
          created_at: "2026-03-28T18:00:00.000Z",
          updated_at: "2026-03-28T21:10:00.000Z",
          projects: {
            id: "project-1",
            name: "Downtown Mobility Plan",
          },
          rtp_cycles: null,
        },
      ],
      error: null,
    });

    projectsOrderMock.mockResolvedValue({
      data: [
        {
          id: "project-1",
          workspace_id: "workspace-1",
          name: "Downtown Mobility Plan",
        },
      ],
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
                projectRecordGroupCount: 2,
                totalProjectRecordCount: 4,
                engagementLabel: "Active",
                engagementItemCount: 3,
                engagementReadyForHandoffCount: 2,
                stageGateLabel: "Complete",
                stageGatePassCount: 2,
                stageGateHoldCount: 0,
                stageGateBlockedGateLabel: null,
              },
              scenarioSetLinks: [
                {
                  scenarioSetId: "scenario-set-1",
                  scenarioSetTitle: "Downtown alternatives",
                  baselineLabel: "Existing conditions",
                  comparisonSnapshots: [
                    {
                      comparisonSnapshotId: "comparison-1",
                      status: "ready",
                      candidateEntryLabel: "Protected bike package",
                      indicatorDeltaCount: 4,
                      updatedAt: "2026-03-28T19:50:00.000Z",
                    },
                  ],
                },
              ],
              projectFundingSnapshot: {
                capturedAt: "2026-03-28T19:45:00.000Z",
                projectUpdatedAt: "2026-03-28T19:40:00.000Z",
                latestSourceUpdatedAt: "2026-03-28T19:45:00.000Z",
                fundingNeedAmount: 1200000,
                localMatchNeedAmount: 100000,
                committedFundingAmount: 300000,
                committedMatchAmount: 50000,
                likelyFundingAmount: 400000,
                totalPotentialFundingAmount: 700000,
                remainingFundingGap: 900000,
                remainingMatchGap: 50000,
                unfundedAfterLikelyAmount: 500000,
                requestedReimbursementAmount: 0,
                paidReimbursementAmount: 0,
                outstandingReimbursementAmount: 0,
                draftReimbursementAmount: 0,
                uninvoicedAwardAmount: 300000,
                nextObligationAt: null,
                awardRiskCount: 0,
                awardCount: 1,
                opportunityCount: 2,
                openOpportunityCount: 2,
                pursuedOpportunityCount: 1,
                awardedOpportunityCount: 0,
                closingSoonOpportunityCount: 0,
                reimbursementPacketCount: 0,
                status: "partially_funded",
                label: "Partially funded",
                reason: "Committed awards cover part of the need, but a gap remains.",
                pipelineStatus: "partially_covered",
                pipelineLabel: "Gap remains",
                pipelineReason: "Pursued opportunities still do not close the gap.",
                reimbursementStatus: "not_started",
                reimbursementLabel: "Reimbursement not started",
                reimbursementReason: "No reimbursement records exist yet.",
                hasTargetNeed: true,
                coverageRatio: 0.25,
                pipelineCoverageRatio: 0.58,
                reimbursementCoverageRatio: 0,
                paidReimbursementCoverageRatio: 0,
              },
            },
          },
        },
      ],
      error: null,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("keeps artifact-backed reports in regenerate posture when report generated_at is null", async () => {
    await renderPage();

    expect(screen.getAllByText(/Artifact-backed report/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Refresh recommended/i).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/Action Next action: open this report and regenerate the packet\./i).length
    ).toBeGreaterThan(0);

    const reportLink = screen.getAllByText(/Artifact-backed report/i)[0]?.closest("a");
    expect(reportLink).toHaveAttribute("href", "/reports/report-1#drift-since-generation");
    expect(screen.queryByText(/Action Next action: open this report and generate the first packet\./i)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Generated/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Open gap resolution/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Grants follow-through")).toBeInTheDocument();
    expect(screen.getByText(/Open gap resolution/i)).toBeInTheDocument();
    expect(screen.getByText(/in Grants OS/i)).toBeInTheDocument();
    expect(
      screen.getAllByText(/saved comparison context can support grant planning language or prioritization framing for this packet/i).length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/not proof of award likelihood or a replacement for funding-source review/i).length
    ).toBeGreaterThan(0);
  });

  it("routes current report queue actions into Grants OS when funding follow-through is the real next move", async () => {
    reportsOrderMock.mockResolvedValueOnce({
      data: [
        {
          id: "report-1",
          workspace_id: "workspace-1",
          project_id: "project-1",
          rtp_cycle_id: null,
          title: "Artifact-backed report",
          report_type: "project_status",
          status: "generated",
          summary: "Report with a real packet artifact.",
          generated_at: "2026-03-28T20:00:00.000Z",
          latest_artifact_kind: "html",
          created_at: "2026-03-28T18:00:00.000Z",
          updated_at: "2026-03-28T19:30:00.000Z",
          projects: {
            id: "project-1",
            name: "Downtown Mobility Plan",
          },
          rtp_cycles: null,
        },
      ],
      error: null,
    });

    reportArtifactsOrderMock.mockResolvedValueOnce({
      data: [
        {
          report_id: "report-1",
          generated_at: "2026-03-28T20:00:00.000Z",
          metadata_json: {
            sourceContext: {
              projectFundingSnapshot: {
                capturedAt: "2026-03-28T19:45:00.000Z",
                projectUpdatedAt: "2026-03-28T19:20:00.000Z",
                latestSourceUpdatedAt: "2026-03-28T19:20:00.000Z",
                fundingNeedAmount: 1200000,
                localMatchNeedAmount: 100000,
                committedFundingAmount: 300000,
                committedMatchAmount: 50000,
                likelyFundingAmount: 400000,
                totalPotentialFundingAmount: 700000,
                remainingFundingGap: 900000,
                remainingMatchGap: 50000,
                unfundedAfterLikelyAmount: 500000,
                requestedReimbursementAmount: 0,
                paidReimbursementAmount: 0,
                outstandingReimbursementAmount: 0,
                draftReimbursementAmount: 0,
                uninvoicedAwardAmount: 300000,
                nextObligationAt: null,
                awardRiskCount: 0,
                awardCount: 1,
                opportunityCount: 2,
                openOpportunityCount: 2,
                pursuedOpportunityCount: 1,
                awardedOpportunityCount: 0,
                closingSoonOpportunityCount: 0,
                reimbursementPacketCount: 0,
                status: "partially_funded",
                label: "Partially funded",
                reason: "Committed awards cover part of the need, but a gap remains.",
                pipelineStatus: "partially_covered",
                pipelineLabel: "Gap remains",
                pipelineReason: "Pursued opportunities still do not close the gap.",
                reimbursementStatus: "not_started",
                reimbursementLabel: "Reimbursement not started",
                reimbursementReason: "No reimbursement records exist yet.",
                hasTargetNeed: true,
                coverageRatio: 0.25,
                pipelineCoverageRatio: 0.58,
                reimbursementCoverageRatio: 0,
                paidReimbursementCoverageRatio: 0,
              },
            },
          },
        },
      ],
      error: null,
    });

    await renderPage();

    expect(document.querySelectorAll('a[href="/grants#grants-gap-resolution-lane"]').length).toBeGreaterThan(0);
  });

  it("surfaces RTP review-loop posture in the reports registry when a current packet is not yet settled", async () => {
    reportsOrderMock.mockResolvedValueOnce({
      data: [
        {
          id: "report-rtp-1",
          workspace_id: "workspace-1",
          project_id: null,
          rtp_cycle_id: "rtp-1",
          title: "Nevada County RTP Packet",
          report_type: "board_packet",
          status: "generated",
          summary: "RTP packet for release review.",
          generated_at: "2026-03-28T20:00:00.000Z",
          latest_artifact_kind: "html",
          created_at: "2026-03-28T18:00:00.000Z",
          updated_at: "2026-03-28T20:00:00.000Z",
          projects: null,
          rtp_cycles: {
            id: "rtp-1",
            title: "2050 Nevada County RTP",
            updated_at: "2026-03-28T19:55:00.000Z",
          },
        },
      ],
      error: null,
    });

    reportArtifactsOrderMock.mockResolvedValueOnce({
      data: [
        {
          report_id: "report-rtp-1",
          generated_at: "2026-03-28T20:00:00.000Z",
          metadata_json: {
            sourceContext: {
              rtpCycleUpdatedAt: "2026-03-28T19:55:00.000Z",
              publicReviewSummary: {
                label: "Public review active",
                detail: "1 comment is still waiting for operator review while 2 approved items are already ready for packet handoff.",
                tone: "warning",
                actionItems: ["Resolve pending comments before closeout."],
              },
            },
          },
        },
      ],
      error: null,
    });

    await renderPage();

    expect(screen.getAllByText("Review loop still open").length).toBeGreaterThan(0);
    expect(screen.getByText(/Action Close pending comment review/i)).toBeInTheDocument();
    expect(screen.getByText(/1 comment is still waiting for operator review while 2 approved items are already ready for packet handoff\./i)).toBeInTheDocument();

    const reportLink = screen.getAllByText(/Nevada County RTP Packet/i)[0]?.closest("a");
    expect(reportLink).toHaveAttribute("href", "/reports/report-rtp-1#packet-release-review");
  });
});
