import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * REGRESSION GUARD — a role-blind write policy may not exist without a
 * restrictive writer gate over the same table.
 *
 * `workspace-write-role-gate-guard.test.ts` states the problem from the API
 * side, and its own header admits the database half: OpenPlan's workspace
 * content write policies ask `workspace_id IN (SELECT … FROM workspace_members
 * WHERE user_id = auth.uid())`, which is MEMBERSHIP, not PERMISSION. That guard
 * can only police route files. It cannot police PostgREST.
 *
 * It had to, because Supabase's ALTER DEFAULT PRIVILEGES grants ALL on every new
 * public-schema table straight to `authenticated`. With table grants wide open
 * and RLS role-blind, a viewer holding the public anon key and their own session
 * JWT could write directly to PostgREST, past every route gate in the product.
 *
 * 20260728000006 / 20260728000007 close that with RESTRICTIVE policies over the
 * 74 workspace-scoped tables. This guard exists so the NEXT table does not
 * reopen it: add a role-blind permissive write policy to a table that carries no
 * restrictive writer gate, and this test fails and names the table.
 *
 * Note what is deliberately NOT asserted: that a policy is role-AWARE. Almost
 * every permissive policy in the schema is role-blind and that is fine — the
 * restrictive layer is what supplies the role. What must never happen is a
 * workspace-scoped write path with neither.
 */

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

/** The two migrations that INSTALL the restrictive gate; they are the answer, not the question. */
const WRITER_GATE_MIGRATIONS = [
  "20260728000006_workspace_write_role_gate.sql",
  "20260728000007_workspace_write_role_gate_children.sql",
];

const WRITE_COMMANDS = ["INSERT", "UPDATE", "DELETE", "ALL"] as const;

type PolicyStatement = {
  /** Byte offset in the migration, so creates and drops can be replayed in source order. */
  at: number;
  file: string;
  policy: string;
  table: string;
  command: string;
  body: string;
};

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

function readMigration(name: string): string {
  return readFileSync(path.join(MIGRATIONS_DIR, name), "utf8");
}

/**
 * Every `CREATE POLICY` in a migration, with the clause body that follows it.
 * Policy bodies contain no semicolons, so the statement terminator is a safe
 * delimiter here.
 */
function parsePolicies(file: string, sql: string): PolicyStatement[] {
  const statements: PolicyStatement[] = [];
  // The schema qualifier is optional but, when present, must be `public` —
  // storage.objects carries its own policies that this guard has no business
  // reasoning about, and an unanchored match reported them as a table called
  // "storage".
  // The schema qualifier must be captured generically, not as an optional
  // literal `public.` — with `(?:(public)\.)?` the statement `ON storage.objects`
  // matched no schema and reported a table named "storage", which is how
  // storage.objects policies leaked into a guard about workspace content.
  const pattern =
    /CREATE\s+POLICY\s+"?([A-Za-z0-9_]+)"?\s+ON\s+(?:([A-Za-z0-9_]+)\.)?"?([A-Za-z0-9_]+)"?([^;]*);/gi;

  for (const match of sql.matchAll(pattern)) {
    const [, policy, schema, table, rest] = match;
    if (schema !== undefined && schema.toLowerCase() !== "public") continue;

    const commandMatch = rest.match(/\bFOR\s+(INSERT|UPDATE|DELETE|SELECT|ALL)\b/i);
    statements.push({
      at: match.index ?? 0,
      file,
      policy,
      table,
      // Postgres defaults a policy with no FOR clause to ALL — which is a WRITE
      // grant. Six tables reached this guard only because an earlier hand-rolled
      // pg_policies query filtered on cmd IN ('INSERT','UPDATE','DELETE') and
      // silently skipped every FOR ALL policy in the schema.
      command: (commandMatch?.[1] ?? "ALL").toUpperCase(),
      body: rest,
    });
  }

  return statements;
}

/** `DROP POLICY [IF EXISTS] <name> ON <table>` — a policy retired, not replaced. */
function parsePolicyDrops(sql: string): Array<{ at: number; policy: string; table: string }> {
  const drops: Array<{ at: number; policy: string; table: string }> = [];
  const pattern =
    /DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?"?([A-Za-z0-9_]+)"?\s+ON\s+(?:public\.)?"?([A-Za-z0-9_]+)"?/gi;
  for (const match of sql.matchAll(pattern)) {
    drops.push({ at: match.index ?? 0, policy: match[1], table: match[2] });
  }
  return drops;
}

function isWorkspaceScoped(statement: PolicyStatement): boolean {
  return statement.body.includes("workspace_members");
}

/**
 * Role-blind means the predicate never consults `workspace_members.role`. The
 * one historically role-aware family (billing_invoice_records, 20260717000082)
 * names the column outright, so a plain word-boundary match separates them.
 */
function isRoleBlind(statement: PolicyStatement): boolean {
  return !/\brole\b/i.test(statement.body);
}

function isWriteCommand(statement: PolicyStatement): boolean {
  return (WRITE_COMMANDS as readonly string[]).includes(statement.command);
}

