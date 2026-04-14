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
    expect(summary.nextCommand?.moduleLabel).toBe("Grants OS");
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
          updated_at: "2026-04-11T17:15:00.000Z",
        },
      ],
      projectSubmittals: [
        {
          id: "submittal-1",
          project_id: "project-gap",
          submittal_type: "reimbursement",
          status: "in_review",
          title: "Initial reimbursement packet",
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
