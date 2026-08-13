import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 20260812000019 — what the ordinance kept back, and the replacement that now
 * covers all three row sets.
 *
 * ============================================================================
 * WHAT A STATIC READ OF A MIGRATION CAN AND CANNOT PROVE
 * ============================================================================
 *
 * It can prove the constraints, policies and grants were WRITTEN. It cannot
 * prove Postgres enforces them, and this repository has a recorded case of a
 * guard reading migration TEXT and staying green for months over eight tables
 * whose correct policies were never switched on (`unarmed-policy-defect-class`).
 * The division of labour is the one `measure-off-the-top-migration.test.ts`
 * sets out, and this file is its sibling:
 *
 *   THIS FILE          the CHECKs, the uniqueness, the composite foreign keys,
 *                      the DROP that stops the old signature overloading,
 *                      SECURITY INVOKER, the three-array scope refusal, the
 *                      EXECUTE grants
 *   inventory.test.ts  that the policy and grant COUNTS moved by exactly three
 *                      and two, so a fourth policy cannot appear unremarked
 *   the locked-door    that the GRANT and the policies agree, so none of the
 *   guard              three is a door with no handle
 *
 * THE ONE THING NEITHER CAN SEE is that a failed INSERT rolls the DELETEs back.
 * That is a property of Postgres, and it was proven against the live local
 * database rather than reasoned about: the probe is recorded at the bottom of
 * `measure-reserve-reconciliation.test.ts`, which also carries the four
 * constraint refusals below being raised by a real server and the period still
 * holding its rows after each rollback.
 */

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260812000019_measure_period_reserve.sql"),
  "utf8"
);

/**
 * SQL comments stripped, `--` to end of line.
 *
 * NOT `stripSourceComments`: `--` is TypeScript's decrement operator, so a
 * shared stripper that understood SQL would delete real code from every `.ts`
 * file it was pointed at. This migration's header argues at length about
 * overloaded functions, cleared rows and default arguments, and every one of
 * those paragraphs would satisfy the assertions below.
 */
const sql = migration.replace(/--[^\n]*/g, "");

