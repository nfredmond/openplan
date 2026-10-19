/** SQL source controls only. These do not execute or establish trigger enforcement. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20261019070000_guided_comparison_report_evidence.sql", "utf8")
  .replace(/--[^\n]*/g, "");
const guard = sql.slice(sql.indexOf("CREATE FUNCTION public.guard_report_guided_comparison_artifact()"),
  sql.indexOf("REVOKE ALL ON FUNCTION public.guard_report_guided_comparison_artifact()"));
const updates = guard.slice(guard.indexOf("  ELSE\n"));

describe("guided artifact persistence SQL source boundaries", () => {
  it("attaches an invoker guard and confines new selected inserts to the generation server", () => {
    expect(guard).toContain("SECURITY INVOKER SET search_path = ''");
    expect(guard).not.toContain("SECURITY DEFINER");
    expect(sql).toContain("CREATE TRIGGER guard_report_guided_comparison_artifact BEFORE INSERT OR UPDATE OR DELETE ON public.report_artifacts");
    expect(sql).toContain("FOR EACH ROW EXECUTE FUNCTION public.guard_report_guided_comparison_artifact()");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.guard_report_guided_comparison_artifact() FROM PUBLIC,anon,authenticated,service_role");
    expect(guard).toContain("current_user NOT IN ('service_role', 'postgres')");
    expect(guard).toContain("v_selection IS DISTINCT FROM v_context_selection");
    for (const scope of ["workspaceId", "projectId"]) expect(guard).toContain(`v_selection->'payload'->>'${scope}' IS DISTINCT FROM v_report.`);
    expect(guard).toContain("AND user_id = NEW.generated_by AND role IN ('owner','admin','member') FOR SHARE");
  });

  it("refuses selected-artifact deletion before reading NEW and retains legacy deletion behavior", () => {
    const deletion = guard.slice(guard.indexOf("IF TG_OP = 'DELETE'"), guard.indexOf("  v_selection :="));
    expect(deletion).toContain("coalesce(OLD.metadata_json->'guidedComparisonSelectionV1', 'null'::jsonb) <> 'null'::jsonb");
    expect(deletion).toContain("coalesce(OLD.metadata_json->'sourceContext'->'guidedComparisonSelectionV1', 'null'::jsonb) <> 'null'::jsonb");
    expect(deletion).toContain("RAISE EXCEPTION 'Retained guided artifacts cannot be deleted or replaced' USING ERRCODE = '23514'");
    expect(deletion.indexOf("RAISE EXCEPTION")).toBeLessThan(deletion.indexOf("RETURN OLD"));
    expect(deletion).not.toContain("NEW.");
    expect(guard).not.toContain("jsonb := coalesce(NEW.");
  });

  it("compares each retained selection copy before allowing a legacy update", () => {
    expect(updates).toContain("coalesce(OLD.metadata_json->'guidedComparisonSelectionV1', 'null'::jsonb) IS DISTINCT FROM v_selection");
    expect(updates).toContain("coalesce(OLD.metadata_json->'sourceContext'->'guidedComparisonSelectionV1', 'null'::jsonb) IS DISTINCT FROM v_context_selection");
    expect(updates.indexOf("Guided artifact selections are immutable")).toBeLessThan(updates.indexOf("THEN RETURN NEW"));
    expect(updates).toContain("IF v_selection = 'null'::jsonb AND v_context_selection = 'null'::jsonb THEN RETURN NEW; END IF");
  });

  it("names both sides of every artifact identity and rendered-content comparison", () => {
    const identity = ["id", "report_id", "created_at", "generated_at", "generated_by", "artifact_kind", "storage_path"];
    expect(updates).toContain(`ROW(${identity.map((field) => `NEW.${field}`).join(", ")})\n      IS DISTINCT FROM ROW(${identity.map((field) => `OLD.${field}`).join(", ")})`);
    for (const key of ["htmlContent", "generatedAt", "pdfEngine"]) {
      expect(updates).toContain(`NEW.metadata_json->'${key}' IS DISTINCT FROM OLD.metadata_json->'${key}'`);
    }
    expect(updates).not.toContain("NEW.metadata_json IS DISTINCT FROM OLD.metadata_json");
  });

  it("permits the first exact writeback receipt and freezes a recorded receipt", () => {
    expect(updates).toContain("IF coalesce(OLD.metadata_json->'generationWriteback', 'null'::jsonb) <> 'null'::jsonb THEN");
    expect(updates).toContain("NEW.metadata_json->'generationWriteback' IS DISTINCT FROM OLD.metadata_json->'generationWriteback'");
    expect(updates).toContain("ELSIF coalesce(NEW.metadata_json->'generationWriteback', 'null'::jsonb) <> 'null'::jsonb THEN");
    expect(updates).toContain("FROM public.reports WHERE id = NEW.report_id FOR SHARE");
    expect(updates).toContain("IS DISTINCT FROM 'openplan.report-generation-writeback.v1'");
    expect(updates).toContain("(NEW.metadata_json->'generationWriteback'->>'reportUpdatedAt')::timestamptz IS DISTINCT FROM v_report.updated_at");
    expect(updates).not.toContain("current_user");
    expect(guard).not.toMatch(/\b(?:UPDATE|DELETE FROM|ALTER TABLE|GRANT)\b/);
  });
});
