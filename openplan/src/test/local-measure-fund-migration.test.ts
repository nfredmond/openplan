import { describe, expect, it } from "vitest";
import { loadGrantInventory } from "./migrations/grant-inventory";
import { loadPolicyInventory } from "./migrations/policy-inventory";
import { loadSchemaInventory } from "./migrations/schema-inventory";
import { readMigration } from "./migrations/read-migrations";

/**
 * THE MEASURE FUND SCHEMA, guarded where the schema is the artifact.
 *
 * These are not claims scanned out of prose. Each assertion below is about a
 * live property of the database the migrations define — a nullability, a
 * default, a privilege, a uniqueness rule — and every one of them is a decision
 * a future edit could reverse without any other test noticing.
 *
 * WHAT MADE EACH ONE WORTH A TEST is recorded beside it. Three are corrections
 * of defects this repository has already shipped once.
 */

const MIGRATION = "20260812000011_local_measure_fund.sql";

const MEASURE_TABLES = [
  "measure_funds",
  "measure_fund_periods",
  "measure_allocation_rules",
  "measure_recipients",
  "measure_recipient_basis_values",
  "measure_allocations",
] as const;

const sql = readMigration(MIGRATION);
const schema = loadSchemaInventory();
const policies = loadPolicyInventory();
const grants = loadGrantInventory();

