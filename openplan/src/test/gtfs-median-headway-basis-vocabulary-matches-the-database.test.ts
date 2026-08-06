import { describe, expect, it } from "vitest";
import { blankComments, migrationFiles, readMigration } from "./migrations/read-migrations";
import { GTFS_MEDIAN_HEADWAY_BASES } from "@/lib/gtfs/types";

/**
 * The TypeScript vocabulary and the database CHECK must be the same vocabulary.
 *
 * `median_headway_basis` says why a median headway is what it is, and two of its
 * three values are refusals — "the span is mostly unserved" and "too few
 * departures for a headway to be an idea yet". That makes it a CLAIM TIER, and
 * the honesty of every service-level row rests on the two refusals surviving the
 * trip from the derivation into the table.
 *
 * WHY THIS SHAPE OF TEST, SPECIFICALLY. On 2026-08-05 the portal's language set
 * grew from 11 to 22 in TypeScript while `engagement_item_demographics
 * .primary_language` kept a CHECK holding the original eleven. The consequence
 * was not a build failure: the app offered a Hmong speaker their own language and
 * the DATABASE refused the row at the end of a form they had already filled in —
 * the failure landing on a member of the public, in an error page in a language
 * it would not be written in. The same two-copies-of-one-vocabulary shape is here,
 * so it gets the same guard: parse the migration SQL and compare.
 *
 * Comments are blanked before parsing, so a vocabulary quoted in a header cannot
 * be mistaken for the constraint itself.
 */

const CHECKED_TABLES = ["gtfs_route_service_levels", "gtfs_stop_service_levels"] as const;

/** The `IN (…)` vocabulary of the median-headway CHECK on `table`, per the migrations. */
function databaseVocabulary(table: string): string[] | null {
  for (const file of migrationFiles().slice().reverse()) {
    const sql = blankComments(readMigration(file));
    const constraint = new RegExp(
      `CONSTRAINT\\s+${table}_median_headway_basis_check\\s+CHECK\\s*\\(\\s*median_headway_basis\\s+IN\\s*\\(([^)]*)\\)`,
      "i"
    ).exec(sql);
    if (!constraint) continue;

    return constraint[1]
      .split(",")
      .map((value) => value.trim().replace(/^'|'$/g, ""))
      .filter(Boolean)
      .sort();
  }
  return null;
}

describe("the median-headway-basis vocabulary is one vocabulary", () => {
  it.each(CHECKED_TABLES)("matches TypeScript on %s", (table) => {
    const database = databaseVocabulary(table);

    // A parser that finds nothing would make this test pass by agreeing with an
    // empty set — the failure mode that let the GTFS policies sit unarmed for
    // four months. Absence is a failure, not a skip.
    expect(database, `no median_headway_basis CHECK found for ${table} in any migration`).not.toBeNull();
    expect(database).toEqual([...GTFS_MEDIAN_HEADWAY_BASES].sort());
  });

  it("keeps both refusals, which are the reason the column exists", () => {
    // A vocabulary that kept only `hourly_average_over_span` would type-check,
    // migrate cleanly, and quietly turn every "we cannot say" into a number.
    expect(GTFS_MEDIAN_HEADWAY_BASES.filter((basis) => basis.startsWith("not_determined_"))).toHaveLength(2);
  });
});
