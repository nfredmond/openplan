import { describe, expect, it } from "vitest";
import { buildWorkspaceOperationsSummaryFromSourceRows } from "@/lib/operations/workspace-summary";

/**
 * The workspace summary reads plan rows but never reads `plan_links`, scenario
 * sets, or engagement campaigns, so it cannot see the three artifact-linkage
 * checks `buildPlanReadiness` also grades. Those three used to be passed in as
 * literal zeros and read back as measurements, which made every plan in every
 * workspace count as needing setup forever. These tests pin the two halves of
 * the fix: a complete plan record clears, and an incomplete one still does not.
 */

const COMPLETE_PLAN = {
  id: "plan-complete",
  title: "Downtown Corridor Plan",
  status: "active",
  geography_label: "Selected planning area",
  horizon_year: 2050,
  project_id: "project-1",
  updated_at: "2026-04-12T18:00:00.000Z",
};

const ANCHOR_PROJECT = {
  id: "project-1",
  name: "Corridor Delivery Project",
  status: "active",
  delivery_phase: "scoping",
  updated_at: "2026-04-12T17:00:00.000Z",
};

describe("workspace plan setup count", () => {
  it("stops counting a plan that has a project, a geography label, and a horizon year", () => {
    const summary = buildWorkspaceOperationsSummaryFromSourceRows({
      projects: [ANCHOR_PROJECT],
      plans: [COMPLETE_PLAN],
      programs: [],
      reports: [],
      fundingOpportunities: [],
      now: new Date("2026-04-14T12:00:00.000Z"),
    });

    expect(summary.counts.plans).toBe(1);
    expect(summary.counts.plansNeedingSetup).toBe(0);
    expect(summary.fullCommandQueue.map((item) => item.key)).not.toContain("tighten-plan-foundations");
  });

  it("lets the command queue reach a clear posture once the only plan record is complete", () => {
    const summary = buildWorkspaceOperationsSummaryFromSourceRows({
      projects: [ANCHOR_PROJECT],
      plans: [COMPLETE_PLAN],
      programs: [],
      reports: [],
      fundingOpportunities: [],
      now: new Date("2026-04-14T12:00:00.000Z"),
    });

    expect(summary.posture).toBe("stable");
    expect(summary.nextCommand).toBeNull();
    expect(summary.headline).toBe("Workspace command queue is clear");
  });

  it("still counts a plan that is missing a horizon year, and names it in the queue item", () => {
    const summary = buildWorkspaceOperationsSummaryFromSourceRows({
      projects: [ANCHOR_PROJECT],
      plans: [
        COMPLETE_PLAN,
        {
          ...COMPLETE_PLAN,
          id: "plan-no-horizon",
          title: "Countywide Safety Plan",
          horizon_year: null,
          updated_at: "2026-04-12T16:00:00.000Z",
        },
      ],
      programs: [],
      reports: [],
      fundingOpportunities: [],
      now: new Date("2026-04-14T12:00:00.000Z"),
    });

    expect(summary.counts.plansNeedingSetup).toBe(1);

    const planCommand = summary.fullCommandQueue.find((item) => item.key === "tighten-plan-foundations");
    expect(planCommand?.detail).toContain("1 plan record still needs core setup");
    expect(planCommand?.detail).toContain("Countywide Safety Plan");
  });

  it("counts a plan with no project link and no record fields at all", () => {
    const summary = buildWorkspaceOperationsSummaryFromSourceRows({
      projects: [],
      plans: [
        {
          id: "plan-bare",
          title: "Untitled Draft Plan",
          status: "draft",
          geography_label: null,
          horizon_year: null,
          project_id: null,
          updated_at: "2026-04-12T15:00:00.000Z",
        },
      ],
      programs: [],
      reports: [],
      fundingOpportunities: [],
      now: new Date("2026-04-14T12:00:00.000Z"),
    });

    expect(summary.counts.plansNeedingSetup).toBe(1);
  });

  it("never blames a plan for artifacts the workspace read cannot see", () => {
    const summary = buildWorkspaceOperationsSummaryFromSourceRows({
      projects: [ANCHOR_PROJECT],
      plans: [
        {
          ...COMPLETE_PLAN,
          id: "plan-no-geography",
          title: "Regional Access Plan",
          geography_label: null,
        },
      ],
      programs: [],
      reports: [],
      fundingOpportunities: [],
      now: new Date("2026-04-14T12:00:00.000Z"),
    });

    const planCommand = summary.fullCommandQueue.find((item) => item.key === "tighten-plan-foundations");

    // The plan is genuinely incomplete, so it is surfaced — but scenario sets,
    // engagement campaigns, and reports are indeterminate at this scope and must
    // not be presented as absent. Surfacing the unfiltered readiness reason
    // would reintroduce that, because the placeholder zeros make "No linked
    // scenario sets yet." the first missing check.
    expect(planCommand).toBeDefined();
    expect(planCommand?.detail).not.toMatch(/scenario/i);
    expect(planCommand?.detail).not.toMatch(/engagement/i);
    expect(planCommand?.detail).not.toMatch(/report/i);
  });
});