/** The body of one CREATE TABLE, so a constraint can be attributed to its own table. */
function tableBody(table: string): string {
  const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS public.${table} (`);
  if (start < 0) throw new Error(`${MIGRATION} does not create public.${table}`);
  const end = sql.indexOf("\n);", start);
  if (end < 0) throw new Error(`could not find the end of public.${table}`);
  return sql.slice(start, end);
}

describe("the local measure fund schema", () => {
  it("creates all six tables with row security on", () => {
    for (const table of MEASURE_TABLES) {
      expect(schema.createdIn(table), `${table} must be created`).toBe(MIGRATION);
      expect(schema.rlsEnabled(table), `${table} must enable row level security`).toBe(true);
    }
  });

  /**
   * THE COLUMN THE WHOLE DESIGN TURNS ON.
   *
   * `funding_awards.awarded_amount` is `NOT NULL DEFAULT 0`, which is why
   * `drawdown-ledger.ts` has to treat a stored 0 as "nobody entered it" on
   * every read — the column cannot hold the difference between a zero and an
   * absence. `received_amount` must never acquire either modifier: a period
   * nobody has reported is not a period that received nothing, and on a public
   * oversight page those are different sentences about an agency's money.
   *
   * Asserted against the column DEFINITION rather than against behaviour,
   * because behaviour would still look right for a long time after the default
   * was added — right up until a period was opened and left alone.
   */
  it("keeps received_amount nullable, with no default, and non-negative", () => {
    const body = tableBody("measure_fund_periods");
    const line = body.split("\n").find((text) => text.trim().startsWith("received_amount"));
    expect(line, "measure_fund_periods must declare received_amount").toBeTruthy();

    expect(line).toMatch(/NUMERIC\(14,2\)/i);
    expect(line, "an unreported receipt must stay NULL — see funding_awards.awarded_amount").not.toMatch(/NOT\s+NULL/i);
    expect(line, "a DEFAULT would make an unopened period indistinguishable from a zero one").not.toMatch(/DEFAULT/i);
    expect(body).toMatch(/CHECK \(received_amount IS NULL OR received_amount >= 0\)/i);

    // The contrast is the point, so the other side of it is asserted too. If
    // funding_awards is ever fixed, this line fails and the comment above needs
    // rewriting rather than silently going stale.
    const awards = readMigration("20260410000043_funding_awards_and_profiles.sql");
    expect(awards).toMatch(/awarded_amount\s+NUMERIC\(14,2\)\s+NOT NULL DEFAULT 0/i);
  });

  it("keeps the agency's own forecast nullable too, and never derives one", () => {
    const body = tableBody("measure_fund_periods");
    const line = body.split("\n").find((text) => text.trim().startsWith("forecast_amount"));
    expect(line).toBeTruthy();
    expect(line).not.toMatch(/NOT\s+NULL/i);
    expect(line).not.toMatch(/DEFAULT/i);
    // No column anywhere holds a figure OpenPlan projected.
    expect(sql).not.toMatch(/projected_amount|expected_receipt|estimated_receipt/i);
  });

  /**
   * NOTHING IS HARDCODED (product non-negotiable #0).
   *
   * A `DEFAULT 'USD'` would be a country assumption baked into the schema, and
   * the architecture may not assume the US. Percentages, category lists and
   * jurisdictions live in `measure_allocation_rules.rule`, so none of them may
   * appear as a literal here either.
   */
  it("bakes in no currency, no percentage and no jurisdiction", () => {
    const currency = tableBody("measure_funds")
      .split("\n")
      .find((text) => text.trim().startsWith("currency_code"));
    expect(currency).toMatch(/NOT NULL/i);
    expect(currency, "a default currency is a country assumption").not.toMatch(/DEFAULT/i);

    // No allocation percentage may be a column default or a CHECK bound.
    expect(sql).not.toMatch(/percent\w*\s+NUMERIC[^,\n]*DEFAULT\s+\d/i);
    // The ordinance's split lives in JSONB, and nowhere else.
    expect(tableBody("measure_allocation_rules")).toMatch(/rule\s+JSONB NOT NULL/i);
  });

  /**
   * NULLS ARE DISTINCT IN A UNIQUE INDEX.
   *
   * A single `UNIQUE (period_id, category_id, recipient_id)` would permit
   * unlimited duplicate POOLED rows, because every one of them has a NULL
   * recipient. That is the trap `20260811000007`'s header records for a
   * nullable key column, and here it would double-count a category's money.
   */
  it("stops a pooled allocation from being written twice", () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS ux_measure_allocations_pooled[\s\S]*?\(period_id, category_id\)[\s\S]*?WHERE recipient_id IS NULL/i
    );
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS ux_measure_allocations_recipient[\s\S]*?\(period_id, category_id, recipient_id\)[\s\S]*?WHERE recipient_id IS NOT NULL/i
    );
  });

  /**
   * A DENORMALIZED workspace_id INVITES A CROSS-TENANT CHILD.
   *
   * Every table here carries `workspace_id` so its RLS policy is a direct test.
   * The cost is a child row whose workspace disagrees with its parent's — a row
   * the wrong tenant can read. The composite foreign key makes Postgres refuse
   * that outright, which is a mechanism rather than a rule somebody has to
   * remember.
   */
  it("makes a child's workspace agree with its parent's, in the database", () => {
    expect(tableBody("measure_fund_periods")).toMatch(
      /FOREIGN KEY \(measure_fund_id, workspace_id\)\s*REFERENCES public\.measure_funds \(id, workspace_id\)/i
    );
    expect(tableBody("measure_allocation_rules")).toMatch(
      /FOREIGN KEY \(measure_fund_id, workspace_id\)\s*REFERENCES public\.measure_funds \(id, workspace_id\)/i
    );
    expect(tableBody("measure_recipients")).toMatch(
      /FOREIGN KEY \(measure_fund_id, workspace_id\)\s*REFERENCES public\.measure_funds \(id, workspace_id\)/i
    );
    expect(tableBody("measure_recipient_basis_values")).toMatch(
      /FOREIGN KEY \(recipient_id, workspace_id\)\s*REFERENCES public\.measure_recipients \(id, workspace_id\)/i
    );
    expect(tableBody("measure_allocations")).toMatch(
      /FOREIGN KEY \(period_id, workspace_id\)\s*REFERENCES public\.measure_fund_periods \(id, workspace_id\)/i
    );
  });

  it("keeps one measure per program record", () => {
    expect(tableBody("measure_funds")).toMatch(
      /program_id\s+UUID NOT NULL UNIQUE REFERENCES public\.programs\(id\)/i
    );
  });

  /**
   * A HAND-ENTERED FIGURE MUST CARRY ITS REASONING, and a computed one must
   * carry the rule version it came from. Both are CHECKs rather than route
   * validation: the claim "this is what the ordinance produced" has to survive
   * a service-role write.
   */
  it("will not store a manual allocation with no rationale or a computed one with no rule", () => {
    const body = tableBody("measure_allocations");
    expect(body).toMatch(/computation_basis\s+TEXT NOT NULL CHECK \(computation_basis IN \('descriptor', 'manual'\)\)/i);
    expect(body).toMatch(/CHECK \(computation_basis <> 'manual' OR length\(btrim\(coalesce\(rationale, ''\)\)\) > 0\)/i);
    expect(body).toMatch(/CHECK \(computation_basis <> 'descriptor' OR allocation_rule_id IS NOT NULL\)/i);
    // Deleting the ordinance reading a stored money figure was computed from
    // would leave that figure with no provenance at all.
    expect(body).toMatch(/allocation_rule_id UUID REFERENCES public\.measure_allocation_rules\(id\) ON DELETE RESTRICT/i);
  });

  it("requires a stated source and a stater for every apportionment figure", () => {
    const body = tableBody("measure_recipient_basis_values");
    expect(body).toMatch(/basis_source_note TEXT NOT NULL CHECK \(length\(btrim\(basis_source_note\)\) > 0\)/i);
    expect(body).toMatch(/stated_by\s+UUID NOT NULL REFERENCES auth\.users\(id\) ON DELETE RESTRICT/i);
    expect(body).toMatch(/vintage_label\s+TEXT NOT NULL/i);
    // Four decimals: a basis is not always a count, and rounding a divisor
    // changes every share.
    expect(body).toMatch(/basis_value\s+NUMERIC\(18,4\) NOT NULL CHECK \(basis_value >= 0\)/i);
  });

  it("gives the public oversight surface its columns, switched off", () => {
    const body = tableBody("measure_funds");
    expect(body).toMatch(/public_share_enabled BOOLEAN NOT NULL DEFAULT false/i);
    expect(body).toMatch(/public_share_token\s+TEXT UNIQUE/i);
  });
});

describe("the local measure fund privileges", () => {
  /**
   * A POLICY AND A GRANT ARE TWO SEPARATE LOCKS.
   *
   * `a-policy-without-a-grant-is-a-locked-door.test.ts` asks this of the whole
   * corpus, and it must stay green for these six. Repeated here by name because
   * the general rule would go green again if someone deleted the policies
   * instead of adding the grants — which is exactly what a "fix" to a failing
   * corpus-wide guard tends to look like.
   */
  it("grants a signed-in planner exactly the commands the policies promise", () => {
    const expected: Record<string, string[]> = {
      measure_funds: ["SELECT", "INSERT", "UPDATE", "DELETE"],
      measure_fund_periods: ["SELECT", "INSERT", "UPDATE", "DELETE"],
      // No UPDATE: a rule version is what an ordinance said on a date.
      measure_allocation_rules: ["SELECT", "INSERT", "DELETE"],
      // No DELETE: the invoicing_clients posture — a body that has been paid
      // public money must keep appearing on the record that paid it.
      measure_recipients: ["SELECT", "INSERT", "UPDATE"],
      // No UPDATE: a stated figure with a named source is a record.
      measure_recipient_basis_values: ["SELECT", "INSERT", "DELETE"],
      measure_allocations: ["SELECT", "INSERT", "UPDATE", "DELETE"],
    };

    for (const [table, commands] of Object.entries(expected)) {
      for (const command of ["SELECT", "INSERT", "UPDATE", "DELETE"] as const) {
        const held = grants.holds(table, "authenticated", command);
        const shouldHold = commands.includes(command);
        expect(held !== "none", `${table}: authenticated ${command} should be ${shouldHold}`).toBe(shouldHold);
      }
      // By NAME, not swept up by a blanket grant that happened to include it.
      expect(grants.heldBy(table, "authenticated", "SELECT")?.reach).toBe("named");
    }
  });

  it("gives anon nothing on any of the six", () => {
    // The public oversight page is a service-role read behind a share token. An
    // anon grant would hand a fund's whole ledger to anyone holding the
    // publishable key, which the browser ships by design.
    for (const table of MEASURE_TABLES) {
      for (const command of ["SELECT", "INSERT", "UPDATE", "DELETE"] as const) {
        expect(grants.holds(table, "anon", command), `${table}: anon must hold no ${command}`).toBe("none");
      }
    }
  });

  /**
   * THE REVOKE RUNS FIRST, AND THAT IS NOT COSMETIC.
   *
   * Postgres drops column privileges along with table-level ones, so a REVOKE
   * placed after a GRANT destroys it. Asserted by byte offset because the
   * ordering is the property, and a reader cannot see it from the grant
   * inventory (which replays both and reports only the outcome).
   */
  it("revokes before it grants, for every table", () => {
    for (const table of MEASURE_TABLES) {
      const revoke = sql.indexOf(`REVOKE ALL ON TABLE public.${table} FROM PUBLIC, anon, authenticated;`);
      const grant = sql.indexOf(`GRANT SELECT`, sql.indexOf(`public.${table}`));
      expect(revoke, `${table} must revoke first`).toBeGreaterThan(-1);
      expect(revoke).toBeLessThan(sql.lastIndexOf(`ON TABLE public.${table} TO authenticated;`));
      expect(grant).toBeGreaterThan(-1);
    }
  });

  /**
   * ROLE-AWARE AT THE PERMISSIVE LAYER, so a viewer is refused by the policy
   * itself and no restrictive `_writer_only_*` gate is needed.
   *
   * Both halves matter. Without the first, a viewer holding the publishable key
   * and their own session JWT writes straight through PostgREST. Without the
   * second, `viewer-write-denial-guard.test.ts`'s "keeps the gate list honest"
   * assertion fails, because a gate over a table with no role-blind policy is
   * either dead weight or a sign the inventory cannot read the policies.
   */
  it("puts the role check in every write policy and adds no restrictive gate", () => {
    for (const table of MEASURE_TABLES) {
      for (const command of ["INSERT", "UPDATE", "DELETE"] as const) {
        for (const policy of policies.permissiveGrants(table, command)) {
          expect(policy.body, `${table}.${policy.policy} must consult the member's role`).toMatch(
            /workspace_member_can_write/i
          );
        }
      }
      expect(
        policies.all().filter((policy) => policy.table === table && policy.kind === "RESTRICTIVE"),
        `${table} must not carry a restrictive writer gate — its permissive policies are already role-aware`
      ).toEqual([]);
    }
  });

  it("lets every member READ without asking their role", () => {
    // Reading is not a write. A restrictive FOR ALL gate would take reading away
    // from the very role the viewer tier exists to keep reading.
    for (const table of MEASURE_TABLES) {
      const reads = policies.permissiveGrants(table, "SELECT");
      expect(reads, `${table} must be readable by its workspace`).toHaveLength(1);
      expect(reads[0]?.body).toMatch(/workspace_members/i);
      expect(reads[0]?.body).not.toMatch(/workspace_member_can_write/i);
    }
  });
});
