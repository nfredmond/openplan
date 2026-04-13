import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkspaceRuntimeCue } from "@/components/operations/workspace-runtime-cue";
import type { WorkspaceCommandQueueItem, WorkspaceOperationsSummary } from "@/lib/operations/workspace-summary";

const baseCounts: WorkspaceOperationsSummary["counts"] = {
  projects: 1,
  activeProjects: 1,
  plans: 0,
  plansNeedingSetup: 0,
  programs: 0,
  activePrograms: 0,
  reports: 0,
  reportRefreshRecommended: 0,
  reportNoPacket: 0,
  reportPacketCurrent: 0,
  rtpFundingReviewPackets: 0,
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
};

function buildSummary(
  nextCommand: WorkspaceCommandQueueItem | null,
  counts: Partial<WorkspaceOperationsSummary["counts"]> = {}
): WorkspaceOperationsSummary {
  return {
    posture: "attention",
    headline: nextCommand?.title ?? "No queue pressure",
    detail: nextCommand?.detail ?? "No immediate workspace command is visible.",
    counts: {
      ...baseCounts,
      ...counts,
    },
    nextCommand,
    commandQueue: nextCommand ? [nextCommand] : [],
    fullCommandQueue: nextCommand ? [nextCommand] : [],
  };
}

describe("WorkspaceRuntimeCue", () => {
  it("renders a Grants OS runtime cue for a non-reimbursement workspace command", () => {
    render(
      <WorkspaceRuntimeCue
        summary={buildSummary(
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
          { projectFundingNeedAnchorProjects: 1 }
        )}
      />
    );

    expect(
      screen.getByText(
        "Shared runtime cue: Grants OS next command is anchor project funding needs. 1 project funding lane has linked opportunities but still no recorded funding-need anchor."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Grants OS" })).toHaveAttribute(
      "href",
      "/grants?focusProjectId=project-anchor#grants-funding-need-editor"
    );
  });

  it("preserves the reimbursement-start cue wording and href", () => {
    render(
      <WorkspaceRuntimeCue
        summary={buildSummary(
          {
            key: "start-project-reimbursement-packets",
            moduleKey: "grants",
            moduleLabel: "Grants OS",
            title: "Start reimbursement packets",
            detail: "A project has committed awards but no reimbursement packet started yet.",
            href: "/projects/project-gap#project-invoices",
            targetProjectId: "project-gap",
            targetProjectName: "Gap Project",
            tone: "warning",
            priority: 4,
            badges: [{ label: "Need packets", value: 1 }],
          },
          { projectFundingReimbursementStartProjects: 1 }
        )}
      />
    );

    expect(
      screen.getByText(
        "Shared runtime cue: start the lead reimbursement packet in Gap Project before delivery work outruns the funding trail."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open reimbursement start" })).toHaveAttribute(
      "href",
      "/grants?focusProjectId=project-gap#grants-reimbursement-composer"
    );
  });

  it("preserves the RTP funding-review cue wording and href", () => {
    render(
      <WorkspaceRuntimeCue
        summary={buildSummary(
          {
            key: "review-current-report-packets",
            title: "Run release review on current packets",
            detail: "1 current RTP packet still carries funding follow-up from linked projects.",
            href: "/reports/report-rtp-1#packet-release-review",
            tone: "warning",
            priority: 2.5,
            badges: [{ label: "Funding review", value: 1 }],
          },
          { reports: 1, reportPacketCurrent: 1, rtpFundingReviewPackets: 1 }
        )}
      />
    );

    expect(
      screen.getByText(
        "Shared runtime cue: 1 current RTP packet still carries linked-project funding follow-up, so release review should verify funding posture before treating the packet as truly settled."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open RTP funding review" })).toHaveAttribute(
      "href",
      "/reports/report-rtp-1#packet-release-review"
    );
  });
});
