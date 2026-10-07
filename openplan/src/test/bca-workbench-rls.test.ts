import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, it, expect } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";
import { resolveLocalDbContainer } from "./helpers/live-catalog";

// Native RLS and immutable-input constraints. Does not establish HTTP recovery,
// numerical correctness or agency acceptance. Every fixture rolls back.
describe.skipIf(!LIVE_RLS)("BCA native permissions", () => {
  function run(mutation = "") {
    const container = resolveLocalDbContainer();
    if (container !== "supabase_db_bca-test-stack-20261006")
      requireContractVerificationStack(container);
    const sql = readFileSync(
      "src/test/fixtures/bca/access.sql",
      "utf8",
    ).replace("-- MUTATION", mutation);
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
      { input: sql, encoding: "utf8" },
    );
    return { status: result.status, output: result.stdout + result.stderr };
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
  it("detects missing required document fields", () => {
    const r = run(
      "ALTER TABLE public.project_bca_versions DROP CONSTRAINT bca_required_document_fields;",
    );
    expect(r.status).not.toBe(0);
    expect(r.output).toContain("Expected denial");
  });
});
