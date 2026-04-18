import { render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceOperationsSummary } from "@/lib/operations/workspace-summary";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/reports/report-detail-controls", () => ({
  ReportDetailControls: () => <div data-testid="report-detail-controls" />,
}));

vi.mock("@/components/reports/rtp-report-section-controls", () => ({
  RtpReportSectionControls: () => <div data-testid="rtp-report-section-controls" />,
}));

vi.mock("@/components/operations/workspace-command-board", () => ({
  WorkspaceCommandBoard: () => <div data-testid="workspace-command-board" />,
}));

import { RtpReportDetail } from "@/components/reports/rtp-report-detail";

function buildFundingSnapshot(overrides: Partial<NonNullable<Parameters<typeof RtpReportDetail>[0]["currentContext"]["fundingSnapshot"]>>) {
  return {
    capturedAt: null,
    latestSourceUpdatedAt: null,
    linkedProjectCount: 3,
    trackedProjectCount: 3,
    fundedProjectCount: 1,
    likelyCoveredProjectCount: 0,
    gapProjectCount: 0,
    committedFundingAmount: 500000,
    likelyFundingAmount: 0,
    totalPotentialFundingAmount: 500000,
    unfundedAfterLikelyAmount: 0,
    paidReimbursementAmount: 0,
    outstandingReimbursementAmount: 0,
    uninvoicedAwardAmount: 0,
    awardRiskCount: 0,
    label: "Funded",
    reason: "Committed awards meet the need.",
    reimbursementLabel: "Awarded dollars reimbursed",
    reimbursementReason: "All award-linked invoices are paid.",
    ...overrides,
  };
}