/** The tables named in a writer-gate migration's VALUES mapping list. */
function gatedTables(): Set<string> {
  const tables = new Set<string>();
  for (const file of WRITER_GATE_MIGRATIONS) {
    const sql = readMigration(file);
    for (const match of sql.matchAll(/^\s*\('([a-z0-9_]+)',/gim)) {
      tables.add(match[1]);
    }
  }
  return tables;
}

/**
 * Tables that carry at least one role-blind, workspace-scoped write policy.
 *
 * Migrations are replayed in filename order and a policy is keyed by
 * (table, policy name), so a later `DROP POLICY IF EXISTS … ; CREATE POLICY`
 * REPLACES the earlier definition rather than adding to it. Without that,
 * billing_invoice_records would register as role-blind forever on the strength
 * of its original 20260424000072 definition, even though 20260717000082
 * rewrote those same policies to be role-aware. The question this guard asks is
 * about the schema that exists, not about every schema that ever existed.
 */
function tablesNeedingGate(): Map<string, PolicyStatement[]> {
  const latest = new Map<string, PolicyStatement>();

  for (const file of migrationFiles()) {
    if (WRITER_GATE_MIGRATIONS.includes(file)) continue;

    const sql = readMigration(file);
    // Creates and drops are replayed in the order they appear in the file, so
    // that both `DROP POLICY IF EXISTS x; CREATE POLICY x` (a replace) and a
    // drop with no recreate land correctly. assistant_action_executions is the
    // second kind: its INSERT policy was retired and never reinstated, so the
    // table has no write policy at all today and needs no gate.
    const events: Array<{ at: number; apply: () => void }> = [
      ...parsePolicies(file, sql).map((statement) => ({
        at: statement.at,
        apply: () => {
          latest.set(`${statement.table}.${statement.policy}`, statement);
        },
      })),
      ...parsePolicyDrops(sql).map((drop) => ({
        at: drop.at,
        apply: () => {
          latest.delete(`${drop.table}.${drop.policy}`);
        },
      })),
    ].sort((left, right) => left.at - right.at);

    for (const event of events) event.apply();
  }

  const needing = new Map<string, PolicyStatement[]>();
  for (const statement of latest.values()) {
    if (!isWriteCommand(statement)) continue;
    if (!isWorkspaceScoped(statement)) continue;
    if (!isRoleBlind(statement)) continue;

    const existing = needing.get(statement.table) ?? [];
    existing.push(statement);
    needing.set(statement.table, existing);
  }

  return needing;
}

describe("viewer write denial", () => {
  it("gates every table that has a role-blind workspace write policy", () => {
    const gated = gatedTables();
    const ungated = [...tablesNeedingGate().entries()]
      .filter(([table]) => !gated.has(table))
      .map(([table, statements]) => `${table} (${statements.map((s) => `${s.command} in ${s.file}`).join(", ")})`)
      .sort();

    expect(
      ungated,
      "These tables accept workspace-scoped writes through a role-blind policy and have no " +
        "RESTRICTIVE writer gate, so a viewer can write to them directly through PostgREST. " +
        "Add the table to a writer-gate migration's VALUES list with the expression that " +
        "resolves its workspace."
    ).toEqual([]);
  });

  it("installs the writer predicate as one shared, fail-closed helper", () => {
    const sql = readMigration(WRITER_GATE_MIGRATIONS[0]);

    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.workspace_member_can_write\(/i);
    // Rank comparison rather than a role-name allowlist, so a new tier ranks in
    // one place instead of in 222 policies.
    expect(sql).toMatch(/workspace_role_rank\(wm\.role\)\s*>=\s*public\.workspace_role_rank\('member'\)/i);
    // An RLS policy evaluates as the caller, so the caller needs the rank helper.
    expect(sql).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.workspace_role_rank\(text\)\s+TO\s+authenticated/i);
  });

  it("creates all three write commands per table, not only the ones in use today", () => {
    for (const file of WRITER_GATE_MIGRATIONS) {
      const sql = readMigration(file);
      for (const command of ["INSERT", "UPDATE", "DELETE"]) {
        expect(sql, `${file} must gate ${command}`).toContain(`AS RESTRICTIVE FOR ${command}`);
      }
      // FOR ALL would put SELECT behind the writer predicate and take reading
      // away from the very role this exists to keep reading.
      expect(sql).not.toMatch(/AS\s+RESTRICTIVE\s+FOR\s+ALL/i);
    }
  });

  it("guards the guard", () => {
    const gated = gatedTables();
    const needing = tablesNeedingGate();

    // A parser that silently matched nothing would make this suite vacuously green.
    expect(gated.size).toBeGreaterThanOrEqual(70);
    expect(needing.size).toBeGreaterThanOrEqual(70);

    // Spot-check both families: a table owning workspace_id, and one that
    // reaches a workspace only through a parent.
    expect(gated.has("projects")).toBe(true);
    expect(gated.has("report_sections")).toBe(true);

    // The detector must actually discriminate — billing_invoice_records was made
    // role-aware in 20260717000082, so it must not register as needing a gate.
    expect(needing.has("billing_invoice_records")).toBe(false);
  });
});
