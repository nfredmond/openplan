import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260827000003_evidence_dependency_freshness.sql"),
  "utf8",
);

describe("evidence dependency aggregate revision migration", () => {
  it("advances project freshness for direct, parent-linked, and modeling evidence", () => {
    for (const table of [
      "project_corridors",
      "plans",
      "kb_documents",
      "reports",
      "client_invoices",
      "data_dataset_project_links",
      "models",
      "model_runs",
      "county_runs",
      "safety_crash_ingests",
      "engagement_campaigns",
      "aerial_missions",
    ]) {
      expect(sql, table).toContain(`'${table}'`);
    }
    for (const trigger of [
      "trg_report_artifacts_project_evidence_revision",
      "trg_model_artifacts_project_evidence_revision",
      "trg_safety_crashes_project_evidence_revision",
      "trg_engagement_items_project_evidence_revision",
      "trg_aerial_imagery_project_evidence_revision",
      "trg_aerial_custody_project_evidence_revision",
      "trg_data_datasets_project_evidence_revision",
    ]) {
      expect(sql, trigger).toContain(trigger);
    }
    expect(sql).toContain("'modeling_source_manifests'");
    expect(sql).toContain("'modeling_validation_results'");
    expect(sql).toContain("'modeling_claim_decisions'");
  });

  it("keeps the revision monotonic and trigger helpers out of client reach", () => {
    expect(sql).toMatch(/greatest\(clock_timestamp\(\), OLD\.updated_at \+ interval '1 microsecond'\)/);
    expect(sql).toMatch(/SECURITY DEFINER[\s\S]*SET search_path = public, pg_catalog/);
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.touch_project_evidence_revision(uuid) FROM PUBLIC, anon, authenticated;",
    );
  });
});
