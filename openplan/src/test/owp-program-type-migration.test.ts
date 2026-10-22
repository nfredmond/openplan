import { describe, expect, it } from "vitest";
import { PROGRAM_TYPE_OPTIONS } from "@/lib/programs/catalog";
import { blankComments, migrationFiles, readMigration } from "./migrations/read-migrations";

/**
 * THE OVERALL WORK PROGRAM TYPE: one CHECK replaced, never two left behind.
 *
 * `programs.program_type` was guarded by an inline, unnamed CHECK in
 * 20260315000022, which Postgres names `programs_program_type_check`.
 * 20261017000009 drops it by that name and adds the widened one back. The
 * hazard is a constraint that is renamed or already widened on some
 * installation: a drop by the wrong name fails, but an `IF EXISTS` drop would
 * pass and leave the old CHECK in force beside the new one, refusing every
 * OWP. So the migration checks the catalog first and stops loudly.
 *
 * The live half is `owp-program-type-rls.test.ts`. Blind category: this reads
 * the files, not a database, so it cannot tell whether Postgres renders the
 * expected definition exactly as written (the live run and the pg_dump of a
 * local schema can).
 */

const ORIGINAL = "20260315000022_programs_module.sql";
const MIGRATION = "20261017000009_owp_program_type.sql";

const sql = blankComments(readMigration(MIGRATION));

/** The quoted values in the first `program_type IN (...)` after `from`. */
function inListValues(text: string, from = 0): string[] {
  const match = /program_type\s+IN\s*\(([^)]*)\)/i.exec(text.slice(from));
  if (!match) throw new Error("no program_type IN (...) list found");
  return [...match[1].matchAll(/'([^']+)'/g)].map((value) => value[1]);
}

const originalValues = inListValues(blankComments(readMigration(ORIGINAL)));

describe("20261017000009 adds owp_upwp to programs.program_type", () => {
  it("starts from the six original types", () => {
    expect(originalValues).toEqual(["rtip", "stip", "itip", "tcep", "local_measure", "other"]);
  });

  it("adds exactly owp_upwp and keeps every original type", () => {
    const added = sql.indexOf("ADD CONSTRAINT programs_program_type_check");
    expect(added).toBeGreaterThan(-1);
    const values = inListValues(sql, added);
    expect(new Set(values)).toEqual(new Set([...originalValues, "owp_upwp"]));
    expect(values).toHaveLength(originalValues.length + 1);
  });

  it("matches the types the app offers", () => {
    const added = sql.indexOf("ADD CONSTRAINT programs_program_type_check");
    expect(new Set(inListValues(sql, added))).toEqual(new Set(PROGRAM_TYPE_OPTIONS.map((option) => option.value)));
  });

  it("stops unless the original constraint is the only CHECK on the column", () => {
    const guard = sql.indexOf("DO $$");
    const drop = sql.indexOf("DROP CONSTRAINT programs_program_type_check");
    expect(guard).toBeGreaterThan(-1);
    expect(drop).toBeGreaterThan(guard);
    const body = sql.slice(guard, drop);

    expect(body).toMatch(/a\.attname = 'program_type'/);
    expect(body).toMatch(/c\.contype = 'c'/);
    expect(body).toMatch(/IF v_count <> 1 THEN\s+RAISE EXCEPTION/);
    expect(body).toMatch(/IF v_name <> 'programs_program_type_check' THEN\s+RAISE EXCEPTION/);

    // The expected definition is the original six values, in their original order.
    const expected = /IF v_definition <> '(.*)' THEN\s+RAISE EXCEPTION/.exec(body);
    expect(expected).not.toBeNull();
    const listed = [...(expected?.[1] ?? "").matchAll(/''([a-z_]+)''::text/g)].map((value) => value[1]);
    expect(listed).toEqual(originalValues);
  });

  it("drops by name without IF EXISTS, then adds NOT VALID, then validates, in one transaction", () => {
    expect(sql).not.toMatch(/DROP CONSTRAINT IF EXISTS/i);
    const drop = sql.indexOf("DROP CONSTRAINT programs_program_type_check;");
    const add = sql.search(/ADD CONSTRAINT programs_program_type_check[\s\S]*?\) NOT VALID;/);
    const validate = sql.indexOf("VALIDATE CONSTRAINT programs_program_type_check;");
    expect(drop).toBeGreaterThan(-1);
    expect(add).toBeGreaterThan(drop);
    expect(validate).toBeGreaterThan(add);
    expect(sql.trim().startsWith("BEGIN;")).toBe(true);
    expect(sql.trim().endsWith("COMMIT;")).toBe(true);
  });

  it("rewrites no rows", () => {
    expect(sql).not.toMatch(/^\s*(UPDATE|DELETE|INSERT|TRUNCATE)\b/im);
  });

  it("is the only migration that names the constraint", () => {
    const naming = migrationFiles().filter((file) =>
      blankComments(readMigration(file)).includes("programs_program_type_check"),
    );
    expect(naming).toEqual([MIGRATION]);
  });
});
