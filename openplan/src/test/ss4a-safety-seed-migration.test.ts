/** SQL source controls only. PostgreSQL syntax, transactions, locks and RLS remain unexecuted. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SS4A_SECTION_KEYS } from "@/lib/grants/ss4a-safety-seed";

const sql = readFileSync("supabase/migrations/20261018000002_ss4a_safety_seed.sql", "utf8");
const apply = sql.slice(sql.indexOf("CREATE FUNCTION public.apply_ss4a_safety_seed"), sql.indexOf("REVOKE ALL ON FUNCTION public.apply_ss4a_safety_seed"));

describe("SS4A seed SQL source boundaries", () => {
  it("keeps one service-only invoker transaction, exact six-section mapping and a unique replay receipt", () => {
    expect(apply).toContain("SECURITY INVOKER SET search_path = ''");
    expect(sql).toContain("UNIQUE (opportunity_id, preview_hash)");
    expect(sql).toContain("cardinality(draft_ids) = 6");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.apply_ss4a_safety_seed(uuid, jsonb, text, jsonb) FROM PUBLIC, anon, authenticated");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.apply_ss4a_safety_seed(uuid, jsonb, text, jsonb) TO service_role");
    expect(apply).toContain("current_user NOT IN ('service_role', 'postgres') OR p_actor IS NULL");
    for (const key of SS4A_SECTION_KEYS) expect(apply).toContain(`'${key}'`);
    expect(apply).toContain("jsonb_array_length(p_sections) <> 6");
    expect(apply).not.toMatch(/EXCEPTION WHEN|COMMIT|ON CONFLICT.*DO NOTHING/);
    expect(apply.indexOf("RETURN to_jsonb(v_receipt)")).toBeLessThan(apply.indexOf("INSERT INTO public.funding_opportunity_section_drafts"));
    expect(apply).toContain("safety_seed_id = v_receipt.id AND id = ANY(v_receipt.draft_ids)) <> 6");
  });
  it("holds attributed writer/source/section locks and detects exact source, final-text and draft-history changes before insertion", () => {
    expect(apply).toContain("user_id = p_actor AND role IN ('owner','admin','member') FOR SHARE");
    expect(apply).toMatch(/funding_opportunities[\s\S]*FOR UPDATE/);
    for (const name of ["projects", "reports", "report_artifacts", "safety_crash_ingests"]) expect(apply).toMatch(new RegExp(`FROM public\\.${name} [^;]+FOR SHARE`));
    expect(apply).toContain("workspace_id = v_opportunity.workspace_id");
    expect(apply).toContain("project_id = v_opportunity.project_id");
    expect(apply).toContain("ORDER BY id FOR UPDATE LOOP");
    expect(apply).toContain("to_jsonb(v_section)->e.key IS DISTINCT FROM e.value");
    expect(apply).toContain("v_current IS DISTINCT FROM p_rows->'drafts'");
    expect(apply.indexOf("Draft history changed")).toBeLessThan(apply.indexOf("INSERT INTO public.funding_opportunity_safety_seeds"));
    expect(apply).toContain("AND source = 'catalog' AND section_key = v_draft->>'section_key'");
  });
  it("preserves final text and histories, does not promote checklists, and prevents code-origin forgery", () => {
    const update = apply.slice(apply.indexOf("UPDATE public.funding_opportunity_application_sections"));
    expect(update).toContain("CASE WHEN status = 'final' THEN status ELSE 'operator_review' END");
    expect(update).not.toContain("final_markdown ="); expect(update).not.toContain("finalized_from_draft_id =");
    expect(apply).not.toMatch(/DELETE FROM|UPDATE public\.funding_opportunity_section_drafts|funding_opportunity_attachments/);
    expect(sql).toContain("(origin = 'safety_plan_seed') = (safety_seed_id IS NOT NULL)");
    expect(sql).toContain("AND current_user NOT IN ('service_role', 'postgres')");
    expect(sql).toContain("CREATE TRIGGER guard_safety_seed_draft_origin");
  });
  it("freezes new artifact snapshots and identity without rewriting legacy artifacts", () => {
    expect(sql).toContain("CREATE TRIGGER guard_report_safety_snapshot BEFORE INSERT OR UPDATE ON public.report_artifacts");
    expect(sql).toContain("coalesce(OLD.metadata_json->'safetyPlanSnapshotV1', 'null'::jsonb) IS DISTINCT FROM coalesce(NEW.metadata_json->'safetyPlanSnapshotV1', 'null'::jsonb)");
    expect(sql).toContain("ROW(NEW.id, NEW.report_id, NEW.generated_at, NEW.generated_by, NEW.artifact_kind, NEW.storage_path)");
    expect(sql).toContain("NEW.metadata_json->'htmlContent' IS DISTINCT FROM OLD.metadata_json->'htmlContent'");
    expect(sql).toContain("NEW.metadata_json->'generationWriteback' IS DISTINCT FROM OLD.metadata_json->'generationWriteback'");
    expect(sql).not.toContain("UPDATE public.report_artifacts");
  });
});
