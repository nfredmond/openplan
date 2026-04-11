import { describe, expect, it } from "vitest";
import { buildAssistantOperations } from "@/lib/assistant/operations";
import type { ProjectAssistantContext, ProgramAssistantContext } from "@/lib/assistant/context";

function buildProjectContext(): ProjectAssistantContext {
  return {
    kind: "project",
    workspace: {
      id: "workspace-1",
      name: "Test Workspace",
      plan: "pilot",
      role: "owner",
    },
    project: {
      id: "project-1",
      name: "Test Project",
      summary: null,
      status: "active",
      planType: "corridor_study",
      deliveryPhase: "scoping",
      updatedAt: "2026-04-11T18:00:00.000Z",
    },
    counts: {
      deliverables: 0,
      risks: 0,
      issues: 0,
      decisions: 0,
      meetings: 0,
      linkedDatasets: 0,
      overlayReadyDatasets: 0,
      recentRuns: 0,
    },
    fundingSummary: {
      opportunityCount: 1,
      openCount: 1,
      closingSoonCount: 0,
      pursueCount: 0,
      fundingNeedAmount: 500000,
      gapAmount: 500000,
      leadOpportunity: {
        id: "opp-1",
        title: "ATP Cycle 8",
        status: "open",
        decisionState: null,
        closesAt: null,
        decisionDueAt: null,
      },
    },
    stageGateSummary: {
      blockedGate: null,
      holdCount: 0,
      passCount: 0,
      notStartedCount: 0,
      decisionCount: 0,
    } as unknown as ProjectAssistantContext["stageGateSummary"],
    linkedDatasets: [],
    recentRuns: [],
  };
}

function buildProgramContext(): ProgramAssistantContext {
  return {
    kind: "program",
    workspace: {
      id: "workspace-1",
      name: "Test Workspace",
      plan: "pilot",
      role: "owner",
    },
    project: {
      id: "project-1",
      name: "Test Project",
    },
    program: {
      id: "program-1",
      title: "Test Program",
      summary: null,
      status: "assembling",
      programType: "rtip",
      cycleName: "2027 RTIP",
      sponsorAgency: null,
      updatedAt: "2026-04-11T18:00:00.000Z",
    },
    readiness: {
      label: "Incomplete",
      ready: false,
      missingCheckCount: 1,
    } as unknown as ProgramAssistantContext["readiness"],
    workflow: {
      label: "Assembling",
    } as unknown as ProgramAssistantContext["workflow"],
    linkageCounts: {
      plans: 0,
      reports: 0,
      engagementCampaigns: 0,
      relatedProjects: 1,
    },
    fundingSummary: {
      opportunityCount: 1,
      openCount: 1,
      closingSoonCount: 0,
      pursueCount: 0,
      fundingNeedAmount: 500000,
      gapAmount: 500000,
      leadOpportunity: {
        id: "opp-2",
        title: "RAISE 2026",
        status: "open",
        decisionState: null,
        closesAt: null,
        decisionDueAt: null,
      },
    },
    packetSummary: {
      linkedReportCount: 0,
      attentionCount: 0,
      noPacketCount: 0,
      refreshRecommendedCount: 0,
      recommendedReport: null,
    },
    operationsSummary: {
      posture: "active",
      headline: "Funding posture",
      detail: "Funding work is active.",
      counts: {
        projects: 1,
        activeProjects: 1,
        plans: 0,
        plansNeedingSetup: 0,
        programs: 1,
        activePrograms: 1,
        reports: 0,
        reportRefreshRecommended: 0,
        reportNoPacket: 0,
        comparisonBackedReports: 0,
        fundingOpportunities: 1,
        openFundingOpportunities: 1,
        closingSoonFundingOpportunities: 0,
        projectFundingNeedAnchorProjects: 0,
        projectFundingSourcingProjects: 0,
        projectFundingDecisionProjects: 0,
        projectFundingAwardRecordProjects: 0,
        projectFundingGapProjects: 1,
        queueDepth: 1,
      },
      nextCommand: null,
      commandQueue: [],
    },
  };
}

describe("project and program funding operations", () => {
  it("adds a project execute action to mark the lead funding opportunity pursue", () => {
    const links = buildAssistantOperations(buildProjectContext());
    const action = links.find((link) => link.id === "project-advance-funding-opportunity");

    expect(action).toBeDefined();
    expect(action?.executeAction?.kind).toBe("update_funding_opportunity_decision");
    if (action?.executeAction?.kind === "update_funding_opportunity_decision") {
      expect(action.executeAction.opportunityId).toBe("opp-1");
      expect(action.executeAction.decisionState).toBe("pursue");
    }
  });

  it("adds a program execute action to mark the lead funding opportunity pursue", () => {
    const links = buildAssistantOperations(buildProgramContext());
    const action = links.find((link) => link.id === "program-advance-funding-opportunity");

    expect(action).toBeDefined();
    expect(action?.executeAction?.kind).toBe("update_funding_opportunity_decision");
    if (action?.executeAction?.kind === "update_funding_opportunity_decision") {
      expect(action.executeAction.opportunityId).toBe("opp-2");
      expect(action.executeAction.decisionState).toBe("pursue");
    }
  });
});