describe("measure_period_reserve — the shape of a recorded reserve", () => {
  it("cannot hold a negative amount, in either money column, or a basis it was not taken of", () => {
    expect(sql).toMatch(/amount\s+NUMERIC\(14,2\)\s+NOT NULL\s+CHECK \(amount >= 0\)/);
    expect(sql).toMatch(/computed_amount\s+NUMERIC\(14,2\)\s+NOT NULL\s+CHECK \(computed_amount >= 0\)/);
    expect(sql).toMatch(/basis_amount\s+NUMERIC\(14,2\)\s+NOT NULL\s+CHECK \(basis_amount >= 0\)/);
  });

  /**
   * A rate outside 0–100 is not a percentage of anything, and four decimal
   * places is what `percentSchema` allows — ordinances really do apportion in
   * thirds, and a column that rounded 33.3333 to 33.33 would store a different
   * ordinance from the one the allocator applied.
   */
  it("stores the ordinance's rate at the descriptor's own precision, bounded", () => {
    expect(sql).toMatch(/percent\s+NUMERIC\(7,4\)\s+NOT NULL\s+CHECK \(percent >= 0 AND percent <= 100\)/);
  });

  /**
   * The public surfaces SUBTRACT these rows from what came in. Two rows for one
   * clause in one period would double the subtraction, in the direction that
   * understates what the ordinance's own purposes were given.
   */
  it("allows exactly one row per clause per period", () => {
    expect(sql).toMatch(/CONSTRAINT measure_period_reserve_uniq UNIQUE \(period_id, reserve_id\)/);
  });

  /**
   * The basis is three columns rather than the descriptor's one `category:<id>`
   * string, so no reader has to parse a prefix to find out what kind of reserve
   * it is. The CHECKs are what stop the three drifting apart: a 'category'
   * reserve with no category cannot say what it came out of, and a category id
   * with no label prints as an id on a public page.
   */
  it("keeps the three basis kinds closed and the category triple consistent", () => {
    expect(sql).toMatch(/basis_kind IN \('gross', 'after_off_the_top', 'category'\)/);
    expect(sql).toMatch(
      /measure_period_reserve_basis_pair[\s\S]{0,120}\(basis_kind = 'category'\) = \(basis_category_id IS NOT NULL\)/
    );
    expect(sql).toMatch(
      /measure_period_reserve_basis_label_pair[\s\S]{0,140}\(basis_category_id IS NULL\) = \(basis_category_label IS NULL\)/
    );
  });

  /**
   * The composite keys, which are what stop a row being parented across
   * tenants. A plain `REFERENCES measure_fund_periods(id)` would let a row
   * carrying workspace A's `workspace_id` hang off workspace B's period — and
   * these rows change what workspace B's published oversight page says its own
   * purposes were given.
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
      /allocation_rule_id\s+UUID REFERENCES public\.measure_allocation_rules\(id\) ON DELETE RESTRICT/
    );
  });

  /**
   * THREE POLICIES, ASSERTED AS A SET. A `not.toMatch(/FOR UPDATE/)` would pass
   * the day somebody adds `measure_period_reserve_amend` spelled any other way;
   * the equality fails on any fourth policy at all.
   */
  it("has exactly a read, an insert and a delete — no UPDATE, by design", () => {
    const policies = [...sql.matchAll(/CREATE POLICY (measure_period_reserve_\w+)[\s\S]*?FOR (\w+)/g)].map(
      (match) => `${match[1]} ${match[2]}`
    );
    expect(policies).toEqual([
      "measure_period_reserve_read SELECT",
      "measure_period_reserve_insert INSERT",
      "measure_period_reserve_delete DELETE",
    ]);
  });

  it("makes both write policies role-aware rather than membership-only", () => {
    expect(sql).toMatch(
      /CREATE POLICY measure_period_reserve_insert[\s\S]{0,120}WITH CHECK \(public\.workspace_member_can_write\(workspace_id\)\)/
    );
    expect(sql).toMatch(
      /CREATE POLICY measure_period_reserve_delete[\s\S]{0,120}USING \(public\.workspace_member_can_write\(workspace_id\)\)/
    );
  });

  it("revokes before it grants, gives anon nothing, and grants exactly what the policies promise", () => {
    const revokeAt = sql.indexOf("REVOKE ALL ON TABLE public.measure_period_reserve");
    const grantAt = sql.indexOf("GRANT SELECT, INSERT, DELETE ON TABLE public.measure_period_reserve");
    expect(revokeAt).toBeGreaterThan(-1);
    expect(grantAt).toBeGreaterThan(-1);
    // Postgres drops column privileges along with table-level ones, so a revoke
    // placed after a grant destroys it.
    expect(revokeAt).toBeLessThan(grantAt);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.measure_period_reserve FROM PUBLIC, anon, authenticated;/);
    // No UPDATE for `authenticated`: a privilege granted past a policy is a
    // policy a future migration can quietly widen into.
    expect(sql).not.toMatch(/GRANT[^;]*UPDATE[^;]*ON TABLE public\.measure_period_reserve TO authenticated/);
  });
});

