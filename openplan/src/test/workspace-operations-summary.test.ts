import { describe, expect, it } from "vitest";
import { buildWorkspaceOperationsSummaryFromSourceRows } from "@/lib/operations/workspace-summary";

describe("workspace operations summary", () => {
  it("treats report write-back timestamps as source freshness for RTP packets", () => {
    const summary = buildWorkspaceOperationsSummaryFromSourceRows({
      projects: [],
      plans: [],
      programs: [],
      reports: [
        {
          id: "report-rtp",
          title: "RTP board packet",
          status: "generated",
          latest_artifact_kind: "html",
          generated_at: "2026-04-12T10:00:00.000Z",
          updated_at: "2026-04-14T10:00:00.000Z",
          metadata_json: {
            sourceContext: {
              rtpCycleUpdatedAt: "2026-04-11T10:00:00.000Z",
            },
          },
        },
      ],
      fundingOpportunities: [],
      now: new Date("2026-04-14T12:00:00.000Z"),
    });

    expect(summary.counts.reportRefreshRecommended).toBe(1);
    expect(summary.nextCommand?.key).toBe("refresh-report-packets");
    expect(summary.nextCommand?.href).toBe("/reports/report-rtp#drift-since-generation");
  });

  it("prioritizes missing funding-need anchors before measurable funding gaps", () => {
    const summary = buildWorkspaceOperationsSummaryFromSourceRows({
      projects: [
        {
          id: "project-anchor",
          name: "Anchor Needed Project",
          status: "active",
          delivery_phase: "scoping",
          updated_at: "2026-04-11T18:00:00.000Z",
        },
        {
          id: "project-gap",
          name: "Gap Project",
          status: "active",
          delivery_phase: "delivery",
          updated_at: "2026-04-11T17:00:00.000Z",
        },
      ],
      plans: [],
      programs: [],
      reports: [],
      fundingOpportunities: [
        {
          id: "opp-anchor-1",
          title: "Anchor opportunity",
          opportunity_status: "open",
          decision_state: "pursue",
          expected_award_amount: 250000,
          closes_at: "2026-05-10T00:00:00.000Z",
          decision_due_at: null,
          program_id: null,
          project_id: "project-anchor",
          updated_at: "2026-04-11T18:00:00.000Z",
        },
        {
          id: "opp-gap-1",
          title: "Gap opportunity",
          opportunity_status: "open",
          decision_state: "pursue",
          expected_award_amount: 100000,
          closes_at: "2026-05-12T00:00:00.000Z",
          decision_due_at: null,
          program_id: null,
          project_id: "project-gap",
          updated_at: "2026-04-11T17:00:00.000Z",
        },
      ],
      projectFundingProfiles: [
        {
          project_id: "project-gap",
          funding_need_amount: 500000,
          local_match_need_amount: 50000,
        },
      ],
      now: new Date("2026-04-11T12:00:00.000Z"),
    });

    expect(summary.counts.projectFundingNeedAnchorProjects).toBe(1);
    expect(summary.counts.projectFundingDecisionProjects).toBe(0);
    expect(summary.counts.projectFundingAwardRecordProjects).toBe(0);
    expect(summary.counts.projectFundingGapProjects).toBe(1);
    expect(summary.nextCommand?.key).toBe("anchor-project-funding-needs");
    expect(summary.nextCommand?.moduleKey).toBe("grants");
    expect(summary.nextCommand?.moduleLabel).toBe("Grants");
    expect(summary.nextCommand?.targetProjectId).toBe("project-anchor");
  });

  it("surfaces measurable funding gaps when anchors already exist", () => {
    const summary = buildWorkspaceOperationsSummaryFromSourceRows({
      projects: [
        {
          id: "project-gap",
          name: "Gap Project",
          status: "active",
          delivery_phase: "delivery",
          updated_at: "2026-04-11T17:00:00.000Z",
        },
      ],
      plans: [],
      programs: [],
      reports: [],
      fundingOpportunities: [],
      projectFundingProfiles: [
        {
          project_id: "project-gap",
          funding_need_amount: 500000,
          local_match_need_amount: 50000,
        },
      ],
      now: new Date("2026-04-11T12:00:00.000Z"),
    });

    expect(summary.counts.projectFundingNeedAnchorProjects).toBe(0);
    expect(summary.counts.projectFundingSourcingProjects).toBe(1);
    expect(summary.counts.projectFundingDecisionProjects).toBe(0);
    expect(summary.counts.projectFundingAwardRecordProjects).toBe(0);
    expect(summary.counts.projectFundingGapProjects).toBe(0);
    expect(summary.nextCommand?.key).toBe("source-project-funding-opportunities");
    expect(summary.nextCommand?.targetProjectId).toBe("project-gap");
  });

  it("surfaces pursue-decision pressure before true funding gaps when opportunities exist but none are pursued", () => {
    const summary = buildWorkspaceOperationsSummaryFromSourceRows({
      projects: [
        {
          id: "project-gap",
          name: "Gap Project",
          status: "active",
          delivery_phase: "delivery",
          updated_at: "2026-04-11T17:00:00.000Z",
        },
      ],
      plans: [],
      programs: [],
      reports: [],
      fundingOpportunities: [
        {
          id: "opp-gap-1",
          title: "ATP Cycle 8",
          opportunity_status: "open",
          decision_state: "monitor",
          expected_award_amount: 100000,
          closes_at: "2026-05-12T00:00:00.000Z",
          decision_due_at: null,
          program_id: null,
          project_id: "project-gap",
          updated_at: "2026-04-11T17:00:00.000Z",
        },
      ],
      projectFundingProfiles: [
        {
          project_id: "project-gap",
          funding_need_amount: 500000,
          local_match_need_amount: 50000,
        },
      ],
      now: new Date("2026-04-11T12:00:00.000Z"),
    });

    expect(summary.counts.projectFundingNeedAnchorProjects).toBe(0);
    expect(summary.counts.projectFundingSourcingProjects).toBe(0);
    expect(summary.counts.projectFundingDecisionProjects).toBe(1);
    expect(summary.counts.projectFundingAwardRecordProjects).toBe(0);
    expect(summary.counts.projectFundingGapProjects).toBe(1);
    expect(summary.nextCommand?.key).toBe("advance-project-funding-decisions");
    expect(summary.nextCommand?.targetProjectId).toBe("project-gap");
  });

  it("prefers decision-ready modeling support when funding decisions share the same timing posture", () => {
    const summary = buildWorkspaceOperationsSummaryFromSourceRows({
      projects: [
        {
          id: "project-modeled",
          name: "Modeled Project",
          status: "active",
          delivery_phase: "delivery",
          updated_at: "2026-04-11T17:00:00.000Z",
        },
        {
          id: "project-unmodeled",
          name: "Unmodeled Project",
          status: "active",
          delivery_phase: "delivery",
          updated_at: "2026-04-11T16:00:00.000Z",
        },
      ],
      plans: [],
      programs: [],
      reports: [
        {
          id: "report-modeled",
          project_id: "project-modeled",
          title: "Mobility Grant Packet",
          status: "generated",
          latest_artifact_kind: "html",
          generated_at: "2026-04-11T17:00:00.000Z",
          updated_at: "2026-04-11T17:00:00.000Z",
          metadata_json: {
            sourceContext: {
              scenarioSetLinks: [
                {
                  comparisonSnapshots: [
                    {
                      status: "ready",
                      indicatorDeltaCount: 3,
                      updatedAt: "2026-04-11T16:45:00.000Z",
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
      fundingOpportunities: [
        {
          id: "opp-modeled-1",
          title: "ATP Cycle 8",
          opportunity_status: "open",
          decision_state: "monitor",
          expected_award_amount: 100000,
          closes_at: "2026-05-12T00:00:00.000Z",
          decision_due_at: null,
          program_id: null,
          project_id: "project-modeled",
          updated_at: "2026-04-11T17:00:00.000Z",
        },
        {
          id: "opp-unmodeled-1",
          title: "SB1 Local Partnership",
          opportunity_status: "open",
          decision_state: "monitor",
          expected_award_amount: 100000,
          closes_at: "2026-05-12T00:00:00.000Z",
          decision_due_at: null,
          program_id: null,
          project_id: "project-unmodeled",
          updated_at: "2026-04-11T17:00:00.000Z",
        },
      ],
      projectFundingProfiles: [
        {
          project_id: "project-modeled",
          funding_need_amount: 300000,
          local_match_need_amount: 30000,
        },
        {
          project_id: "project-unmodeled",
          funding_need_amount: 500000,
          local_match_need_amount: 50000,
        },
      ],
      now: new Date("2026-04-11T12:00:00.000Z"),
    });

    const decisionCommand = summary.fullCommandQueue.find(
      (item) => item.key === "advance-project-funding-decisions"
    );

    expect(decisionCommand?.targetProjectId).toBe("project-modeled");
    expect(decisionCommand?.targetOpportunityId).toBe("opp-modeled-1");
    expect(decisionCommand?.targetOpportunityTitle).toBe("ATP Cycle 8");
    expect(decisionCommand?.detail).toContain("Modeling posture for Modeled Project: Appears decision-ready.");
    expect(decisionCommand?.detail).toContain("Recommended next move: Advance to pursue now.");
    expect(decisionCommand?.detail).toContain(
      "Treat it as planning support only, not proof of award likelihood or a replacement for funding-source review."
    );
    expect(decisionCommand?.badges).toContainEqual({
      label: "Modeling",
      value: "Appears decision-ready",
    });
    expect(decisionCommand?.badges).toContainEqual({
      label: "Next move",
      value: "Advance to pursue now",
    });
  });

  it("surfaces awarded opportunities without award records before final gap closure", () => {
    const summary = buildWorkspaceOperationsSummaryFromSourceRows({
      projects: [
        {
          id: "project-gap",
          name: "Gap Project",
          status: "active",
          delivery_phase: "delivery",
          updated_at: "2026-04-11T17:00:00.000Z",
        },
      ],
      plans: [],
      programs: [],
      reports: [],
      fundingOpportunities: [
        {
          id: "opp-gap-1",
          title: "ATP Cycle 8",
          opportunity_status: "awarded",
          decision_state: "pursue",
          expected_award_amount: 250000,
          closes_at: null,
          decision_due_at: null,
          program_id: null,
          project_id: "project-gap",
          updated_at: "2026-04-11T17:00:00.000Z",
        },
      ],
      fundingAwards: [],
      projectFundingProfiles: [
        {
          project_id: "project-gap",
          funding_need_amount: 500000,
          local_match_need_amount: 50000,
        },
      ],
      now: new Date("2026-04-11T12:00:00.000Z"),
    });

    expect(summary.counts.projectFundingDecisionProjects).toBe(0);
    expect(summary.counts.projectFundingAwardRecordProjects).toBe(1);
    expect(summary.counts.projectFundingGapProjects).toBe(1);
    expect(summary.nextCommand?.key).toBe("record-awarded-funding");
    expect(summary.nextCommand?.targetProjectId).toBe("project-gap");
    expect(summary.nextCommand?.targetOpportunityId).toBe("opp-gap-1");
    expect(summary.nextCommand?.targetOpportunityTitle).toBe("ATP Cycle 8");
  });

  it("surfaces reimbursement packet creation before generic funding-gap cleanup", () => {
    const summary = buildWorkspaceOperationsSummaryFromSourceRows({
      projects: [
        {
          id: "project-gap",
          name: "Gap Project",
          status: "active",
          delivery_phase: "delivery",
          updated_at: "2026-04-11T17:00:00.000Z",
        },
      ],
      plans: [],
      programs: [],
      reports: [],
      fundingOpportunities: [
        {
          id: "opp-gap-1",
          title: "Gap opportunity",
          opportunity_status: "awarded",
          decision_state: "pursue",
          expected_award_amount: 100000,
          closes_at: null,
          decision_due_at: null,
          program_id: null,
          project_id: "project-gap",
          updated_at: "2026-04-11T17:00:00.000Z",
        },
      ],
      fundingAwards: [
        {
          id: "award-1",
          project_id: "project-gap",
          funding_opportunity_id: "opp-gap-1",
          title: "Gap award",
          awarded_amount: 100000,
          updated_at: "2026-04-11T17:10:00.000Z",
        },
      ],
      fundingInvoices: [],
      projectSubmittals: [],
      projectFundingProfiles: [
        {
          project_id: "project-gap",
          funding_need_amount: 500000,
          local_match_need_amount: 50000,
        },
      ],
      now: new Date("2026-04-11T12:00:00.000Z"),
    });

    expect(summary.counts.projectFundingReimbursementStartProjects).toBe(1);
    expect(summary.counts.projectFundingReimbursementActiveProjects).toBe(0);
    expect(summary.nextCommand?.key).toBe("start-project-reimbursement-packets");
    expect(summary.nextCommand?.targetProjectId).toBe("project-gap");
    expect(summary.nextCommand?.href).toBe("/projects/project-gap#project-submittals");
  });

  it("surfaces reimbursement invoice follow-through after a packet already exists", () => {
    const summary = buildWorkspaceOperationsSummaryFromSourceRows({
      projects: [
        {
          id: "project-gap",
          name: "Gap Project",
          status: "active",
          delivery_phase: "delivery",
          updated_at: "2026-04-11T17:00:00.000Z",
        },
      ],
      plans: [],
      programs: [],
      reports: [],
      fundingOpportunities: [
        {
          id: "opp-gap-1",
          title: "Gap opportunity",
          opportunity_status: "awarded",
          decision_state: "pursue",
          expected_award_amount: 100000,
          closes_at: null,
          decision_due_at: null,
          program_id: null,
          project_id: "project-gap",
          updated_at: "2026-04-11T17:00:00.000Z",
        },
      ],
      fundingAwards: [
        {
          id: "award-1",
          project_id: "project-gap",
          funding_opportunity_id: "opp-gap-1",
          title: "Gap award",
          awarded_amount: 100000,
          updated_at: "2026-04-11T17:10:00.000Z",
        },
      ],
      fundingInvoices: [],
      projectSubmittals: [
        {
          id: "submittal-1",
          project_id: "project-gap",
          submittal_type: "reimbursement",
          status: "draft",
          updated_at: "2026-04-11T17:20:00.000Z",
        },
      ],
      projectFundingProfiles: [
        {
          project_id: "project-gap",
          funding_need_amount: 500000,
          local_match_need_amount: 50000,
        },
      ],
      now: new Date("2026-04-11T12:00:00.000Z"),
    });

    expect(summary.counts.projectFundingReimbursementStartProjects).toBe(0);
    expect(summary.counts.projectFundingReimbursementActiveProjects).toBe(1);
    expect(summary.nextCommand?.key).toBe("advance-project-reimbursement-invoicing");
    expect(summary.nextCommand?.targetProjectId).toBe("project-gap");
    expect(summary.nextCommand?.href).toBe("/projects/project-gap#project-invoices");
  });

  it("surfaces exact invoice-to-award relinks before generic reimbursement follow-through", () => {
    const summary = buildWorkspaceOperationsSummaryFromSourceRows({
      projects: [
        {
          id: "project-gap",
          name: "Gap Project",
          status: "active",
          delivery_phase: "delivery",
          updated_at: "2026-04-11T17:00:00.000Z",
        },
      ],
      plans: [],
      programs: [],
      reports: [],
      fundingOpportunities: [
        {
          id: "opp-gap-1",
          title: "Gap opportunity",
          opportunity_status: "awarded",
          decision_state: "pursue",
          expected_award_amount: 100000,
          closes_at: null,
          decision_due_at: null,
          program_id: null,
          project_id: "project-gap",
          updated_at: "2026-04-11T17:00:00.000Z",
        },
      ],
      fundingAwards: [
        {
          id: "award-1",
          project_id: "project-gap",
          funding_opportunity_id: "opp-gap-1",
          title: "Gap award",
          awarded_amount: 100000,
          updated_at: "2026-04-11T17:10:00.000Z",
        },
      ],
      fundingInvoices: [
        {
          id: "invoice-1",
          project_id: "project-gap",
          funding_award_id: null,
          amount: 25000,
          retention_percent: null,
          retention_amount: null,
          status: "submitted",
          due_date: "2026-04-01T00:00:00.000Z",
        },
      ],
      projectSubmittals: [
        {
          id: "submittal-1",
          project_id: "project-gap",
          submittal_type: "reimbursement",
          status: "in_review",
          updated_at: "2026-04-11T17:20:00.000Z",
        },
      ],
      projectFundingProfiles: [
        {
          project_id: "project-gap",
          funding_need_amount: 500000,
          local_match_need_amount: 50000,
        },
      ],
      now: new Date("2026-04-11T12:00:00.000Z"),
    });

    expect(summary.nextCommand?.key).toBe("relink-project-invoice-awards");
    expect(summary.nextCommand?.targetProjectId).toBe("project-gap");
    expect(summary.nextCommand?.targetInvoiceId).toBe("invoice-1");
    expect(summary.nextCommand?.targetFundingAwardId).toBe("award-1");
    expect(summary.nextCommand?.href).toBe("/projects/project-gap#project-invoices");
  });

  it("surfaces overdue monitored funding decisions as a focused grants queue command", () => {
    const summary = buildWorkspaceOperationsSummaryFromSourceRows({
      projects: [
        {
          id: "project-overdue",
          name: "Overdue Project",
          status: "active",
          delivery_phase: "delivery",
          updated_at: "2026-04-11T17:00:00.000Z",
        },
      ],
      plans: [],
      programs: [],
      reports: [],
      fundingOpportunities: [
        {
          id: "opp-overdue-older",
          title: "ATP Cycle 8",
          opportunity_status: "open",
          decision_state: "monitor",
          expected_award_amount: 100000,
          closes_at: "2026-05-20T00:00:00.000Z",
          decision_due_at: "2026-04-01T00:00:00.000Z",
          program_id: null,
          project_id: "project-overdue",
          updated_at: "2026-04-11T17:00:00.000Z",
        },
        {
          id: "opp-overdue-newer",
          title: "SB1 Local Partnership",
          opportunity_status: "open",
          decision_state: "monitor",
          expected_award_amount: 100000,
          closes_at: "2026-05-25T00:00:00.000Z",
          decision_due_at: "2026-04-10T00:00:00.000Z",
          program_id: null,
          project_id: "project-overdue",
          updated_at: "2026-04-11T17:00:00.000Z",
        },
      ],
      now: new Date("2026-04-16T12:00:00.000Z"),
    });

    expect(summary.counts.overdueDecisionFundingOpportunities).toBe(2);

    const overdueCommand = summary.fullCommandQueue.find(
      (item) => item.key === "resolve-overdue-funding-decisions"
    );
    expect(overdueCommand).toBeDefined();
    expect(overdueCommand?.moduleKey).toBe("grants");
    expect(overdueCommand?.targetOpportunityId).toBe("opp-overdue-older");
    expect(overdueCommand?.targetOpportunityTitle).toBe("ATP Cycle 8");
    expect(overdueCommand?.href).toBe(
      "/grants?focusOpportunityId=opp-overdue-older#funding-opportunity-opp-overdue-older"
    );
    expect(overdueCommand?.detail).toContain("past their decision deadline");
  });

  it("carries the lead closing opportunity title on the funding-windows-closing queue item", () => {
    const summary = buildWorkspaceOperationsSummaryFromSourceRows({
      projects: [
        {
          id: "project-closing",
          name: "Closing Project",
          status: "active",
          delivery_phase: "delivery",
          updated_at: "2026-04-11T17:00:00.000Z",
        },
      ],
      plans: [],
      programs: [],
      reports: [],
      fundingOpportunities: [
        {
          id: "opp-closing-first",
          title: "ATP Cycle 8",
          opportunity_status: "open",
          decision_state: "pursue",
          expected_award_amount: 100000,
          closes_at: "2026-04-20T00:00:00.000Z",
          decision_due_at: null,
          program_id: null,
          project_id: "project-closing",
          updated_at: "2026-04-11T17:00:00.000Z",
        },
        {
          id: "opp-closing-later",
          title: "SB1 Local Partnership",
          opportunity_status: "open",
          decision_state: "pursue",
          expected_award_amount: 100000,
          closes_at: "2026-04-25T00:00:00.000Z",
          decision_due_at: null,
          program_id: null,
          project_id: "project-closing",
          updated_at: "2026-04-11T17:00:00.000Z",
        },
      ],
      now: new Date("2026-04-16T12:00:00.000Z"),
    });

    const closingCommand = summary.fullCommandQueue.find((item) => item.key === "funding-windows-closing");
    expect(closingCommand).toBeDefined();
    expect(closingCommand?.targetOpportunityId).toBe("opp-closing-first");
    expect(closingCommand?.targetOpportunityTitle).toBe("ATP Cycle 8");
  });

  it("surfaces measurable funding gaps after sourcing exists", () => {
    const summary = buildWorkspaceOperationsSummaryFromSourceRows({
      projects: [
        {
          id: "project-gap",
          name: "Gap Project",
          status: "active",
          delivery_phase: "delivery",
          updated_at: "2026-04-11T17:00:00.000Z",
        },
      ],
      plans: [],
      programs: [],
      reports: [],
      fundingOpportunities: [
        {
          id: "opp-gap-1",
          title: "Gap opportunity",
          opportunity_status: "open",
          decision_state: "pursue",
          expected_award_amount: 100000,
          closes_at: "2026-05-12T00:00:00.000Z",
          decision_due_at: null,
          program_id: null,
          project_id: "project-gap",
          updated_at: "2026-04-11T17:00:00.000Z",
        },
      ],
      projectFundingProfiles: [
        {
          project_id: "project-gap",
          funding_need_amount: 500000,
          local_match_need_amount: 50000,
        },
      ],
      now: new Date("2026-04-11T12:00:00.000Z"),
    });

    expect(summary.counts.projectFundingNeedAnchorProjects).toBe(0);
    expect(summary.counts.projectFundingSourcingProjects).toBe(0);
    expect(summary.counts.projectFundingDecisionProjects).toBe(0);
    expect(summary.counts.projectFundingAwardRecordProjects).toBe(0);
    expect(summary.counts.projectFundingGapProjects).toBe(1);
    expect(summary.nextCommand?.key).toBe("close-project-funding-gaps");
    expect(summary.nextCommand?.targetProjectId).toBe("project-gap");
  });
});

/**
 * The Grants queue reads as plain words a planner can act on.
 *
 * It used to say "1 project funding lane has linked grant opportunities" and
 * "1 project reimbursement lane has an exact invoice-to-award relink". A planner
 * reads a lane as part of a road; the thing being counted is projects. These
 * pin the sentence for one project and for several, so a singular or plural
 * slip, or the old word coming back, fails here.
 */
describe("the Grants queue counts projects in plain words", () => {
  const NOW = new Date("2026-04-11T12:00:00.000Z");

  function projectRows(count: number) {
    return Array.from({ length: count }, (_, index) => ({
      id: `project-${index + 1}`,
      name: `Project ${index + 1}`,
      status: "active",
      delivery_phase: "delivery",
      updated_at: `2026-04-11T1${index}:00:00.000Z`,
    }));
  }

  function fundingTargetDetail(count: number) {
    const summary = buildWorkspaceOperationsSummaryFromSourceRows({
      projects: projectRows(count),
      plans: [],
      programs: [],
      reports: [],
      fundingOpportunities: projectRows(count).map((project, index) => ({
        id: `opp-${index + 1}`,
        title: `Opportunity ${index + 1}`,
        opportunity_status: "open",
        decision_state: "pursue",
        expected_award_amount: 100000,
        closes_at: "2026-06-10T00:00:00.000Z",
        decision_due_at: null,
        program_id: null,
        project_id: project.id,
        updated_at: "2026-04-11T09:00:00.000Z",
      })),
      now: NOW,
    });
    return summary.commandQueue.find((item) => item.key === "anchor-project-funding-needs");
  }

  function invoiceLinkDetail(count: number) {
    const projects = projectRows(count);
    const summary = buildWorkspaceOperationsSummaryFromSourceRows({
      projects,
      plans: [],
      programs: [],
      reports: [],
      fundingOpportunities: [],
      fundingAwards: projects.map((project, index) => ({
        id: `award-${index + 1}`,
        project_id: project.id,
        funding_opportunity_id: null,
        title: `Award ${index + 1}`,
        awarded_amount: 100000,
        updated_at: "2026-04-11T09:00:00.000Z",
      })),
      fundingInvoices: projects.map((project, index) => ({
        id: `invoice-${index + 1}`,
        project_id: project.id,
        funding_award_id: null,
        amount: 25000,
        retention_percent: null,
        retention_amount: null,
        status: "submitted",
        due_date: "2026-05-01T00:00:00.000Z",
      })),
      projectFundingProfiles: projects.map((project) => ({
        project_id: project.id,
        funding_need_amount: 500000,
        local_match_need_amount: 50000,
      })),
      now: NOW,
    });
    return summary.commandQueue.find((item) => item.key === "relink-project-invoice-awards");
  }

  it("says how many projects still need a funding target, for one and for several", () => {
    const one = fundingTargetDetail(1);
    expect(one?.detail).toBe(
      "1 project has grant opportunities but no funding target, so the funding gap cannot be measured. Start with Project 1."
    );
    expect(one?.badges?.[0]?.label).toBe("No funding target");

    const several = fundingTargetDetail(3);
    expect(several?.detail).toMatch(
      /^3 projects have grant opportunities but no funding target, so the funding gap cannot be measured\. Start with Project \d\.$/
    );
  });

  it("says how many projects have an invoice ready to link to their award, for one and for several", () => {
    const one = invoiceLinkDetail(1);
    expect(one?.detail).toBe(
      "1 project has an invoice that can be linked to its funding award. Start with Project 1: link its invoice to Award 1."
    );
    // A record id is not something a planner can read or search for.
    expect(one?.detail).not.toContain("invoice-1");

    const several = invoiceLinkDetail(2);
    expect(several?.detail).toMatch(
      /^2 projects have an invoice that can be linked to their funding award\. Start with Project \d: link its invoice to Award \d\.$/
    );
  });

  it("does not call a project a lane", () => {
    for (const item of [fundingTargetDetail(1), fundingTargetDetail(2), invoiceLinkDetail(1), invoiceLinkDetail(2)]) {
      expect(item, "the queue item was not produced").toBeDefined();
      expect(item?.detail).not.toMatch(/\blanes?\b/i);
    }
  });
});
