import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Migration-content guard for run provenance (20260727000003).
 *
 * Three run tables gain a nullable project_id so work can travel from a run
 * to its project. The guard pins what the migration must and must not do:
 * additive columns on all three tables, a workspace-match CHECK backed by a
 * plain STABLE function (never SECURITY DEFINER, never used in RLS), and no
 * destructive statement of any kind.
 */

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260727000003_run_project_provenance.sql",
);

const sql = readFileSync(migrationPath, "utf8");
// Executable statements only — comments may legitimately NAME forbidden
// constructs while explaining why they are absent.
const sqlWithoutComments = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

const RUN_TABLES = ["runs", "model_runs", "county_runs"] as const;

describe("run project provenance migration", () => {
  it("adds a nullable project_id to all three run tables, additively", () => {
    for (const table of RUN_TABLES) {
      expect(sql).toMatch(
        new RegExp(
          `ALTER TABLE public\\.${table}\\s+ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public\\.projects\\(id\\) ON DELETE SET NULL`,
        ),
      );
    }
    // Nullable by design: NULL means "not attributed", never a guess.
    expect(sql).not.toMatch(/project_id UUID NOT NULL/);
  });

  it("indexes attributed runs per table without indexing the null majority", () => {
    for (const table of RUN_TABLES) {
      expect(sql).toMatch(
        new RegExp(`ON public\\.${table} \\(project_id, created_at DESC\\)\\s+WHERE project_id IS NOT NULL`),
      );
    }
  });

  it("enforces workspace match through a plain STABLE function and guarded CHECKs", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.run_project_matches_workspace/);
    expect(sqlWithoutComments).toMatch(/STABLE/);
    expect(sqlWithoutComments).not.toMatch(/SECURITY DEFINER/i);
    for (const table of RUN_TABLES) {
      expect(sql).toMatch(new RegExp(`${table}_project_workspace_match`));
    }
    // Constraint adds are guarded so re-running the migration is safe.
    expect(sql.match(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint/g)?.length).toBe(3);
  });

  it("destroys nothing", () => {
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/DROP COLUMN/i);
    expect(sql).not.toMatch(/\bDELETE FROM\b/i);
    expect(sql).not.toMatch(/\bUPDATE\b\s+public\./i);
  });
});
