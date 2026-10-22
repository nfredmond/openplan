import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20261019000003_model_common_population_comparisons.sql", "utf8");
const fixture = readFileSync("src/test/fixtures/modeling/common-population-comparisons.sql", "utf8");
const packageSource = readFileSync("package.json", "utf8");
const nativeTestPath = "src/test/model-common-population-comparison-rls.test.ts";
const rpcSignature = "public.read_common_population_stage_custody(pg_catalog.uuid,pg_catalog.uuid,pg_catalog.uuid,pg_catalog.uuid)";

function requireNativeRegistration(source: string) {
  const parsed: unknown = JSON.parse(source);
  if (!parsed || typeof parsed !== "object" || !("scripts" in parsed) || !parsed.scripts || typeof parsed.scripts !== "object"
    || !("test:rls-live" in parsed.scripts) || typeof parsed.scripts["test:rls-live"] !== "string") {
    throw new Error("The actual test:rls-live command is missing");
  }
  const tokens = parsed.scripts["test:rls-live"].trim().split(/\s+/);
  expect(tokens.slice(0, 5)).toEqual(["OPENPLAN_RLS_LIVE_TEST=1", "node", "--env-file-if-exists=.env.local", "node_modules/vitest/vitest.mjs", "run"]);
  expect(tokens.filter((token) => token === nativeTestPath)).toHaveLength(1);
  expect(tokens.slice(5).some((token) => /[;&|`$()]/.test(token))).toBe(false);
}

function requireCustodyPredicates(source: string) {
  for (const predicate of [
    "enrollment.run_id = v_run.id AND enrollment.provenance = 'new_run'",
    "execution_start.stage_id = stage.id AND execution_start.run_id = stage.run_id",
    "v_run.attempt_managed IS DISTINCT FROM false",
    "v_stage.attempt_managed IS DISTINCT FROM false OR v_stage.active_attempt_id IS NOT NULL",
    "v_artifact.attempt_id IS NOT NULL",
    "receipt.request_payload = pg_catalog.jsonb_build_object('workspace_id',v_run.workspace_id,'payload',pg_catalog.jsonb_build_object(",
    "AND receipt.response_payload = pg_catalog.to_jsonb(v_artifact)",
    "v_artifact.metadata_json->>'population_custody' IS DISTINCT FROM v_custody",
    "v_source_artifact.metadata_json->>'custody' IS DISTINCT FROM v_custody",
    "v_source_artifact.metadata_json->'origin' IS DISTINCT FROM 'null'::pg_catalog.jsonb",
    "v_source_artifact.metadata_json->>'scientific_acceptance' IS DISTINCT FROM 'unassessed'",
    "v_claim->>'custody' NOT IN ('managed_attempt','legacy_stage_snapshot')",
  ]) expect(source).toContain(predicate);
  expect(source.match(/attempt\.revoked_at IS NULL FOR SHARE OF stage, attempt/g)).toHaveLength(2);
}

function requireSourceCompanions(source: string) {
  for (const predicate of [
    "FOREACH v_key IN ARRAY ARRAY['households','persons','selected_zones','diagnostics','source_manifest','source_zone_attributes'] LOOP",
    "companion.run_id = v_source_run.id AND companion.artifact_type = 'common_population_'||v_key",
    "companion.stage_id = v_source_artifact.stage_id",
    "companion.attempt_id IS NOT DISTINCT FROM v_source_artifact.attempt_id FOR SHARE OF companion",
    "v_companion.metadata_json IS DISTINCT FROM v_source_artifact.metadata_json",
    "v_companion.file_url IS DISTINCT FROM v_source_directory||v_filename",
    "v_companion.content_hash IS NULL OR v_companion.content_hash !~ '^[a-f0-9]{64}$'",
    "v_companion.file_size_bytes IS NULL OR v_companion.file_size_bytes <= 0",
    "v_companion.content_hash IS DISTINCT FROM v_descriptor->>'sha256'",
    "v_companion.file_size_bytes IS DISTINCT FROM (v_descriptor->>'bytes')::pg_catalog.int8",
    "public.read_common_population_stage_custody(v_set.workspace_id,v_source_run.id,v_companion.stage_id,v_companion.id)",
  ]) expect(source).toContain(predicate);
  for (const path of ["households.csv", "persons.csv", "selected_zones.json", "diagnostics.json", "source_manifest.json", "source_zone_attributes.csv"]) {
    expect(source).toContain(`'${path}'`);
  }
  expect(source).toContain("WHERE companion.run_id = v_source_run.id AND companion.artifact_type = 'common_population_'||v_key) <> 1");
  const companionRead = source.indexOf("SELECT companion.* INTO v_companion");
  expect(companionRead).toBeGreaterThan(0);
  expect(source.indexOf("INTO v_links FROM public.scenario_comparison_model_run_links")).toBeGreaterThan(companionRead);
}

// SQL source controls do not parse PostgreSQL or prove native permissions/custody.
describe("bounded native common-population comparison source", () => {
  it("registers the exact native fixture once in the actual package live-RLS command", () => requireNativeRegistration(packageSource));
  it("survives harmless package whitespace", () => requireNativeRegistration(`\n${packageSource}\n`));
  it("detects removing the exact native fixture from the actual command", () => {
    expect(packageSource).toContain(nativeTestPath);
    expect(() => requireNativeRegistration(packageSource.replace(nativeTestPath, ""))).toThrow();
  });
  it("adds one private trigger and one fixed service RPC without changing original guards or protected table privileges", () => {
    expect(sql.match(/CREATE FUNCTION /g)).toHaveLength(2);
    expect(sql).toContain("CREATE FUNCTION public.validate_common_population_comparison()\nRETURNS pg_catalog.trigger");
    expect(sql).toContain("LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.validate_common_population_comparison() FROM PUBLIC, anon, authenticated, service_role;");
    expect(sql).toContain(`REVOKE ALL ON FUNCTION ${rpcSignature} FROM PUBLIC, anon, authenticated, service_role;`);
    expect(sql.match(/GRANT [^;]+;/g)).toEqual([`GRANT EXECUTE ON FUNCTION ${rpcSignature} TO service_role;`]);
    expect(sql).not.toMatch(/CREATE OR REPLACE|ALTER OWNER|\bEXECUTE\s+(?!FUNCTION|ON FUNCTION)|INSERT INTO|UPDATE public|DELETE FROM|DISABLE TRIGGER/);
    expect(sql.match(/LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''/g)).toHaveLength(2);
    expect(sql).toContain("p_artifact pg_catalog.uuid DEFAULT NULL");
    expect(sql).toContain("'workspace_id',v_run.workspace_id,'run_id',v_run.id,'stage_id',v_stage.id,'artifact_id',p_artifact,'eligible',true");
    expect(sql).toContain("zz_validate_common_population_comparison_link\n  BEFORE INSERT ON public.scenario_comparison_model_run_links");
    expect(sql).toContain("zz_validate_common_population_comparison_snapshot\n  BEFORE INSERT OR UPDATE ON public.scenario_comparison_snapshots");
    expect("zz_validate_common_population_comparison_link" > "validate_scenario_comparison_model_run_link_before_insert").toBe(true);
    expect("zz_validate_common_population_comparison_snapshot" > "refuse_bound_comparison_snapshot_update").toBe(true);
  });
  it("derives source scope through actual parents before private attempt reads, and keeps exact current policy local", () => {
    const authorize = sql.indexOf("SELECT scenario_set.* INTO v_set");
    const protectedRead = sql.indexOf("JOIN public.model_stage_attempts attempt");
    expect(authorize).toBeGreaterThan(0); expect(protectedRead).toBeGreaterThan(authorize);
    for (const fragment of [
      "project.id = scenario_set.project_id AND project.workspace_id = scenario_set.workspace_id",
      "member.user_id = auth.uid() AND member.role IN ('owner', 'admin', 'member')",
      "v_set.baseline_entry_id IS DISTINCT FROM v_snapshot.baseline_entry_id",
      "run.workspace_id = v_set.workspace_id", "run.project_id = v_set.project_id", "run.scenario_set_id = v_set.id",
      "run.scenario_entry_id = v_snapshot.baseline_entry_id", "artifact.artifact_type = 'common_population'",
      "stage.stage_name = 'AequilibraE Setup'", "stage.active_attempt_id = v_source_artifact.attempt_id",
      "v_source_artifact.metadata_json->'population_basis' IS DISTINCT FROM v_basis",
      "v_artifact.metadata_json->'population_basis' IS DISTINCT FROM v_basis",
      "v_artifact.metadata_json->>'population_basis_payload_json' IS DISTINCT FROM v_payload",
      "v_artifact.metadata_json->>'population_basis_digest' IS DISTINCT FROM v_digest",
      "pg_catalog.jsonb_array_length(v_links) <> 4",
      "'openplan.common-population-comparison.v1'", "'fixed_population_auto_trip_change'",
    ]) expect(sql).toContain(fragment);
    requireCustodyPredicates(sql);
    requireSourceCompanions(sql);
  });
  it("publishes separately declared synthetic modes through real claims and exact retained commands", () => {
    for (const command of ["public.claim_model_stage_attempt", "public.write_model_attempt_artifact", "public.write_model_stage_attempt", "public.record_legacy_model_artifact", "public.read_common_population_stage_custody"]) expect(fixture).toContain(command);
    expect(fixture).not.toMatch(/DISABLE TRIGGER|session_replication_role|INSERT INTO public\.model_stage_attempts|INSERT INTO public\.model_run_artifacts/);
    expect(fixture).toContain("Synthetic fixture, no scientific validation");
    expect(fixture).toContain("Comparison changed retained runs or artifacts");
    expect(fixture.match(/status='running',started_at=clock_timestamp\(\).*status='queued'/g)).toHaveLength(2);
    expect(fixture).toContain("IF p.custody='legacy_stage_snapshot' THEN\n    INSERT INTO public.modeling_claim_decisions");
    expect(fixture).toContain("PERFORM pg_temp.cp_instrument(attempt,COALESCE(j.instrument_method,j.method)");
    expect(fixture).toContain("result:=public.record_model_attempt_instrument(gen_random_uuid(),attempt,payload)");
    expect(fixture.match(/FOR f IN SELECT \* FROM cp_source_files LOOP/g)).toHaveLength(2);
  });
  it("survives a harmless source comment", () => {
    requireCustodyPredicates(`-- harmless source control\n${sql}`);
    requireSourceCompanions(`-- harmless source control\n${sql}`);
  });
  it.each([
    "AND enrollment.provenance = 'new_run'",
    "execution_start.stage_id = stage.id AND execution_start.run_id = stage.run_id",
    "AND receipt.response_payload = pg_catalog.to_jsonb(v_artifact)",
    "v_artifact.metadata_json->>'population_custody' IS DISTINCT FROM v_custody",
    "attempt.revoked_at IS NULL FOR SHARE OF stage, attempt",
  ])("detects removal of the intended custody predicate %s", (predicate) => {
    expect(sql).toContain(predicate);
    expect(() => requireCustodyPredicates(sql.replace(predicate, "true"))).toThrow();
  });
  it.each([
    "companion.stage_id = v_source_artifact.stage_id",
    "companion.attempt_id IS NOT DISTINCT FROM v_source_artifact.attempt_id FOR SHARE OF companion",
    "v_companion.metadata_json IS DISTINCT FROM v_source_artifact.metadata_json",
    "v_companion.file_url IS DISTINCT FROM v_source_directory||v_filename",
    "v_companion.content_hash IS DISTINCT FROM v_descriptor->>'sha256'",
    "public.read_common_population_stage_custody(v_set.workspace_id,v_source_run.id,v_companion.stage_id,v_companion.id)",
  ])("detects removal of source companion admission predicate %s", (predicate) => {
    expect(sql).toContain(predicate);
    expect(() => requireSourceCompanions(sql.replace(predicate, "true"))).toThrow();
  });
});
