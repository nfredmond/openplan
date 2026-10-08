import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

import { requireContractVerificationStack } from "./helpers/contract-verification-stack";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { LIVE_RLS } from "./local-supabase-env";

const artifacts = [
  ["validation_input_bundle_v2", "openplan.validation-input-bundle.v2"],
  ["pre_volume_match_audit_v2", "openplan.pre-volume-observation-match-audit.v2"],
  ["model_comparison_basis_v2", "openplan.model-comparison-basis.v2"],
  ["model_validation_assessment_v2", "openplan.model-validation-assessment.v2"],
  ["model_validation_structural_diagnosis_v2", "openplan.model-validation-structural-diagnosis.v2"],
] as const;
const malformed = [
  ["omitted schema", {}],
  ["null schema", { schema: null }],
  ["null document", null],
  ["wrong schema", { schema: "openplan.wrong.v2" }],
] as const;
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

(LIVE_RLS ? describe : describe.skip)("comparable observation v2 native metadata custody", () => {
  let container: string;
  beforeAll(() => {
    container = resolveLocalDbContainer();
    requireContractVerificationStack(container);
  });

  // Exercise the installed RPC and trigger. Synthetic rows and optional guard
  // mutations stay inside one transaction, including on assertion failure.
  function check(invalidIndex?: number, metadata?: unknown) {
    const workspace = randomUUID();
    const model = randomUUID();
    const run = randomUUID();
    const actor = randomUUID();
    const ids = artifacts.map(() => randomUUID());
    const hashes = artifacts.map((_, index) => String(index + 1).repeat(64));
    const mutationPath = process.env.OPENPLAN_MODEL_CUSTODY_TEST_SQL;
    const mutation = mutationPath ? readFileSync(mutationPath, "utf8") : "";
    const inserts = artifacts.map(([type, schema], index) => {
      const value = index === invalidIndex ? metadata : { schema, harmlessExtra: "retained" };
      return `INSERT INTO public.model_run_artifacts
        (id, run_id, artifact_type, file_url, file_size_bytes, content_hash, metadata_json)
        VALUES ('${ids[index]}','${run}',${quote(type)},'storage://synthetic/${run}/${index}.json',10,
          '${hashes[index]}',${quote(JSON.stringify(value))}::jsonb);`;
    }).join("\n");
    const call = `PERFORM public.record_modeling_validation_instrument_v2(
      '${workspace}','${run}',${ids.map((id, index) => `'${id}','${hashes[index]}'`).join(",")},'inconclusive');`;
    const assertion = invalidIndex === undefined
      ? `${call}
        IF (SELECT count(*) FROM public.modeling_validation_instrument_v2_custody
            WHERE model_run_id='${run}' AND scientific_outcome='inconclusive') <> 1 THEN
          RAISE EXCEPTION 'valid custody was not retained';
        END IF;`
      : `BEGIN
          ${call}
        EXCEPTION WHEN SQLSTATE 'P0001' THEN
          IF SQLERRM <> 'comparable observation schema metadata does not match custody' THEN RAISE; END IF;
          rejected := true;
        END;
        IF NOT rejected THEN RAISE EXCEPTION 'malformed metadata was accepted'; END IF;
        IF EXISTS (SELECT 1 FROM public.modeling_validation_instrument_v2_custody WHERE model_run_id='${run}') THEN
          RAISE EXCEPTION 'rejected metadata left custody behind';
        END IF;`;
    const result = spawnSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], {
      input: `BEGIN;
        SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='1s';
        ${mutation}
        INSERT INTO auth.users(id,email) VALUES ('${actor}','custody-${actor}@example.test');
        INSERT INTO public.workspaces(id,name,slug) VALUES ('${workspace}','Synthetic custody','custody-${workspace}');
        INSERT INTO public.models(id,workspace_id,title,model_family,created_by)
          VALUES ('${model}','${workspace}','Synthetic custody','travel_demand','${actor}');
        INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
          VALUES ('${run}','${workspace}','${model}','aequilibrae','succeeded','Synthetic custody','${actor}');
        ${inserts}
        SET LOCAL ROLE service_role;
        DO $proof$ DECLARE rejected boolean := false; BEGIN
          ${assertion}
        END; $proof$;
        SELECT 'CUSTODY_METADATA_ASSERTIONS_REACHED';
        ROLLBACK;`,
      encoding: "utf8", timeout: 15_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("CUSTODY_METADATA_ASSERTIONS_REACHED");
    expect(result.stdout).toContain("ROLLBACK");
  }

  it("accepts all five correct schemas with extra metadata", () => check());
  artifacts.forEach(([type], index) => {
    it.each(malformed)(`refuses %s for ${type} without retaining custody`, (_label, metadata) => {
      check(index, metadata);
    });
  });
});
