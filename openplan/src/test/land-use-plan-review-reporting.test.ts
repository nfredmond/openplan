import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { JurisdictionPlanDescriptor } from "@/lib/land-use-plans/contracts";
import { pickPublicAttributes, publicMapIsTooDense } from "@/lib/land-use-plans/public-map";
import {
  buildAdoptionBlockers,
  buildLandUsePlanWorkflow,
  buildPublicDraftBlockers,
  percentComplete,
} from "@/lib/land-use-plans/workflow";
import { formatReportTypeLabel } from "@/lib/reports/catalog";
import { REPORT_ACCESS_COLUMNS } from "@/lib/reports/api";

const descriptor: JurisdictionPlanDescriptor = {
  id: "test-neutral",
  jurisdictionLabel: "Test descriptor",
  authorityScope: "Test authority",
  configured: true,
  verifiedAt: "2026-08-23",
  reviewDueAt: "2027-01-01",
  terminology: { plan: "plan", section: "part", adoptionInstrument: "decision", implementationReport: "status report" },
  planKinds: [{ key: "whole", label: "Whole plan" }],
  requirements: [{ key: "required_part", label: "Required part", applicability: "required", sourceUrls: [] }],
  processSteps: [
    { key: "setup", label: "Setup", required: true, sourceUrls: [] },
    { key: "hearing", label: "Hearing", required: true, adoptionPrerequisite: true, sourceUrls: [] },
    { key: "optional_notice", label: "Optional notice", required: false, sourceUrls: [] },
  ],
  disclosure: "Test only",
  sourceUrls: [],
};

function workflowInput() {
  return {
    descriptor,
    applicableRequirementKeys: ["required_part"],
    completedRequirementKeys: ["required_part"],
    hasDesignation: true,
    hasImplementationAction: true,
    hasStoredGeography: true,
    processRecords: [{ processKey: "hearing", status: "complete" }],
    hasReviewRelease: true,
    hasClosedReviewRelease: true,
    hasAdoptionDecision: true,
    hasPublishedReport: true,
    hasImplementationReport: true,
  };
}

describe("Land Use Plans review and reporting completion", () => {
  it("shows the exact adoption prerequisites beside the adoption control", () => {
    expect(buildAdoptionBlockers({
      requiredPrerequisites: [
        { key: "referrals", label: "Send referrals" },
        { key: "hearing", label: "Record hearing" },
      ],
      processRecords: [{ processKey: "referrals", status: "complete" }],
      hasClosedReviewRelease: false,
    })).toEqual([
      "Complete adoption prerequisites: Record hearing",
      "Close and freeze the exact latest public-review release",
    ]);
  });

  it("shows every public-draft blocker beside the freeze control", () => {
    expect(buildPublicDraftBlockers({
      applicableRequirementKeys: ["land_use", "circulation"],
      completedRequirementKeys: ["land_use"],
      hasDesignation: false,
      hasImplementationAction: false,
      requiredReviewPrerequisiteKeys: ["environmental_review", "hearing"],
      completedProcessKeys: ["hearing"],
      requiresConsultation: true,
      consultationStatus: "in_progress",
    })).toEqual([
      "Complete applicable sections: circulation",
      "Attach a versioned mapped-designation layer",
      "Add at least one implementation action",
      "Complete review prerequisites: environmental_review",
      "Complete or mark the private tribal-consultation record not applicable",
    ]);

    expect(buildPublicDraftBlockers({
      applicableRequirementKeys: ["land_use"],
      completedRequirementKeys: ["land_use"],
      hasDesignation: true,
      hasImplementationAction: true,
      requiredReviewPrerequisiteKeys: ["hearing"],
      completedProcessKeys: ["hearing"],
      requiresConsultation: true,
      consultationStatus: "not_applicable",
    })).toEqual([]);
  });

  it("derives completion from required descriptor records and ignores optional omissions", () => {
    const complete = buildLandUsePlanWorkflow(workflowInput());
    expect(complete.some((step) => step.key === "optional_notice")).toBe(false);
    expect(percentComplete(complete)).toBe(100);

    const missingHearing = buildLandUsePlanWorkflow({ ...workflowInput(), processRecords: [] });
    expect(missingHearing.find((step) => step.key === "hearing")?.complete).toBe(false);
    expect(percentComplete(missingHearing)).toBeLessThan(100);

    const waivedRequiredHearing = buildLandUsePlanWorkflow({
      ...workflowInput(),
      processRecords: [{ processKey: "hearing", status: "not_applicable" }],
    });
    expect(waivedRequiredHearing.find((step) => step.key === "hearing")?.complete).toBe(false);
  });

  it("never exposes an unselected GIS attribute", () => {
    expect(pickPublicAttributes({ designation: "Mixed use", owner: "Private", sensitive: true }, ["designation"]))
      .toEqual({ designation: "Mixed use" });
  });

  it("draws no dense subset at the public-map limit", () => {
    expect(publicMapIsTooDense(500, 500)).toBe(false);
    expect(publicMapIsTooDense(501, 500)).toBe(true);
  });

  it("uses distinct plan report labels", () => {
    expect(formatReportTypeLabel("land_use_plan_packet")).toBe("Land Use Plan Packet");
    expect(formatReportTypeLabel("land_use_plan_implementation_report")).toBe("Land Use Plan Implementation Report");
  });

  it("keeps the land-use-plan target in shared report access", () => {
    expect(REPORT_ACCESS_COLUMNS.split(", ").filter((column) => column === "land_use_plan_id"))
      .toEqual(["land_use_plan_id"]);
  });

  it("qualifies My Work's plan-version relationship", () => {
    const sources = readFileSync(path.resolve(__dirname, "../lib/my-work/sources.ts"), "utf8");
    expect(sources).toContain("land_use_plans!land_use_plan_versions_plan_id_workspace_id_fkey!inner");
  });

  it("puts review, adoption, and finalized GIS integrity in the database", () => {
    const migration = readFileSync(path.resolve(__dirname, "../../supabase/migrations/20260823000007_land_use_plan_review_reporting.sql"), "utf8");
    expect(migration).toContain("Review release must name the exact frozen public-review version hash");
    expect(migration).toContain("Decision must reference the exact latest closed public-review release");
    expect(migration).toContain("Features of a finalized workspace GIS version are immutable");
    expect(migration).toContain("adoption_manifest_hash");
  });

  it("keeps private consultation fields outside every anonymous review and map reader", () => {
    const files = [
      "../lib/land-use-plans/public.ts",
      "../lib/land-use-plans/public-map.ts",
      "../app/api/public/land-use-plan-reviews/[shareToken]/route.ts",
      "../app/api/public/land-use-plan-reviews/[shareToken]/map/[designationId]/route.ts",
      "../app/api/public/land-use-plans/[planId]/map/[designationId]/route.ts",
    ].map((file) => readFileSync(path.resolve(__dirname, file), "utf8")).join("\n");
    expect(files).not.toContain("land_use_plan_consultation_records");
    expect(files).not.toContain("confidential_notes");
    expect(files).not.toContain("contains_sensitive_locations");
  });
});
