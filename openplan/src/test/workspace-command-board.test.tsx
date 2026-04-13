import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkspaceCommandBoard } from "@/components/operations/workspace-command-board";
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
    projectFundingNeedAnchorProjects: 0,
    projectFundingSourcingProjects: 0,
    projectFundingDecisionProjects: 0,
    projectFundingAwardRecordProjects: 0,
    projectFundingReimbursementStartProjects: 0,
    projectFundingReimbursementActiveProjects: 0,
    projectFundingGapProjects: 0,
    queueDepth: 1,
  },
  nextCommand: {
    key: "review-current-report-packets",
    title: "Run release review on current packets",
    detail: "1 current RTP packet still carries funding follow-up from linked projects.",
    href: "/reports/report-rtp-1#packet-release-review",
    tone: "warning",
    priority: 2.5,
    badges: [
      { label: "Current", value: 1 },
      { label: "Funding review", value: 1 },
    ],
  },
  commandQueue: [
    {
      key: "review-current-report-packets",
      title: "Run release review on current packets",
      detail: "1 current RTP packet still carries funding follow-up from linked projects.",
      href: "/reports/report-rtp-1#packet-release-review",
      tone: "warning",
      priority: 2.5,
      badges: [
        { label: "Current", value: 1 },
        { label: "Funding review", value: 1 },
      ],
    },
  ],
  fullCommandQueue: [
    {
      key: "review-current-report-packets",
      title: "Run release review on current packets",
      detail: "1 current RTP packet still carries funding follow-up from linked projects.",
      href: "/reports/report-rtp-1#packet-release-review",
      tone: "warning",
      priority: 2.5,
      badges: [
        { label: "Current", value: 1 },
        { label: "Funding review", value: 1 },
      ],
    },
  ],
};

describe("WorkspaceCommandBoard", () => {
  it("surfaces funding-backed RTP packet review in shared packet work copy", () => {
    render(<WorkspaceCommandBoard summary={summary} />);

    expect(
      screen.getByText(/1 current RTP packet still needs funding-backed release review even though packet freshness already reads current\./i)
    ).toBeInTheDocument();
    expect(screen.getByText(/1 ready for release review, 1 funding-backed\./i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Run release review on current packets/i })).toHaveAttribute(
      "href",
      "/reports/report-rtp-1#packet-release-review"
    );
    expect(screen.getByText(/Funding review: 1/i)).toBeInTheDocument();
  });

  it("shows Grants OS lane metadata and routes grants commands to the shared lane", () => {
    render(
      <WorkspaceCommandBoard
        summary={{
          ...summary,
          detail: "A funding need anchor is missing.",
          counts: {
            ...summary.counts,
            reportPacketCurrent: 0,
            rtpFundingReviewPackets: 0,
            projectFundingNeedAnchorProjects: 1,
            queueDepth: 1,
          },
          nextCommand: {
            key: "anchor-project-funding-needs",
            moduleKey: "grants",
            moduleLabel: "Grants OS",
            title: "Anchor project funding needs",
            detail: "1 project funding lane has linked opportunities but still no recorded funding-need anchor.",
            href: "/projects/project-anchor#project-funding-opportunities",
            targetProjectId: "project-anchor",
            tone: "warning",
            priority: 3,
            badges: [{ label: "Missing anchors", value: 1 }],
          },
          commandQueue: [
            {
              key: "anchor-project-funding-needs",
              moduleKey: "grants",
              moduleLabel: "Grants OS",
              title: "Anchor project funding needs",
              detail: "1 project funding lane has linked opportunities but still no recorded funding-need anchor.",
              href: "/projects/project-anchor#project-funding-opportunities",
              targetProjectId: "project-anchor",
              tone: "warning",
              priority: 3,
              badges: [{ label: "Missing anchors", value: 1 }],
            },
          ],
          fullCommandQueue: [
            {
              key: "anchor-project-funding-needs",
              moduleKey: "grants",
              moduleLabel: "Grants OS",
              title: "Anchor project funding needs",
              detail: "1 project funding lane has linked opportunities but still no recorded funding-need anchor.",
              href: "/projects/project-anchor#project-funding-opportunities",
              targetProjectId: "project-anchor",
              tone: "warning",
              priority: 3,
              badges: [{ label: "Missing anchors", value: 1 }],
            },
          ],
        }}
      />
    );

    expect(screen.getByText("Grants OS")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Anchor project funding needs/i })).toHaveAttribute(
      "href",
      "/grants?focusProjectId=project-anchor#grants-funding-need-editor"
    );
  });
});
