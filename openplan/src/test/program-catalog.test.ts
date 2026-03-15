import { describe, expect, it } from "vitest";
import { buildProgramReadiness, buildProgramWorkflowSummary } from "@/lib/programs/catalog";

describe("program readiness helpers", () => {
  it("marks a package ready when metadata and linked evidence are present", () => {
    expect(
      buildProgramReadiness({
        cycleName: "2027 RTIP",
        hasProject: true,
        planCount: 2,
        reportCount: 1,
        engagementCampaignCount: 1,
        sponsorAgency: "Nevada County Transportation Commission",
        fiscalYearStart: 2027,
        fiscalYearEnd: 2030,
        nominationDueAt: "2026-06-01T17:00:00.000Z",
        adoptionTargetAt: "2026-09-01T17:00:00.000Z",
      })
    ).toMatchObject({
      ready: true,
      status: "ready",
      label: "Package basis ready",
      readyCheckCount: 8,
      missingCheckCount: 0,
    });
  });

  it("surfaces the first missing programming gap without inventing a score", () => {
    expect(
      buildProgramReadiness({
        cycleName: "",
        hasProject: false,
        planCount: 0,
        reportCount: 0,
        engagementCampaignCount: 0,
        sponsorAgency: null,
        fiscalYearStart: null,
        fiscalYearEnd: null,
        nominationDueAt: null,
        adoptionTargetAt: null,
      })
    ).toMatchObject({
      ready: false,
      status: "incomplete",
      label: "Needs setup",
      reason: "Name the programming cycle or package lane.",
      missingCheckCount: 8,
    });
  });

  it("builds workflow cues for a submitted package", () => {
    const readiness = buildProgramReadiness({
      cycleName: "2027 RTIP",
      hasProject: true,
      planCount: 2,
      reportCount: 1,
      engagementCampaignCount: 1,
      sponsorAgency: "Nevada County Transportation Commission",
      fiscalYearStart: 2027,
      fiscalYearEnd: 2030,
      nominationDueAt: "2026-06-01T17:00:00.000Z",
      adoptionTargetAt: "2026-09-01T17:00:00.000Z",
    });

    expect(
      buildProgramWorkflowSummary({
        programStatus: "submitted",
        readiness,
        planCount: 2,
        reportCount: 1,
        generatedReportCount: 1,
        engagementCampaignCount: 1,
        approvedEngagementItemCount: 3,
        pendingEngagementItemCount: 1,
      })
    ).toMatchObject({
      label: "Awaiting programming action",
      packageLabel: "Submission logged",
      packageTone: "info",
    });
  });
});
