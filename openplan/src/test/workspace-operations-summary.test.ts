import { describe, expect, it } from "vitest";
import { buildWorkspaceOperationsSummaryFromSourceRows } from "@/lib/operations/workspace-summary";

describe("workspace operations summary", () => {
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
    expect(summary.counts.projectFundingGapProjects).toBe(1);
    expect(summary.nextCommand?.key).toBe("anchor-project-funding-needs");
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
    expect(summary.counts.projectFundingGapProjects).toBe(1);
    expect(summary.nextCommand?.key).toBe("close-project-funding-gaps");
    expect(summary.nextCommand?.targetProjectId).toBe("project-gap");
  });
});
