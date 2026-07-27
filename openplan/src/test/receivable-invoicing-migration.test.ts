import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Migration-content guard for receivable invoicing (20260727000010).
 *
 * The consultant/agency workspace billing ITS OWN clients — the mirror
 * direction of billing_invoice_records (the agency invoicing its funder).
 * The guard pins the load-bearing choices:
 *
 * - four tables, all IF NOT EXISTS, all RLS-enabled;
 * - canonical workspace-membership policies on the three parents, the
 *   EXISTS-through-parent join on line items;
 * - a DELETE policy on line items ONLY (line-set replacement needs it) and
 *   deliberately NONE on clients/engagements/invoices — a wrong invoice is
 *   voided, never deleted;
 * - the per-workspace unique invoice-number index;
 * - nothing destructive (DROP TRIGGER IF EXISTS is the repo's idempotent
 *   trigger convention and is the only DROP allowed).
 */

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260727000010_receivable_invoicing.sql",
);

const sql = readFileSync(migrationPath, "utf8");
// Executable statements only — comments may legitimately NAME forbidden
// constructs while explaining why they are absent.
const sqlWithoutComments = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

const PARENT_TABLES = ["invoicing_clients", "invoicing_engagements", "client_invoices"] as const;
const ALL_TABLES = [...PARENT_TABLES, "client_invoice_line_items"] as const;

const WORKSPACE_POLICY_SHAPE =
  /workspace_id IN \(\s*SELECT workspace_id FROM workspace_members WHERE user_id = auth\.uid\(\)\s*\)/g;

const LINE_ITEM_POLICY_SHAPE =
  /FROM client_invoices ci\s+JOIN workspace_members wm ON wm\.workspace_id = ci\.workspace_id\s+WHERE ci\.id = client_invoice_line_items\.invoice_id\s+AND wm\.user_id = auth\.uid\(\)/g;

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

describe("receivable invoicing migration", () => {
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

  it("binds the canonical workspace-membership shape inside EVERY parent-table policy", () => {
    for (const table of PARENT_TABLES) {
      for (const action of ["read", "insert", "update"] as const) {
        const body = policyBody(`${table}_${action}`, table);
        // UPDATE carries the shape twice (USING + WITH CHECK); read/insert once.
        expect(shapeCount(body, WORKSPACE_POLICY_SHAPE), `${table}_${action}`).toBe(
          action === "update" ? 2 : 1,
        );
      }
    }
  });

  it("scopes EVERY line-item policy through the parent invoice, not a duplicated workspace_id", () => {
    for (const action of ["read", "insert", "update", "delete"] as const) {
      const body = policyBody(`client_invoice_line_items_${action}`, "client_invoice_line_items");
      expect(shapeCount(body, LINE_ITEM_POLICY_SHAPE), `client_invoice_line_items_${action}`).toBe(
        action === "update" ? 2 : 1,
      );
    }
  });

  it("grants DELETE on line items only — parents are corrected by voiding, never deleted", () => {
    expect(sql).toMatch(/CREATE POLICY client_invoice_line_items_delete/);
    for (const table of PARENT_TABLES) {
      expect(sql).not.toMatch(new RegExp(`CREATE POLICY ${table}_delete`));
    }
    // Exactly one FOR DELETE policy in the whole migration.
    expect(sqlWithoutComments.match(/FOR DELETE/g)?.length).toBe(1);
  });

  it("claims invoice numbers per workspace, never globally", () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_client_invoices_workspace_invoice_number\s+ON client_invoices\(workspace_id, invoice_number\)/,
    );
  });

  it("keeps the shared basis and status vocabularies", () => {
    // Engagement billing basis matches billing_invoice_records (20260321000033).
    expect(sql).toMatch(/'lump_sum', 'time_and_materials', 'cost_plus', 'milestone', 'progress_payment'/);
    // The receivable lifecycle: correction is void, not deletion.
    expect(sql).toMatch(/status IN \('draft', 'sent', 'paid', 'void'\)/);
    // Client kinds are organization types, never jurisdictions.
    expect(sql).toMatch(
      /client_kind IN \('public_agency', 'tribal_government', 'prime_contractor', 'nonprofit', 'private', 'other'\)/,
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
    // The only DROPs are the idempotent trigger re-creates.
    const dropStatements = sqlWithoutComments.match(/\bDROP\b[^;]*/gi) ?? [];
    for (const statement of dropStatements) {
      expect(statement).toMatch(/^DROP TRIGGER IF EXISTS/i);
    }
  });
});
