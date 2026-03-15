import { describe, expect, it } from "vitest";
import { buildPlanReadiness } from "@/lib/plans/catalog";

describe("plan readiness helpers", () => {
  it("marks the plan foundation ready when all explicit checks are present", () => {
    expect(
      buildPlanReadiness({
        hasProject: true,
        scenarioCount: 2,
        engagementCampaignCount: 1,
        reportCount: 1,
        geographyLabel: "Downtown core",
        horizonYear: 2035,
      })
    ).toMatchObject({
      ready: true,
      status: "ready",
      label: "Foundation ready",
      readyCheckCount: 6,
      missingCheckCount: 0,
    });
  });

  it("explains the first missing readiness basis without inventing a score", () => {
    expect(
      buildPlanReadiness({
        hasProject: false,
        scenarioCount: 0,
        engagementCampaignCount: 0,
        reportCount: 0,
        geographyLabel: null,
        horizonYear: null,
      })
    ).toMatchObject({
      ready: false,
      status: "incomplete",
      label: "Needs setup",
      reason: "Attach a primary or related project record.",
      readyCheckCount: 0,
      missingCheckCount: 6,
    });
  });
});