describe("replace_measure_period_allocation — all three row sets, all or nothing", () => {
  /**
   * THE DROP IS THE LOAD-BEARING STATEMENT IN THIS HALF OF THE MIGRATION.
   *
   * `CREATE OR REPLACE FUNCTION` with a new argument list creates an OVERLOAD.
   * Without the DROP the four-argument version stays callable, and a route that
   * reached it would clear a period's categories and its takes and leave the
   * previous reserve rows in place beside the new figures — a division under
   * two ordinances, which is the exact outcome the wholesale replacement
   * exists to prevent.
   */
  it("drops the four-argument signature rather than overloading it", () => {
    expect(sql).toContain(
      "DROP FUNCTION IF EXISTS public.replace_measure_period_allocation(uuid, uuid, jsonb, jsonb);"
    );
    const dropAt = sql.indexOf("DROP FUNCTION IF EXISTS public.replace_measure_period_allocation");
    const createAt = sql.indexOf("CREATE OR REPLACE FUNCTION public.replace_measure_period_allocation");
    expect(dropAt).toBeGreaterThan(-1);
    expect(createAt).toBeGreaterThan(dropAt);
  });

  /**
   * The default is what makes the migrate-before-deploy window safe: an older
   * build calling with four named arguments resolves here, its period's reserve
   * rows are cleared with everything else, and none are written — correct for a
   * build that computes none. Remove it and a planner cannot allocate a period
   * until the deploy lands.
   */
  it("is declared with the signature the route calls, and a default for the older one", () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.replace_measure_period_allocation\(\s*p_measure_fund_id uuid,\s*p_period_id\s+uuid,\s*p_allocations\s+jsonb,\s*p_off_the_top\s+jsonb,\s*p_reserves\s+jsonb DEFAULT '\[\]'::jsonb\s*\)/
    );
    expect(sql).toMatch(/RETURNS jsonb/);
  });

  /**
   * SECURITY INVOKER IS THE LOAD-BEARING WORD, for the reason 20260812000014
   * gives: a definer function would bypass the row policies on all three tables
   * and have to re-implement the tenant boundary in its own body. Flipping it
   * would turn an EXECUTE grant to `authenticated` into unrestricted write
   * access across every tenant's measure figures.
   */
  it("runs as the caller, so the row policies are still the access control", () => {
    expect(sql).toMatch(/replace_measure_period_allocation[\s\S]{0,400}SECURITY INVOKER/);
    expect(sql).not.toMatch(/replace_measure_period_allocation[\s\S]{0,400}SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path = public, pg_catalog/);
  });

  /**
   * THE SCOPE REFUSAL, COUNTED PER ARRAY RATHER THAN MATCHED.
   *
   * The predecessor's own test records why: asserting the predicate "appears"
   * let a mutation that disabled it for one array survive, because the same
   * text was still in the file one clause down. There are three arrays now, so
   * the count has to be three.
   */
  it("refuses any row that does not name the period and fund being replaced — in ALL THREE arrays", () => {
    const scopedArrays = [
      ...sql.matchAll(
        /FROM jsonb_array_elements\((p_allocations|p_off_the_top|p_reserves)\) AS entry\s+WHERE \(entry->>'period_id'\)::uuid IS DISTINCT FROM p_period_id\s+OR \(entry->>'measure_fund_id'\)::uuid IS DISTINCT FROM p_measure_fund_id/g
      ),
    ].map((match) => match[1]);

    expect(scopedArrays.sort()).toEqual(["p_allocations", "p_off_the_top", "p_reserves"]);
    expect(sql).toMatch(/every row must name period % of fund %/);
    // And the shape check covers the third array too — a scalar `p_reserves`
    // would otherwise reach `jsonb_array_elements` and raise something the
    // route cannot recognise.
    expect(sql).toMatch(/jsonb_typeof\(p_reserves\) <> 'array'/);
  });

  it("clears all three tables for the period, in the one statement batch", () => {
    expect(sql).toMatch(
      /DELETE FROM public\.measure_allocations\s+WHERE period_id = p_period_id\s+AND measure_fund_id = p_measure_fund_id/
    );
    expect(sql).toMatch(
      /DELETE FROM public\.measure_period_off_the_top\s+WHERE period_id = p_period_id\s+AND measure_fund_id = p_measure_fund_id/
    );
    expect(sql).toMatch(
      /DELETE FROM public\.measure_period_reserve\s+WHERE period_id = p_period_id\s+AND measure_fund_id = p_measure_fund_id/
    );
  });

  /**
   * EVERY COLUMN A SURFACE READS HAS TO BE INSERTED, and a static read of the
   * INSERT is the only place this is visible: the Supabase client is untyped,
   * so a column left out of the function body would be a silent NULL — or, for
   * the NOT NULL ones, a runtime failure a planner meets rather than a test.
   */
  it("writes every reserve column the projection reads", () => {
    const insert = /INSERT INTO public\.measure_period_reserve \(([\s\S]*?)\)\s+SELECT/.exec(sql)?.[1] ?? "";
    const columns = insert
      .split(",")
      .map((column) => column.trim())
      .filter(Boolean);
    expect(columns).toEqual([
      "workspace_id",
      "measure_fund_id",
      "period_id",
      "reserve_id",
      "label",
      "basis_kind",
      "basis_category_id",
      "basis_category_label",
      "basis_amount",
      "percent",
      "amount",
      "computed_amount",
      "allocation_rule_id",
      "stated_by",
      "stated_on",
    ]);
  });

  it("returns the replaced counts the route reports to its caller", () => {
    expect(sql).toMatch(/'replaced_allocation_count', v_replaced_allocations/);
    expect(sql).toMatch(/'replaced_off_the_top_count', v_replaced_off_the_top/);
    expect(sql).toMatch(/'replaced_reserve_count', v_replaced_reserves/);
    expect(sql).toMatch(/'allocations', v_allocations/);
  });

  /**
   * `authenticated` needs EXECUTE — a signed-in planner allocates a period from
   * the browser. `anon` is revoked EXPLICITLY, because Supabase's default
   * privileges grant EXECUTE on new public functions to both client roles and
   * `REVOKE … FROM PUBLIC` does not remove those direct grants (the lesson
   * 20260722000005 exists to record). Forgetting it here would put a function
   * that rewrites a public fund's whole division behind nothing at all.
   */
  it("locks EXECUTE down to the signed-in roles and revokes anon by name", () => {
    const signature = "public.replace_measure_period_allocation(uuid, uuid, jsonb, jsonb, jsonb)";
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
