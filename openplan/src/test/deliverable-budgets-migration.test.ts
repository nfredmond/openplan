import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Migration-content guard for deliverable budgets and the project spend
 * ledger (20260727000012).
 *
 * The guard pins what the migration must and must not do: additive nullable
 * budget columns (NULL means "not entered", never zero), guarded CHECK
 * constraint adds so re-running is safe, a project_spend_entries ledger with
 * project-subrecord RLS INCLUDING a DELETE policy (a plain ledger row may be
 * corrected), the shared set_project_subrecord_updated_at trigger, and no
 * destructive statement of any kind.
 */

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260727000012_deliverable_budgets_and_spend.sql",
);

const sql = readFileSync(migrationPath, "utf8");
// Executable statements only — comments may legitimately NAME forbidden
// constructs while explaining why they are absent.
const sqlWithoutComments = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("deliverable budgets and spend migration", () => {
  it("adds nullable budget columns additively", () => {
    expect(sql).toMatch(
      /ALTER TABLE project_deliverables\s+ADD COLUMN IF NOT EXISTS budget_amount NUMERIC\(14, 2\)/,
    );
    expect(sql).toMatch(
      /ALTER TABLE project_deliverables\s+ADD COLUMN IF NOT EXISTS percent_complete NUMERIC\(5, 2\)/,
    );
    expect(sql).toMatch(
      /ALTER TABLE projects\s+ADD COLUMN IF NOT EXISTS budget_amount NUMERIC\(14, 2\)/,
    );
    // Nullable by design: NULL means "not entered", never a zero default.
    expect(sqlWithoutComments).not.toMatch(/budget_amount NUMERIC\(14, 2\) NOT NULL/);
    expect(sqlWithoutComments).not.toMatch(/percent_complete NUMERIC\(5, 2\) NOT NULL/);
    expect(sqlWithoutComments).not.toMatch(/budget_amount NUMERIC\(14, 2\) DEFAULT/);
  });

  it("guards every CHECK constraint add against re-runs", () => {
    expect(sql.match(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint/g)?.length).toBe(3);
    expect(sql).toMatch(/project_deliverables_budget_amount_nonnegative/);
    expect(sql).toMatch(/project_deliverables_percent_complete_range/);
    expect(sql).toMatch(/projects_budget_amount_nonnegative/);
    expect(sql).toMatch(/CHECK \(budget_amount IS NULL OR budget_amount >= 0\)/);
    expect(sql).toMatch(
      /CHECK \(percent_complete IS NULL OR \(percent_complete >= 0 AND percent_complete <= 100\)\)/,
    );
  });

  it("creates the project_spend_entries ledger with the right shape", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS project_spend_entries/);
    expect(sql).toMatch(/project_id UUID NOT NULL REFERENCES projects\(id\) ON DELETE CASCADE/);
    expect(sql).toMatch(/deliverable_id UUID REFERENCES project_deliverables\(id\) ON DELETE SET NULL/);
    expect(sql).toMatch(/entry_date DATE NOT NULL DEFAULT CURRENT_DATE/);
    expect(sql).toMatch(/amount NUMERIC\(14, 2\) NOT NULL CHECK \(amount >= 0\)/);
    expect(sql).toMatch(/description TEXT NOT NULL/);
    expect(sql).toMatch(/vendor_label TEXT/);
    expect(sql).toMatch(/created_by UUID REFERENCES auth\.users\(id\) ON DELETE SET NULL/);
  });

  it("indexes the ledger for project timelines and deliverable attribution", () => {
    expect(sql).toMatch(/ON project_spend_entries\(project_id, entry_date DESC\)/);
    expect(sql).toMatch(/ON project_spend_entries\(deliverable_id\)/);
  });

  it("enables RLS with all four project-subrecord policies, including DELETE", () => {
    expect(sql).toMatch(/ALTER TABLE project_spend_entries ENABLE ROW LEVEL SECURITY/);
    for (const policy of [
      "project_spend_entries_read",
      "project_spend_entries_insert",
      "project_spend_entries_update",
      "project_spend_entries_delete",
    ]) {
      expect(sql).toContain(policy);
    }
    // Every policy takes the EXISTS-through-projects shape.
    expect(
      sql.match(/JOIN workspace_members wm ON wm\.workspace_id = p\.workspace_id/g)?.length,
    ).toBeGreaterThanOrEqual(5); // read, insert, update USING + WITH CHECK, delete
    expect(sql).toMatch(/FOR DELETE USING \(/);
  });

  it("keeps updated_at fresh with the shared subrecord trigger", () => {
    expect(sql).toMatch(/CREATE TRIGGER trg_project_spend_entries_updated_at/);
    expect(sql).toMatch(/EXECUTE FUNCTION set_project_subrecord_updated_at\(\)/);
  });

  it("destroys nothing", () => {
    expect(sqlWithoutComments).not.toMatch(/DROP TABLE/i);
    expect(sqlWithoutComments).not.toMatch(/DROP COLUMN/i);
    expect(sqlWithoutComments).not.toMatch(/\bDELETE FROM\b/i);
    expect(sqlWithoutComments).not.toMatch(/\bUPDATE\s+projects\b/i);
    expect(sqlWithoutComments).not.toMatch(/\bTRUNCATE\b/i);
  });
});
