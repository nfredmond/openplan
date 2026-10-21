import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const current = readFileSync("supabase/migrations/20261021000001_model_common_population_admission.sql", "utf8");
const previous = readFileSync("supabase/migrations/20261019051430_model_population_replacement.sql", "utf8");
const original = readFileSync("supabase/migrations/20261019000001_model_common_population_comparisons.sql", "utf8");
const native = readFileSync("src/test/model-common-population-comparison-rls.test.ts", "utf8");
const admissionFixture = readFileSync("src/test/fixtures/modeling/common-population-admission.sql", "utf8");
const tailStart = "  -- Resolve the actual parent and authorize before reading protected source rows.";
const tailEnd = "REVOKE ALL ON FUNCTION public.validate_common_population_comparison() FROM PUBLIC, anon, authenticated, service_role;";

function custodyTail(source: string) {
  const start = source.indexOf(tailStart);
  const end = source.indexOf(tailEnd, start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end + tailEnd.length);
}
function requireAdmission(source: string) {
  for (const fragment of [
    "p_config ? 'guidedProjectComparison'",
    "UPDATE public.scenario_sets SET updated_at = updated_at WHERE id = v_id;",
    "PERFORM public.lock_common_population_admission_sets(ARRAY[OLD.scenario_set_id,NEW.scenario_set_id]);",
    "WHERE snapshot.id = NEW.comparison_snapshot_id FOR UPDATE OF snapshot;",
    "v_snapshot.scenario_set_id IS DISTINCT FROM v_set_id",
    "v_scope_ids := ARRAY[OLD.scenario_set_id,NEW.scenario_set_id];",
    "IF NOT (v_guided OR v_fixed_claim) THEN RETURN NEW; END IF;",
    "AND NOT v_has_links AND NOT v_fixed_claim THEN RETURN NEW; END IF;",
    "OR COALESCE(v_claim->>'comparisonPolicy' = 'fixed_population_auto_trip_change',false);",
    "WHERE snapshot.scenario_set_id = ANY(v_sets) AND (snapshot.status = 'ready' OR EXISTS (",
    "v_old_intent := public.model_common_population_guided_intent(OLD.config_json);",
    "v_new_intent := public.model_common_population_guided_intent(NEW.config_json);",
    "IF v_old_intent THEN v_old_set := OLD.scenario_set_id; END IF;",
    "IF v_new_intent THEN v_new_set := NEW.scenario_set_id; END IF;",
    "WHERE scenario_set.id = v_new_set AND scenario_set.workspace_id = NEW.workspace_id",
    "BEFORE INSERT OR UPDATE OR DELETE ON public.models",
    "model.workspace_id IS DISTINCT FROM scenario_set.workspace_id",
    "model.config_json->>'guidedProjectComparison' IS DISTINCT FROM 'openplan.project_comparison.v1'",
  ]) expect(source).toContain(fragment);
  // Both admission and custody lock this snapshot. A remaining copy must not
  // conceal a removed lock at the other site.
  expect(source.match(/WHERE snapshot\.id = NEW\.comparison_snapshot_id FOR UPDATE OF snapshot;/g)).toHaveLength(2);
  expect(source).not.toContain("NEW.metadata_json->'commonPopulation' IS NOT DISTINCT FROM OLD.metadata_json->'commonPopulation'");
  expect(source).not.toContain("'fixed_population_auto_trip_change' THEN RETURN NEW");
  expect(source.indexOf("FOR UPDATE OF scenario_set;")).toBeLessThan(source.indexOf("UPDATE public.scenario_sets SET updated_at"));
  const modelGuard = source.slice(source.indexOf("CREATE FUNCTION public.guard_common_population_model_admission()"), source.indexOf("CREATE OR REPLACE FUNCTION"));
  expect(modelGuard.indexOf("PERFORM public.lock_common_population_admission_sets(v_sets);")).toBeLessThan(modelGuard.indexOf("IF EXISTS (SELECT 1 FROM public.scenario_comparison_snapshots"));
  const validator = source.slice(source.indexOf("CREATE OR REPLACE FUNCTION"));
  expect(validator.indexOf("SELECT EXISTS (SELECT 1 FROM public.scenario_comparison_model_run_links")).toBeLessThan(validator.indexOf("IF NOT (v_guided OR v_fixed_claim)"));
  expect(validator.indexOf("model.scenario_set_id = ANY(v_scope_ids)")).toBeLessThan(validator.indexOf("IF NOT (v_guided OR v_fixed_claim)"));
}

