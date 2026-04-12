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
      awardCount: 0,
      awardRecordCount: 0,
      fundingNeedAmount: 500000,
      gapAmount: 500000,
      requestedReimbursementAmount: null,
      uninvoicedAwardAmount: null,
      reimbursementStatus: null,
      reimbursementPacketCount: 0,
      exactInvoiceAwardRelink: null,
      leadOpportunity: {
        id: "opp-1",
        title: "ATP Cycle 8",
        status: "open",
        decisionState: null,
        closesAt: null,
        decisionDueAt: null,
      },
      leadAwardOpportunity: null,
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
      awardCount: 0,
      awardRecordCount: 0,
      fundingNeedAmount: 500000,
      gapAmount: 500000,
      requestedReimbursementAmount: null,
      uninvoicedAwardAmount: null,
      reimbursementStatus: null,
      reimbursementPacketCount: 0,
      exactInvoiceAwardRelink: null,
      leadOpportunity: {
        id: "opp-2",
        title: "RAISE 2026",
        status: "open",
        decisionState: null,
        closesAt: null,
        decisionDueAt: null,
      },
      leadAwardOpportunity: null,
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
        projectFundingReimbursementStartProjects: 0,
        projectFundingReimbursementActiveProjects: 0,
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

  it("surfaces a project award-record action when an awarded opportunity is not yet recorded", () => {
    const context = buildProjectContext();
    context.fundingSummary.pursueCount = 1;
    context.fundingSummary.awardRecordCount = 1;
    context.fundingSummary.leadOpportunity = null;
    context.fundingSummary.leadAwardOpportunity = {
      id: "opp-award-1",
      title: "ATP Cycle 8 Award",
      status: "awarded",
      decisionState: "pursue",
      closesAt: null,
      decisionDueAt: null,
    };

    const links = buildAssistantOperations(context);
    const action = links.find((link) => link.id === "project-record-awarded-funding");

    expect(action).toBeDefined();
    expect(action?.label).toBe("Record awarded funding");
    expect(action?.statusLabel).toBe("Award record needed");
  });

  it("surfaces a program award-record action when an awarded opportunity is not yet recorded", () => {
    const context = buildProgramContext();
    context.fundingSummary.pursueCount = 1;
    context.fundingSummary.awardRecordCount = 1;
    context.fundingSummary.leadOpportunity = null;
    context.fundingSummary.leadAwardOpportunity = {
      id: "opp-award-2",
      title: "RAISE 2026 Award",
      status: "awarded",
      decisionState: "pursue",
      closesAt: null,
      decisionDueAt: null,
    };

    const links = buildAssistantOperations(context);
    const action = links.find((link) => link.id === "program-record-awarded-funding");

    expect(action).toBeDefined();
    expect(action?.label).toBe("Record awarded funding");
    expect(action?.statusLabel).toBe("Award record needed");
  });

  it("surfaces a project reimbursement action when awards are recorded but uninvoiced", () => {
    const context = buildProjectContext();
    context.fundingSummary.pursueCount = 1;
    context.fundingSummary.awardCount = 1;
    context.fundingSummary.uninvoicedAwardAmount = 180000;
    context.fundingSummary.reimbursementPacketCount = 1;

    const links = buildAssistantOperations(context);
    const action = links.find((link) => link.id === "project-reimbursement-lane");

    expect(action).toBeDefined();
    expect(action?.label).toBe("Open reimbursement lane");
    expect(action?.href).toBe("/projects/project-1#project-invoices");
    expect(links.find((link) => link.id === "project-create-reimbursement-record")).toBeUndefined();
  });

  it("creates a project reimbursement record from uninvoiced award posture", () => {
    const context = buildProjectContext();
    context.fundingSummary.pursueCount = 1;
    context.fundingSummary.awardCount = 1;
    context.fundingSummary.uninvoicedAwardAmount = 180000;

    const links = buildAssistantOperations(context);
    const action = links.find((link) => link.id === "project-create-reimbursement-record");

    expect(action).toBeDefined();
    expect(action?.executeAction?.kind).toBe("create_project_record");
    if (action?.executeAction?.kind === "create_project_record") {
      expect(action.executeAction.projectId).toBe("project-1");
      expect(action.executeAction.recordType).toBe("submittal");
      expect(action.executeAction.submittalType).toBe("reimbursement");
    }
  });

  it("surfaces a program reimbursement action when linked-project awards are uninvoiced", () => {
    const context = buildProgramContext();
    context.fundingSummary.pursueCount = 1;
    context.fundingSummary.awardCount = 1;
    context.fundingSummary.uninvoicedAwardAmount = 225000;
    context.fundingSummary.reimbursementPacketCount = 1;

    const links = buildAssistantOperations(context);
    const action = links.find((link) => link.id === "program-reimbursement-lane");

    expect(action).toBeDefined();
    expect(action?.label).toBe("Open reimbursement lane");
    expect(action?.href).toBe("/projects/project-1#project-invoices");
    expect(links.find((link) => link.id === "program-create-reimbursement-record")).toBeUndefined();
  });

  it("creates a program reimbursement record on the linked project from uninvoiced award posture", () => {
    const context = buildProgramContext();
    context.fundingSummary.pursueCount = 1;
    context.fundingSummary.awardCount = 1;
    context.fundingSummary.uninvoicedAwardAmount = 225000;

    const links = buildAssistantOperations(context);
    const action = links.find((link) => link.id === "program-create-reimbursement-record");

    expect(action).toBeDefined();
    expect(action?.executeAction?.kind).toBe("create_project_record");
    if (action?.executeAction?.kind === "create_project_record") {
      expect(action.executeAction.projectId).toBe("project-1");
      expect(action.executeAction.recordType).toBe("submittal");
      expect(action.executeAction.submittalType).toBe("reimbursement");
    }
  });

  it("adds a project exact invoice-award relink action when the match is unambiguous", () => {
    const context = buildProjectContext();
    context.fundingSummary.pursueCount = 1;
    context.fundingSummary.awardCount = 1;
    context.fundingSummary.uninvoicedAwardAmount = 180000;
    context.fundingSummary.exactInvoiceAwardRelink = {
      invoiceId: "invoice-1",
      fundingAwardId: "award-1",
    };

    const links = buildAssistantOperations(context);
    const action = links.find((link) => link.id === "project-link-invoice-award");

    expect(action).toBeDefined();
    expect(action?.label).toBe("Link exact invoice to award");
    expect(action?.executeAction?.kind).toBe("link_billing_invoice_funding_award");
    expect(links.find((link) => link.id === "project-create-reimbursement-record")).toBeUndefined();
    if (action?.executeAction?.kind === "link_billing_invoice_funding_award") {
      expect(action.executeAction.workspaceId).toBe("workspace-1");
      expect(action.executeAction.invoiceId).toBe("invoice-1");
      expect(action.executeAction.fundingAwardId).toBe("award-1");
    }
  });

  it("adds a program exact invoice-award relink action when the linked-project match is unambiguous", () => {
    const context = buildProgramContext();
    context.fundingSummary.pursueCount = 1;
    context.fundingSummary.awardCount = 1;
    context.fundingSummary.uninvoicedAwardAmount = 225000;
    context.fundingSummary.exactInvoiceAwardRelink = {
      invoiceId: "invoice-2",
      fundingAwardId: "award-2",
    };

    const links = buildAssistantOperations(context);
    const action = links.find((link) => link.id === "program-link-invoice-award");

    expect(action).toBeDefined();
    expect(action?.label).toBe("Link exact invoice to award");
    expect(action?.executeAction?.kind).toBe("link_billing_invoice_funding_award");
    expect(links.find((link) => link.id === "program-create-reimbursement-record")).toBeUndefined();
    if (action?.executeAction?.kind === "link_billing_invoice_funding_award") {
      expect(action.executeAction.workspaceId).toBe("workspace-1");
      expect(action.executeAction.invoiceId).toBe("invoice-2");
      expect(action.executeAction.fundingAwardId).toBe("award-2");
    }
  });
});
