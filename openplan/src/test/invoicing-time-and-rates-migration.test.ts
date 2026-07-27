import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Migration-content guard for invoicing time & rates (20260727000011).
 *
 * Staff, rate tables + per-category entries, and the time-entry ledger that
 * draft client-invoice line items are composed from. The guard pins:
 *
 * - four tables, IF NOT EXISTS, all RLS-enabled;
 * - workspace-membership policies on staff/rate-tables/time-entries, the
 *   EXISTS-through-parent join on rate entries;
 * - DELETE policies on rate entries (entry-set replacement) and time entries
 *   (a plain ledger row) ONLY — and the migration header documents that the
 *   API layer refuses mutating BILLED time entries, which RLS cannot express;
 * - the per-table unique labor category, the bounded hours check, and the
 *   partial unbilled-time index;
 * - nothing destructive (DROP TRIGGER IF EXISTS is the idempotent trigger
 *   convention and the only DROP allowed).
 */

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260727000011_invoicing_time_and_rates.sql",
);

const sql = readFileSync(migrationPath, "utf8");
// Executable statements only — comments may legitimately NAME forbidden
// constructs while explaining why they are absent.
const sqlWithoutComments = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

const WORKSPACE_TABLES = ["invoicing_staff", "invoicing_rate_tables", "invoicing_time_entries"] as const;
const ALL_TABLES = [...WORKSPACE_TABLES, "invoicing_rate_entries"] as const;

const WORKSPACE_POLICY_SHAPE =
  /workspace_id IN \(\s*SELECT workspace_id FROM workspace_members WHERE user_id = auth\.uid\(\)\s*\)/g;

const RATE_ENTRY_POLICY_SHAPE =
  /FROM invoicing_rate_tables rt\s+JOIN workspace_members wm ON wm\.workspace_id = rt\.workspace_id\s+WHERE rt\.id = invoicing_rate_entries\.rate_table_id\s+AND wm\.user_id = auth\.uid\(\)/g;

/**
 * The body of one named policy: everything from its CREATE POLICY up to the
 * next CREATE POLICY (or end of file). Asserting the membership shape inside
 * EACH body — not just once per file — means no single well-formed policy can
 * vouch for a malformed sibling.
 */
function policyBody(name: string, table: string): string {
  const match = sql.match(new RegExp(`CREATE POLICY ${name} ON ${table}([\\s\\S]*?)(?=CREATE POLICY|$)`));
  expect(match, `policy ${name} on ${table} must exist`).not.toBeNull();
  return (match as RegExpMatchArray)[1];
}

function shapeCount(body: string, shape: RegExp): number {
  return body.match(shape)?.length ?? 0;
}

describe("invoicing time and rates migration", () => {
  it("creates all four tables additively", () => {
    for (const table of ALL_TABLES) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(`));
    }
  });

  it("enables RLS on every table", () => {
    for (const table of ALL_TABLES) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
    }
  });

  it("binds the canonical workspace-membership shape inside EVERY workspace-table policy", () => {
    for (const table of WORKSPACE_TABLES) {
      for (const action of ["read", "insert", "update"] as const) {
        const body = policyBody(`${table}_${action}`, table);
        // UPDATE carries the shape twice (USING + WITH CHECK); read/insert once.
        expect(shapeCount(body, WORKSPACE_POLICY_SHAPE), `${table}_${action}`).toBe(
          action === "update" ? 2 : 1,
        );
      }
    }
    // The one workspace-table DELETE policy (time entries) uses the same shape.
    expect(
      shapeCount(policyBody("invoicing_time_entries_delete", "invoicing_time_entries"), WORKSPACE_POLICY_SHAPE),
    ).toBe(1);
  });

  it("scopes EVERY rate-entry policy through the parent rate table", () => {
    for (const action of ["read", "insert", "update", "delete"] as const) {
      const body = policyBody(`invoicing_rate_entries_${action}`, "invoicing_rate_entries");
      expect(shapeCount(body, RATE_ENTRY_POLICY_SHAPE), `invoicing_rate_entries_${action}`).toBe(
        action === "update" ? 2 : 1,
      );
    }
  });

  it("grants DELETE on rate entries and time entries only", () => {
    expect(sql).toMatch(/CREATE POLICY invoicing_rate_entries_delete/);
    expect(sql).toMatch(/CREATE POLICY invoicing_time_entries_delete/);
    expect(sql).not.toMatch(/CREATE POLICY invoicing_staff_delete/);
    expect(sql).not.toMatch(/CREATE POLICY invoicing_rate_tables_delete/);
    expect(sqlWithoutComments.match(/FOR DELETE/g)?.length).toBe(2);
  });

  it("documents that the API layer refuses mutating billed time entries", () => {
    // RLS cannot cleanly forbid deleting/editing an entry whose
    // billed_line_item_id is set (the stamp itself is a legitimate update),
    // so the migration header must state where the enforcement lives.
    expect(sql).toMatch(/billed_line_item_id[\s\S]*API layer/i);
  });

  it("keeps one rate per labor category per table and bounds hours honestly", () => {
    expect(sql).toMatch(/UNIQUE \(rate_table_id, labor_category\)/);
    expect(sql).toMatch(/hourly_rate NUMERIC\(10, 2\) NOT NULL CHECK \(hourly_rate >= 0\)/);
    expect(sql).toMatch(/hours NUMERIC\(6, 2\) NOT NULL CHECK \(hours > 0 AND hours <= 24\)/);
  });

  it("indexes the unbilled-time query partially, skipping the billed majority", () => {
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_invoicing_time_entries_unbilled\s+ON invoicing_time_entries\(engagement_id, billable\)\s+WHERE billed_line_item_id IS NULL/,
    );
  });

  it("stamps updated_at through the shared subrecord trigger on every table", () => {
    for (const table of ALL_TABLES) {
      expect(sql).toMatch(new RegExp(`CREATE TRIGGER trg_${table}_updated_at\\s+BEFORE UPDATE ON ${table}`));
    }
    expect(sqlWithoutComments.match(/set_project_subrecord_updated_at\(\)/g)?.length).toBe(4);
  });

  it("destroys nothing", () => {
    expect(sqlWithoutComments).not.toMatch(/DROP TABLE/i);
    expect(sqlWithoutComments).not.toMatch(/DROP COLUMN/i);
    expect(sqlWithoutComments).not.toMatch(/DROP POLICY/i);
    expect(sqlWithoutComments).not.toMatch(/DROP INDEX/i);
    expect(sqlWithoutComments).not.toMatch(/\bDELETE FROM\b/i);
    expect(sqlWithoutComments).not.toMatch(/\bTRUNCATE\b/i);
    const dropStatements = sqlWithoutComments.match(/\bDROP\b[^;]*/gi) ?? [];
    for (const statement of dropStatements) {
      expect(statement).toMatch(/^DROP TRIGGER IF EXISTS/i);
    }
  });
});
