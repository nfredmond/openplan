import { describe, expect, it } from "vitest";
import { blankComments, migrationFiles, readMigration } from "./migrations/read-migrations";
import { KB_EXTRACTION_SOURCES } from "@/lib/knowledge-base/types";

/**
 * `extraction_source` is ONE vocabulary, and it is written in three places.
 *
 * WHY THIS SHAPE OF TEST, SPECIFICALLY. On 2026-08-05 the portal's language set
 * grew from 11 to 22 in TypeScript while the database CHECK kept the original
 * eleven. The app then offered a Hmong speaker their own language and the
 * DATABASE refused the row at the end of a form they had already filled in. The
 * same two-copies-of-one-vocabulary shape is here, so it gets the same guard:
 * parse the migration SQL and compare.
 *
 * BOTH CHECKs are pinned, not only the live one:
 *
 *   20260811000005 — where the column was born, with three values. Pinned
 *   because it is the one whose header PROMISED that 'ocr' would arrive with
 *   "the worker lane's own migration", and a future edit that quietly added
 *   'ocr' there instead would erase the record of when the capability actually
 *   started existing.
 *
 *   20260811000010 — the widening, which is what the database enforces today.
 *   Pinned because this is the copy that can refuse a row.
 *
 * And the TypeScript constant is the third copy, which is what the application
 * types against.
 *
 * Comments are blanked before parsing, so a vocabulary quoted in a header — and
 * 20260811000005's header quotes this one — cannot be mistaken for the
 * constraint itself. That exact confusion has broken five guards in this repo
 * in one day, in both directions.
 */

const ORIGINAL_MIGRATION = "20260811000005_document_library_stored_kinds.sql";
const WIDENING_MIGRATION = "20260811000010_kb_ocr_extraction_source.sql";
const CSV_MIGRATION = "20260824000003_project_estimated_cost_and_csv_provenance.sql";

/**
 * Blank every single-quoted SQL string literal, preserving length so offsets
 * and line numbers still line up. `''` is Postgres's escaped apostrophe inside
 * a literal, so it is consumed as part of the literal rather than closing it.
 */
function withoutStringLiterals(sql: string): string {
  const out = sql.split("");
  let index = 0;
  while (index < sql.length) {
    if (sql[index] !== "'") {
      index += 1;
      continue;
    }
    let cursor = index + 1;
    while (cursor < sql.length) {
      if (sql[cursor] === "'") {
        if (sql[cursor + 1] === "'") {
          cursor += 2;
          continue;
        }
        break;
      }
      cursor += 1;
    }
    for (let i = index + 1; i < Math.min(cursor, sql.length); i += 1) {
      if (out[i] !== "\n") out[i] = " ";
    }
    index = cursor + 1;
  }
  return out.join("");
}

/** The `IN (…)` vocabulary of the extraction_source CHECK in one migration. */
function vocabularyIn(file: string): string[] | null {
  const sql = blankComments(readMigration(file));
  const match = /CHECK\s*\(\s*extraction_source\s+IN\s*\(([^)]*)\)/i.exec(sql);
  if (!match) return null;
  return match[1]
    .split(",")
    .map((value) => value.trim().replace(/^'|'$/g, ""))
    .filter(Boolean)
    .sort();
}

describe("the extraction_source vocabulary is one vocabulary", () => {
  it("has both migrations to read (the parser is not agreeing with an empty set)", () => {
    // A parser that finds nothing would make every assertion below pass by
    // agreeing with an empty vocabulary — the failure mode that let the GTFS
    // policies sit unarmed for four months. Absence is a failure, not a skip.
    const files = migrationFiles();
    expect(files).toContain(ORIGINAL_MIGRATION);
    expect(files).toContain(WIDENING_MIGRATION);
    expect(files).toContain(CSV_MIGRATION);
    expect(vocabularyIn(ORIGINAL_MIGRATION)).not.toBeNull();
    expect(vocabularyIn(WIDENING_MIGRATION)).not.toBeNull();
    expect(vocabularyIn(CSV_MIGRATION)).not.toBeNull();
  });

  it("matches the widened CHECK, which is what the database enforces today", () => {
    expect(vocabularyIn(CSV_MIGRATION)).toEqual([...KB_EXTRACTION_SOURCES].sort());
  });

  it("matches the original CHECK plus exactly the value the worker earned", () => {
    const original = vocabularyIn(ORIGINAL_MIGRATION);
    expect(original).toEqual(
      [...KB_EXTRACTION_SOURCES].filter((value) => value !== "ocr" && value !== "spreadsheet_parse").sort()
    );
    // The OCR migration remains a dated record of the capability at that time.
    expect(vocabularyIn(WIDENING_MIGRATION)).not.toContain("spreadsheet_parse");
    expect(KB_EXTRACTION_SOURCES).toContain("spreadsheet_parse");
  });

  it("keeps 'ocr' distinguishable from 'text_layer' — the reason it is not a boolean", () => {
    // A vocabulary that collapsed these two would type-check, migrate cleanly,
    // and quietly stop every surface from being able to say that a figure was
    // read off a scan by a machine rather than embedded by the plan's author.
    expect(KB_EXTRACTION_SOURCES).toContain("ocr");
    expect(KB_EXTRACTION_SOURCES).toContain("text_layer");
  });

  it("carries no confidence or accuracy companion in the OCR migration", () => {
    // The recogniser can emit per-word confidence figures. A column here would
    // put "OCR confidence 94%" next to a dollar figure in an adopted plan — a
    // machine vouching for a planning number, which is the one thing this
    // entire lane exists to prevent.
    //
    // PROSE MUST NOT REACH THIS MATCHER, in either direction. `--` comments are
    // blanked, and so are single-quoted STRING LITERALS: the migration's own
    // COMMENT ON statements argue at length that no confidence column may
    // exist, and matching that argument would fail the guard for saying the
    // right thing (this test failed exactly that way when first written). What
    // is left is DDL — the only place a column could actually be declared.
    const sql = withoutStringLiterals(blankComments(readMigration(WIDENING_MIGRATION))).toLowerCase();
    for (const word of ["confidence", "certainty", "likelihood", "accuracy"]) {
      expect(sql, `${WIDENING_MIGRATION} declares a ${word} column`).not.toMatch(
        new RegExp(`\\b${word}\\b`)
      );
    }
  });

  it("the literal stripper is what makes the check above meaningful", () => {
    // Non-vacuity, both ways. If `withoutStringLiterals` blanked everything,
    // the assertion above would pass over an empty string; if it blanked
    // nothing, it would fail on the migration's own argument. Prove it keeps
    // DDL and drops literals.
    const sample = "ALTER TABLE t ADD COLUMN ocr_confidence real; COMMENT ON TABLE t IS 'no confidence here';";
    const stripped = withoutStringLiterals(sample);
    expect(stripped).toContain("ocr_confidence");
    expect(stripped).not.toContain("no confidence here");

    const migration = withoutStringLiterals(blankComments(readMigration(WIDENING_MIGRATION)));
    expect(migration).toContain("kb_ocr_jobs");
    expect(migration).toContain("pages_with_text");
  });
});