function requireCatalogBool(source: string) {
  expect(source).not.toMatch(/\bpg_catalog\.boolean\b/);
  expect(source.match(/\bpg_catalog\.bool\b/g)).toHaveLength(6);
}

// Literal source checks cannot parse SQL, inspect installed roles, observe query
// snapshots, prove lock schedules or establish scientific/worker acceptance.
describe("current guided admission source, not installed safety", () => {
  it("retains the complete latest managed, ordinary and restored-source custody tail byte for byte", () => {
    expect(custodyTail(current)).toBe(custodyTail(previous));
  });
  it("uses the catalog bool spelling at all six sites without claiming SQL validity", () => {
    requireCatalogBool(current);
    requireCatalogBool(`-- harmless spelling-control comment\n${current}`);
  });
  it.each([1, 2, 3, 4, 5, 6])("detects the qualified boolean alias fault at site %i", (site) => {
    let seen = 0;
    const broken = current.replace(/\bpg_catalog\.bool\b/g, (spelling) =>
      ++seen === site ? "pg_catalog.boolean" : spelling);
    expect(seen).toBe(6);
    expect(broken).not.toBe(current);
    expect(() => requireCatalogBool(broken)).toThrow();
  });
  it("serializes both admission and model mutation before classification/refusal", () => requireAdmission(current));
  it("survives harmless comments before testing broken behavior", () => {
    requireAdmission(`-- harmless\n${current}`);
    expect(custodyTail(`-- harmless\n${current}`)).toBe(custodyTail(previous));
  });
  it.each([
    "p_config ? 'guidedProjectComparison'",
    "UPDATE public.scenario_sets SET updated_at = updated_at WHERE id = v_id;",
    "PERFORM public.lock_common_population_admission_sets(ARRAY[OLD.scenario_set_id,NEW.scenario_set_id]);",
    "WHERE snapshot.id = NEW.comparison_snapshot_id FOR UPDATE OF snapshot;",
    "IF v_old_intent THEN v_old_set := OLD.scenario_set_id; END IF;",
    "IF v_new_intent THEN v_new_set := NEW.scenario_set_id; END IF;",
    "WHERE snapshot.scenario_set_id = ANY(v_sets) AND (snapshot.status = 'ready' OR EXISTS (",
  ])("detects removing an admission predicate: %s", (fragment) => {
    expect(current).toContain(fragment);
    expect(() => requireAdmission(current.replace(fragment, "-- removed admission predicate"))).toThrow();
  });
  it("detects the old missing-claim or unchanged-claim prefix", () => {
    for (const shortcut of [
      "NEW.metadata_json->'commonPopulation' IS NOT DISTINCT FROM OLD.metadata_json->'commonPopulation'",
      "'fixed_population_auto_trip_change' THEN RETURN NEW",
    ]) expect(() => requireAdmission(`${current}\n-- ${shortcut}`)).toThrow();
  });
  it("keeps original trigger identities and revokes direct execution of every new helper", () => {
    for (const name of ["zz_validate_common_population_comparison_link", "zz_validate_common_population_comparison_snapshot"]) {
      expect(original).toContain(`CREATE TRIGGER ${name}`);
      expect(current).not.toContain(`DROP TRIGGER ${name}`);
    }
    for (const signature of ["model_common_population_guided_intent(pg_catalog.jsonb)",
      "lock_common_population_admission_sets(pg_catalog.uuid[])", "lock_common_population_comparison_admission()",
      "guard_common_population_model_admission()", "validate_common_population_comparison()"]) {
      expect(current).toContain(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, anon, authenticated, service_role;`);
    }
    expect(current).not.toMatch(/\bGRANT\b|ALTER OWNER|DISABLE TRIGGER|DROP FUNCTION|DROP TRIGGER/);
    expect(current.match(/SECURITY DEFINER SET search_path = ''/g)).toHaveLength(4);
    expect(current).toContain("OLD.status = 'ready' AND NEW.status = 'archived'");
    expect("aa_lock_common_population_comparison_link" < "validate_scenario_comparison_model_run_link_before_insert").toBe(true);
    expect("aa_lock_common_population_comparison_snapshot" < "refuse_bound_comparison_snapshot_update").toBe(true);
  });
  it("composes the new generic fixture into actual native trials without borrowing guided links", () => {
    expect(native).toContain("`${admissionFixture}\\n${body}\\nSELECT");
    expect(admissionFixture).toContain("Synthetic genuinely generic set");
    expect(admissionFixture).toContain("CREATE FUNCTION pg_temp.cp_generic_snapshot");
    expect(admissionFixture).not.toContain("cp_all_links");
    expect(admissionFixture).not.toMatch(/GRANT.*public\.models/);
  });
});
