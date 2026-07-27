import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Migration-content guard for report typed evidence (20260727000004).
 *
 * report_runs becomes the single place a report cites a run of any kind:
 * legacy Analysis Studio runs (run_id), worker model runs (model_run_id), and
 * county validation runs (county_run_id) — exactly one per row. The guard
 * pins: additive typed columns, the num_nonnulls presence CHECK, the
 * deliberate DROP NOT NULL on run_id (the ONLY allowed "drop"), per-kind
 * partial unique indexes, and no destructive statement of any other kind.
 */

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260727000004_report_runs_typed_evidence.sql",
);

const sql = readFileSync(migrationPath, "utf8");
// Executable statements only — comments may legitimately NAME forbidden
// constructs while explaining why they are absent.
const sqlWithoutComments = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("report_runs typed evidence migration", () => {
  it("adds nullable typed citation columns that cascade with their runs", () => {
    expect(sql).toMatch(
      /ALTER TABLE public\.report_runs\s+ADD COLUMN IF NOT EXISTS model_run_id UUID REFERENCES public\.model_runs\(id\) ON DELETE CASCADE/,
    );
    expect(sql).toMatch(
      /ALTER TABLE public\.report_runs\s+ADD COLUMN IF NOT EXISTS county_run_id UUID REFERENCES public\.county_runs\(id\) ON DELETE CASCADE/,
    );
    // Nullable by design: exactly one of the three is set per row.
    expect(sql).not.toMatch(/model_run_id UUID NOT NULL/);
    expect(sql).not.toMatch(/county_run_id UUID NOT NULL/);
  });

  it("drops NOT NULL on run_id — the one deliberate loosening — and nothing else", () => {
    expect(sqlWithoutComments).toMatch(
      /ALTER TABLE public\.report_runs\s+ALTER COLUMN run_id DROP NOT NULL/,
    );
    expect(sqlWithoutComments.match(/DROP NOT NULL/g)?.length).toBe(1);
  });

  it("enforces exactly one citation kind per row through a guarded CHECK", () => {
    expect(sql).toMatch(/report_runs_evidence_presence/);
    expect(sqlWithoutComments).toMatch(
      /CHECK \(num_nonnulls\(run_id, model_run_id, county_run_id\) = 1\)/,
    );
    // Constraint add is guarded so re-running the migration is safe.
    expect(sql).toMatch(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint/);
  });

  it("adds per-kind partial unique indexes without indexing the null majority", () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uniq_report_runs_report_model_run\s+ON public\.report_runs \(report_id, model_run_id\)\s+WHERE model_run_id IS NOT NULL/,
    );
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uniq_report_runs_report_county_run\s+ON public\.report_runs \(report_id, county_run_id\)\s+WHERE county_run_id IS NOT NULL/,
    );
  });

  it("destroys nothing", () => {
    expect(sqlWithoutComments).not.toMatch(/DROP TABLE/i);
    expect(sqlWithoutComments).not.toMatch(/DROP COLUMN/i);
    expect(sqlWithoutComments).not.toMatch(/\bDELETE FROM\b/i);
    expect(sqlWithoutComments).not.toMatch(/\bUPDATE\b\s+public\./i);
  });
});
