import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  path.resolve(
    process.cwd(),
    "supabase/migrations/20260824000004_workspace_stage_gate_template_selection.sql"
  ),
  "utf8"
);

describe("workspace stage-gate selection migration", () => {
  it("adds nullable provenance before setting the default for future rows", () => {
    const addAt = sql.indexOf("ADD COLUMN IF NOT EXISTS stage_gate_template_selection TEXT;");
    const defaultAt = sql.indexOf("SET DEFAULT 'interim_unconfigured_default'");
    expect(addAt).toBeGreaterThan(-1);
    expect(defaultAt).toBeGreaterThan(addAt);
    expect(sql.slice(addAt, defaultAt)).not.toMatch(/NOT NULL|DEFAULT/i);
  });

  it("does not invent provenance for historical workspaces", () => {
    expect(sql).not.toMatch(/UPDATE\s+workspaces/i);
    expect(sql).toContain('NULL means "historical provenance');
  });

  it("constrains only the three selection values while retaining null", () => {
    expect(sql).toContain("workspaces_stage_gate_template_selection_check");
    expect(sql).toContain("stage_gate_template_selection IS NULL");
    for (const value of [
      "explicitly_requested",
      "jurisdiction_matched",
      "interim_unconfigured_default",
    ]) {
      expect(sql).toContain(`'${value}'`);
    }
  });

  it("inherits existing workspace RLS without changing policies", () => {
    expect(sql).not.toMatch(/CREATE POLICY|ALTER POLICY|DROP POLICY|DISABLE ROW LEVEL SECURITY/i);
  });
});
