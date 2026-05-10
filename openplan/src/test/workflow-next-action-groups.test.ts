import { describe, expect, it } from "vitest";
import {
  buildWorkflowNextActionGroups,
  classifyWorkflowNextAction,
  getCommandCenterRoadmapWorkflowLaneKeys,
  workflowGroupsCoverCommandCenterRoadmapLanes,
  workflowGroupsPreserveStandingChecksWhenQueueIsEmpty,
} from "@/lib/operations/workflow-next-action-groups";
import type { WorkspaceCommandQueueItem, WorkspaceOperationsSummary } from "@/lib/operations/workspace-summary";

function command(overrides: Partial<WorkspaceCommandQueueItem>): WorkspaceCommandQueueItem {
  return {
    key: "review-current-report-packets",
    title: "Run release review on current packets",
    detail: "Review the current RTP packet before external release.",
    href: "/reports/report-1#packet-release-review",
    tone: "warning",
    priority: 1,
    badges: [],
    ...overrides,
  };
}

function summary(overrides: Partial<WorkspaceOperationsSummary> = {}): WorkspaceOperationsSummary {
  const fullCommandQueue = overrides.fullCommandQueue ?? [
    command({
      key: "review-current-report-packets",
      detail: "1 current RTP packet still reads as public review active with a review loop open.",
      badges: [{ label: "Review loop open", value: 1 }],
    }),
    command({
      key: "advance-project-funding-decisions",
      moduleKey: "grants",
      moduleLabel: "Grants OS",
      title: "Advance project funding decisions",
      detail: "Review grant decisions and modeling posture before pursue language is used.",
      href: "/projects/project-1#project-funding-opportunities",
      badges: [{ label: "Modeling", value: "Thin support" }],
      priority: 2,
    }),
    command({
      key: "review-aerial-evidence",
      title: "Review aerial evidence posture",
      detail: "Check ready mission evidence packages before field verification.",
      href: "/aerial",
      tone: "info",
      priority: 3,
    }),
  ];

  return {
    posture: "attention",
    headline: "Run release review on current packets",
    detail: "Review the next queued workflow action.",
    counts: {
      projects: 1,
      activeProjects: 1,
      plans: 1,
      plansNeedingSetup: 0,
      programs: 0,
      activePrograms: 0,
      reports: 1,
      reportRefreshRecommended: 0,
      reportNoPacket: 0,
      reportPacketCurrent: 1,
      rtpFundingReviewPackets: 0,
      comparisonBackedReports: 1,
      fundingOpportunities: 1,
      openFundingOpportunities: 1,
      closingSoonFundingOpportunities: 0,
      overdueDecisionFundingOpportunities: 0,
      projectFundingNeedAnchorProjects: 0,
      projectFundingSourcingProjects: 0,
      projectFundingDecisionProjects: 1,
      projectFundingAwardRecordProjects: 0,
      projectFundingReimbursementStartProjects: 0,
      projectFundingReimbursementActiveProjects: 0,
      projectFundingGapProjects: 0,
      queueDepth: fullCommandQueue.length,
      aerialMissions: 1,
      aerialActiveMissions: 0,
      aerialReadyPackages: 1,
    },
    nextCommand: fullCommandQueue[0] ?? null,
    commandQueue: fullCommandQueue.slice(0, 2),
    fullCommandQueue,
    ...overrides,
  };
}

describe("workflow next-action groups", () => {
  it("classifies report, grants/modeling, engagement, aerial, and release-proof actions", () => {
    expect(
      classifyWorkflowNextAction(
        command({
          key: "review-current-report-packets",
          detail: "Regenerate packet release review after public review comment handoff.",
          badges: [{ label: "Review loop open", value: 2 }],
        })
      )
    ).toEqual(expect.arrayContaining(["rtp", "engagement", "admin-release-proof"]));

    expect(
      classifyWorkflowNextAction(
        command({
          key: "advance-project-funding-decisions",
          moduleKey: "grants",
          moduleLabel: "Grants OS",
          detail: "Inspect modeling caveats before grant pursue language.",
        })
      )
    ).toEqual(expect.arrayContaining(["grants", "analysis-modeling"]));
  });

  it("builds one operator lane for each required Command Center workflow", () => {
    const groups = buildWorkflowNextActionGroups(summary());

    expect(groups.map((group) => group.key)).toEqual(getCommandCenterRoadmapWorkflowLaneKeys());
    expect(workflowGroupsCoverCommandCenterRoadmapLanes(groups)).toBe(true);
    expect(groups.find((group) => group.key === "rtp")?.actions[0]?.title).toBe("Run release review on current packets");
    expect(groups.find((group) => group.key === "grants")?.actions[0]?.title).toBe("Advance project funding decisions");
    expect(groups.find((group) => group.key === "engagement")?.actions[0]?.detail).toMatch(/review loop open/i);
    expect(groups.find((group) => group.key === "analysis-modeling")?.actions[0]?.detail).toMatch(/modeling posture/i);
    expect(groups.find((group) => group.key === "aerial")?.actions[0]?.title).toBe("Review aerial evidence posture");
    expect(groups.find((group) => group.key === "admin-release-proof")?.actions[0]?.title).toBe(
      "Run release review on current packets"
    );
    expect(groups.find((group) => group.key === "grants")).toMatchObject({
      queuedActionCount: 1,
      displayedActionCount: 1,
    });
    expect(groups.find((group) => group.key === "rtp")?.actions[0]?.badges).toEqual([
      { label: "Review loop open", value: 1 },
    ]);
  });

  it("keeps standing check actions visible when a workflow has no queued pressure", () => {
    const groups = buildWorkflowNextActionGroups(summary({ fullCommandQueue: [], commandQueue: [], nextCommand: null }));

    expect(workflowGroupsCoverCommandCenterRoadmapLanes(groups)).toBe(true);
    expect(workflowGroupsPreserveStandingChecksWhenQueueIsEmpty(groups)).toBe(true);

    expect(groups.find((group) => group.key === "engagement")?.actions[0]).toMatchObject({
      title: "Inspect engagement handoff readiness",
      source: "standing-check",
      href: "/engagement",
      badges: [{ label: "Standing check", value: "handoff" }],
    });
    expect(groups.find((group) => group.key === "admin-release-proof")?.actions[0]).toMatchObject({
      title: "Check release proof packet",
      source: "standing-check",
      href: "/admin/pilot-readiness",
      badges: [{ label: "Total commands", value: 0 }],
    });
    expect(groups.find((group) => group.key === "rtp")?.actions[0]?.badges).toEqual([
      { label: "Regenerate", value: 0 },
      { label: "Generate", value: 0 },
      { label: "Current", value: 1 },
    ]);
    expect(groups.find((group) => group.key === "rtp")).toMatchObject({
      queuedActionCount: 0,
      displayedActionCount: 1,
    });
  });
});
