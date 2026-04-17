import { describe, expect, it } from "vitest";
import {
  isGrantsAwardCommand,
  isGrantsCommand,
  isGrantsDecisionCommand,
  isGrantsModelingCommand,
  isGrantsReimbursementCommand,
  isGrantsSourcingCommand,
  resolveGrantsQueueCalloutCopy,
  resolveRtpFundingFollowThrough,
  resolveWorkspaceCommandHref,
} from "@/lib/operations/grants-links";
import type { WorkspaceCommandQueueItem } from "@/lib/operations/workspace-summary";

function buildCommand(overrides: Partial<WorkspaceCommandQueueItem>): WorkspaceCommandQueueItem {
  return {
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
    ...overrides,
  };
}

describe("grants-links", () => {
  it("treats module-tagged grants commands as shared grants commands", () => {
    expect(
      isGrantsCommand(
        buildCommand({
          key: "anchor-project-funding-needs",
        })
      )
    ).toBe(true);
  });

  it("identifies reimbursement-focused grants commands", () => {
    expect(
      isGrantsReimbursementCommand(
        buildCommand({
          key: "start-project-reimbursement-packets",
          href: "/projects/project-gap#project-invoices",
          targetProjectId: "project-gap",
        })
      )
    ).toBe(true);

    expect(
      isGrantsReimbursementCommand(
        buildCommand({
          key: "anchor-project-funding-needs",
        })
      )
    ).toBe(false);
  });

  it("identifies award-conversion grants commands", () => {
    expect(
      isGrantsAwardCommand(
        buildCommand({
          key: "record-awarded-funding",
          targetOpportunityId: "opportunity-award-1",
        })
      )
    ).toBe(true);

    expect(
      isGrantsAwardCommand(
        buildCommand({
          key: "advance-project-reimbursement-invoicing",
          targetInvoiceId: "invoice-1",
        })
      )
    ).toBe(false);
  });

  it("identifies opportunity-decision grants commands", () => {
    expect(
      isGrantsDecisionCommand(
        buildCommand({
          key: "funding-windows-closing",
          targetOpportunityId: "opportunity-close-1",
        })
      )
    ).toBe(true);

    expect(
      isGrantsDecisionCommand(
        buildCommand({
          key: "resolve-overdue-funding-decisions",
          targetOpportunityId: "opportunity-overdue-1",
        })
      )
    ).toBe(true);

    expect(
      isGrantsDecisionCommand(
        buildCommand({
          key: "record-awarded-funding",
          targetOpportunityId: "opportunity-award-1",
        })
      )
    ).toBe(false);
  });

  it("treats comparison-backed report posture as a grants-relevant modeling command", () => {
    const modelingCommand = buildCommand({
      key: "review-comparison-backed-reports",
      moduleKey: "reports" as WorkspaceCommandQueueItem["moduleKey"],
      moduleLabel: "Reports",
      href: "/reports?posture=comparison-backed",
      title: "Review comparison-backed packet posture",
      detail:
        "1 report carries saved comparison context that can support grant planning language or prioritization framing while shaping refresh and narrative choices.",
      badges: [{ label: "Comparison-backed", value: 1 }],
    });

    expect(isGrantsCommand(modelingCommand)).toBe(true);
    expect(isGrantsModelingCommand(modelingCommand)).toBe(true);
    expect(resolveWorkspaceCommandHref(modelingCommand)).toBe("/reports?posture=comparison-backed");
  });

  it("identifies sourcing and gap grants commands", () => {
    expect(
      isGrantsSourcingCommand(
        buildCommand({
          key: "source-project-funding-opportunities",
          targetProjectId: "project-source-1",
        })
      )
    ).toBe(true);

    expect(
      isGrantsSourcingCommand(
        buildCommand({
          key: "close-project-funding-gaps",
          targetProjectId: "project-gap-1",
        })
      )
    ).toBe(true);

    expect(
      isGrantsSourcingCommand(
        buildCommand({
          key: "record-awarded-funding",
          targetOpportunityId: "opportunity-award-1",
        })
      )
    ).toBe(false);
  });

  it("keeps grants queue callout copy coherent across lane variants", () => {
    expect(resolveGrantsQueueCalloutCopy("workspace", buildCommand({ tone: "warning" }))).toEqual({
      title: "Lead workspace grant command",
      actionLabel: "Open next grants action",
      badgeLabel: "Next",
    });
    expect(resolveGrantsQueueCalloutCopy("sourcing", buildCommand({ tone: "warning" }))).toEqual({
      title: "Lead sourcing and gap command from workspace queue",
      actionLabel: "Open sourcing lane",
      badgeLabel: "Next",
    });
    expect(resolveGrantsQueueCalloutCopy("reimbursement", buildCommand({ tone: "info" }))).toEqual({
      title: "Lead reimbursement command from workspace queue",
      actionLabel: "Open reimbursement follow-through",
      badgeLabel: "Queue",
    });
    expect(resolveGrantsQueueCalloutCopy("award", buildCommand({ tone: "warning" }))).toEqual({
      title: "Lead award conversion command from workspace queue",
      actionLabel: "Open award conversion",
      badgeLabel: "Next",
    });
    expect(resolveGrantsQueueCalloutCopy("decision", buildCommand({ tone: "success" }))).toEqual({
      title: "Lead opportunity decision command from workspace queue",
      actionLabel: "Open opportunity decision",
      badgeLabel: "Queue",
    });
  });

  it("names the specific lead overdue opportunity in the decision callout copy when available", () => {
    expect(
      resolveGrantsQueueCalloutCopy(
        "decision",
        buildCommand({
          key: "resolve-overdue-funding-decisions",
          tone: "warning",
          targetOpportunityId: "opportunity-overdue-1",
          targetOpportunityTitle: "ATP Cycle 8",
        })
      )
    ).toEqual({
      title: "Lead overdue opportunity decision command from workspace queue: ATP Cycle 8",
      actionLabel: "Open overdue decision lane",
      badgeLabel: "Next",
    });
  });

  it("falls back to the overdue callout title without a lead opportunity title", () => {
    expect(
      resolveGrantsQueueCalloutCopy(
        "decision",
        buildCommand({
          key: "resolve-overdue-funding-decisions",
          tone: "warning",
        })
      )
    ).toEqual({
      title: "Lead overdue opportunity decision command from workspace queue",
      actionLabel: "Open overdue decision lane",
      badgeLabel: "Next",
    });
  });

  it("names the lead closing opportunity in the decision callout copy when available", () => {
    expect(
      resolveGrantsQueueCalloutCopy(
        "decision",
        buildCommand({
          key: "funding-windows-closing",
          tone: "warning",
          targetOpportunityId: "opportunity-closing-1",
          targetOpportunityTitle: "ATP Cycle 8",
        })
      )
    ).toEqual({
      title: "Lead opportunity decision command from workspace queue: ATP Cycle 8",
      actionLabel: "Open opportunity decision",
      badgeLabel: "Next",
    });
  });

  it("names the lead funding-decision opportunity in the decision callout copy when available", () => {
    expect(
      resolveGrantsQueueCalloutCopy(
        "decision",
        buildCommand({
          key: "advance-project-funding-decisions",
          tone: "warning",
          targetOpportunityId: "opportunity-decision-1",
          targetOpportunityTitle: "ATP Cycle 8",
        })
      )
    ).toEqual({
      title: "Lead opportunity decision command from workspace queue: ATP Cycle 8",
      actionLabel: "Open opportunity decision",
      badgeLabel: "Next",
    });
  });

  it("names the lead awarded opportunity in the award callout copy when available", () => {
    expect(
      resolveGrantsQueueCalloutCopy(
        "award",
        buildCommand({
          key: "record-awarded-funding",
          tone: "warning",
          targetOpportunityId: "opportunity-award-1",
          targetOpportunityTitle: "ATP Cycle 8",
        })
      )
    ).toEqual({
      title: "Lead award conversion command from workspace queue: ATP Cycle 8",
      actionLabel: "Open award conversion",
      badgeLabel: "Next",
    });
  });

  it("falls back to the plain decision callout copy without a lead opportunity title", () => {
    expect(
      resolveGrantsQueueCalloutCopy(
        "decision",
        buildCommand({
          key: "advance-project-funding-decisions",
          tone: "warning",
        })
      )
    ).toEqual({
      title: "Lead opportunity decision command from workspace queue",
      actionLabel: "Open opportunity decision",
      badgeLabel: "Next",
    });
  });

  it("routes sourcing commands into the grants opportunity creator lane", () => {
    expect(
      resolveWorkspaceCommandHref(
        buildCommand({
          key: "source-project-funding-opportunities",
          targetProjectId: "project-source-1",
        })
      )
    ).toBe("/grants?focusProjectId=project-source-1#grants-opportunity-creator");
  });

  it("routes funding-gap commands into the grants gap lane", () => {
    expect(
      resolveWorkspaceCommandHref(
        buildCommand({
          key: "close-project-funding-gaps",
          targetProjectId: "project-gap-1",
        })
      )
    ).toBe("/grants?focusProjectId=project-gap-1#grants-gap-resolution-lane");
  });

  it("routes opportunity-decision commands into the focused opportunity lane", () => {
    expect(
      resolveWorkspaceCommandHref(
        buildCommand({
          key: "funding-windows-closing",
          targetOpportunityId: "opportunity-close-1",
        })
      )
    ).toBe("/grants?focusOpportunityId=opportunity-close-1#funding-opportunity-opportunity-close-1");
  });

  it("routes overdue-decision commands into the focused opportunity lane", () => {
    expect(
      resolveWorkspaceCommandHref(
        buildCommand({
          key: "resolve-overdue-funding-decisions",
          targetOpportunityId: "opportunity-overdue-1",
        })
      )
    ).toBe("/grants?focusOpportunityId=opportunity-overdue-1#funding-opportunity-opportunity-overdue-1");
  });

  it("routes award-conversion commands into the grants award conversion composer", () => {
    expect(
      resolveWorkspaceCommandHref(
        buildCommand({
          key: "record-awarded-funding",
          targetOpportunityId: "opportunity-award-1",
        })
      )
    ).toBe("/grants?focusOpportunityId=opportunity-award-1#grants-award-conversion-composer");
  });

  it("routes reimbursement-start commands into the grants reimbursement composer", () => {
    expect(
      resolveWorkspaceCommandHref(
        buildCommand({
          key: "start-project-reimbursement-packets",
          href: "/projects/project-gap#project-invoices",
          targetProjectId: "project-gap",
        })
      )
    ).toBe("/grants?focusProjectId=project-gap#grants-reimbursement-composer");
  });

  it("routes invoice follow-through commands into the grants reimbursement triage lane", () => {
    expect(
      resolveWorkspaceCommandHref(
        buildCommand({
          key: "advance-project-reimbursement-invoicing",
          href: "/projects/project-gap#project-invoices",
          targetProjectId: "project-gap",
          targetInvoiceId: "invoice-1",
        })
      )
    ).toBe("/grants?focusInvoiceId=invoice-1#grants-reimbursement-triage");
  });

  it("maps RTP funding review signals back into the right grants follow-through lane", () => {
    const gapSnapshot = {
      capturedAt: null,
      latestSourceUpdatedAt: null,
      linkedProjectCount: 4,
      trackedProjectCount: 4,
      fundedProjectCount: 1,
      likelyCoveredProjectCount: 1,
      gapProjectCount: 2,
      committedFundingAmount: 500000,
      likelyFundingAmount: 200000,
      totalPotentialFundingAmount: 700000,
      unfundedAfterLikelyAmount: 300000,
      paidReimbursementAmount: 0,
      outstandingReimbursementAmount: 0,
      uninvoicedAwardAmount: 0,
      awardRiskCount: 0,
      label: "Partially funded",
      reason: "Gap remains.",
      reimbursementLabel: "Reimbursement posture unknown",
      reimbursementReason: "No reimbursement records.",
    };
    expect(resolveRtpFundingFollowThrough(gapSnapshot)).toEqual({
      href: "/grants#grants-gap-resolution-lane",
      title: "Linked RTP projects still carry uncovered funding gaps.",
      actionLabel: "Open gap resolution",
    });

    const reimbursementSnapshot = {
      capturedAt: null,
      latestSourceUpdatedAt: null,
      linkedProjectCount: 2,
      trackedProjectCount: 2,
      fundedProjectCount: 2,
      likelyCoveredProjectCount: 0,
      gapProjectCount: 0,
      committedFundingAmount: 500000,
      likelyFundingAmount: 0,
      totalPotentialFundingAmount: 500000,
      unfundedAfterLikelyAmount: 0,
      paidReimbursementAmount: 100000,
      outstandingReimbursementAmount: 50000,
      uninvoicedAwardAmount: 0,
      awardRiskCount: 0,
      label: "Funded",
      reason: "Committed awards meet the need.",
      reimbursementLabel: "Reimbursement in flight",
      reimbursementReason: "Outstanding reimbursement remains.",
    };
    expect(resolveRtpFundingFollowThrough(reimbursementSnapshot)).toEqual({
      href: "/grants#grants-reimbursement-triage",
      title: "Reimbursement follow-through is still active across linked RTP projects.",
      actionLabel: "Open reimbursement triage",
    });
  });
});
