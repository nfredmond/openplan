import { describe, expect, it } from "vitest";
import { buildAssistantOperations } from "@/lib/assistant/operations";
import type { WorkspaceAssistantContext } from "@/lib/assistant/context";

function buildWorkspaceContext(): WorkspaceAssistantContext {
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
      name: "Recent Project",
      status: "active",
      planType: "corridor_study",
      deliveryPhase: "scoping",
      updatedAt: "2026-04-11T18:00:00.000Z",
    },
    recentRuns: [],
    currentRun: null,
    baselineRun: null,
    operationsSummary: {
      posture: "attention",
      headline: "Anchor project funding needs",
      detail: "A project has linked opportunities but no funding-need anchor.",
      counts: {
        projects: 2,
        activeProjects: 2,
        plans: 0,
        plansNeedingSetup: 0,
        programs: 0,
        activePrograms: 0,
        reports: 0,
        reportRefreshRecommended: 0,
        reportNoPacket: 0,
        comparisonBackedReports: 0,
        fundingOpportunities: 1,
        openFundingOpportunities: 1,
        closingSoonFundingOpportunities: 0,
        projectFundingNeedAnchorProjects: 1,
        projectFundingGapProjects: 0,
        queueDepth: 1,
      },
      nextCommand: {
        key: "anchor-project-funding-needs",
        title: "Anchor project funding needs",
        detail: "Reopen Anchor Project first so the gap can be measured honestly.",
        href: "/projects/project-anchor#project-funding-opportunities",
        targetProjectId: "project-anchor",
        tone: "warning",
        priority: 3,
        badges: [{ label: "Missing anchors", value: 1 }],
      },
      commandQueue: [
        {
          key: "anchor-project-funding-needs",
          title: "Anchor project funding needs",
          detail: "Reopen Anchor Project first so the gap can be measured honestly.",
          href: "/projects/project-anchor#project-funding-opportunities",
          targetProjectId: "project-anchor",
          tone: "warning",
          priority: 3,
          badges: [{ label: "Missing anchors", value: 1 }],
        },
      ],
    },
  };
}

describe("assistant funding operations", () => {
  it("exposes a workspace-level execute action for the lead missing funding anchor", () => {
    const links = buildAssistantOperations(buildWorkspaceContext());
    const action = links.find((link) => link.id === "workspace-create-funding-profile");

    expect(action).toBeDefined();
    expect(action?.executeAction?.kind).toBe("create_project_funding_profile");
    if (action?.executeAction?.kind === "create_project_funding_profile") {
      expect(action.executeAction.projectId).toBe("project-anchor");
    }
  });
});
