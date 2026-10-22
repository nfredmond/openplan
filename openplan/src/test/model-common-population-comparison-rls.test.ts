// @vitest-environment node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";

const fixture = readFileSync("src/test/fixtures/modeling/common-population-comparisons.sql", "utf8");
const readinessRetry = readFileSync("src/test/fixtures/modeling/managed-comparison-readiness-retry.sql", "utf8");
const admissionFixture = readFileSync("src/test/fixtures/modeling/common-population-admission.sql", "utf8");
const profileFixture = readFileSync("src/test/fixtures/modeling/common-population-profiles.sql", "utf8");
const signature = "public.validate_common_population_comparison()";
const stageSignature = "public.read_common_population_stage_custody(uuid,uuid,uuid,uuid)";
const ordinaryStageSignature = "public.read_common_population_stage_custody_before_replacement(uuid,uuid,uuid,uuid)";
type TrialOptions = { profileSql?: string; source?: string; output?: string; guard?: string; custody?: "managed_attempt" | "legacy_stage_snapshot" };
const owner = "SET LOCAL ROLE authenticated;";
const sourceFault = "UPDATE cp_probe SET source_metadata=source_metadata-'population_basis';";
const missingOutput = (position: number) => `UPDATE cp_jobs SET metadata=metadata-ARRAY['population_basis','population_basis_payload_json','population_basis_digest'] WHERE position=${position};`;
const sourceCompanionKinds = ["common_population_households", "common_population_persons", "common_population_selected_zones",
  "common_population_diagnostics", "common_population_source_manifest", "common_population_source_zone_attributes"] as const;
const linkRefusal = (position: number) => `${owner} DO $$ DECLARE s uuid; BEGIN s:=pg_temp.cp_snapshot();
 PERFORM pg_temp.cp_expect_refusal(format('SELECT pg_temp.cp_link(%L,${position})',s)); END $$; RESET ROLE;`;

// Copy injected SQL literally, including dollar quotes and replacement tokens.
function assembleFixture(options: TrialOptions = {}) {
  return fixture.replace("-- CUSTODY SEAM", () => `UPDATE cp_probe SET custody='${options.custody ?? "managed_attempt"}';${options.profileSql ?? ""}`)
    .replace("-- SOURCE PUBLICATION SEAM", () => options.source ?? "")
    .replace("-- OUTPUT PUBLICATION SEAM", () => options.output ?? "");
}

// Ordinary assembly checks execute no SQL and do not register in native mode.
if (!LIVE_RLS) describe("common-population fixture literal SQL assembly", () => {
  const spans = fixture.split(/-- CUSTODY SEAM|-- SOURCE PUBLICATION SEAM|-- OUTPUT PUBLICATION SEAM/);
  const metacharacters = "$$ $& $` $' $1 $2 $<capture>";
  function literalFixture(custody: string, source: string, output: string) {
    expect(spans).toHaveLength(4);
    return [spans[0], custody, spans[1], source, spans[2], output, spans[3]].join("");
  }

  it("preserves the actual readiness retry source SQL literally", () => {
    expect(assembleFixture({ source: readinessRetry }), "literal readiness retry source SQL").toBe(
      literalFixture("UPDATE cp_probe SET custody='managed_attempt';", readinessRetry, ""));
  });
  it("preserves output SQL replacement metacharacters literally", () => {
    const output = `-- Output literals: ${metacharacters}\nDO $$ BEGIN NULL; END $$;`;
    expect(assembleFixture({ output }), "literal output SQL").toBe(
      literalFixture("UPDATE cp_probe SET custody='managed_attempt';", "", output));
  });
  it("preserves custody profile SQL replacement metacharacters literally", () => {
    const profileSql = `\n-- Profile literals: ${metacharacters}\nDO $$ BEGIN NULL; END $$;`;
    expect(assembleFixture({ custody: "legacy_stage_snapshot", profileSql }), "literal custody profile SQL").toBe(
      literalFixture(`UPDATE cp_probe SET custody='legacy_stage_snapshot';${profileSql}`, "", ""));
  });
});

