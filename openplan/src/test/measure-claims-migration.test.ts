import { describe, expect, it } from "vitest";
import { loadGrantInventory } from "./migrations/grant-inventory";
import { loadPolicyInventory } from "./migrations/policy-inventory";
import { loadSchemaInventory } from "./migrations/schema-inventory";
import { readMigration } from "./migrations/read-migrations";

/**
 * THE CLAIM SCHEMA, guarded where the schema is the artifact.
 *
 * Not prose scanned for claims. Every assertion below is about a live property
 * of the database the migrations define — a CHECK, a privilege, a policy
 * predicate — and each one is a decision a future edit could reverse with no
 * other test noticing. Three of them are the places where this side of the
 * reimbursement seam deliberately DIFFERS from the other, which is exactly the
 * kind of difference that gets "tidied" back into symmetry by someone reading
 * only the shapes.
 */

const MIGRATION = "20260812000012_measure_claims.sql";

const CLAIM_TABLES = ["measure_claims", "measure_claim_documents", "measure_moe_records"] as const;

const sql = readMigration(MIGRATION);
const schema = loadSchemaInventory();
const policies = loadPolicyInventory();
const grants = loadGrantInventory();

function tableBody(table: string): string {
  const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS public.${table} (`);
  if (start < 0) throw new Error(`${MIGRATION} does not create public.${table}`);
  const end = sql.indexOf("\n);", start);
  if (end < 0) throw new Error(`could not find the end of public.${table}`);
  return sql.slice(start, end);
}

describe("the measure claim schema", () => {
  it("creates all three tables with row security on", () => {
    for (const table of CLAIM_TABLES) {
      expect(schema.createdIn(table), `${table} must be created`).toBe(MIGRATION);
      expect(schema.rlsEnabled(table), `${table} must enable row level security`).toBe(true);
    }
  });

  /**
   * THE DEFECT FIX, ASSERTED AGAINST BOTH SIDES.
   *
   * `billing_invoice_records` permits `status = 'paid'` with no `paid_date`, and
   * `buildAwardDrawdownLedger` carries a `paidWithNoDateCount` on every read
   * because of it (drawdown-ledger.ts:144). This table refuses the row instead.
   *
   * The other side is asserted too, so that if `billing_invoice_records` is
   * ever fixed this test fails and the comparison in the migration header gets
   * rewritten rather than quietly going stale.
   */
  it("refuses a paid claim with no payment date, unlike the invoice register", () => {
    expect(tableBody("measure_claims")).toMatch(
      /CONSTRAINT measure_claims_paid_has_a_date\s*\n?\s*CHECK \(status <> 'paid' OR paid_on IS NOT NULL\)/i
    );

    // `paid_date` reached billing_invoice_records in 20260727000010, not in the
    // original invoicing migration. Asserted so that if it ever acquires the
    // same CHECK, this test fails and the comparison in 20260812000012's header
    // gets rewritten rather than quietly going stale.
    const invoices = readMigration("20260727000010_receivable_invoicing.sql");
    expect(invoices).toMatch(/paid_date\s+DATE/i);
    expect(
      invoices,
      "if billing_invoice_records now requires a paid date, rewrite the comparison in 20260812000012's header"
    ).not.toMatch(/status <> 'paid' OR paid_date IS NOT NULL/i);
  });

  /**
   * A DECISION HAS AN AUTHOR, AND A DENIAL HAS A REASON.
   *
   * The two things that make the funder side different from the claimant side.
   * Enforced in the database rather than only in the route, because "public
   * money left the fund and nobody is recorded as having decided that" is not a
   * state any second writer should be able to reach.
   */
  it("requires a decider on every decided state and a reason on every denial", () => {
    const body = tableBody("measure_claims");

    expect(body).toMatch(/CONSTRAINT measure_claims_decision_has_an_author/i);
    expect(body).toMatch(/status IN \('draft', 'submitted', 'withdrawn'\)/i);
    expect(body).toMatch(/decided_by IS NOT NULL AND decided_at IS NOT NULL/i);

    expect(body).toMatch(
      /CONSTRAINT measure_claims_denial_states_a_reason\s*\n?\s*CHECK \(status <> 'denied' OR length\(btrim\(coalesce\(denial_reason, ''\)\)\) > 0\)/i
    );

    // The decision author cannot be erased out from under the decision.
    expect(body).toMatch(/decided_by\s+UUID REFERENCES auth\.users\(id\) ON DELETE RESTRICT/i);
  });

  /**
   * THE DELETE POLICY IS A MECHANISM, NOT A ROUTE CONVENTION.
   *
   * A submitted claim is a public body's request on the record and a paid one
   * is a disbursement. The route says so in words; the POLICY is what makes it
   * true for a second writer, a script, or a future agent action that never
   * read the route.
   */
  it("permits deleting a draft claim and nothing else, in the policy itself", () => {
    const deletePolicies = policies.permissiveGrants("measure_claims", "DELETE");
    expect(deletePolicies.map((policy) => policy.policy)).toEqual(["measure_claims_delete"]);

    const [deletePolicy] = deletePolicies;
    expect(deletePolicy.command).toBe("DELETE");
    expect(deletePolicy.kind).toBe("PERMISSIVE");
    // Both halves: the role gate AND the draft restriction.
    expect(deletePolicy.body).toMatch(/workspace_member_can_write\(workspace_id\)/i);
    expect(deletePolicy.body, "a submitted or paid claim must not be deletable").toMatch(/status = 'draft'/i);
  });

  /**
   * MAINTENANCE OF EFFORT STORES NO VERDICT.
   *
   * A computed compliance judgement with no column is exactly the tier-guard
   * blind spot already recorded against the RTP fiscal verdict — the guard
   * walks columns, so a verdict that lives only in a derivation is invisible to
   * it. Here there is no column at all, so there is nothing to promote, and
   * both figures stay nullable so `not_determined` is representable.
   */
  it("stores two nullable figures and no compliance verdict", () => {
    const body = tableBody("measure_moe_records");

    for (const column of ["required_amount", "reported_amount"]) {
      const line = body.split("\n").find((text) => text.trim().startsWith(column));
      expect(line, `measure_moe_records must declare ${column}`).toBeTruthy();
      expect(line, `${column} must stay nullable — not_determined has to be representable`).not.toMatch(/NOT\s+NULL/i);
      expect(line, `a DEFAULT on ${column} would make an unanswered year read as a finding`).not.toMatch(/DEFAULT/i);
    }

    expect(sql).not.toMatch(/compliance_status|moe_verdict|is_compliant|compliance_verdict/i);
  });

  /**
   * NOTHING NAMES A PLACE, A PERCENTAGE OR A CATEGORY.
   *
   * Product non-negotiable #0. `category_id` in particular carries no CHECK: an
   * ordinance's categories are ITS list, and a vocabulary here would be a
   * second, wrong one that every differently-shaped measure would fail.
   */
  it("bakes in no category vocabulary and no jurisdiction", () => {
    const line = tableBody("measure_claims")
      .split("\n")
      .find((text) => text.trim().startsWith("category_id"));
    expect(line).toMatch(/TEXT NOT NULL/i);
    expect(line, "the ordinance declares its own categories").not.toMatch(/IN \(/i);
    expect(sql).not.toMatch(/REFERENCES public\.measure_categories/i);
  });

  /**
   * THE EVIDENCE FOR A PAID CLAIM CANNOT BE DELETED OUT FROM UNDER IT, and the
   * link is a link: no second byte store, no second Document Library source.
   */
  it("links backup to kb_documents with RESTRICT and adds no second store", () => {
    const body = tableBody("measure_claim_documents");
    expect(body).toMatch(/kb_document_id UUID NOT NULL REFERENCES public\.kb_documents\(id\) ON DELETE RESTRICT/i);
    expect(body).toMatch(/CONSTRAINT measure_claim_documents_uniq UNIQUE \(claim_id, kb_document_id\)/i);
    // No storage path, no bucket, no bytes.
    expect(sql).not.toMatch(/storage_ref|storage_path|byte_size|storage\.buckets/i);
  });

  /**
   * A DENORMALIZED workspace_id INVITES A CROSS-TENANT CHILD, and a composite
   * foreign key is what makes Postgres refuse it rather than a rule somebody
   * has to remember. Lane 1's posture, continued.
   */
  it("makes every child's workspace agree with its parent's, in the database", () => {
    expect(tableBody("measure_claims")).toMatch(
      /FOREIGN KEY \(measure_fund_id, workspace_id\)\s*\n?\s*REFERENCES public\.measure_funds \(id, workspace_id\)/i
    );
    expect(tableBody("measure_claims")).toMatch(
      /FOREIGN KEY \(recipient_id, workspace_id\)\s*\n?\s*REFERENCES public\.measure_recipients \(id, workspace_id\)/i
    );
    expect(tableBody("measure_claim_documents")).toMatch(
      /FOREIGN KEY \(claim_id, workspace_id\)\s*\n?\s*REFERENCES public\.measure_claims \(id, workspace_id\)/i
    );
    expect(tableBody("measure_moe_records")).toMatch(
      /FOREIGN KEY \(recipient_id, workspace_id\)\s*\n?\s*REFERENCES public\.measure_recipients \(id, workspace_id\)/i
    );
  });

  /**
   * NULLS ARE DISTINCT IN A UNIQUE INDEX.
   *
   * A plain `UNIQUE (recipient_id, claim_reference)` would be satisfied by any
   * number of rows leaving the reference blank — which is most of them — so the
   * index is partial.
   */
  it("stops two claims sharing one reference number, without blocking blank ones", () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS ux_measure_claims_recipient_reference[\s\S]*?\(recipient_id, claim_reference\)[\s\S]*?WHERE claim_reference IS NOT NULL/i
    );
  });

  /**
   * A POLICY WITHOUT A GRANT IS A LOCKED DOOR, and a grant wider than a policy
   * is a door a future migration can widen further.
   *
   * `a-policy-without-a-grant-is-a-locked-door.test.ts` catches the first
   * across the whole corpus; this pins the exact privilege set, including the
   * two absences that are deliberate.
   */
  it("grants exactly the commands its policies promise, and nothing to anon", () => {
    for (const table of CLAIM_TABLES) {
      expect(grants.holds(table, "anon", "SELECT"), `${table} must never be readable by anon`).toBe("none");
      expect(grants.holds(table, "authenticated", "SELECT")).toBe("table");
      expect(grants.holds(table, "authenticated", "INSERT")).toBe("table");
    }

    expect(grants.holds("measure_claims", "authenticated", "UPDATE")).toBe("table");
    expect(grants.holds("measure_claims", "authenticated", "DELETE")).toBe("table");

    // No UPDATE on an attachment: an assertion is withdrawn by detaching.
    expect(grants.holds("measure_claim_documents", "authenticated", "UPDATE")).toBe("none");
    expect(grants.holds("measure_claim_documents", "authenticated", "DELETE")).toBe("table");

    expect(grants.holds("measure_moe_records", "authenticated", "UPDATE")).toBe("table");

    // By NAME, not swept up by a blanket grant that happened to include them.
    for (const table of CLAIM_TABLES) {
      expect(grants.heldBy(table, "authenticated", "SELECT")?.reach).toBe("named");
    }

    // THE REVOKE RUNS FIRST — PER TABLE, not "somewhere above".
    //
    // Postgres drops column privileges along with table-level ones, so a revoke
    // placed after a grant destroys it. Asserted per table because the obvious
    // version of this check ("the last REVOKE precedes the first GRANT") is
    // vacuous: deleting one table's revoke leaves the other two, both still
    // above every grant, and the check passes. That mutation SURVIVED the first
    // draft of this test.
    for (const table of CLAIM_TABLES) {
      const revoke = sql.indexOf(`REVOKE ALL ON TABLE public.${table} `);
      const grant = sql.indexOf(`ON TABLE public.${table} TO authenticated`);
      expect(revoke, `${table} must revoke before it grants`).toBeGreaterThan(-1);
      expect(grant, `${table} must grant to authenticated`).toBeGreaterThan(-1);
      expect(revoke, `${table}'s REVOKE must precede its GRANT`).toBeLessThan(grant);
    }
  });

  /**
   * ROLE-AWARE PERMISSIVE, NO RESTRICTIVE GATE — Lane 1's posture continued.
   *
   * Every write policy consults the role through `workspace_member_can_write`,
   * so none of these tables needs a `_writer_only_*` companion to supply one.
   * A gate over a table that has no role-blind policy is what
   * `viewer-write-denial-guard.test.ts`'s "keeps the gate list honest"
   * assertion fails on.
   */
  it("makes every write policy role-aware at the permissive layer", () => {
    for (const table of CLAIM_TABLES) {
      const tablePolicies = policies.forTable(table);
      expect(tablePolicies.length).toBeGreaterThan(0);

      for (const policy of tablePolicies) {
        expect(policy.kind, `${policy.policy} must be permissive`).toBe("PERMISSIVE");
        if (policy.command === "SELECT") continue;
        expect(policy.body, `${policy.policy} must consult the role`).toMatch(/workspace_member_can_write/i);
      }
    }

    expect(sql, "these tables carry no restrictive gate — see the header").not.toMatch(/AS RESTRICTIVE/i);
  });
});
