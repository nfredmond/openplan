import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 20260812000014 — the recorded off-the-top take, and the atomic replacement.
 *
 * ============================================================================
 * WHAT A STATIC READ OF A MIGRATION CAN AND CANNOT PROVE
 * ============================================================================
 *
 * It can prove the constraints, policies and grants were WRITTEN. It cannot
 * prove Postgres enforces them, and this repository has a recorded case of a
 * guard reading migration TEXT and staying green for months over eight tables
 * whose correct policies were never switched on (`unarmed-policy-defect-class`).
 *
 * So the division of labour here is deliberate:
 *
 *   THIS FILE          the CHECKs, the uniqueness, the composite foreign keys,
 *                      SECURITY INVOKER, the scope refusal, the EXECUTE grants
 *   the live probe     that a failed INSERT rolls the DELETE back
 *                      (run 2026-08-12, recorded at the bottom of
 *                      `measure-allocate-route.test.ts`)
 *   inventory.test.ts  that the policy and grant COUNTS moved by exactly three
 *                      and two, so a fourth policy cannot appear unremarked
 *   the locked-door    that the GRANT and the policies agree, so none of the
 *   guard              three is a door with no handle
 *
 * The one assertion below that is about ABSENCE — no UPDATE policy — is the
 * kind that rots silently, so it is written as an equality on the policy list
 * rather than as a `not.toMatch`: a fourth policy of any command fails it.
 */

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260812000014_measure_off_the_top_and_atomic_allocation.sql"),
  "utf8"
);

/**
 * SQL comments stripped, `--` to end of line.
 *
 * NOT `stripSourceComments`, and the header of that helper says why in as many
 * words: `--` is TypeScript's decrement operator, so a shared stripper that
 * understood SQL would delete real code from every `.ts` file it was pointed
 * at. A SQL stripper is a separate function chosen by a caller who knows what
 * they are reading. This migration's header argues at length about negative
 * amounts and deleted rows; every one of those paragraphs would satisfy the
 * assertions below.
 */
const sql = migration.replace(/--[^\n]*/g, "");

describe("measure_period_off_the_top — the shape of a recorded take", () => {
  it("cannot hold a negative amount, in either column", () => {
    expect(sql).toMatch(/amount\s+NUMERIC\(14,2\)\s+NOT NULL\s+CHECK \(amount >= 0\)/);
    expect(sql).toMatch(/uncapped_amount\s+NUMERIC\(14,2\)\s+NOT NULL\s+CHECK \(uncapped_amount >= 0\)/);
  });

  /**
   * The cap arithmetic sums these rows. Two rows for one clause in one period
   * would double the year-to-date total — which stops an agency taking money it
   * is entitled to — and, on a recompute that failed halfway, would let it take
   * the same money twice.
   */
  it("allows exactly one row per clause per period", () => {
    expect(sql).toMatch(/CONSTRAINT measure_period_off_the_top_uniq UNIQUE \(period_id, off_the_top_id\)/);
  });

  it("refuses a cap amount with no window, and a cap status that contradicts the cap", () => {
    // The descriptor's own refusal, mirrored in the database: "a cap with no
    // window is a cap nobody can evaluate".
    expect(sql).toMatch(/measure_period_off_the_top_cap_pair[\s\S]{0,120}\(cap_amount IS NULL\) = \(cap_basis IS NULL\)/);
    expect(sql).toMatch(/cap_status = 'no_cap' AND cap_amount IS NULL/);
    expect(sql).toMatch(/cap_status <> 'no_cap' AND cap_amount IS NOT NULL/);
  });

  it("keeps the four cap statuses the allocator can produce, and no others", () => {
    expect(sql).toMatch(/cap_status IN \('no_cap', 'within_cap', 'capped', 'not_evaluable'\)/);
    expect(sql).toMatch(/cap_basis IN \('per_period', 'fiscal_year'\)/);
  });

  /**
   * The composite keys, which are what stop a row being parented across
   * tenants. A plain `REFERENCES measure_fund_periods(id)` would let a row
   * carrying workspace A's `workspace_id` hang off workspace B's period.
   */
  it("reaches its period and its fund through (id, workspace_id)", () => {
    expect(sql).toMatch(
      /FOREIGN KEY \(period_id, workspace_id\)\s+REFERENCES public\.measure_fund_periods \(id, workspace_id\) ON DELETE CASCADE/
    );
    expect(sql).toMatch(
      /FOREIGN KEY \(measure_fund_id, workspace_id\)\s+REFERENCES public\.measure_funds \(id, workspace_id\) ON DELETE CASCADE/
    );
  });

  it("will not let the ordinance reading behind a stored figure be deleted", () => {
    expect(sql).toMatch(
      /allocation_rule_id UUID REFERENCES public\.measure_allocation_rules\(id\) ON DELETE RESTRICT/
    );
  });

  /**
   * THREE POLICIES, ASSERTED AS A SET. A `not.toMatch(/FOR UPDATE/)` would pass
   * the day somebody adds `measure_period_off_the_top_amend` spelled any other
   * way; the equality fails on any fourth policy at all.
   */
  it("has exactly a read, an insert and a delete — no UPDATE, by design", () => {
    const policies = [...sql.matchAll(/CREATE POLICY (measure_period_off_the_top_\w+)[\s\S]*?FOR (\w+)/g)].map(
      (match) => `${match[1]} ${match[2]}`
    );
    expect(policies).toEqual([
      "measure_period_off_the_top_read SELECT",
      "measure_period_off_the_top_insert INSERT",
      "measure_period_off_the_top_delete DELETE",
    ]);
  });

  it("makes both write policies role-aware rather than membership-only", () => {
    expect(sql).toMatch(
      /CREATE POLICY measure_period_off_the_top_insert[\s\S]{0,120}WITH CHECK \(public\.workspace_member_can_write\(workspace_id\)\)/
    );
    expect(sql).toMatch(
      /CREATE POLICY measure_period_off_the_top_delete[\s\S]{0,120}USING \(public\.workspace_member_can_write\(workspace_id\)\)/
    );
  });

  it("revokes before it grants, gives anon nothing, and grants exactly what the policies promise", () => {
    const revokeAt = sql.indexOf("REVOKE ALL ON TABLE public.measure_period_off_the_top");
    const grantAt = sql.indexOf("GRANT SELECT, INSERT, DELETE ON TABLE public.measure_period_off_the_top");
    expect(revokeAt).toBeGreaterThan(-1);
    expect(grantAt).toBeGreaterThan(-1);
    // Postgres drops column privileges along with table-level ones, so a revoke
    // placed after a grant destroys it.
    expect(revokeAt).toBeLessThan(grantAt);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.measure_period_off_the_top FROM PUBLIC, anon, authenticated;/);
    // No UPDATE for `authenticated`: a privilege granted past a policy is a
    // policy a future migration can quietly widen into.
    expect(sql).not.toMatch(/GRANT[^;]*UPDATE[^;]*ON TABLE public\.measure_period_off_the_top TO authenticated/);
  });
});

