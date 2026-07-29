import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Migration-content guard for the award closure-provenance columns
 * (20260729000001).
 *
 * THE DEFECT IT CLOSES. `funding_awards.spending_status` could hold
 * `fully_spent` and said nothing about how it got there. The create route took
 * that value verbatim from a dropdown, so an award could be born closed with no
 * coverage check, no close-out milestone and no posture rebuild — and with no
 * PATCH route, permanently. Two rows both reading "fully spent" could therefore
 * mean opposite things and nothing could tell them apart.
 *
 * What this guard pins is the part that must be true in the DATABASE, not only
 * in a route: additive nullable columns, a closed basis vocabulary, an
 * equivalence between the closed status and the basis (both directions), a
 * required statement behind an asserted closure, an accounted-for re-open, an
 * honest backfill for rows that were already closed, and no destructive
 * statement anywhere.
 */

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260729000001_funding_award_closure_provenance.sql",
);

const sql = readFileSync(migrationPath, "utf8");
// Executable statements only. The header legitimately NAMES things the
// migration must not do while explaining why they are absent, and a guard that
// read the comments would either pass on prose or fail on it.
const sqlWithoutComments = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("funding award closure-provenance migration", () => {
  it("adds every closure and re-open column additively and nullable", () => {
    for (const column of [
      "closure_basis",
      "closed_at",
      "closed_by",
      "closure_note",
      "reopened_at",
      "reopened_by",
      "reopen_reason",
    ]) {
      expect(
        sqlWithoutComments,
        `${column} must be added with ADD COLUMN IF NOT EXISTS so the migration is re-runnable`,
      ).toMatch(new RegExp(`ALTER TABLE funding_awards\\s+ADD COLUMN IF NOT EXISTS ${column}\\b`));
    }

    // NOT NULL on a new column would need a default, and a default here would
    // invent provenance for every existing row.
    expect(sqlWithoutComments).not.toMatch(/ADD COLUMN IF NOT EXISTS \w+ [A-Z]+ NOT NULL/);
  });

  it("keeps the basis vocabulary closed to the three values that mean something", () => {
    expect(sqlWithoutComments).toMatch(/closure_basis IS NULL/);
    for (const basis of ["earned_coverage", "recorded_on_import", "unrecorded_legacy"]) {
      expect(sqlWithoutComments).toContain(`'${basis}'`);
    }
  });

  it("ties the closed status and the basis together in BOTH directions", () => {
    // An equivalence, not an implication. `fully_spent` with no basis is the
    // original defect; a basis with no `fully_spent` is a stale closure left
    // behind by a re-open that forgot to clear it, which would leave a re-opened
    // award still reading as closed.
    expect(sqlWithoutComments).toMatch(
      /\(spending_status = 'fully_spent'\)\s*=\s*\(closure_basis IS NOT NULL\)/,
    );
  });

  it("refuses an asserted closure that states no basis", () => {
    expect(sqlWithoutComments).toMatch(/closure_basis IS DISTINCT FROM 'recorded_on_import'/);
    expect(sqlWithoutComments).toMatch(/length\(btrim\(closure_note\)\) > 0/);
  });

  it("refuses a re-open that is not accounted for", () => {
    expect(sqlWithoutComments).toMatch(/reopened_at IS NULL AND reopen_reason IS NULL/);
    expect(sqlWithoutComments).toMatch(/length\(btrim\(reopen_reason\)\) > 0/);
  });

  it("backfills already-closed awards as unrecorded rather than as earned", () => {
    // The honesty hinge of the whole migration. Backfilling `earned_coverage`
    // would manufacture a verified close-out for rows that may well have been
    // typed in on the create form — the exact claim this change exists to stop.
    expect(sqlWithoutComments).toMatch(/UPDATE funding_awards/);
    expect(sqlWithoutComments).toMatch(/SET closure_basis = 'unrecorded_legacy'/);
    expect(sqlWithoutComments).toMatch(/WHERE spending_status = 'fully_spent'/);
    // Idempotent, so re-running the migration cannot overwrite a basis a route
    // has since recorded.
    expect(sqlWithoutComments).toMatch(/AND closure_basis IS NULL/);
    expect(sqlWithoutComments).not.toMatch(/SET closure_basis = 'earned_coverage'/);
  });

  it("runs the backfill before the constraint it has to satisfy", () => {
    // Ordering is load-bearing: every already-closed row violates the coherence
    // CHECK until the backfill has run, so an ALTER TABLE ... ADD CONSTRAINT
    // placed first would abort the migration on any database with a closed
    // award in it.
    const backfillAt = sqlWithoutComments.indexOf("SET closure_basis = 'unrecorded_legacy'");
    const coherenceAt = sqlWithoutComments.indexOf("funding_awards_closure_basis_matches_status");

    expect(backfillAt).toBeGreaterThan(-1);
    expect(coherenceAt).toBeGreaterThan(-1);
    expect(backfillAt).toBeLessThan(coherenceAt);
  });

  it("guards every constraint add so re-running the migration is safe", () => {
    const guards = sql.match(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint/g)?.length ?? 0;
    const adds = sqlWithoutComments.match(/ADD CONSTRAINT/g)?.length ?? 0;

    expect(adds).toBe(4);
    expect(guards).toBe(adds);
  });

  it("adds no policy, because a column inherits its table's", () => {
    // funding_awards already carries permissive read/insert/update/delete
    // policies (20260410000043) and the RESTRICTIVE writer gates
    // (20260728000006). A new policy here would be a second, divergent answer to
    // a question already settled, and would move the counts
    // src/test/migrations/inventory.test.ts pins.
    expect(sqlWithoutComments).not.toMatch(/CREATE POLICY/i);
    expect(sqlWithoutComments).not.toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });

  it("destroys nothing", () => {
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/DROP COLUMN/i);
    expect(sql).not.toMatch(/DROP CONSTRAINT/i);
    expect(sql).not.toMatch(/\bDELETE FROM\b/i);
    expect(sql).not.toMatch(/TRUNCATE/i);
  });
});