describe("RtpReportDetail", () => {
  it("prefers the latest artifact timestamp for packet freshness", () => {
    render(
      <RtpReportDetail
        report={{
          id: "report-1",
          title: "Nevada County RTP Packet",
          report_type: "board_packet",
          status: "generated",
          summary: "Board packet for release review.",
          latest_artifact_kind: "html",
          generated_at: null,
          updated_at: "2026-03-28T18:05:00.000Z",
          rtp_basis_stale: false,
          rtp_basis_stale_reason: null,
          rtp_basis_stale_run_id: null,
          rtp_basis_stale_marked_at: null,
        }}
        workspace={{ id: "workspace-1", name: "OpenPlan QA", slug: "openplan-qa" }}
        cycle={{
          id: "cycle-1",
          title: "2027 RTP",
          status: "draft",
          summary: "Cycle summary",
          geography_label: "Nevada County",
          horizon_start_year: 2027,
          horizon_end_year: 2050,
          updated_at: "2026-03-28T17:30:00.000Z",
        }}
        sections={[
          {
            id: "section-1",
            section_key: "project_pipeline",
            title: "Project pipeline",
            enabled: true,
            sort_order: 0,
            config_json: {},
          },
        ]}
        artifacts={[
          {
            id: "artifact-1",
            artifact_kind: "html",
            generated_at: "2026-03-28T18:00:00.000Z",
          },
        ]}
        comparisonDigest={null}
        latestHtml={null}
        generationContext={{
          generatedAt: "2026-03-28T18:00:00.000Z",
          enabledSectionKeys: ["project_pipeline"],
          readinessLabel: "Ready",
          readinessReason: "Packet is aligned.",
          workflowLabel: "On track",
          workflowDetail: "All source sections are captured.",
          chapterCount: 8,
          chapterCompleteCount: 8,
          chapterReadyForReviewCount: 8,
          linkedProjectCount: 3,
          engagementCampaignCount: 1,
          presetStage: null,
          presetLabel: null,
          presetStatusLabel: null,
          presetDetail: null,
          fundingSnapshot: null,
          publicReviewLabel: "Comment-response foundation ready",
          publicReviewDetail: "2 approved comments are ready for packet handoff and the current RTP packet is in place for review closure.",
          publicReviewTone: "success",
          cycleLevelCampaignCount: 1,
          chapterLevelCampaignCount: 0,
          pendingCommentCount: 0,
          approvedCommentCount: 2,
          readyCommentCount: 2,
        }}
        currentContext={{
          enabledSectionKeys: ["project_pipeline"],
          readinessLabel: "Ready",
          readinessReason: "Packet is aligned.",
          workflowLabel: "On track",
          workflowDetail: "All source sections are captured.",
          chapterCount: 8,
          chapterCompleteCount: 8,
          chapterReadyForReviewCount: 8,
          linkedProjectCount: 3,
          engagementCampaignCount: 1,
          cycleUpdatedAt: "2026-03-28T17:30:00.000Z",
          presetStage: null,
          presetLabel: null,
          presetStatusLabel: null,
          presetDetail: null,
          fundingSnapshot: null,
          publicReviewLabel: "Comment-response foundation ready",
          publicReviewDetail: "2 approved comments are ready for packet handoff and the current RTP packet is in place for review closure.",
          publicReviewTone: "success",
          cycleLevelCampaignCount: 1,
          chapterLevelCampaignCount: 0,
          pendingCommentCount: 0,
          approvedCommentCount: 2,
          readyCommentCount: 2,
        }}
        operationsSummary={{} as WorkspaceOperationsSummary}
      />
    );

    expect(screen.getAllByText("Packet current").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Release review ready").length).toBeGreaterThan(0);
    expect(screen.getByText(/Next operator move: Open release review\./i)).toBeInTheDocument();
    expect(screen.queryByText("No packet")).not.toBeInTheDocument();
    expect(screen.getAllByText(/Packet generated/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Live comment-response posture")).toBeInTheDocument();
    expect(screen.getAllByText("Comment-response foundation ready").length).toBeGreaterThan(0);
    expect(screen.getByText("Approved categorized items ready for packet handoff.")).toBeInTheDocument();
  });

  it("surfaces the grants follow-through lane when RTP funding posture still needs cross-module work", () => {
    render(
      <RtpReportDetail
        report={{
          id: "report-1",
          title: "Nevada County RTP Packet",
          report_type: "board_packet",
          status: "generated",
          summary: "Board packet for release review.",
          latest_artifact_kind: "html",
          generated_at: "2026-03-28T18:00:00.000Z",
          updated_at: "2026-03-28T18:05:00.000Z",
          rtp_basis_stale: false,
          rtp_basis_stale_reason: null,
          rtp_basis_stale_run_id: null,
          rtp_basis_stale_marked_at: null,
        }}
        workspace={{ id: "workspace-1", name: "OpenPlan QA", slug: "openplan-qa" }}
        cycle={{
          id: "cycle-1",
          title: "2027 RTP",
          status: "draft",
          summary: "Cycle summary",
          geography_label: "Nevada County",
          horizon_start_year: 2027,
          horizon_end_year: 2050,
          updated_at: "2026-03-28T17:30:00.000Z",
        }}
        sections={[
          {
            id: "section-1",
            section_key: "project_pipeline",
            title: "Project pipeline",
            enabled: true,
            sort_order: 0,
            config_json: {},
          },
        ]}
        artifacts={[
          {
            id: "artifact-1",
            artifact_kind: "html",
            generated_at: "2026-03-28T18:00:00.000Z",
          },
        ]}
        comparisonDigest={null}
        latestHtml={null}
        generationContext={{
          generatedAt: "2026-03-28T18:00:00.000Z",
          enabledSectionKeys: ["project_pipeline"],
          readinessLabel: "Ready",
          readinessReason: "Packet is aligned.",
          workflowLabel: "On track",
          workflowDetail: "All source sections are captured.",
          chapterCount: 8,
          chapterCompleteCount: 8,
          chapterReadyForReviewCount: 8,
          linkedProjectCount: 3,
          engagementCampaignCount: 1,
          presetStage: null,
          presetLabel: null,
          presetStatusLabel: null,
          presetDetail: null,
          fundingSnapshot: buildFundingSnapshot({ gapProjectCount: 1, label: "Partially funded", reason: "A gap remains." }),
          publicReviewLabel: "Comment-response foundation ready",
          publicReviewDetail: "2 approved comments are ready for packet handoff and the current RTP packet is in place for review closure.",
          publicReviewTone: "success",
          cycleLevelCampaignCount: 1,
          chapterLevelCampaignCount: 0,
          pendingCommentCount: 0,
          approvedCommentCount: 2,
          readyCommentCount: 2,
        }}
        currentContext={{
          enabledSectionKeys: ["project_pipeline"],
          readinessLabel: "Ready",
          readinessReason: "Packet is aligned.",
          workflowLabel: "On track",
          workflowDetail: "All source sections are captured.",
          chapterCount: 8,
          chapterCompleteCount: 8,
          chapterReadyForReviewCount: 8,
          linkedProjectCount: 3,
          engagementCampaignCount: 1,
          cycleUpdatedAt: "2026-03-28T17:30:00.000Z",
          presetStage: null,
          presetLabel: null,
          presetStatusLabel: null,
          presetDetail: null,
          fundingSnapshot: buildFundingSnapshot({ gapProjectCount: 1, label: "Partially funded", reason: "A gap remains." }),
          publicReviewLabel: "Public review active",
          publicReviewDetail: "1 comment is still waiting for operator review while 2 approved items are already ready for packet handoff.",
          publicReviewTone: "warning",
          cycleLevelCampaignCount: 1,
          chapterLevelCampaignCount: 1,
          pendingCommentCount: 1,
          approvedCommentCount: 2,
          readyCommentCount: 2,
        }}
        operationsSummary={{} as WorkspaceOperationsSummary}
      />
    );

    expect(screen.getByText("Grants follow-through")).toBeInTheDocument();
    expect(screen.getAllByText("Public review active").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Review loop still open").length).toBeGreaterThan(0);
    expect(screen.getByText(/Next operator move: Close pending comment review\./i)).toBeInTheDocument();
    expect(screen.getAllByText(/1 comment is still waiting for operator review/i).length).toBeGreaterThan(0);
    const link = screen.getByRole("link", { name: /Open gap resolution/i });
    expect(link).toHaveAttribute("href", "/grants#grants-gap-resolution-lane");
  });

});
