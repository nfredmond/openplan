import { describe, expect, it } from "vitest";
import { buildAssistantPreview } from "@/lib/assistant/respond";
import type { WorkspaceAssistantContext } from "@/lib/assistant/context";

function buildWorkspaceContext(overrides?: Partial<WorkspaceAssistantContext["operationsSummary"]>): WorkspaceAssistantContext {
  const operationsSummary: WorkspaceAssistantContext["operationsSummary"] = {
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
    commandQueue: [
      {
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
    ],
    fullCommandQueue: [
      {
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
    ],
  };

  return {
    kind: "workspace",
    workspace: {
      id: "workspace-1",
      name: "Test Workspace",
      plan: "pilot",
      role: "owner",
    },
    recentProject: {
      id: "project-1",
      name: "RTP Corridor Project",
      status: "active",
      planType: "regional_transportation_plan",
      deliveryPhase: "review",
      updatedAt: "2026-04-12T18:00:00.000Z",
    },
    recentRuns: [],
    currentRun: null,
    baselineRun: null,
    operationsSummary: {
      ...operationsSummary,
      ...overrides,
      counts: {
        ...operationsSummary.counts,
        ...overrides?.counts,
      },
      nextCommand: overrides?.nextCommand ?? operationsSummary.nextCommand,
      commandQueue: overrides?.commandQueue ?? operationsSummary.commandQueue,
      fullCommandQueue: overrides?.fullCommandQueue ?? overrides?.commandQueue ?? operationsSummary.fullCommandQueue,
    },
  };
}

describe("assistant RTP funding preview", () => {
  it("surfaces RTP funding release review in workspace preview copy", () => {
    const preview = buildAssistantPreview(buildWorkspaceContext());

    expect(preview.summary).toMatch(/1 current RTP packet still needs Grants OS follow-through/i);
    expect(preview.facts).toContain(
      "RTP grants follow-through: 1 current RTP packet still needs Grants OS follow-through before packet posture can be treated as settled."
    );
    expect(preview.stats.some((stat) => stat.label === "RTP funding review" && stat.value === "1")).toBe(true);
    expect(preview.operatorCue?.title).toBe("Open RTP grants follow-through");
  });
});
