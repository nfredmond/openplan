import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, it, expect } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";
import { resolveLocalDbContainer } from "./helpers/live-catalog";

// Native RLS and immutable-input constraints. Does not establish HTTP recovery,
// numerical correctness or agency acceptance. Every fixture rolls back.
describe.skipIf(!LIVE_RLS)("BCA native permissions", () => {
  function run(mutation = "", fixture: "access" | "project-place-insert" = "access") {
    const container = resolveLocalDbContainer();
    if (container !== "supabase_db_bca-test-stack-20261006")
      requireContractVerificationStack(container);
    const source = readFileSync(`src/test/fixtures/bca/${fixture}.sql`, "utf8");
    expect(source.split("-- MUTATION")).toHaveLength(2);
    const sql = source.replace(
      "-- MUTATION",
      fixture === "project-place-insert"
        ? `SET LOCAL statement_timeout = '15s';\nSET LOCAL lock_timeout = '2s';\n${mutation}`
        : mutation,
    );
    const result = spawnSync(
      "docker",
      [
        "exec",
        "-i",
        container,
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
      ],
      { input: sql, encoding: "utf8", timeout: 30_000 },
    );
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    if (fixture === "project-place-insert" && result.status === 0)
      expect(result.stdout.trim().endsWith("ROLLBACK")).toBe(true);
    return { status: result.status, output: result.stdout + result.stderr };
  }

  // Replace one exact block in the installed function, inside the fixture's
  // transaction. CREATE OR REPLACE retains its OID, settings and ACL; assert
  // that every catalog attribute except the selected body stays unchanged.
  function removeInsertCheck(needle: string) {
    return `DO $bca_mutation$
DECLARE
  target oid := 'public.guard_project_bca_place_insert()'::regprocedure;
  installed pg_catalog.pg_proc%ROWTYPE; retained pg_catalog.pg_proc%ROWTYPE;
  definition text; needle text := $bca_needle$${needle}$bca_needle$;
BEGIN
  SELECT * INTO STRICT installed FROM pg_catalog.pg_proc WHERE oid = target;
  definition := pg_catalog.pg_get_functiondef(target);
  IF (length(definition) - length(replace(definition, needle, ''))) / length(needle) <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one selected BCA insert check';
  END IF;
  EXECUTE replace(definition, needle, '  -- Selected check removed by rolled-back fixture control.');
  SELECT * INTO STRICT retained FROM pg_catalog.pg_proc WHERE oid = target;
  IF retained.prosrc IS NOT DISTINCT FROM installed.prosrc
    OR (to_jsonb(retained) - 'prosrc') IS DISTINCT FROM (to_jsonb(installed) - 'prosrc') THEN
    RAISE EXCEPTION 'BCA control must change only the installed function body';
  END IF;
END;
$bca_mutation$;`;
  }

  function expectPlaceDenial(mutation: string, message: string) {
    const r = run(mutation, "project-place-insert");
    expect(r.status).toBe(3); // psql ON_ERROR_STOP script failure, not a spawn error.
    expect(
      r.output
        .split(/\r?\n/)
        .filter((line) => line.startsWith("ERROR:"))
        .map((line) => line.replace(/^ERROR:\s+/, "")),
    ).toEqual([message]);
  }
  it("permits staff insert and member read, denies outsiders, viewer writes, impersonation and mutation", () => {
    expect(run()).toEqual({ status: 0, output: expect.any(String) });
  });
  it("survives a harmless table comment", () => {
    expect(
      run(
        "COMMENT ON TABLE public.project_bca_versions IS 'Harmless fixture comment';",
      ).status,
    ).toBe(0);
  });
  it("detects an accidentally public read policy", () => {
    const r = run(
      "ALTER POLICY project_bca_versions_read ON public.project_bca_versions USING (true);",
    );
    expect(r.status).not.toBe(0);
    expect(r.output).toContain("Outsider can read another workspace");
  });
  it("detects a disabled native insert guard through the named new-v1 witness", () => {
    const r = run(
      "ALTER TABLE public.project_bca_versions DISABLE TRIGGER project_bca_place_insert_guard;",
    );
    expect(r.status).not.toBe(0);
    expect(r.output).toContain("Expected denial");
    expect(r.output).toContain("new-v1-insert-witness");
  });
  it("retains project-place states, reader domains and immutable history", () => {
    const r = run("", "project-place-insert");
    expect(r.status).toBe(0);
  }, 40_000);
  it("survives a harmless project-place fixture comment", () => {
    const r = run(
      "COMMENT ON TABLE public.project_bca_versions IS 'Harmless project-place fixture comment';",
      "project-place-insert",
    );
    expect(r.status).toBe(0);
  }, 40_000);
  it("detects a disabled project-place guard at the first UUID-domain witness", () => {
    // Reader-domain survivors precede this first refusal, before new-v1 or
    // invented-source. Disabling the guard also removes the UUID predicate.
    expectPlaceDenial(
      "ALTER TABLE public.project_bca_versions DISABLE TRIGGER project_bca_place_insert_guard;",
      "Accepted invalid BCA domain witness: uuid-domain",
    );
  }, 40_000);
  it("detects removed project-place equality at the invented-source witness", () => {
    // All three P2 source-domain refusals remain active before this witness.
    expectPlaceDenial(
      removeInsertCheck(`  IF NEW.document_json->'projectPlace' IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'BCA snapshot does not match the locked current project source/context' USING ERRCODE = 'PT409';
  END IF;`),
      "Accepted invalid BCA witness: invented-source",
    );
  }, 40_000);
  it("detects removed canonical jurisdiction validation at the first trimming witness", () => {
    // P2 domains, exact source equality and earlier access/shape refusals stay
    // active. The first padded raw label is accepted only without this check.
    expectPlaceDenial(
      removeInsertCheck(`  IF public.valid_bca_snapshot_jurisdiction(coalesce(project.jurisdiction_context, 'null'::jsonb)) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Project jurisdiction is invalid or changes under its strict reader; review the project record' USING ERRCODE = '23514';
  END IF;`),
      "Accepted invalid BCA witness: reader-would-trim",
    );
  }, 40_000);
});
