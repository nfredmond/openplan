import { describe, expect, it } from "vitest";
import { buildAssistantOperations } from "@/lib/assistant/operations";
import type { WorkspaceAssistantContext } from "@/lib/assistant/context";

function buildWorkspaceContext(overrides?: Partial<WorkspaceAssistantContext["operationsSummary"]>): WorkspaceAssistantContext {
  const operationsSummary: WorkspaceAssistantContext["operationsSummary"] = {
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
      projectFundingSourcingProjects: 0,
      projectFundingDecisionProjects: 0,
      projectFundingAwardRecordProjects: 0,
      projectFundingReimbursementStartProjects: 0,
      projectFundingReimbursementActiveProjects: 0,
      projectFundingGapProjects: 0,
      queueDepth: 1,
    },
    nextCommand: {
      key: "anchor-project-funding-needs",
      title: "Anchor project funding needs",
      detail: "Reopen Anchor Project first so the gap can be measured honestly.",
      href: "/projects/project-anchor#project-funding-opportunities",
      targetProjectId: "project-anchor",
      targetProjectName: "Anchor Project",
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
        targetProjectName: "Anchor Project",
        tone: "warning",
        priority: 3,
        badges: [{ label: "Missing anchors", value: 1 }],
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
      ...operationsSummary,
      ...overrides,
      counts: {
        ...operationsSummary.counts,
        ...overrides?.counts,
      },
      nextCommand: overrides?.nextCommand ?? operationsSummary.nextCommand,
      commandQueue: overrides?.commandQueue ?? operationsSummary.commandQueue,
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

  it("switches the workspace funding agent into sourcing posture when need exists but opportunities do not", () => {
    const links = buildAssistantOperations(
      buildWorkspaceContext({
        headline: "Source project funding opportunities",
        detail: "A project has recorded need but no linked opportunities.",
        counts: {
          projectFundingNeedAnchorProjects: 0,
          projectFundingSourcingProjects: 1,
          projectFundingDecisionProjects: 0,
          projectFundingAwardRecordProjects: 0,
          projectFundingGapProjects: 0,
        },
        nextCommand: {
          key: "source-project-funding-opportunities",
          title: "Source project funding opportunities",
          detail: "Reopen Gap Project first and source candidate programs.",
          href: "/projects/project-gap#project-funding-opportunities",
          targetProjectId: "project-gap",
          targetProjectName: "Gap Project",
          tone: "warning",
          priority: 4,
          badges: [{ label: "Needs sourcing", value: 1 }],
        },
        commandQueue: [
          {
            key: "source-project-funding-opportunities",
            title: "Source project funding opportunities",
            detail: "Reopen Gap Project first and source candidate programs.",
            href: "/projects/project-gap#project-funding-opportunities",
            targetProjectId: "project-gap",
            targetProjectName: "Gap Project",
            tone: "warning",
            priority: 4,
            badges: [{ label: "Needs sourcing", value: 1 }],
          },
        ],
      })
    );
    const action = links.find((link) => link.id === "workspace-funding-agent");

    expect(action?.label).toBe("Review funding sourcing gaps in panel");
    expect(action?.statusLabel).toBe("1 need sourcing");
  });

  it("exposes a workspace-level execute action for the lead sourcing project", () => {
    const links = buildAssistantOperations(
      buildWorkspaceContext({
        headline: "Source project funding opportunities",
        detail: "A project has recorded need but no linked opportunities.",
        counts: {
          projectFundingNeedAnchorProjects: 0,
          projectFundingSourcingProjects: 1,
          projectFundingDecisionProjects: 0,
          projectFundingAwardRecordProjects: 0,
          projectFundingGapProjects: 0,
        },
        nextCommand: {
          key: "source-project-funding-opportunities",
          title: "Source project funding opportunities",
          detail: "Reopen Gap Project first and source candidate programs.",
          href: "/projects/project-gap#project-funding-opportunities",
          targetProjectId: "project-gap",
          targetProjectName: "Gap Project",
          tone: "warning",
          priority: 4,
          badges: [{ label: "Needs sourcing", value: 1 }],
        },
        commandQueue: [
          {
            key: "source-project-funding-opportunities",
            title: "Source project funding opportunities",
            detail: "Reopen Gap Project first and source candidate programs.",
            href: "/projects/project-gap#project-funding-opportunities",
            targetProjectId: "project-gap",
            targetProjectName: "Gap Project",
            tone: "warning",
            priority: 4,
            badges: [{ label: "Needs sourcing", value: 1 }],
          },
        ],
      })
    );
    const action = links.find((link) => link.id === "workspace-create-funding-opportunity");

    expect(action).toBeDefined();
    expect(action?.executeAction?.kind).toBe("create_funding_opportunity");
    if (action?.executeAction?.kind === "create_funding_opportunity") {
      expect(action.executeAction.projectId).toBe("project-gap");
      expect(action.executeAction.title).toBe("Gap Project funding opportunity");
    }
  });

  it("switches the workspace funding agent into decision posture when opportunities exist but nothing is pursue", () => {
    const links = buildAssistantOperations(
      buildWorkspaceContext({
        headline: "Advance project funding decisions",
        detail: "A project has linked opportunities but nothing marked pursue.",
        counts: {
          projectFundingNeedAnchorProjects: 0,
          projectFundingSourcingProjects: 0,
          projectFundingDecisionProjects: 1,
          projectFundingAwardRecordProjects: 0,
          projectFundingGapProjects: 0,
        },
        nextCommand: {
          key: "advance-project-funding-decisions",
          title: "Advance project funding decisions",
          detail: "ATP Cycle 8 is the first grant decision to advance for Gap Project.",
          href: "/projects/project-gap#project-funding-opportunities",
          targetProjectId: "project-gap",
          targetProjectName: "Gap Project",
          targetOpportunityId: "opp-gap-1",
          tone: "warning",
          priority: 5,
          badges: [{ label: "Decision gaps", value: 1 }],
        },
        commandQueue: [
          {
            key: "advance-project-funding-decisions",
            title: "Advance project funding decisions",
            detail: "ATP Cycle 8 is the first grant decision to advance for Gap Project.",
            href: "/projects/project-gap#project-funding-opportunities",
            targetProjectId: "project-gap",
            targetProjectName: "Gap Project",
            targetOpportunityId: "opp-gap-1",
            tone: "warning",
            priority: 5,
            badges: [{ label: "Decision gaps", value: 1 }],
          },
        ],
      })
    );
    const action = links.find((link) => link.id === "workspace-funding-agent");

    expect(action?.label).toBe("Review funding decision gaps in panel");
    expect(action?.statusLabel).toBe("1 need decisions");
  });

  it("exposes a workspace-level execute action for the lead funding decision gap", () => {
    const links = buildAssistantOperations(
      buildWorkspaceContext({
        headline: "Advance project funding decisions",
        detail: "A project has linked opportunities but nothing marked pursue.",
        counts: {
          projectFundingNeedAnchorProjects: 0,
          projectFundingSourcingProjects: 0,
          projectFundingDecisionProjects: 1,
          projectFundingAwardRecordProjects: 0,
          projectFundingGapProjects: 0,
        },
        nextCommand: {
          key: "advance-project-funding-decisions",
          title: "Advance project funding decisions",
          detail: "ATP Cycle 8 is the first grant decision to advance for Gap Project.",
          href: "/projects/project-gap#project-funding-opportunities",
          targetProjectId: "project-gap",
          targetProjectName: "Gap Project",
          targetOpportunityId: "opp-gap-1",
          tone: "warning",
          priority: 5,
          badges: [{ label: "Decision gaps", value: 1 }],
        },
        commandQueue: [
          {
            key: "advance-project-funding-decisions",
            title: "Advance project funding decisions",
            detail: "ATP Cycle 8 is the first grant decision to advance for Gap Project.",
            href: "/projects/project-gap#project-funding-opportunities",
            targetProjectId: "project-gap",
            targetProjectName: "Gap Project",
            targetOpportunityId: "opp-gap-1",
            tone: "warning",
            priority: 5,
            badges: [{ label: "Decision gaps", value: 1 }],
          },
        ],
      })
    );
    const action = links.find((link) => link.id === "workspace-advance-funding-opportunity");

    expect(action).toBeDefined();
    expect(action?.executeAction?.kind).toBe("update_funding_opportunity_decision");
    if (action?.executeAction?.kind === "update_funding_opportunity_decision") {
      expect(action.executeAction.opportunityId).toBe("opp-gap-1");
      expect(action.executeAction.decisionState).toBe("pursue");
    }
  });

  it("switches the workspace funding agent into award-record posture when an opportunity is awarded but not yet recorded", () => {
    const links = buildAssistantOperations(
      buildWorkspaceContext({
        headline: "Record awarded funding",
        detail: "A project has an awarded opportunity but no funding-award record yet.",
        counts: {
          projectFundingNeedAnchorProjects: 0,
          projectFundingSourcingProjects: 0,
          projectFundingDecisionProjects: 0,
          projectFundingAwardRecordProjects: 1,
          projectFundingGapProjects: 1,
        },
        nextCommand: {
          key: "record-awarded-funding",
          title: "Record awarded funding",
          detail: "Reopen Gap Project first and convert ATP Cycle 8 into a committed award entry.",
          href: "/projects/project-gap#project-funding-opportunities",
          targetProjectId: "project-gap",
          targetProjectName: "Gap Project",
          targetOpportunityId: "opp-gap-1",
          tone: "warning",
          priority: 6,
          badges: [{ label: "Award records needed", value: 1 }],
        },
        commandQueue: [
          {
            key: "record-awarded-funding",
            title: "Record awarded funding",
            detail: "Reopen Gap Project first and convert ATP Cycle 8 into a committed award entry.",
            href: "/projects/project-gap#project-funding-opportunities",
            targetProjectId: "project-gap",
            targetProjectName: "Gap Project",
            targetOpportunityId: "opp-gap-1",
            tone: "warning",
            priority: 6,
            badges: [{ label: "Award records needed", value: 1 }],
          },
        ],
      })
    );
    const action = links.find((link) => link.id === "workspace-funding-agent");

    expect(action?.label).toBe("Review awarded funding records in panel");
    expect(action?.statusLabel).toBe("1 award record missing");
  });

  it("exposes a workspace-level execute action for the lead reimbursement packet start", () => {
    const links = buildAssistantOperations(
      buildWorkspaceContext({
        headline: "Start reimbursement packets",
        detail: "A project has committed awards but no reimbursement packet started yet.",
        counts: {
          projectFundingNeedAnchorProjects: 0,
          projectFundingSourcingProjects: 0,
          projectFundingDecisionProjects: 0,
          projectFundingAwardRecordProjects: 0,
          projectFundingReimbursementStartProjects: 1,
          projectFundingReimbursementActiveProjects: 0,
          projectFundingGapProjects: 1,
        },
        nextCommand: {
          key: "start-project-reimbursement-packets",
          title: "Start reimbursement packets",
          detail: "Reopen Gap Project first and start the packet against uninvoiced award dollars.",
          href: "/projects/project-gap#project-submittals",
          targetProjectId: "project-gap",
          targetProjectName: "Gap Project",
          tone: "warning",
          priority: 6.2,
          badges: [{ label: "Packets needed", value: 1 }],
        },
        commandQueue: [
          {
            key: "start-project-reimbursement-packets",
            title: "Start reimbursement packets",
            detail: "Reopen Gap Project first and start the packet against uninvoiced award dollars.",
            href: "/projects/project-gap#project-submittals",
            targetProjectId: "project-gap",
            targetProjectName: "Gap Project",
            tone: "warning",
            priority: 6.2,
            badges: [{ label: "Packets needed", value: 1 }],
          },
        ],
      })
    );
    const action = links.find((link) => link.id === "workspace-create-reimbursement-record");

    expect(action).toBeDefined();
    expect(action?.executeAction?.kind).toBe("create_project_record");
    if (action?.executeAction?.kind === "create_project_record") {
      expect(action.executeAction.projectId).toBe("project-gap");
      expect(action.executeAction.recordType).toBe("submittal");
      expect(action.executeAction.submittalType).toBe("reimbursement");
    }
  });

  it("switches the workspace funding agent into reimbursement-start posture when packets are still missing", () => {
    const links = buildAssistantOperations(
      buildWorkspaceContext({
        headline: "Start reimbursement packets",
        detail: "A project has committed awards but no reimbursement packet started yet.",
        counts: {
          projectFundingNeedAnchorProjects: 0,
          projectFundingSourcingProjects: 0,
          projectFundingDecisionProjects: 0,
          projectFundingAwardRecordProjects: 0,
          projectFundingReimbursementStartProjects: 1,
          projectFundingReimbursementActiveProjects: 0,
          projectFundingGapProjects: 1,
        },
        nextCommand: {
          key: "start-project-reimbursement-packets",
          title: "Start reimbursement packets",
          detail: "Reopen Gap Project first and start the packet against uninvoiced award dollars.",
          href: "/projects/project-gap#project-submittals",
          targetProjectId: "project-gap",
          targetProjectName: "Gap Project",
          tone: "warning",
          priority: 6.2,
          badges: [{ label: "Packets needed", value: 1 }],
        },
        commandQueue: [
          {
            key: "start-project-reimbursement-packets",
            title: "Start reimbursement packets",
            detail: "Reopen Gap Project first and start the packet against uninvoiced award dollars.",
            href: "/projects/project-gap#project-submittals",
            targetProjectId: "project-gap",
            targetProjectName: "Gap Project",
            tone: "warning",
            priority: 6.2,
            badges: [{ label: "Packets needed", value: 1 }],
          },
        ],
      })
    );
    const action = links.find((link) => link.id === "workspace-funding-agent");

    expect(action?.label).toBe("Review reimbursement packet starts in panel");
    expect(action?.statusLabel).toBe("1 need packet");
  });

  it("switches the workspace funding agent into reimbursement follow-through posture once packets exist", () => {
    const links = buildAssistantOperations(
      buildWorkspaceContext({
        headline: "Advance reimbursement invoicing",
        detail: "A project already has reimbursement work started but invoicing still trails the award stack.",
        counts: {
          projectFundingNeedAnchorProjects: 0,
          projectFundingSourcingProjects: 0,
          projectFundingDecisionProjects: 0,
          projectFundingAwardRecordProjects: 0,
          projectFundingReimbursementStartProjects: 0,
          projectFundingReimbursementActiveProjects: 1,
          projectFundingGapProjects: 1,
        },
        nextCommand: {
          key: "advance-project-reimbursement-invoicing",
          title: "Advance reimbursement invoicing",
          detail: "Reopen Gap Project first and move the existing reimbursement packet through invoicing.",
          href: "/projects/project-gap#project-invoices",
          targetProjectId: "project-gap",
          targetProjectName: "Gap Project",
          tone: "warning",
          priority: 6.3,
          badges: [{ label: "Reimbursement active", value: 1 }],
        },
        commandQueue: [
          {
            key: "advance-project-reimbursement-invoicing",
            title: "Advance reimbursement invoicing",
            detail: "Reopen Gap Project first and move the existing reimbursement packet through invoicing.",
            href: "/projects/project-gap#project-invoices",
            targetProjectId: "project-gap",
            targetProjectName: "Gap Project",
            tone: "warning",
            priority: 6.3,
            badges: [{ label: "Reimbursement active", value: 1 }],
          },
        ],
      })
    );
    const action = links.find((link) => link.id === "workspace-funding-agent");

    expect(action?.label).toBe("Review reimbursement follow-through in panel");
    expect(action?.statusLabel).toBe("1 reimbursement active");
  });

  it("adds a direct workspace reimbursement-lane shortcut when follow-through is active", () => {
    const links = buildAssistantOperations(
      buildWorkspaceContext({
        headline: "Advance reimbursement invoicing",
        detail: "A project already has reimbursement work started but invoicing still trails the award stack.",
        counts: {
          projectFundingNeedAnchorProjects: 0,
          projectFundingSourcingProjects: 0,
          projectFundingDecisionProjects: 0,
          projectFundingAwardRecordProjects: 0,
          projectFundingReimbursementStartProjects: 0,
          projectFundingReimbursementActiveProjects: 1,
          projectFundingGapProjects: 1,
        },
        nextCommand: {
          key: "advance-project-reimbursement-invoicing",
          title: "Advance reimbursement invoicing",
          detail: "Reopen Gap Project first and move the existing reimbursement packet through invoicing.",
          href: "/projects/project-gap#project-invoices",
          targetProjectId: "project-gap",
          targetProjectName: "Gap Project",
          tone: "warning",
          priority: 6.3,
          badges: [{ label: "Reimbursement active", value: 1 }],
        },
        commandQueue: [
          {
            key: "advance-project-reimbursement-invoicing",
            title: "Advance reimbursement invoicing",
            detail: "Reopen Gap Project first and move the existing reimbursement packet through invoicing.",
            href: "/projects/project-gap#project-invoices",
            targetProjectId: "project-gap",
            targetProjectName: "Gap Project",
            tone: "warning",
            priority: 6.3,
            badges: [{ label: "Reimbursement active", value: 1 }],
          },
        ],
      })
    );
    const action = links.find((link) => link.id === "workspace-open-reimbursement-lane");

    expect(action).toBeDefined();
    expect(action?.label).toBe("Open lead reimbursement lane");
    expect(action?.href).toBe("/projects/project-gap#project-invoices");
    expect(action?.statusLabel).toBe("1 reimbursement active");
  });

  it("adds a billing-triage shortcut when reimbursement follow-through is active", () => {
    const links = buildAssistantOperations(
      buildWorkspaceContext({
        headline: "Advance reimbursement invoicing",
        detail: "A project already has reimbursement work started but invoicing still trails the award stack.",
        counts: {
          projectFundingNeedAnchorProjects: 0,
          projectFundingSourcingProjects: 0,
          projectFundingDecisionProjects: 0,
          projectFundingAwardRecordProjects: 0,
          projectFundingReimbursementStartProjects: 0,
          projectFundingReimbursementActiveProjects: 1,
          projectFundingGapProjects: 1,
        },
        nextCommand: {
          key: "advance-project-reimbursement-invoicing",
          title: "Advance reimbursement invoicing",
          detail: "Reopen Gap Project first and move the existing reimbursement packet through invoicing.",
          href: "/projects/project-gap#project-invoices",
          targetProjectId: "project-gap",
          targetProjectName: "Gap Project",
          tone: "warning",
          priority: 6.3,
          badges: [{ label: "Reimbursement active", value: 1 }],
        },
        commandQueue: [
          {
            key: "advance-project-reimbursement-invoicing",
            title: "Advance reimbursement invoicing",
            detail: "Reopen Gap Project first and move the existing reimbursement packet through invoicing.",
            href: "/projects/project-gap#project-invoices",
            targetProjectId: "project-gap",
            targetProjectName: "Gap Project",
            tone: "warning",
            priority: 6.3,
            badges: [{ label: "Reimbursement active", value: 1 }],
          },
        ],
      })
    );
    const action = links.find((link) => link.id === "workspace-open-billing-reimbursement-triage");

    expect(action).toBeDefined();
    expect(action?.label).toBe("Open billing reimbursement triage");
    expect(action?.href).toBe("/billing?workspaceId=workspace-1&projectId=project-gap&linkage=linked");
    expect(action?.statusLabel).toBe("1 reimbursement active");
  });

  it("exposes an exact invoice-to-award relink action when the workspace queue has a safe match", () => {
    const links = buildAssistantOperations(
      buildWorkspaceContext({
        headline: "Relink invoice reimbursement records",
        detail: "A project has an exact invoice-to-award relink ready.",
        counts: {
          projectFundingNeedAnchorProjects: 0,
          projectFundingSourcingProjects: 0,
          projectFundingDecisionProjects: 0,
          projectFundingAwardRecordProjects: 0,
          projectFundingReimbursementStartProjects: 0,
          projectFundingReimbursementActiveProjects: 1,
          projectFundingGapProjects: 0,
        },
        nextCommand: {
          key: "relink-project-invoice-awards",
          title: "Relink invoice reimbursement records",
          detail: "Reopen Gap Project first and attach the exact unlinked invoice to its funding award.",
          href: "/projects/project-gap#project-invoices",
          targetProjectId: "project-gap",
          targetProjectName: "Gap Project",
          targetInvoiceId: "invoice-1",
          targetFundingAwardId: "award-1",
          tone: "warning",
          priority: 6.25,
          badges: [{ label: "Exact relinks", value: 1 }],
        },
        commandQueue: [
          {
            key: "relink-project-invoice-awards",
            title: "Relink invoice reimbursement records",
            detail: "Reopen Gap Project first and attach the exact unlinked invoice to its funding award.",
            href: "/projects/project-gap#project-invoices",
            targetProjectId: "project-gap",
            targetProjectName: "Gap Project",
            targetInvoiceId: "invoice-1",
            targetFundingAwardId: "award-1",
            tone: "warning",
            priority: 6.25,
            badges: [{ label: "Exact relinks", value: 1 }],
          },
        ],
      })
    );
    const action = links.find((link) => link.id === "workspace-link-invoice-award");
    const fundingAgent = links.find((link) => link.id === "workspace-funding-agent");

    expect(action).toBeDefined();
    expect(action?.label).toBe("Link lead invoice to award now");
    expect(action?.href).toBe("/billing?workspaceId=workspace-1&projectId=project-gap&linkage=unlinked&focusInvoiceId=invoice-1");
    expect(action?.executeAction?.kind).toBe("link_billing_invoice_funding_award");
    if (action?.executeAction?.kind === "link_billing_invoice_funding_award") {
      expect(action.executeAction.workspaceId).toBe("workspace-1");
      expect(action.executeAction.invoiceId).toBe("invoice-1");
      expect(action.executeAction.fundingAwardId).toBe("award-1");
    }

    expect(fundingAgent?.label).toBe("Review invoice award relinks in panel");
    expect(fundingAgent?.statusLabel).toBe("1 relink ready");
  });
});
