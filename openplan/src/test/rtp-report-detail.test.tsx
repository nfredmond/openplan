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
        }}
        operationsSummary={{} as WorkspaceOperationsSummary}
      />
    );

    expect(screen.getAllByText("Packet current").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Release review ready").length).toBeGreaterThan(0);
    expect(screen.queryByText("No packet")).not.toBeInTheDocument();
    expect(screen.getAllByText(/Packet generated/i).length).toBeGreaterThan(0);
  });
});
