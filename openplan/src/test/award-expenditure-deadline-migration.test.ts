import { describe, expect, it } from "vitest";

import { WORK_NOTIFICATION_KINDS } from "@/lib/notifications/work";

import { migrationKindVocabulary } from "./helpers/fake-work-notification-tables";
import { blankComments, migrationFiles, readMigration } from "./migrations/read-migrations";
import { loadSchemaInventory } from "./migrations/schema-inventory";

/**
 * THE LAPSE DATE'S MIGRATION (20260812000010).
 *
 * Three claims about a schema change that adds no table, and each is checked
 * against the corpus rather than against this file's memory of it:
 *
 *   1. The award carries TWO deadlines, not one renamed. Obligating is
 *      committing the money; expending is spending it. A migration that moved
 *      or replaced `obligation_due_at` would leave every existing award's
 *      obligation date pointing at the wrong meaning, and the sweep would
 *      remind people of a deadline they already met.
 *   2. The reminder kind is legal in the DATABASE, not only in TypeScript. The
 *      sweep's insert is rejected by the CHECK otherwise — at 13:00 UTC, in a
 *      cron, with nobody watching.
 *   3. It creates no table, so it needs no GRANT block. That is asserted rather
 *      than asserted-in-prose: a v0.14.0 defect shipped a table whose policies
 *      were a locked door because the grant was missing, and the shape of this
 *      file's claim is what the guard for that reads.
 */

const MIGRATION = "20260812000010_award_expenditure_deadline.sql";

function migrationSql(): string {
  return blankComments(readMigration(MIGRATION));
}

describe("the award expenditure (lapse) deadline migration", () => {
  it("is on disk and applies after the tables it alters were created", () => {
    const files = migrationFiles();
    expect(files).toContain(MIGRATION);
    // Filename order is application order. This one only alters — it would
    // fail outright if it ran before `work_notifications` or `funding_awards`
    // existed. (Whether it sits above the last SHIPPED migration is
    // release-ordering.test.ts's question, not this file's.)
    for (const earlier of [
      "20260410000043_funding_awards_and_profiles.sql",
      "20260811000007_work_notifications.sql",
    ]) {
      expect(files.indexOf(MIGRATION)).toBeGreaterThan(files.indexOf(earlier));
    }
  });

  it("adds a lapse date beside the obligation date, never in place of it", () => {
    const inventory = loadSchemaInventory();

    expect(inventory.hasColumn("funding_awards", "expenditure_deadline_at")).toBe(true);
    expect(inventory.hasColumn("funding_awards", "obligation_due_at")).toBe(true);

    const sql = migrationSql();
    // Nullable and defaultless: OpenPlan cannot know a program's lapse rule,
    // and a date it invented would be one an agency plans around. Asserted on
    // the ADD COLUMN statement alone — the partial index below it legitimately
    // says IS NOT NULL, and a pattern loose enough to catch that would fail on
    // the correct migration.
    const addColumn = sql.match(/ADD\s+COLUMN[^;]*expenditure_deadline_at[^;]*;/i)?.[0] ?? "";
    expect(addColumn).toMatch(
      /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+expenditure_deadline_at\s+TIMESTAMPTZ\s*;/i
    );
    expect(addColumn).not.toMatch(/\bDEFAULT\b/i);
    expect(addColumn).not.toMatch(/\bNOT\s+NULL\b/i);
    // And it does not touch the other deadline: no rename, no backfill, no
    // UPDATE copying one column into the other.
    expect(sql).not.toMatch(/\bRENAME\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+funding_awards\b/i);
  });

  it("makes the new reminder kind legal in the database", () => {
    // Read out of the corpus, so the constraint and the TypeScript vocabulary
    // cannot drift apart in either direction.
    expect(migrationKindVocabulary()).toContain("award_expenditure_due");
    expect(migrationKindVocabulary().sort()).toEqual([...WORK_NOTIFICATION_KINDS].sort());

    const sql = migrationSql();
    // Dropped then re-added: an inline column CHECK has no name in the source,
    // so widening it in place is not available and a stale constraint left
    // behind would refuse every insert of the new kind.
    expect(sql).toMatch(
      /ALTER\s+TABLE\s+work_notifications\s+DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+work_notifications_kind_check/i
    );
    expect(sql).toMatch(
      /ALTER\s+TABLE\s+work_notifications\s+ADD\s+CONSTRAINT\s+work_notifications_kind_check\s+CHECK/i
    );
  });

  it("creates no table, so it owes no GRANT block and moves no policy count", () => {
    const sql = migrationSql();
    expect(sql).not.toMatch(/CREATE\s+TABLE/i);
    expect(sql).not.toMatch(/CREATE\s+POLICY/i);
    expect(sql).not.toMatch(/ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    // A GRANT here would widen a posture this migration has no business
    // widening: both tables it touches already hold exactly the privileges
    // their own migrations decided on.
    expect(sql).not.toMatch(/\bGRANT\b/i);
  });
});
