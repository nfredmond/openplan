import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadPolicyInventory } from "./migrations/policy-inventory";
import { loadSchemaInventory } from "./migrations/schema-inventory";

/**
 * Migration-content guard for stage-gate decision scope (20260728000011).
 *
 * A gate decision is a judgement about a PROJECT's delivery readiness, and until
 * this migration the table could not say which project — so every reader queried
 * the whole workspace and rendered one project's verdicts on all of them. The
 * run reference had the mirror gap: it pointed only at `runs`, so the modeling
 * lane a project actually hands its study area down to could never be cited.
 *
 * What this pins: additive columns, at-most-one run citation, workspace-match
 * CHECKs built from the helpers that already exist rather than from new
 * near-duplicates, and no destructive statement of any kind.
 */

const MIGRATION_NAME = "20260728000011_stage_gate_decisions_project_scope.sql";

const sql = readFileSync(path.join(process.cwd(), "supabase/migrations", MIGRATION_NAME), "utf8");
// Executable statements only — the header comment names constructs (DROP, the
// old gate id) precisely in order to explain why they are absent.
const sqlWithoutComments = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

const schema = loadSchemaInventory();
const policies = loadPolicyInventory();

describe("a stage-gate decision can name the project and the run it is about", () => {
  it("adds project_id as a nullable cascade reference to projects", () => {
    expect(sql).toMatch(
      /ALTER TABLE public\.stage_gate_decisions\s+ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public\.projects\(id\) ON DELETE CASCADE/
    );
    // Nullable by design: the rows already in this table were written by the
    // report-export path and had no project. Backfilling them would be invention.
    expect(sqlWithoutComments).not.toMatch(/project_id UUID NOT NULL/);
    expect(schema.hasColumn("stage_gate_decisions", "project_id")).toBe(true);
  });

  it("lets a decision cite any of the three run kinds, and only one", () => {
    expect(sql).toMatch(
      /ADD COLUMN IF NOT EXISTS model_run_id UUID REFERENCES public\.model_runs\(id\) ON DELETE SET NULL/
    );
    expect(sql).toMatch(
      /ADD COLUMN IF NOT EXISTS county_run_id UUID REFERENCES public\.county_runs\(id\) ON DELETE SET NULL/
    );
    // At most one, NOT exactly one: most gates turn on executed documents rather
    // than on a run, and a decision with no citation is complete.
    expect(sql).toMatch(/CHECK \(num_nonnulls\(run_id, model_run_id, county_run_id\) <= 1\)/);
    expect(schema.hasColumn("stage_gate_decisions", "model_run_id")).toBe(true);
    expect(schema.hasColumn("stage_gate_decisions", "county_run_id")).toBe(true);
  });

  it("remembers which template's vocabulary the gate id came from", () => {
    // Unrecoverable after the fact: once a workspace rebinds to another
    // jurisdiction's pack, nothing can say which vocabulary an old gate id used.
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS template_id TEXT/);
    expect(schema.hasColumn("stage_gate_decisions", "template_id")).toBe(true);
  });

  it("reuses the existing workspace-match helpers instead of near-duplicating them", () => {
    expect(sql).toMatch(/public\.run_project_matches_workspace\(workspace_id, project_id\)/);
    expect(sql).toMatch(
      /public\.modeling_evidence_target_matches_workspace\(workspace_id, model_run_id, county_run_id\)/
    );
    // The one genuinely missing predicate — "does this analysis run belong to
    // this workspace" — is added in the same shape: plain STABLE SQL, never
    // SECURITY DEFINER, never used in an RLS policy.
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.run_matches_workspace/);
    expect(sqlWithoutComments).toMatch(/LANGUAGE sql\s+STABLE/);
    expect(sqlWithoutComments).not.toMatch(/SECURITY DEFINER/i);
    expect(sqlWithoutComments).toMatch(
      /REVOKE ALL ON FUNCTION public\.run_matches_workspace\(UUID, UUID\) FROM PUBLIC/
    );
  });

  it("guards every constraint add so re-running the migration is safe", () => {
    expect(sql.match(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint/g)?.length).toBe(3);
  });

  it("indexes the read every board does without indexing the unattributed rows", () => {
    expect(sql).toMatch(
      /ON public\.stage_gate_decisions \(project_id, decided_at DESC\)\s+WHERE project_id IS NOT NULL/
    );
  });

  it("destroys nothing", () => {
    expect(sqlWithoutComments).not.toMatch(/DROP TABLE/i);
    expect(sqlWithoutComments).not.toMatch(/DROP COLUMN/i);
    expect(sqlWithoutComments).not.toMatch(/DROP POLICY/i);
    expect(sqlWithoutComments).not.toMatch(/\bDELETE FROM\b/i);
    expect(sqlWithoutComments).not.toMatch(/\bUPDATE\b\s+public\./i);
  });
});

describe("the stage-gate decision log stays append-only and writable by the caller", () => {
  it("keeps a PERMISSIVE INSERT policy, which is the only command the write path uses", () => {
    // write-policy-coverage-guard.test.ts enforces this across the whole schema;
    // asserted here too because it is the specific property that makes the new
    // POST route work at all. A RESTRICTIVE policy only ever subtracts.
    expect(policies.permissiveGrants("stage_gate_decisions", "INSERT").length).toBeGreaterThanOrEqual(1);
    expect(policies.permissiveGrants("stage_gate_decisions", "SELECT").length).toBeGreaterThanOrEqual(1);
  });

  it("grants no UPDATE or DELETE, because a recorded verdict is superseded and never edited", () => {
    const mutations = [
      ...policies.permissiveGrants("stage_gate_decisions", "UPDATE"),
      ...policies.permissiveGrants("stage_gate_decisions", "DELETE"),
    ];

    expect(
      mutations.map((statement) => `${statement.policy} (${statement.command})`),
      "A stage-gate decision log is append-only: a wrong PASS is corrected by recording the " +
        "HOLD that supersedes it, never by editing the verdict someone signed. Adding a " +
        "permissive UPDATE or DELETE here needs its own argument."
    ).toEqual([]);
  });
});
