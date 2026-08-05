import { describe, expect, it } from "vitest";

import { LANGUAGES, demographicLabel } from "@/lib/engagement/demographics";
import { TRANSLATION_LANGUAGES } from "@/lib/engagement/translation-languages";

import { blankComments, migrationFiles, readMigration } from "./migrations/read-migrations";

/**
 * THE LANGUAGE VOCABULARY EXISTS IN THREE PLACES AND MUST NOT DRIFT.
 *
 *   1. `TRANSLATION_LANGUAGES` — what the portal renders and translates.
 *   2. `LANGUAGES` in demographics.ts — plus two non-language sentinels a
 *      resident may pick ("other", "prefer_not_to_say").
 *   3. A CHECK constraint on `engagement_item_demographics.primary_language`.
 *
 * TypeScript keeps the label maps honest — they are exhaustive Records, so a
 * language with no label fails the build. Nothing keeps 1 against 2, and
 * NOTHING AT ALL keeps either against 3: `.select()` strings and CHECK
 * vocabularies are opaque to the compiler in this codebase by design.
 *
 * The failure that shape produces lands on a member of the public rather than
 * on a developer. The portal offers a Hmong speaker their own language, they
 * choose it, and the row is refused by a constraint at the end of a form they
 * have already filled in — an error page in a language it will not be written
 * in. That is the worst place in this product for a list to be out of date, so
 * it is the one place a test reads the SQL itself.
 */

/** The sentinels demographics carries that are answers, not languages. */
const NON_LANGUAGE_ANSWERS = ["other", "prefer_not_to_say"] as const;

/**
 * The vocabulary the LIVE constraint enforces — the last `CHECK (primary_language
 * IN (...))` in migration order, since a later migration may replace an earlier
 * one and only the final state is what a database actually holds.
 */
function primaryLanguageCheckVocabulary(): { values: string[]; file: string } | null {
  let found: { values: string[]; file: string } | null = null;

  for (const file of migrationFiles()) {
    // Comments are blanked FIRST. A guard that greps raw SQL can be satisfied
    // — or broken — by prose in a comment that happens to spell the pattern;
    // `every-api-route-has-a-caller` was once defeated by a route path written
    // inside an operator-facing sentence. Only live SQL may answer this.
    const sql = blankComments(readMigration(file));
    const matches = sql.matchAll(
      /CHECK\s*\(\s*primary_language\s+IN\s*\(([\s\S]*?)\)\s*\)/gi
    );
    for (const match of matches) {
      const values = Array.from(match[1].matchAll(/'([^']+)'/g)).map((entry) => entry[1]);
      if (values.length > 0) found = { values, file };
    }
  }

  return found;
}

describe("the demographics language vocabulary", () => {
  it("offers exactly the languages the portal carries, plus the two non-language answers", () => {
    expect([...LANGUAGES]).toEqual([...TRANSLATION_LANGUAGES, ...NON_LANGUAGE_ANSWERS]);
  });

  it("is enforced by a database CHECK that names the same values", () => {
    const constraint = primaryLanguageCheckVocabulary();
    expect(
      constraint,
      "no migration defines a CHECK on primary_language — if the constraint was dropped deliberately, delete this test and say why"
    ).not.toBeNull();

    // Order is not a property of a SQL IN list, so compare as sets — but
    // membership is exact in BOTH directions: a value in the database the code
    // never offers is dead vocabulary, and a value the code offers that the
    // database refuses is a resident's submission failing at the last step.
    expect(new Set(constraint!.values)).toEqual(new Set(LANGUAGES));
  });

  it("names every language it enforces (no unlabelled code reaches a summary)", () => {
    // `DEMOGRAPHIC_LABELS` is a loose Record<string, string>, so a missing entry
    // does not fail the build — `demographicLabel` falls back to the raw code
    // and a resident's language renders as "hmn" on the demographics summary.
    // Derived labels make that impossible; this proves the derivation is live.
    const unlabelled = TRANSLATION_LANGUAGES.filter(
      (language) => demographicLabel(language) === language
    );
    expect(unlabelled).toEqual([]);
  });
});