describe("replace_measure_period_allocation — the all-or-nothing replacement", () => {
  it("is declared with the signature the route calls", () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.replace_measure_period_allocation\(\s*p_measure_fund_id uuid,\s*p_period_id\s+uuid,\s*p_allocations\s+jsonb,\s*p_off_the_top\s+jsonb\s*\)/
    );
    expect(sql).toMatch(/RETURNS jsonb/);
  });

  /**
   * SECURITY INVOKER IS THE LOAD-BEARING WORD.
   *
   * A definer function would bypass the row policies on both tables and have to
   * re-implement the tenant boundary in its own body. Invoker keeps RLS as the
   * access control: `authorizeMeasureWrite` in the route is the first gate, and
   * this is the one that holds if the first is ever wrong. A future edit
   * flipping it to DEFINER would silently make an EXECUTE grant to
   * `authenticated` into unrestricted write access across every tenant's
   * allocations.
   */
  it("runs as the caller, so the row policies are still the access control", () => {
    expect(sql).toMatch(/replace_measure_period_allocation[\s\S]{0,300}SECURITY INVOKER/);
    expect(sql).not.toMatch(/replace_measure_period_allocation[\s\S]{0,300}SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path = public, pg_catalog/);
  });

  /**
   * The refusal RLS cannot make. Rows for another period are all in the
   * caller's own workspace, so every policy passes — and they would be inserted
   * BESIDE that period's existing figures, which is the every-category-appears-
   * twice outcome the wholesale replacement exists to prevent.
   */
  it("refuses any row that does not name the period and fund being replaced — in BOTH arrays", () => {
    /*
     * COUNTED, NOT MATCHED. The first version of this test asserted the two
     * predicates appear at all, and a mutation that disabled the check on
     * `p_allocations` while leaving it on `p_off_the_top` SURVIVED: the same
     * text was still in the file, one clause down. The scope check is per
     * array, so the assertion has to be per array too.
     */
    const scopedArrays = [
      ...sql.matchAll(
        /FROM jsonb_array_elements\((p_allocations|p_off_the_top)\) AS entry\s+WHERE \(entry->>'period_id'\)::uuid IS DISTINCT FROM p_period_id\s+OR \(entry->>'measure_fund_id'\)::uuid IS DISTINCT FROM p_measure_fund_id/g
      ),
    ].map((match) => match[1]);

    expect(scopedArrays.sort()).toEqual(["p_allocations", "p_off_the_top"]);
    expect(sql).toMatch(/every row must name period % of fund %/);
  });

  it("clears BOTH tables for the period, not just the category rows", () => {
    expect(sql).toMatch(/DELETE FROM public\.measure_allocations\s+WHERE period_id = p_period_id\s+AND measure_fund_id = p_measure_fund_id/);
    expect(sql).toMatch(/DELETE FROM public\.measure_period_off_the_top\s+WHERE period_id = p_period_id\s+AND measure_fund_id = p_measure_fund_id/);
  });

  it("returns the replaced counts the route reports to its caller", () => {
    expect(sql).toMatch(/'replaced_allocation_count', v_replaced_allocations/);
    expect(sql).toMatch(/'replaced_off_the_top_count', v_replaced_off_the_top/);
    expect(sql).toMatch(/'allocations', v_allocations/);
  });

  /**
   * `authenticated` needs EXECUTE — a signed-in planner allocates a period from
   * the browser. `anon` is revoked EXPLICITLY, because Supabase's default
   * privileges grant EXECUTE on new public functions to both client roles and
   * `REVOKE … FROM PUBLIC` does not remove those direct grants. That is the
   * lesson 20260722000005 exists to record, and forgetting it here would put a
   * function that rewrites a public fund's allocations behind nothing at all.
   */
  it("locks EXECUTE down to the signed-in roles and revokes anon by name", () => {
    const signature = "public.replace_measure_period_allocation(uuid, uuid, jsonb, jsonb)";
    expect(sql).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM anon;`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${signature} TO authenticated;`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`);
  });

  it("is wrapped in an explicit transaction, so a partial migration is not left behind", () => {
    expect(sql.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
  });
});
