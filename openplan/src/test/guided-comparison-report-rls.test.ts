import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

// Run only through the existing selected live suite on a fresh isolated stack.
// SQL roles model the route's service INSERT and member writeback. They do not
// execute its authorization/verifier, HTTP requests, Storage or report rendering.
describe.skipIf(!LIVE_RLS)("guided Reports native retention and writer roles", () => {
  let container: string;
  beforeAll(() => {
    container = resolveLocalDbContainer();
    requireContractVerificationStack(container);
  });

  function exercise(fixture: string, mutation = "") {
    const ids = new Map<string, string>();
    const input = `BEGIN; SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='2s';
      ${mutation}\n${fixture}\nROLLBACK;\n\\echo GUIDED_REPORT_ROLLBACK_REACHED\n`
      .replace(/__([A-Z_]+)__/g, (_, key: string) => {
        if (!ids.has(key)) ids.set(key, randomUUID());
        return ids.get(key)!;
      });
    return spawnSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1"], {
      input, encoding: "utf8", timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
    });
  }

  function retention(mutation = "") {
    return exercise(readFileSync("src/test/fixtures/reports/guided-comparison-retention.sql", "utf8"), mutation);
  }

  function expectSuccess(result: ReturnType<typeof exercise>, marker: string) {
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(marker);
    expect(result.stdout).toContain("GUIDED_REPORT_ROLLBACK_REACHED");
  }

  // These deliberate guard bypasses live only inside the enclosing rollback.
  // They are never used for fixture cleanup or installed as migrations.
  function replaceGuardStatement(from: string, to: string) {
    return `DO $mutation$ DECLARE definition text; needle text := $needle$${from}$needle$; BEGIN
      definition:=pg_get_functiondef('public.guard_report_guided_comparison_artifact()'::regprocedure);
      IF (length(definition)-length(replace(definition,needle,'')))/length(needle) <> 1 THEN
        RAISE EXCEPTION 'Native mutation anchor must occur once';
      END IF;
      EXECUTE replace(definition,needle,$replacement$${to}$replacement$);
    END $mutation$;`;
  }

  it("composes service insertion with member CAS/receipt and retains selected history without changing legacy writes", () => {
    expectSuccess(retention(), "GUIDED_REPORT_NATIVE_ASSERTIONS_REACHED");
  });

  it("survives a harmless trigger-function comment", () => {
    expectSuccess(retention("COMMENT ON FUNCTION public.guard_report_guided_comparison_artifact() IS 'SYNTHETIC harmless native control';"),
      "GUIDED_REPORT_NATIVE_ASSERTIONS_REACHED");
  });

  it.each([
    ["authenticated selected insertion",
      "IF current_user NOT IN ('service_role', 'postgres') THEN", "IF false THEN",
      "authenticated selected INSERT refused: accepted"],
    ["selected DELETE retention",
      "RAISE EXCEPTION 'Retained guided artifacts cannot be deleted or replaced' USING ERRCODE = '23514';", "RETURN OLD;",
      "selected DELETE refused: accepted"],
    ["first receipt revision comparison",
      "RAISE EXCEPTION 'Guided generation receipt does not match report writeback' USING ERRCODE = '40001';", "NULL;",
      "wrong first receipt refused: accepted"],
  ])("detects a bypass of %s at the intended native assertion", (_label, from, to, assertion) => {
    const result = retention(replaceGuardStatement(from, to));
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(3); // psql ON_ERROR_STOP, rather than process/runner failure.
    expect(result.stderr).toContain(assertion);
    expect(result.stdout).not.toContain("GUIDED_REPORT_NATIVE_ASSERTIONS_REACHED");
    expect(result.stdout).not.toContain("GUIDED_REPORT_ROLLBACK_REACHED");
    // psql disconnect rolls back the failed transaction, including the bypass.
  });

  it("detects the old transaction-stable Reports revision setter", () => {
    const result = retention(`CREATE OR REPLACE FUNCTION public.set_report_revision_updated_at()
      RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
      BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;`);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(3);
    expect(result.stderr).toContain("Reports revision must advance");
    expect(result.stdout).not.toContain("GUIDED_REPORT_NATIVE_ASSERTIONS_REACHED");
  });

  it("retains the unmutated baseline after all transaction-local faults", () => {
    expectSuccess(retention(), "GUIDED_REPORT_NATIVE_ASSERTIONS_REACHED");
  });

  it("keeps the existing Safety persistence RPC compatible when both guards protect one artifact", () => {
    const fixture = readFileSync("src/test/fixtures/grants/safety-seed-native.sql", "utf8");
    expectSuccess(exercise(`${fixture}
      SELECT pg_temp.assert_safety((SELECT count(*)=1 FROM public.workspace_members
        WHERE user_id='__ACTOR__' AND role='owner'),'Synthetic Safety actor must own exactly one workspace');
      -- Reuse existing Safety setup, then refresh its P0 after selecting Reports scope.
      UPDATE public.reports SET report_type='analysis_summary' WHERE id='__REPORT__';
      UPDATE safety_input SET project_before=p.updated_at,report_before=r.updated_at,
        artifact=jsonb_set(jsonb_set(artifact,'{metadata_json,safetyPlanSnapshotV1,projectUpdatedAt}',to_jsonb(p.updated_at)),
          '{metadata_json,safetyPlanSnapshotV1,reportUpdatedAt}',to_jsonb(r.updated_at))
        FROM public.projects p JOIN public.reports r ON r.project_id=p.id
        WHERE p.id='__PROJECT__' AND r.id='__REPORT__';
      UPDATE safety_input SET artifact=jsonb_set(artifact,'{storage_path}',
        to_jsonb(pg_temp.safety_workspace()::text||'/__REPORT__/__ARTIFACT__.html'));
      DO $$ DECLARE selection jsonb; BEGIN
        selection:=jsonb_build_object('version',1,'bindingSha256',repeat('a',64),'snapshotId','__SNAPSHOT__',
          'payload',jsonb_build_object('schema','openplan.guided-comparison-report.v1',
            'workspaceId',pg_temp.safety_workspace(),'projectId','__PROJECT__','snapshotId','__SNAPSHOT__',
            'syntheticSqlFixture',true,'scientificStatus','inconclusive'));
        UPDATE safety_input SET artifact=jsonb_set(jsonb_set(artifact,
          '{metadata_json,guidedComparisonSelectionV1}',selection),'{metadata_json,sourceContext}',
          jsonb_build_object('guidedComparisonSelectionV1',selection));
      END $$;
      SELECT set_config('request.jwt.claim.sub','',true);
      SELECT set_config('request.jwt.claim.role','service_role',true);
      SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
      SET LOCAL ROLE service_role;
      SELECT pg_temp.assert_safety(current_user='service_role' AND auth.uid() IS NULL,'Safety service must not borrow a member session');
      SELECT pg_temp.persist_safety();
      DO $$ DECLARE custody public.report_safety_snapshot_persistence; BEGIN
        SELECT * INTO STRICT custody FROM public.report_safety_snapshot_persistence WHERE artifact_id='__ARTIFACT__';
        PERFORM pg_temp.assert_safety(custody.report_updated_at>custody.source_report_updated_at,'Safety report revision must advance');
        PERFORM pg_temp.assert_safety((SELECT
          (metadata_json->'generationWriteback'->>'reportUpdatedAt')::timestamptz=custody.report_updated_at
          AND metadata_json->'guidedComparisonSelectionV1'=metadata_json->'sourceContext'->'guidedComparisonSelectionV1'
          AND metadata_json->'safetyPlanSnapshotV1' IS NOT NULL
          FROM public.report_artifacts WHERE id='__ARTIFACT__'),'Safety and guided receipt/selection compatibility');
        BEGIN UPDATE public.report_artifacts SET metadata_json=metadata_json-'safetyPlanSnapshotV1' WHERE id='__ARTIFACT__';
          RAISE EXCEPTION 'Safety snapshot removal accepted';
          EXCEPTION WHEN check_violation THEN
            IF SQLERRM <> 'Safety snapshots are immutable; regenerate a new artifact' THEN RAISE; END IF;
        END;
      END $$;
      RESET ROLE;
      SELECT 'GUIDED_SAFETY_NATIVE_ASSERTIONS_REACHED';`), "GUIDED_SAFETY_NATIVE_ASSERTIONS_REACHED");
  });
});
