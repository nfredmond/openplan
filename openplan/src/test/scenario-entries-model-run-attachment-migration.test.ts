import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Migration-content guard for scenario model-run attachment (20260727000005).
 *
 * scenario_entries gains a nullable attached_model_run_id so an entry's
 * evidence can be a worker model run — planner-chosen attribution, mirroring
 * project_rtp_cycle_links.evidence_model_run_id (20260722000002). The guard
 * pins: additive column with ON DELETE SET NULL, the one-attachment CHECK
 * (legacy attached_run_id XOR the new column, at most one), a partial index,
 * and no destructive statement of any kind.
 */

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260727000005_scenario_entries_model_run_attachment.sql",
);

const sql = readFileSync(migrationPath, "utf8");
// Executable statements only — comments may legitimately NAME forbidden
// constructs while explaining why they are absent.
const sqlWithoutComments = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("scenario_entries model-run attachment migration", () => {
  it("adds a nullable attached_model_run_id that detaches when its run is deleted", () => {
    expect(sql).toMatch(
      /ALTER TABLE public\.scenario_entries\s+ADD COLUMN IF NOT EXISTS attached_model_run_id UUID REFERENCES public\.model_runs\(id\) ON DELETE SET NULL/,
    );
    // Nullable by design: NULL means "no model-run evidence", never a guess.
    expect(sql).not.toMatch(/attached_model_run_id UUID NOT NULL/);
  });

  it("enforces at most one attachment per entry through a guarded CHECK", () => {
    expect(sql).toMatch(/scenario_entries_one_attachment/);
    expect(sqlWithoutComments).toMatch(
      /CHECK \(num_nonnulls\(attached_run_id, attached_model_run_id\) <= 1\)/,
    );
    // Constraint add is guarded so re-running the migration is safe.
    expect(sql).toMatch(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint/);
  });

  it("indexes attached entries without indexing the null majority", () => {
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_scenario_entries_attached_model_run_id\s+ON public\.scenario_entries \(attached_model_run_id\)\s+WHERE attached_model_run_id IS NOT NULL/,
    );
  });

  it("destroys nothing", () => {
    expect(sqlWithoutComments).not.toMatch(/DROP TABLE/i);
    expect(sqlWithoutComments).not.toMatch(/DROP COLUMN/i);
    expect(sqlWithoutComments).not.toMatch(/DROP NOT NULL/i);
    expect(sqlWithoutComments).not.toMatch(/\bDELETE FROM\b/i);
    expect(sqlWithoutComments).not.toMatch(/\bUPDATE\b\s+public\./i);
  });
});
