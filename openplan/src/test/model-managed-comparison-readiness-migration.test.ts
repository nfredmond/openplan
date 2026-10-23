// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20261022070000_managed_comparison_readiness.sql", "utf8");
const original = readFileSync("supabase/migrations/20260827000001_model_truth_completion.sql", "utf8");
const fixture = readFileSync("src/test/fixtures/modeling/common-population-comparisons.sql", "utf8");
const native = readFileSync("src/test/model-common-population-comparison-rls.test.ts", "utf8");
const truth = readFileSync("src/test/model-truth-rls-live.test.ts", "utf8");
const code = (value: string) => value.replace(/--[^\n]*/g, "");

// Source contracts detect a missing predicate, not its PostgreSQL semantics,
// installed ACL, race behavior, Storage bytes or scientific validity.
function contract(source: string) {
  const body = code(source);
  expect(body, "one existing trigger replacement").toMatch(/CREATE OR REPLACE FUNCTION public\.refuse_bound_comparison_snapshot_change\(\)/);
  expect(body.match(/CREATE OR REPLACE FUNCTION/g), "one replacement only").toHaveLength(1);
  expect(body.match(/CREATE FUNCTION/g), "one private trigger function").toHaveLength(1);
  expect(body).toContain("LANGUAGE plpgsql\nSECURITY INVOKER\nSET search_path = public, pg_catalog");
  expect(body).toContain("ALTER FUNCTION public.validate_managed_comparison_readiness() OWNER TO postgres");
  expect(body).toContain("REVOKE ALL ON FUNCTION public.validate_managed_comparison_readiness() FROM PUBLIC, anon, authenticated, service_role");
  expect(body).toContain("FOR EACH ROW EXECUTE FUNCTION public.validate_managed_comparison_readiness()");
  expect(body, "full population and writer admission runs first").toContain("CREATE TRIGGER zzz_validate_managed_comparison_readiness");
  expect(body, "no direct writes or user grants").not.toMatch(/\b(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|GRANT|DROP|CREATE\s+(?:TABLE|POLICY))\b/i);
  expect(body, "private authority confined to trigger").toContain("LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''");
  expect(body, "fixed trigger context").toContain("TG_TABLE_NAME <> 'scenario_comparison_snapshots' OR TG_OP <> 'UPDATE'");
  const prefixStart = original.indexOf("  IF TG_OP = 'DELETE' AND pg_trigger_depth()", original.indexOf("CREATE OR REPLACE FUNCTION public.refuse_bound_comparison_snapshot_change()"));
  const prefixEnd = original.indexOf("    IF EXISTS (\n      SELECT 1\n      FROM public.scenario_comparison_model_run_links link", prefixStart);
  expect(body, "original immutability transitions and four-link census").toContain(original.slice(prefixStart, prefixEnd));
  expect(body, "ordinary snapshot membership").toContain("member.workspace_id = v_set.workspace_id AND member.user_id = auth.uid() FOR SHARE");
  expect(body, "legacy keeps its original access path").toContain("WHERE link.comparison_snapshot_id = OLD.id AND run.attempt_managed) THEN RETURN NEW; END IF;");
  expect(body, "ordinary roles use existing membership").toContain("IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles role");
  expect(body, "real SQL invoker").toContain("coalesce(nullif(current_setting('role', true), 'none'), session_user)");
  expect(body, "privileged SQL role").toContain("role.rolname = v_invoker AND (role.rolsuper OR role.rolbypassrls)");
  expect(body, "status-limited private read").toContain("IF OLD.status <> 'draft' OR NEW.status <> 'ready' THEN RETURN NEW; END IF;");
  for (const [predicate, reason] of [
    ["ORDER BY run.id FOR SHARE", "parent lifecycle lock"],
    ["WHERE run.id = link.model_run_id AND run.attempt_managed", "legacy excludes only visible managed runs"],
    ["decision.model_run_id = link.model_run_id", "legacy exact run"],
    ["decision.track = CASE link.method WHEN 'aequilibrae' THEN 'assignment' ELSE 'behavioral_demand' END", "legacy track"],
    ["v_run.workspace_id IS DISTINCT FROM v_link.workspace_id OR v_run.status <> 'succeeded'", "managed succeeded scope"],
    ["v_projection := public.read_model_attempt_outputs(v_run.id, v_link.workspace_id)", "installed current selector call"],
    ["instrument.workspace_id = v_link.workspace_id AND instrument.model_run_id = v_run.id", "instrument scope"],
    ["instrument.demand_method = v_link.method", "instrument method"],
    ["instrument.model_output_artifact_id = v_link.model_run_artifact_id", "instrument output identity"],
    ["instrument.model_output_sha256 = v_link.artifact_sha256) <> 1 THEN", "exact-one instrument hash"],
    ["v_instrument.scientific_outcome IS DISTINCT FROM 'inconclusive'", "inconclusive scientific hold"],
    ["receipt.response_payload - 'created_at' = to_jsonb(v_instrument) - 'created_at'", "installed command receipt"],
    ["(receipt.response_payload->>'created_at')::timestamptz = v_instrument.created_at", "receipt timestamp instant"],
    ["projected->>'kind' = 'artifact'", "artifact projection kind"],
    ["projected->>'ownership_state' = 'current_completed'", "current completed only"],
    ["projected->'record' = to_jsonb(artifact)", "full projected descriptor"],
    ["artifact.run_id = v_run.id AND artifact.stage_id = v_instrument.stage_id", "artifact run and stage"],
    ["artifact.attempt_id = v_instrument.attempt_id", "artifact attempt"],
    ["artifact.content_hash = v_reference.artifact_sha256", "artifact hash"],
    ["artifact.file_size_bytes > 0 AND length(btrim(artifact.file_url)) > 0", "usable artifact descriptor"],
  ]) expect(body, reason).toContain(predicate);
  expect(body, "all six exact references").toMatch(/FOR v_reference IN SELECT \* FROM \(VALUES\s*\(v_instrument\.model_output_artifact_id, v_instrument\.model_output_sha256\),\s*\(v_instrument\.input_bundle_artifact_id, v_instrument\.input_bundle_sha256\),\s*\(v_instrument\.match_audit_artifact_id, v_instrument\.match_audit_sha256\),\s*\(v_instrument\.comparison_basis_artifact_id, v_instrument\.comparison_basis_sha256\),\s*\(v_instrument\.assessment_artifact_id, v_instrument\.assessment_sha256\),\s*\(v_instrument\.diagnosis_artifact_id, v_instrument\.diagnosis_sha256\)/);
}

describe("managed comparison readiness additive source contract", () => {
  it("preserves immutability and legacy readiness while requiring exact current inconclusive custody", () => contract(sql));
  it("survives a harmless SQL comment", () => contract(`-- harmless readiness control\n${sql}`));
  it.each([
    ["WHERE run.id = link.model_run_id AND run.attempt_managed", "WHERE true"],
    ["v_projection := public.read_model_attempt_outputs(v_run.id, v_link.workspace_id)", "v_projection := '{}'::jsonb"],
    ["instrument.demand_method = v_link.method", "true"],
    ["instrument.model_output_artifact_id = v_link.model_run_artifact_id", "true"],
    ["instrument.model_output_sha256 = v_link.artifact_sha256) <> 1 THEN", "instrument.model_output_sha256 = v_link.artifact_sha256) < 1 THEN"],
    ["v_instrument.scientific_outcome IS DISTINCT FROM 'inconclusive'", "false"],
    ["receipt.response_payload - 'created_at' = to_jsonb(v_instrument) - 'created_at'", "true"],
    ["projected->>'ownership_state' = 'current_completed'", "projected->>'ownership_state' = 'retained_inactive'"],
    ["artifact.stage_id = v_instrument.stage_id", "true"],
    ["artifact.attempt_id = v_instrument.attempt_id", "true"],
    ["artifact.content_hash = v_reference.artifact_sha256", "true"],
  ])("detects missing or incorrect binding %s", (before, after) => {
    expect(sql).toContain(before);
    expect(() => contract(sql.replaceAll(before, after))).toThrow();
  });
  it("keeps native fixture admission on real commands before completion", () => {
    const source = code(fixture);
    expect(source).toContain("IF p.custody='legacy_stage_snapshot' THEN\n    INSERT INTO public.modeling_claim_decisions");
    expect(source, "instrument command call").toContain("result:=public.record_model_attempt_instrument(gen_random_uuid(),attempt,payload)");
    const start = source.indexOf("IF NOT j.omit_instrument THEN");
    expect(start).toBeGreaterThan(0);
    expect(source, "instrument admission call exists").toContain("PERFORM pg_temp.cp_instrument(attempt,COALESCE(j.instrument_method,j.method)");
    const admission = source.indexOf("PERFORM pg_temp.cp_instrument(attempt,COALESCE(j.instrument_method,j.method)", start);
    expect(admission, "instrument admission call exists").toBeGreaterThan(start);
    expect(admission, "instrument admitted before completion").toBeLessThan(source.indexOf("'succeeded','Synthetic output only'", start));
    expect(code(truth)).not.toContain('from("modeling_claim_decisions").insert');
    expect(code(truth), "native truth instrument command").toContain('service.rpc("record_model_attempt_instrument",');
    expect(native).toContain('"managed readiness bridge: current retry without legacy decisions"');
  });
});
