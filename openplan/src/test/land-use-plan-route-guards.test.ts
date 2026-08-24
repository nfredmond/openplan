import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const API_ROOT = path.resolve(__dirname, "../app/api/land-use-plans/[planId]");
const WRITE_ROUTES = [
  "route.ts", "content/route.ts", "designations/route.ts", "implementation/route.ts",
  "reviews/route.ts", "relationships/route.ts", "freeze/route.ts", "versions/route.ts", "decisions/route.ts",
  "implementation-reports/route.ts",
];

describe("Land Use Plans route boundaries", () => {
  it("qualifies the plan-version relationship on both registry reads", () => {
    const relationship = "land_use_plan_versions!land_use_plan_versions_plan_id_workspace_id_fkey";
    expect(readFileSync(path.resolve(__dirname, "../app/(app)/land-use-plans/page.tsx"), "utf8")).toContain(relationship);
    expect(readFileSync(path.resolve(__dirname, "../app/api/land-use-plans/route.ts"), "utf8")).toContain(relationship);
  });

  it("does not request an ambiguous GIS layer-version relationship", () => {
    const detailRoute = readFileSync(path.join(API_ROOT, "route.ts"), "utf8");
    expect(detailRoute).toContain('from("workspace_gis_layers").select("id, name, current_version_id")');
    expect(detailRoute).not.toContain("workspace_gis_layer_versions(");
  });

  it("extends the shared report target invariant to Land Use Plans", () => {
    const migration = readFileSync(path.resolve(__dirname, "../../supabase/migrations/20260823000006_land_use_plan_report_target.sql"), "utf8");
    expect(migration).toContain("num_nonnulls(project_id, rtp_cycle_id, engagement_campaign_id, land_use_plan_id) = 1");
  });

  it("makes every plan-scoped write resolve the plan and its workspace role", () => {
    for (const relative of WRITE_ROUTES) {
      const source = readFileSync(path.join(API_ROOT, relative), "utf8");
      expect(source, relative).toContain("loadLandUsePlanAccess");
      expect(source, relative).toContain("{ write: true }");
    }
  });

  it("uses strict executed-payload schemas for every consequential operation", () => {
    for (const relative of WRITE_ROUTES) {
      const source = readFileSync(path.join(API_ROOT, relative), "utf8");
      expect(source, relative).toContain(".strict()");
    }
  });

  it("keeps private consultation data out of the public route", () => {
    const publicRoute = readFileSync(path.resolve(__dirname, "../app/api/public/land-use-plans/[planId]/route.ts"), "utf8");
    const publicLoader = readFileSync(path.resolve(__dirname, "../lib/land-use-plans/public.ts"), "utf8");
    const publicSurface = `${publicRoute}\n${publicLoader}`;
    expect(publicSurface).not.toContain("land_use_plan_consultation_records");
    expect(publicSurface).not.toContain("confidential_notes");
    expect(publicSurface).not.toContain("contains_sensitive_locations");
    expect(publicLoader).toContain("published_report_id");
    expect(publicLoader).toContain('.eq("state", "adopted")');
    const publicPage = readFileSync(path.resolve(__dirname, "../app/(public)/published-plans/[planId]/page.tsx"), "utf8");
    expect(publicPage).toContain("loadPublishedLandUsePlanPacket");
    expect(publicPage).toContain("applicableRequirementKeys");
    expect(publicPage).toContain("ContentBranch");
  });

  it("derives required adoption review events from the jurisdiction descriptor", () => {
    const decisions = readFileSync(path.join(API_ROOT, "decisions/route.ts"), "utf8");
    expect(decisions).toContain("descriptor.processSteps");
    expect(decisions).toContain("step.required");
    expect(decisions).not.toContain('["hearing", "recommendation", "comment_response"].filter');
  });

  it("does not let applicability remove descriptor-required content", () => {
    const detailRoute = readFileSync(path.join(API_ROOT, "route.ts"), "utf8");
    expect(detailRoute).toContain('requirement.applicability === "required"');
    expect(detailRoute).toContain("Required descriptor content cannot be marked inapplicable");
  });

  it("keeps conditional applicability, evidence, and policy-map links reachable in the workbench", () => {
    const workbench = readFileSync(path.resolve(__dirname, "../components/land-use-plans/land-use-plan-workbench.tsx"), "utf8");
    expect(workbench).toContain("Applicable to this version");
    expect(workbench).toContain("Official evidence URL");
    expect(workbench).toContain('name="policyNodeIds"');
    expect(workbench).toContain('form.getAll("policyNodeIds")');
  });
});