// Real native commands and database roles. Synthetic descriptors/decisions do not
// establish byte availability, worker consumption, observation quality or accuracy.
(LIVE_RLS ? describe : describe.skip)("explicit common-population native comparison boundary", () => {
  let container: string;
  beforeAll(() => {
    if (process.env.GITHUB_ACTIONS !== "true" && !isAbsolute(process.env.OPENPLAN_SUPABASE_WORKDIR ?? "")) {
      throw new Error("Select an explicit isolated Supabase workdir for population fixtures.");
    }
    container = resolveLocalDbContainer();
  });

  function trial(body: string, options: TrialOptions = {}) {
    return spawnSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1"], {
      input: `BEGIN; SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='2s';\n${options.guard ?? ""}\n` +
        assembleFixture(options) +
        `${admissionFixture}\n${body}\nSELECT 'COMMON_POPULATION_NATIVE_ASSERTIONS_REACHED'; ROLLBACK;`,
      encoding: "utf8", timeout: 60_000, maxBuffer: 2 * 1024 * 1024,
    });
  }
  function accepts(body: string, options: TrialOptions = {}) {
    const result = trial(body, options);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("COMMON_POPULATION_NATIVE_ASSERTIONS_REACHED");
  }

  const positive = `${owner} DO $$ DECLARE s uuid; n integer; BEGIN
    s:=pg_temp.cp_snapshot(); PERFORM pg_temp.cp_all_links(s); PERFORM pg_temp.cp_ready(s);
    SELECT count(*) INTO n FROM public.scenario_comparison_model_run_links WHERE comparison_snapshot_id=s;
    IF n<>4 THEN RAISE EXCEPTION 'Four actual links were not visible'; END IF;
    PERFORM set_config('request.jwt.claim.sub',(SELECT viewer_id::text FROM cp_probe),true);
    SELECT count(*) INTO n FROM public.scenario_comparison_model_run_links WHERE comparison_snapshot_id=s;
    IF n<>4 THEN RAISE EXCEPTION 'Viewer could not read retained links'; END IF;
    PERFORM set_config('request.jwt.claim.sub',(SELECT outsider_id::text FROM cp_probe),true);
    SELECT count(*) INTO n FROM public.scenario_comparison_model_run_links WHERE comparison_snapshot_id=s;
    IF n<>0 THEN RAISE EXCEPTION 'Other tenant read retained links'; END IF;
    PERFORM set_config('request.jwt.claim.sub',(SELECT owner_id::text FROM cp_probe),true);
    BEGIN UPDATE public.scenario_comparison_snapshots SET label='Changed after ready' WHERE id=s;
      RAISE EXCEPTION 'Bound snapshot became mutable'; EXCEPTION WHEN raise_exception THEN
      IF SQLERRM<>'evidence-bound comparison snapshot semantics are immutable' THEN RAISE; END IF; END;
  END $$; RESET ROLE;
  SELECT pg_temp.cp_unchanged();
  SET LOCAL ROLE anon;
  DO $$ BEGIN BEGIN PERFORM 1 FROM public.scenario_comparison_model_run_links;
    RAISE EXCEPTION 'Anonymous comparison read accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
  RESET ROLE;
  DO $$ DECLARE r text; t text; BEGIN
    FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF has_function_privilege(r,'${signature}','EXECUTE') THEN RAISE EXCEPTION 'Population trigger became callable'; END IF;
      FOREACH t IN ARRAY ARRAY['model_stage_attempts','model_execution_custody_enrollment','model_stage_execution_starts','model_legacy_artifact_receipts'] LOOP
        IF has_table_privilege(r,'public.'||t,'SELECT') THEN RAISE EXCEPTION 'Protected custody rows became public'; END IF;
      END LOOP;
      IF has_function_privilege(r,'${stageSignature}','EXECUTE') IS DISTINCT FROM (r='service_role') THEN
        RAISE EXCEPTION 'Stage custody RPC privilege differs'; END IF;
    END LOOP;
    IF EXISTS(SELECT FROM pg_proc WHERE oid IN ('public.validate_scenario_comparison_model_run_link()'::regprocedure,
      'public.refuse_bound_comparison_snapshot_change()'::regprocedure) AND prosecdef) THEN RAISE EXCEPTION 'Original invoker guard became a definer'; END IF;
    IF NOT (SELECT prosecdef AND proconfig=ARRAY['search_path=""'] AND pg_get_userbyid(proowner)='postgres'
      FROM pg_proc WHERE oid='public.validate_managed_comparison_readiness()'::regprocedure) THEN RAISE EXCEPTION 'Readiness private authority is not confined'; END IF;
    FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF has_function_privilege(r,'public.validate_managed_comparison_readiness()','EXECUTE') THEN RAISE EXCEPTION 'Private readiness trigger became callable'; END IF;
      IF has_table_privilege(r,'public.model_attempt_instrument_receipts','SELECT') THEN RAISE EXCEPTION 'Private instrument receipts became readable'; END IF;
    END LOOP;
  END $$;`;

  // Prepared native cases. Ordinary Vitest collection skips these unless the
  // existing isolated-stack opt-in is set. SQL descriptors do not verify bytes.
  const noLegacyClaims = `DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM public.modeling_claim_decisions WHERE model_run_id IN(SELECT run_id FROM cp_jobs))
      THEN RAISE EXCEPTION 'Managed readiness fabricated legacy decisions'; END IF;
    IF (SELECT count(*) FROM public.model_run_relaunch_receipts WHERE request_payload->>'run_id'=(SELECT run_id::text FROM cp_jobs WHERE position=0))<>1
      THEN RAISE EXCEPTION 'Actual same-run retry receipt missing'; END IF;
    IF EXISTS(SELECT 1 FROM bridge_retained retained WHERE NOT EXISTS(SELECT 1 FROM public.model_run_artifacts artifact WHERE to_jsonb(artifact)=retained.artifact))
      THEN RAISE EXCEPTION 'Retained first-attempt artifacts changed'; END IF;
    IF EXISTS(SELECT 1 FROM bridge_retained retained WHERE NOT EXISTS(
      SELECT 1 FROM jsonb_array_elements(public.read_model_attempt_outputs((SELECT run_id FROM cp_jobs WHERE position=0),(SELECT workspace_id FROM cp_probe))->'outputs') projected
      WHERE projected->>'kind'='artifact' AND projected->>'ownership_state'='retained_inactive' AND projected->'record'=retained.artifact))
      THEN RAISE EXCEPTION 'Old evidence became current'; END IF;
  END $$;`;
  const instrumentRefusal = `${owner} DO $$ DECLARE s uuid; BEGIN
    s:=pg_temp.cp_snapshot(); PERFORM pg_temp.cp_all_links(s);
    BEGIN PERFORM pg_temp.cp_ready(s);
      RAISE EXCEPTION 'Invalid managed instrument was accepted';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM<>'managed comparison requires exact current inconclusive instrument custody' THEN RAISE; END IF;
    END;
    IF (SELECT status FROM public.scenario_comparison_snapshots WHERE id=s)<>'draft'
      OR (SELECT count(*) FROM public.scenario_comparison_model_run_links WHERE comparison_snapshot_id=s)<>4
      THEN RAISE EXCEPTION 'Managed readiness refusal was not atomic'; END IF;
  END $$; RESET ROLE; SELECT pg_temp.cp_unchanged();`;

  it("managed readiness bridge: current retry without legacy decisions", () => accepts(positive + noLegacyClaims, { source: readinessRetry }));
  it("matches the exact instrument receipt across session time zones", () => accepts("SET LOCAL TIME ZONE 'America/Los_Angeles';" + positive + noLegacyClaims, { source: readinessRetry }));
  it("managed readiness bridge survives harmless trigger commentary", () => accepts(positive + noLegacyClaims, {
    source: readinessRetry, guard: "COMMENT ON FUNCTION public.validate_managed_comparison_readiness() IS 'Harmless native control';",
  }));
  it.each([
    ["missing current custody", "UPDATE cp_jobs SET omit_instrument=true WHERE position=1;"],
    ["revoked retained-only custody", "UPDATE cp_jobs SET omit_instrument=true WHERE position=0;"],
    ["other output identity", "UPDATE cp_jobs SET instrument_output_id=gen_random_uuid() WHERE position=1;"],
    ["wrong demand method", "UPDATE cp_jobs SET instrument_method='activitysim' WHERE position=1;"],
    ["ambiguous exact instruments", "UPDATE cp_jobs SET duplicate_instrument=true WHERE position=1;"],
    ["empty instrument descriptor", "UPDATE cp_jobs SET instrument_bytes=0 WHERE position=1;"],
  ])("managed readiness refuses %s without changing the draft or retained records", (_name, output) => accepts(instrumentRefusal + noLegacyClaims, { source: readinessRetry, output }));
  it("keeps the existing snapshot UPDATE policy for members and outsiders", () => accepts(`${owner}
    DO $$ DECLARE s uuid; n integer; before_snapshot jsonb; before_links jsonb; BEGIN
      s:=pg_temp.cp_snapshot(); PERFORM pg_temp.cp_all_links(s);
      SELECT to_jsonb(snapshot) INTO before_snapshot FROM public.scenario_comparison_snapshots snapshot WHERE snapshot.id=s;
      SELECT jsonb_agg(to_jsonb(link) ORDER BY link.id) INTO before_links FROM public.scenario_comparison_model_run_links link WHERE link.comparison_snapshot_id=s;
      PERFORM set_config('request.jwt.claim.sub',(SELECT outsider_id::text FROM cp_probe),true);
      UPDATE public.scenario_comparison_snapshots SET status='ready' WHERE id=s;
      GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'Outsider updated snapshot'; END IF;
      PERFORM set_config('request.jwt.claim.sub',(SELECT viewer_id::text FROM cp_probe),true);
      UPDATE public.scenario_comparison_snapshots SET status='ready' WHERE id=s;
      GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'Viewer updated snapshot'; END IF;
      IF (SELECT to_jsonb(snapshot) FROM public.scenario_comparison_snapshots snapshot WHERE snapshot.id=s) IS DISTINCT FROM before_snapshot
        OR (SELECT jsonb_agg(to_jsonb(link) ORDER BY link.id) FROM public.scenario_comparison_model_run_links link WHERE link.comparison_snapshot_id=s) IS DISTINCT FROM before_links
        THEN RAISE EXCEPTION 'Viewer readiness attempt changed persisted evidence'; END IF;
      IF (SELECT status FROM public.scenario_comparison_snapshots WHERE id=s) IS DISTINCT FROM 'draft'
        OR (SELECT count(*) FROM public.scenario_comparison_model_run_links WHERE comparison_snapshot_id=s)<>4
        THEN RAISE EXCEPTION 'Viewer readiness no-op changed draft or four links'; END IF;
      PERFORM set_config('request.jwt.claim.sub',(SELECT owner_id::text FROM cp_probe),true);
      PERFORM pg_temp.cp_ready(s);
      IF (SELECT status FROM public.scenario_comparison_snapshots WHERE id=s) IS DISTINCT FROM 'ready'
        OR (SELECT count(*) FROM public.scenario_comparison_model_run_links WHERE comparison_snapshot_id=s)<>4
        THEN RAISE EXCEPTION 'Owner readiness did not persist ready with four links'; END IF;
    END $$; RESET ROLE; SELECT pg_temp.cp_unchanged();`));

  it("detects bypass of the private managed readiness guard", () => {
    const bypass = `DO $fault$ DECLARE definition text; BEGIN
      SELECT pg_get_functiondef('public.validate_managed_comparison_readiness()'::regprocedure) INTO definition;
      IF position('IF NOT v_run.attempt_managed THEN CONTINUE; END IF;' IN definition)=0 THEN RAISE EXCEPTION 'Readiness mutation anchor missing'; END IF;
      EXECUTE replace(definition,'IF NOT v_run.attempt_managed THEN CONTINUE; END IF;','RETURN NEW;');
    END $fault$;`;
    const result = trial(instrumentRefusal, { source: readinessRetry, output: "UPDATE cp_jobs SET omit_instrument=true WHERE position=0;", guard: bypass });
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid managed instrument was accepted");
  });

  it.each(["managed_attempt", "legacy_stage_snapshot"] as const)("accepts four exact %s outputs with existing writer/viewer/tenant/immutability boundaries", (custody) => accepts(positive, { custody }));
  it.each(["managed_attempt", "legacy_stage_snapshot"] as const)("survives harmless comments under %s", (custody) => accepts(positive, {
    custody, guard: `COMMENT ON FUNCTION ${signature} IS 'Harmless native control'; COMMENT ON FUNCTION ${stageSignature} IS 'Harmless RPC control';`,
  }));

  it.each([0, 1, 2, 3])("refuses missing consumed-population metadata on output %s at authenticated link insertion", (position) => {
    accepts(linkRefusal(position), { output: missingOutput(position) });
    accepts(linkRefusal(position), { custody: "legacy_stage_snapshot", output: missingOutput(position) });
  });
  it.each([
    "UPDATE cp_jobs SET metadata=jsonb_set(metadata,'{population_basis_payload_json}','\"{bad-json\"'::jsonb) WHERE position=1;",
    "UPDATE cp_jobs SET metadata=jsonb_set(metadata,'{population_basis_digest}',to_jsonb(repeat('f',64))) WHERE position=1;",
    `UPDATE cp_jobs SET metadata=jsonb_set(jsonb_set(metadata,'{population_basis,realized_zone_counts,0,persons}','5'::jsonb),
       '{population_basis,realized_zone_counts,1,persons}','1'::jsonb) WHERE position=1;
     UPDATE cp_jobs SET metadata=metadata||jsonb_build_object('population_basis_payload_json',public.model_truth_canonical_jsonb(metadata->'population_basis'),
       'population_basis_digest',encode(extensions.digest(convert_to(public.model_truth_canonical_jsonb(metadata->'population_basis'),'UTF8'),'sha256'),'hex')) WHERE position=1;`,
  ])("refuses tampered payload/hash or a different correctly hashed realization", (output) => accepts(linkRefusal(1), { output }));

  it("refuses an incomplete exact source artifact without mutating it", () => accepts(
    `${owner} SELECT pg_temp.cp_expect_refusal('SELECT pg_temp.cp_snapshot()'); RESET ROLE; SELECT pg_temp.cp_unchanged();`, { source: sourceFault },
  ));
  it.each(sourceCompanionKinds)("requires the unique source companion %s in both custody modes", (kind) => {
    for (const custody of ["managed_attempt", "legacy_stage_snapshot"] as const) accepts(
      `${owner} SELECT pg_temp.cp_expect_refusal('SELECT pg_temp.cp_snapshot()'); RESET ROLE;`,
      { custody, source: `DELETE FROM cp_source_files WHERE kind='${kind}';` },
    );
  });
  it.each([
    "INSERT INTO cp_source_files SELECT * FROM cp_source_files WHERE kind='common_population_households';",
    "UPDATE cp_source_files SET path='different_households.csv' WHERE kind='common_population_households';",
    "UPDATE cp_source_files SET metadata_override=(SELECT source_metadata||'{\"extra\":true}'::jsonb FROM cp_probe) WHERE kind='common_population_persons';",
    "UPDATE cp_source_files SET metadata_override=(SELECT source_metadata||jsonb_build_object('custody',CASE custody WHEN 'managed_attempt' THEN 'legacy_stage_snapshot' ELSE 'managed_attempt' END) FROM cp_probe) WHERE kind='common_population_diagnostics';",
    "UPDATE cp_source_files SET sha256=repeat('9',64) WHERE kind='common_population_selected_zones';",
    "UPDATE cp_source_files SET bytes=18 WHERE kind='common_population_source_manifest';",
  ])("refuses duplicate, path, metadata, custody or known descriptor companion drift", (source) => {
    for (const custody of ["managed_attempt", "legacy_stage_snapshot"] as const) accepts(
      `${owner} SELECT pg_temp.cp_expect_refusal('SELECT pg_temp.cp_snapshot()'); RESET ROLE;`, { custody, source },
    );
  });
  it.each(sourceCompanionKinds)("requires an exact ordinary source companion receipt for %s", (kind) => accepts(`
    DELETE FROM public.model_legacy_artifact_receipts WHERE artifact_id IN (SELECT artifact.id FROM public.model_run_artifacts artifact
      JOIN cp_groups g ON g.run_id=artifact.run_id AND g.name='main' WHERE artifact.artifact_type='${kind}');
    ${owner} SELECT pg_temp.cp_expect_refusal('SELECT pg_temp.cp_snapshot()'); RESET ROLE;`, { custody: "legacy_stage_snapshot" }));
  it("rechecks all source companion receipts at draft-to-ready admission", () => accepts(`
    ${owner} SELECT set_config('cp.snapshot',pg_temp.cp_snapshot()::text,true);
    SELECT pg_temp.cp_all_links(current_setting('cp.snapshot')::uuid); RESET ROLE;
    UPDATE public.model_legacy_artifact_receipts SET response_payload=response_payload-'metadata_json' WHERE artifact_id IN (
      SELECT artifact.id FROM public.model_run_artifacts artifact JOIN cp_groups g ON g.run_id=artifact.run_id AND g.name='main'
      WHERE artifact.artifact_type='common_population_source_manifest');
    ${owner} SELECT pg_temp.cp_expect_refusal(format('SELECT pg_temp.cp_ready(%L)',current_setting('cp.snapshot'))); RESET ROLE;`, { custody: "legacy_stage_snapshot" }));
  it("refuses an otherwise valid ordinary companion registered on the wrong producing stage", () => accepts(`
    SET LOCAL ROLE service_role;
    DO $$ DECLARE p cp_probe%ROWTYPE; g cp_groups%ROWTYPE; j cp_jobs%ROWTYPE; BEGIN
      SELECT * INTO p FROM cp_probe; SELECT * INTO g FROM cp_groups WHERE name='main'; SELECT * INTO j FROM cp_jobs WHERE position=0;
      PERFORM public.record_legacy_model_artifact(p.workspace_id,jsonb_build_object('id',gen_random_uuid(),'run_id',g.run_id,'stage_id',j.stage_id,
        'artifact_type','common_population_households','file_url','local://synthetic/'||g.run_id||'/households.csv','file_size_bytes',19,
        'content_hash',repeat('d',64),'metadata_json',p.source_metadata));
    END $$; RESET ROLE;
    ${owner} SELECT pg_temp.cp_expect_refusal('SELECT pg_temp.cp_snapshot()'); RESET ROLE;`,
    { custody: "legacy_stage_snapshot", source: "DELETE FROM cp_source_files WHERE kind='common_population_households';" },
  ));
  it("refuses a consistently hashed unsupported universe even when source and all consumers repeat it", () => accepts(
    `${owner} SELECT pg_temp.cp_expect_refusal('SELECT pg_temp.cp_snapshot()'); RESET ROLE;`, { source: `
      UPDATE cp_probe SET basis=jsonb_set(basis,'{universe}','"all_persons"'::jsonb);
      UPDATE cp_probe SET basis_payload=public.model_truth_canonical_jsonb(basis),
        basis_digest=encode(extensions.digest(convert_to(public.model_truth_canonical_jsonb(basis),'UTF8'),'sha256'),'hex');
      UPDATE cp_probe SET source_metadata=source_metadata||jsonb_build_object('population_basis',basis,'population_basis_payload_json',basis_payload,'population_basis_digest',basis_digest);`,
    },
  ));
  it.each(["same_workspace_other_project", "other_workspace"])("refuses a valid managed source from %s", (name) => accepts(`
    UPDATE cp_probe p SET claim=jsonb_set(jsonb_set(p.claim,'{source}',jsonb_build_object('modelRunId',g.run_id,'artifactId',g.artifact_id,
      'stageId',g.setup_id,'attemptId',g.attempt_id,'sha256',repeat('a',64),'sizeBytes',123)),'{sourceRunId}',to_jsonb(g.run_id::text))
      FROM cp_groups g WHERE g.name='${name}';
    ${owner} SELECT pg_temp.cp_expect_refusal('SELECT pg_temp.cp_snapshot()'); RESET ROLE;`));

  it.each([
    "UPDATE cp_probe SET claim=jsonb_set(claim,'{source,attemptId}',to_jsonb(gen_random_uuid()::text));",
    "UPDATE cp_probe SET claim=jsonb_set(claim,'{source,sha256}',to_jsonb(repeat('f',64)));",
    "UPDATE cp_probe SET claim=jsonb_set(claim,'{populationBasisDigest}',to_jsonb(repeat('f',64)));",
    "UPDATE cp_probe SET claim=jsonb_set(claim,'{populationBasis,manifest,bytes}','\"123\"'::jsonb);",
    "UPDATE cp_probe SET claim=jsonb_set(claim,'{populationBasis,realized_zone_counts,0,zone_id}','0'::jsonb);",
  ])("refuses malformed or mismatched frozen source/identity fields", (mutation) => accepts(
    `${mutation} ${owner} SELECT pg_temp.cp_expect_refusal('SELECT pg_temp.cp_snapshot()'); RESET ROLE;`,
  ));

  it("refuses a revoked exact baseline attempt even while its stage still names that attempt", () => accepts(`
    UPDATE public.model_stage_attempts SET revoked_at=clock_timestamp() WHERE id=(SELECT attempt_id FROM cp_groups WHERE name='main');
    ${owner} SELECT pg_temp.cp_expect_refusal('SELECT pg_temp.cp_snapshot()'); RESET ROLE;`));
  it("rechecks revoked consumed attempts at draft-to-ready after all links were accepted", () => accepts(`
    ${owner} SELECT set_config('cp.snapshot',pg_temp.cp_snapshot()::text,true);
    SELECT pg_temp.cp_all_links(current_setting('cp.snapshot')::uuid); RESET ROLE;
    UPDATE public.model_stage_attempts SET revoked_at=clock_timestamp() WHERE id=(SELECT attempt_id FROM cp_jobs WHERE position=3);
    ${owner} SELECT pg_temp.cp_expect_refusal(format('SELECT pg_temp.cp_ready(%L)',current_setting('cp.snapshot'))); RESET ROLE;`));

  const stageSourceCall = "SELECT public.read_common_population_stage_custody(p.workspace_id,g.run_id,g.setup_id,g.artifact_id) FROM cp_probe p,cp_groups g WHERE g.name='main'";
  it("returns only the exact service custody envelope for a retained ordinary source and denies anonymous/authenticated calls", () => accepts(`
    SET LOCAL ROLE service_role;
    DO $$ DECLARE actual jsonb; expected jsonb; BEGIN
      SELECT public.read_common_population_stage_custody(p.workspace_id,g.run_id,g.setup_id,g.artifact_id),
        jsonb_build_object('schema','openplan.common-population-stage-custody.v1','custody','legacy_stage_snapshot',
        'workspace_id',p.workspace_id,'run_id',g.run_id,'stage_id',g.setup_id,'artifact_id',g.artifact_id,'eligible',true)
        INTO actual,expected FROM cp_probe p,cp_groups g WHERE g.name='main';
      IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Stage custody envelope differs'; END IF;
    END $$; RESET ROLE;
    SET LOCAL ROLE authenticated;
    DO $$ BEGIN BEGIN ${stageSourceCall.replace("SELECT ", "PERFORM ")}; RAISE EXCEPTION 'Authenticated custody RPC accepted';
      EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$; RESET ROLE;
    SET LOCAL ROLE anon;
    DO $$ BEGIN BEGIN ${stageSourceCall.replace("SELECT ", "PERFORM ")}; RAISE EXCEPTION 'Anonymous custody RPC accepted';
      EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$; RESET ROLE;`, { custody: "legacy_stage_snapshot" }));

  it("attests a fresh ordinary Bundle claim only after its actual queued-to-running start", () => accepts(`
    DO $$ DECLARE r uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); p cp_probe%ROWTYPE; g cp_groups%ROWTYPE; result jsonb; BEGIN
      SELECT * INTO p FROM cp_probe; SELECT * INTO g FROM cp_groups WHERE name='main';
      INSERT INTO public.model_runs(id,workspace_id,project_id,model_id,scenario_set_id,scenario_entry_id,engine_key,status,run_title,input_snapshot_json)
        VALUES(r,p.workspace_id,g.project_id,p.asim_model,g.scenario_set_id,g.baseline_id,'behavioral_demand','queued','Fresh ordinary Bundle probe',
          jsonb_build_object('commonPopulation',jsonb_build_object('schema','openplan.common-population-request.v1','mode','reuse',
            'custody','legacy_stage_snapshot','comparisonPolicy','fixed_population_auto_trip_change','source',p.source_ref)));
      INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES(s,r,'ActivitySim Bundle & Preflight','queued',0);
      SET LOCAL ROLE service_role;
      PERFORM pg_temp.cp_expect_stage_refusal(format('SELECT public.read_common_population_stage_custody(%L,%L,%L,NULL)',p.workspace_id,r,s));
      UPDATE public.model_run_stages SET status='running',started_at=clock_timestamp() WHERE id=s AND run_id=r AND status='queued';
      IF NOT FOUND THEN RAISE EXCEPTION 'Fresh Bundle claim missed'; END IF;
      UPDATE public.model_runs SET status='running' WHERE id=r AND status='queued';
      result:=public.read_common_population_stage_custody(p.workspace_id,r,s,NULL);
      IF result IS DISTINCT FROM jsonb_build_object('schema','openplan.common-population-stage-custody.v1','custody','legacy_stage_snapshot',
        'workspace_id',p.workspace_id,'run_id',r,'stage_id',s,'artifact_id',NULL,'eligible',true) THEN RAISE EXCEPTION 'Bundle custody differs'; END IF;
      PERFORM pg_temp.cp_expect_stage_refusal(format('SELECT public.read_common_population_stage_custody(%L,%L,%L,NULL)',p.other_workspace,r,s),'Population scope mismatch');
      PERFORM pg_temp.cp_expect_stage_refusal(format('SELECT public.read_common_population_stage_custody(%L,%L,%L,NULL)',p.workspace_id,r,g.setup_id));
      RESET ROLE;
    END $$;`, { custody: "legacy_stage_snapshot" }));

  it("refuses managed flags at the ordinary RPC without reinterpreting them as legacy custody", () => accepts(`
    SET LOCAL ROLE service_role; SELECT pg_temp.cp_expect_stage_refusal($stage$${stageSourceCall}$stage$); RESET ROLE;`));
  it("refuses a receipt-backed artifact outside the fixed kind/producer allowlist", () => accepts(`
    SET LOCAL ROLE service_role;
    DO $$ DECLARE p cp_probe%ROWTYPE; g cp_groups%ROWTYPE; a uuid:=gen_random_uuid(); BEGIN
      SELECT * INTO p FROM cp_probe; SELECT * INTO g FROM cp_groups WHERE name='main';
      PERFORM public.record_legacy_model_artifact(p.workspace_id,jsonb_build_object('id',a,'run_id',g.run_id,'stage_id',g.setup_id,
        'artifact_type','population_notes','file_url','local://synthetic/unsupported','file_size_bytes',1,
        'content_hash',repeat('f',64),'metadata_json',p.source_metadata));
      PERFORM pg_temp.cp_expect_stage_refusal(format('SELECT public.read_common_population_stage_custody(%L,%L,%L,%L)',p.workspace_id,g.run_id,g.setup_id,a));
    END $$; RESET ROLE;`, { custody: "legacy_stage_snapshot" }));
  it.each([
    "UPDATE cp_probe SET claim=claim-'custody';",
    "UPDATE cp_probe SET claim=jsonb_set(claim,'{custody}','\"unknown\"'::jsonb);",
    "UPDATE cp_probe SET claim=jsonb_set(claim,'{custody}','\"managed_attempt\"'::jsonb);",
    "UPDATE cp_probe SET claim=jsonb_set(claim,'{source,attemptId}',to_jsonb(gen_random_uuid()::text));",
  ])("refuses missing/unknown/mixed ordinary custody instead of falling back", (mutation) => accepts(
    `${mutation} ${owner} SELECT pg_temp.cp_expect_refusal('SELECT pg_temp.cp_snapshot()'); RESET ROLE;`, { custody: "legacy_stage_snapshot" },
  ));
  it("refuses managed output metadata on an ordinary consumer", () => accepts(linkRefusal(2), {
    custody: "legacy_stage_snapshot", output: "UPDATE cp_jobs SET metadata=jsonb_set(metadata,'{population_custody}','\"managed_attempt\"'::jsonb) WHERE position=2;",
  }));
  it.each(["schema", "custody", "origin", "scientific_acceptance"])("requires exact ordinary source metadata field %s", (field) => accepts(
    `${owner} SELECT pg_temp.cp_expect_refusal('SELECT pg_temp.cp_snapshot()'); RESET ROLE;`,
    { custody: "legacy_stage_snapshot", source: `UPDATE cp_probe SET source_metadata=source_metadata-'${field}';` },
  ));
  it.each([
    "UPDATE public.model_legacy_artifact_receipts SET request_payload=jsonb_set(request_payload,'{payload,file_url}','\"local://changed\"'::jsonb) WHERE artifact_id=(SELECT artifact_id FROM cp_groups WHERE name='main');",
    "UPDATE public.model_legacy_artifact_receipts SET response_payload=response_payload-'metadata_json' WHERE artifact_id=(SELECT artifact_id FROM cp_groups WHERE name='main');",
    "DELETE FROM public.model_legacy_artifact_receipts WHERE artifact_id=(SELECT artifact_id FROM cp_groups WHERE name='main');",
  ])("refuses missing or nonidentical full legacy receipt in both service and comparison boundaries", (mutation) => accepts(`
    ${mutation} SET LOCAL ROLE service_role; SELECT pg_temp.cp_expect_stage_refusal($stage$${stageSourceCall}$stage$); RESET ROLE;
    ${owner} SELECT pg_temp.cp_expect_refusal('SELECT pg_temp.cp_snapshot()'); RESET ROLE;`, { custody: "legacy_stage_snapshot" }));
  it("rechecks the consumed output receipt at ready", () => accepts(`
    ${owner} SELECT set_config('cp.snapshot',pg_temp.cp_snapshot()::text,true);
    SELECT pg_temp.cp_all_links(current_setting('cp.snapshot')::uuid); RESET ROLE;
    UPDATE public.model_legacy_artifact_receipts SET request_payload=request_payload-'workspace_id' WHERE artifact_id=(SELECT artifact_id FROM cp_jobs WHERE position=3);
    ${owner} SELECT pg_temp.cp_expect_refusal(format('SELECT pg_temp.cp_ready(%L)',current_setting('cp.snapshot'))); RESET ROLE;`, { custody: "legacy_stage_snapshot" }));
  it("refuses a source whose actual project scope changed after receipt creation", () => accepts(`
    UPDATE public.model_runs SET project_id=(SELECT project_id FROM cp_groups WHERE name='same_workspace_other_project') WHERE id=(SELECT run_id FROM cp_groups WHERE name='main');
    ${owner} SELECT pg_temp.cp_expect_refusal('SELECT pg_temp.cp_snapshot()'); RESET ROLE;`, { custody: "legacy_stage_snapshot" }));
  it("refuses actual consumer geometry drift rather than treating the old receipt as a complete run freeze", () => accepts(`
    UPDATE public.model_runs SET corridor_geojson='{"type":"Polygon","coordinates":[[[2,2],[3,2],[3,3],[2,2]]]}'::jsonb WHERE id=(SELECT run_id FROM cp_jobs WHERE position=1);
    ${linkRefusal(1)}`, { custody: "legacy_stage_snapshot" }));
  it("refuses a fresh synthetic historical enrollment without changing or relabeling any historical row", () => accepts(`
    -- This new row models the pre-migration enrollment boundary inside rollback.
    -- Disable only automatic NEW enrollment while inserting this one synthetic row.
    ALTER TABLE public.model_runs DISABLE TRIGGER enroll_new_model_execution;
    INSERT INTO public.model_runs(id,workspace_id,project_id,model_id,scenario_set_id,scenario_entry_id,engine_key,status,run_title,input_snapshot_json)
      SELECT gen_random_uuid(),p.workspace_id,g.project_id,g.model_id,g.scenario_set_id,g.baseline_id,'aequilibrae','queued','Synthetic historical boundary',
        jsonb_build_object('commonPopulation',jsonb_build_object('schema','openplan.common-population-request.v1','mode','generate','custody','legacy_stage_snapshot',
          'comparisonPolicy','fixed_population_auto_trip_change','sourceProfile',p.profile)) FROM cp_probe p,cp_groups g WHERE g.name='main';
    ALTER TABLE public.model_runs ENABLE TRIGGER enroll_new_model_execution;
    INSERT INTO public.model_execution_custody_enrollment(run_id,provenance)
      SELECT id,'historical_unassessed' FROM public.model_runs WHERE run_title='Synthetic historical boundary' AND workspace_id=(SELECT workspace_id FROM cp_probe);
    SET LOCAL ROLE service_role;
    DO $$ DECLARE r uuid; BEGIN SELECT id INTO STRICT r FROM public.model_runs WHERE run_title='Synthetic historical boundary' AND workspace_id=(SELECT workspace_id FROM cp_probe);
      PERFORM pg_temp.cp_expect_stage_refusal(format('SELECT public.read_common_population_stage_custody(%L,%L,%L,NULL)',
        (SELECT workspace_id FROM cp_probe),r,(SELECT setup_id FROM cp_groups WHERE name='main'))); END $$; RESET ROLE;`, { custody: "legacy_stage_snapshot" }));
  it("rejects a direct ready insert with no four-link custody", () => accepts(
    `${owner} SELECT pg_temp.cp_expect_refusal('SELECT pg_temp.cp_snapshot(NULL, ''ready'')'); RESET ROLE;`,
  ));
  it("rejects a three-link ready transition", () => accepts(`${owner} DO $$ DECLARE s uuid; BEGIN
    s:=pg_temp.cp_snapshot(); FOR i IN 0..2 LOOP PERFORM pg_temp.cp_link(s,i); END LOOP;
    BEGIN PERFORM pg_temp.cp_ready(s); RAISE EXCEPTION 'Three-link ready accepted'; EXCEPTION WHEN raise_exception THEN
      IF SQLERRM<>'a ready guided comparison requires all four exact model-run links' THEN RAISE; END IF; END;
    END $$; RESET ROLE;`));

  it("refuses viewer snapshot writes before protected attempt reads", () => accepts(`
    SELECT set_config('request.jwt.claim.sub',viewer_id::text,true) FROM cp_probe;
    ${owner} SELECT pg_temp.cp_expect_refusal('SELECT pg_temp.cp_snapshot()'); RESET ROLE;`));
  it("refuses an outsider at parent authorization before private custody reads", () => accepts(`
    SELECT set_config('request.jwt.claim.sub',outsider_id::text,true) FROM cp_probe;
    ${owner} SELECT pg_temp.cp_expect_refusal('SELECT pg_temp.cp_snapshot()'); RESET ROLE;`));

  it.each(["{}", '{"commonPopulation":null}', '{"commonPopulation":[]}', '{"commonPopulation":"bad"}',
    '{"commonPopulation":{"schema":"openplan.future-population.v1","comparisonPolicy":"population_changing"}}'])
    ("refuses guided links and ready publication without an exact supported claim: %s", (metadata) => accepts(`
      ${owner} DO $$ DECLARE s uuid; BEGIN s:=pg_temp.cp_snapshot('${metadata}'::jsonb);
        PERFORM pg_temp.cp_expect_refusal(format('SELECT pg_temp.cp_link(%L,0)',s));
        PERFORM pg_temp.cp_expect_refusal(format('SELECT pg_temp.cp_ready(%L)',s));
        PERFORM pg_temp.cp_expect_refusal('SELECT pg_temp.cp_snapshot(''${metadata}''::jsonb, ''ready'')');
      END $$; RESET ROLE; SELECT pg_temp.cp_unchanged();`,
      { output: "UPDATE cp_jobs SET metadata=metadata-ARRAY['population_basis','population_basis_payload_json','population_basis_digest'];" },
    ));

  it.each(["{}", '{"commonPopulation":{"schema":"openplan.future-population.v1","comparisonPolicy":"population_changing"}}'])
    ("preserves genuinely generic ready creation and same-claim updates: %s", (metadata) => accepts(`
      ${owner} DO $$ DECLARE s uuid; BEGIN s:=pg_temp.cp_generic_snapshot('${metadata}'::jsonb);
        UPDATE public.scenario_comparison_snapshots SET status='ready' WHERE id=s;
        IF EXISTS(SELECT 1 FROM public.scenario_comparison_model_run_links WHERE comparison_snapshot_id=s) THEN
          RAISE EXCEPTION 'Generic survivor borrowed guided links'; END IF;
      END $$; RESET ROLE; SELECT pg_temp.cp_unchanged();`));

  it.each(['{"commonPopulation":{"schema":"openplan.common-population-comparison.v1"}}',
    '{"commonPopulation":{"comparisonPolicy":"fixed_population_auto_trip_change"}}'])
    ("makes either exact fixed-population marker opt into full validation: %s", (metadata) => accepts(`
      ${owner} SELECT pg_temp.cp_expect_refusal('SELECT pg_temp.cp_generic_snapshot(''${metadata}''::jsonb,''draft'')'); RESET ROLE;`));

  it("refuses an unchanged-claim ready scope move into a guided set", () => accepts(`
    ${owner} DO $$ DECLARE s uuid; g cp_groups%ROWTYPE; BEGIN
      s:=pg_temp.cp_generic_snapshot(); SELECT * INTO g FROM cp_groups WHERE name='main';
      PERFORM pg_temp.cp_expect_refusal(format('UPDATE public.scenario_comparison_snapshots SET scenario_set_id=%L,baseline_entry_id=%L,candidate_entry_id=%L WHERE id=%L',
        g.scenario_set_id,g.baseline_id,g.build_id,s)); END $$; RESET ROLE;`));

  it("rechecks complete ordinary source receipts on unchanged-claim ready updates and permits inert archival", () => accepts(`
    ${owner} SELECT set_config('cp.snapshot',pg_temp.cp_snapshot()::text,true);
    SELECT pg_temp.cp_all_links(current_setting('cp.snapshot')::uuid); SELECT pg_temp.cp_ready(current_setting('cp.snapshot')::uuid); RESET ROLE;
    UPDATE public.model_legacy_artifact_receipts SET response_payload=response_payload-'metadata_json' WHERE artifact_id IN (
      SELECT artifact.id FROM public.model_run_artifacts artifact JOIN cp_groups g ON g.run_id=artifact.run_id AND g.name='main'
      WHERE artifact.artifact_type='common_population_source_manifest');
    ${owner} SELECT pg_temp.cp_expect_refusal(format('SELECT pg_temp.cp_ready(%L)',current_setting('cp.snapshot')));
    UPDATE public.scenario_comparison_snapshots SET status='archived' WHERE id=current_setting('cp.snapshot')::uuid;
    DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.scenario_comparison_snapshots
      WHERE id=current_setting('cp.snapshot')::uuid AND status='archived') THEN RAISE EXCEPTION 'Inert archive failed'; END IF; END $$;
    RESET ROLE;`, { custody: "legacy_stage_snapshot" }));

  it.each(['{"guidedProjectComparison":"openplan.project_comparison.v1"}', '{"guidedProjectComparison":null}',
    '{"guidedProjectComparison":"openplan.project_comparison.v999"}', '{"method":"activitysim","networkBasis":{"kind":"worker_osm_snapshot"}}'])
    ("refuses guided intent introduction into a ready generic set: %s", (config) => accepts(`
      ${owner} SELECT pg_temp.cp_generic_snapshot(); RESET ROLE;
      SELECT pg_temp.cp_expect_refusal('SELECT pg_temp.cp_generic_model(''${config}''::jsonb)');
      DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.models WHERE scenario_set_id=(SELECT set_id FROM cp_generic_scope)) THEN
        RAISE EXCEPTION 'Refused guided insert retained a model'; END IF; END $$;`));

  it.each(["NULL", "'\"openplan.project_comparison.v999\"'::jsonb"])("refuses unsupported actual marker %s at guided ready admission", (marker) => accepts(`
    UPDATE public.models SET config_json=jsonb_build_object('guidedProjectComparison',${marker})
      WHERE scenario_set_id=(SELECT scenario_set_id FROM cp_groups WHERE name='main');
    ${owner} SELECT pg_temp.cp_expect_refusal('SELECT pg_temp.cp_snapshot(NULL,''ready'')'); RESET ROLE;`));

  it("refuses config removal, DELETE and OLD/NEW scope moves affecting bound evidence", () => accepts(`
    ${owner} DO $$ DECLARE s uuid; BEGIN s:=pg_temp.cp_snapshot(); PERFORM pg_temp.cp_all_links(s); PERFORM pg_temp.cp_ready(s); END $$; RESET ROLE;
    DO $$ DECLARE m uuid; g cp_generic_scope%ROWTYPE; BEGIN
      SELECT model_id INTO m FROM cp_groups WHERE name='main'; SELECT * INTO g FROM cp_generic_scope;
      PERFORM pg_temp.cp_expect_refusal(format('UPDATE public.models SET config_json=''{}'' WHERE id=%L',m));
      PERFORM pg_temp.cp_expect_refusal(format('UPDATE public.models SET scenario_set_id=%L WHERE id=%L',g.set_id,m));
      PERFORM pg_temp.cp_expect_refusal(format('DELETE FROM public.models WHERE id=%L',m));
      UPDATE public.models SET title='Harmless model label',config_json=config_json WHERE id=m;
    END $$; SELECT pg_temp.cp_unchanged();`));

  it("refuses guided moves into ready sets and foreign project/workspace attachment", () => accepts(`
    ${owner} SELECT pg_temp.cp_generic_snapshot(); RESET ROLE;
    SELECT pg_temp.cp_expect_refusal('UPDATE public.models SET scenario_set_id=(SELECT set_id FROM cp_generic_scope) WHERE id=(SELECT model_id FROM cp_groups WHERE name=''main'')');
    SELECT pg_temp.cp_expect_refusal('UPDATE public.models SET project_id=(SELECT project_id FROM cp_groups WHERE name=''same_workspace_other_project'') WHERE id=(SELECT model_id FROM cp_groups WHERE name=''main'')');
    SELECT pg_temp.cp_expect_refusal('UPDATE public.models SET workspace_id=(SELECT workspace_id FROM cp_groups WHERE name=''other_workspace'') WHERE id=(SELECT model_id FROM cp_groups WHERE name=''main'')');`));

  it("preserves generic model writes in ready sets and guided edits in unbound unfinished drafts", () => accepts(`
    ${owner} SELECT pg_temp.cp_generic_snapshot(); SELECT pg_temp.cp_snapshot('{}'); RESET ROLE;
    SELECT pg_temp.cp_generic_model();
    UPDATE public.models SET config_json='{"generic":"updated"}' WHERE id=(SELECT model_id FROM cp_generic_scope);
    UPDATE public.models SET config_json='{}' WHERE scenario_set_id=(SELECT scenario_set_id FROM cp_groups WHERE name='main');
    DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.models WHERE scenario_set_id=(SELECT scenario_set_id FROM cp_groups WHERE name='main')
      AND config_json <> '{}') THEN RAISE EXCEPTION 'Unfinished model edit did not reach both methods'; END IF; END $$;`));

  it("rolls back every row of a mixed multi-row guided introduction", () => accepts(`
    ${owner} SELECT pg_temp.cp_generic_snapshot(); RESET ROLE;
    SELECT pg_temp.cp_expect_refusal('INSERT INTO public.models(workspace_id,project_id,scenario_set_id,title,model_family,config_json)
      SELECT g.workspace_id,g.project_id,s.set_id,''Synthetic multi-row'',''other'',x.config
      FROM cp_groups g,cp_generic_scope s,(VALUES (''{}''::jsonb),(''{"guidedProjectComparison":null}''::jsonb)) x(config) WHERE g.name=''main''');
    DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.models WHERE scenario_set_id=(SELECT set_id FROM cp_generic_scope)) THEN
      RAISE EXCEPTION 'Mixed statement retained an earlier generic row'; END IF; END $$;`));

  it("retains both models after refused multi-row intent removal or deletion", () => accepts(`
    ${owner} DO $$ DECLARE s uuid; BEGIN s:=pg_temp.cp_snapshot(); PERFORM pg_temp.cp_all_links(s); PERFORM pg_temp.cp_ready(s); END $$; RESET ROLE;
    DO $$ DECLARE before_rows jsonb; after_rows jsonb; BEGIN
      SELECT jsonb_agg(to_jsonb(model) ORDER BY model.id) INTO before_rows FROM public.models model
        WHERE scenario_set_id=(SELECT scenario_set_id FROM cp_groups WHERE name='main');
      IF jsonb_array_length(before_rows)<>2 THEN RAISE EXCEPTION 'Two guided models were not in scope'; END IF;
      PERFORM pg_temp.cp_expect_refusal('UPDATE public.models SET config_json=''{}'' WHERE scenario_set_id=(SELECT scenario_set_id FROM cp_groups WHERE name=''main'')');
      PERFORM pg_temp.cp_expect_refusal('DELETE FROM public.models WHERE scenario_set_id=(SELECT scenario_set_id FROM cp_groups WHERE name=''main'')');
      SELECT jsonb_agg(to_jsonb(model) ORDER BY model.id) INTO after_rows FROM public.models model
        WHERE scenario_set_id=(SELECT scenario_set_id FROM cp_groups WHERE name='main');
      IF after_rows IS DISTINCT FROM before_rows THEN RAISE EXCEPTION 'Refused model statement changed rows'; END IF;
    END $$; SELECT pg_temp.cp_unchanged();`));

  it("permits generic model deletion beside a generic ready snapshot", () => accepts(`
    ${owner} SELECT pg_temp.cp_generic_snapshot(); RESET ROLE; SELECT pg_temp.cp_generic_model();
    DELETE FROM public.models WHERE id=(SELECT model_id FROM cp_generic_scope);
    DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.models WHERE scenario_set_id=(SELECT set_id FROM cp_generic_scope)) THEN
      RAISE EXCEPTION 'Generic deletion did not execute'; END IF;
      IF (SELECT count(*) FROM public.scenario_comparison_snapshots WHERE scenario_set_id=(SELECT set_id FROM cp_generic_scope) AND status='ready')<>1 THEN
        RAISE EXCEPTION 'Generic deletion changed ready evidence'; END IF; END $$;`));

  it.each(["managed_attempt", "legacy_stage_snapshot"] as const)("detects disabling the population link trigger under %s", (custody) => {
    const result = trial(linkRefusal(1), { output: missingOutput(1),
      custody, guard: "ALTER TABLE public.scenario_comparison_model_run_links DISABLE TRIGGER zz_validate_common_population_comparison_link;" });
    expect(result.error).toBeUndefined(); expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid population claim was accepted");
  });
  it.each(["managed_attempt", "legacy_stage_snapshot"] as const)("detects disabling the population snapshot trigger under %s", (custody) => {
    const result = trial(`${owner} SELECT pg_temp.cp_expect_refusal('SELECT pg_temp.cp_snapshot()'); RESET ROLE;`, {
      custody, source: sourceFault, guard: "ALTER TABLE public.scenario_comparison_snapshots DISABLE TRIGGER zz_validate_common_population_comparison_snapshot;",
    });
    expect(result.error).toBeUndefined(); expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid population claim was accepted");
  });
  it("detects an RPC that stops comparing the complete retained response", () => {
    const result = trial(`
      UPDATE public.model_legacy_artifact_receipts SET response_payload=response_payload-'metadata_json' WHERE artifact_id=(SELECT artifact_id FROM cp_groups WHERE name='main');
      SET LOCAL ROLE service_role; SELECT pg_temp.cp_expect_stage_refusal($stage$${stageSourceCall}$stage$); RESET ROLE;`, {
      custody: "legacy_stage_snapshot", guard: `DO $$ DECLARE definition text; broken text; BEGIN
        definition:=pg_get_functiondef('${ordinaryStageSignature}'::regprocedure);
        broken:=replace(definition,'AND receipt.response_payload = pg_catalog.to_jsonb(v_artifact)','');
        IF broken=definition THEN RAISE EXCEPTION 'Receipt mutation anchor missing'; END IF;
        EXECUTE broken;
      END $$;`,
    });
    expect(result.error).toBeUndefined(); expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid stage custody was accepted");
  });
  it("detects skipping the fixed source companion enumeration", () => {
    const result = trial(`${owner} SELECT pg_temp.cp_expect_refusal('SELECT pg_temp.cp_snapshot()'); RESET ROLE;`, {
      custody: "legacy_stage_snapshot", source: "DELETE FROM cp_source_files WHERE kind='common_population_households';",
      guard: `DO $$ DECLARE definition text; broken text; BEGIN
        definition:=pg_get_functiondef('${signature}'::regprocedure);
        broken:=replace(definition,
          $loop$FOREACH v_key IN ARRAY ARRAY['households','persons','selected_zones','diagnostics','source_manifest','source_zone_attributes'] LOOP$loop$,
          $loop$FOREACH v_key IN ARRAY ARRAY[]::pg_catalog.text[] LOOP$loop$);
        IF broken=definition THEN RAISE EXCEPTION 'Companion mutation anchor missing'; END IF;
        EXECUTE broken;
      END $$;`,
    });
    expect(result.error).toBeUndefined(); expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid population claim was accepted");
  });

  // P2 additions leave every P1 case and its default fixture path unchanged.
  it("checks native profile membership, installed callers and effective private ACLs", () => accepts(profileFixture));
  it.each(["managed_attempt", "legacy_stage_snapshot"] as const)("retains canonical 2022 comparisons without enabling new guided launch under %s", (custody) => accepts(positive, {
    custody, profileSql: `UPDATE cp_probe SET profile='{"adapter":"us_census_acs5_pums","acs_summary_endpoint":"https://api.census.gov/data/2022/acs/acs5","pums_endpoint":"https://api.census.gov/data/2022/acs/acs5/pums","sample_years":[2018,2022],"income_dollar_year":2022,"puma_fields":{"2020":"PUMA20","2010":"PUMA10"}}';`,
  }));
  const profileFaults = [
    `profile||'{"extra":true}'::jsonb`, `profile||'{"adapter":"unknown"}'::jsonb`,
    `profile||'{"income_dollar_year":2024}'::jsonb`, `profile||'{"sample_years":[2018,2023]}'::jsonb`,
    `profile||'{"puma_fields":{"2020":"PUMA20","2010":"PUMA10"}}'::jsonb`,
    `profile||'{"pums_endpoint":"https://api.census.gov/data/2022/acs/acs5/pums"}'::jsonb`,
    `profile||'{"pums_endpoint":"https://api.census.gov/data/2023/acs/acs5/pums/"}'::jsonb`,
  ];
  it.each(profileFaults)("refuses an exactly propagated but unregistered profile at comparison admission: %s", (fault) => accepts(
    `${owner} SELECT pg_temp.cp_expect_refusal('SELECT pg_temp.cp_snapshot()'); RESET ROLE;`,
    { profileSql: `UPDATE cp_probe SET profile=${fault};` },
  ));
  it("reaches the actual renamed ordinary profile caller with supported and extra-field inputs", () => accepts(`${profileFixture}
    SELECT pg_temp.cp_profile_ordinary_probe((SELECT profile FROM cp_probe),true);
    SELECT pg_temp.cp_profile_ordinary_probe((SELECT profile||'{"extra":true}'::jsonb FROM cp_probe),false);`));
  it.each(["comparison", "ordinary"])("detects removing the installed %s profile call at its acceptance sentinel", (caller) => {
    const target = caller === "comparison" ? signature : ordinaryStageSignature;
    const guard = `DO $$ DECLARE definition text; broken text; BEGIN
      definition:=pg_get_functiondef('${target}'::regprocedure);
      broken:=replace(definition,$anchor$public.model_common_population_profile_allowed(v_profile,'retained_validation') IS DISTINCT FROM true$anchor$,'false');
      IF broken=definition THEN RAISE EXCEPTION 'Profile mutation anchor missing'; END IF; EXECUTE broken;
    END $$;`;
    const result = caller === "comparison" ? trial(
      `${owner} SELECT pg_temp.cp_expect_refusal('SELECT pg_temp.cp_snapshot()'); RESET ROLE;`,
      { guard, profileSql: `UPDATE cp_probe SET profile=profile||'{"extra":true}'::jsonb;` },
    ) : trial(`${profileFixture}
      ${guard}
      SELECT pg_temp.cp_profile_ordinary_probe((SELECT profile||'{"extra":true}'::jsonb FROM cp_probe),false);`);
    expect(result.error).toBeUndefined(); expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(caller === "comparison" ? "Invalid population claim was accepted" : "Invalid registered profile stage custody accepted");
  });

});
