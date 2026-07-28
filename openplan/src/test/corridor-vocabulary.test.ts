import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CORRIDOR_LOS_GRADES,
  CORRIDOR_LOS_GRADE_LABELS,
  CORRIDOR_TYPE_LABELS,
  CORRIDOR_TYPES,
  DEFAULT_CORRIDOR_TYPE,
  isCorridorLosGrade,
  isCorridorType,
} from "@/lib/cartographic/corridor-vocabulary";

/**
 * The corridor vocabulary exists in two places that must agree: the CHECK
 * constraints in the migration, and the TypeScript constants the API schema and
 * the UI select both read.
 *
 * Nothing in the product wrote a corridor until now, so the lists never had to
 * match. Once a form offers a dropdown and a route validates input, a drift
 * means the UI offers an option Postgres rejects — surfacing as a 500 that
 * reads like saving is broken, not like a vocabulary mismatch. So this test
 * reads the migration and compares.
 */

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

function readCorridorMigration(): string {
  const file = readdirSync(MIGRATIONS_DIR)
    .filter((entry) => entry.endsWith("_project_corridors.sql"))
    .sort()
    .at(-1);

  // Not finding it must fail loudly. A guard that compares against an empty
  // string passes forever and checks nothing.
  expect(file, "no *_project_corridors.sql migration found").toBeDefined();
  return readFileSync(path.join(MIGRATIONS_DIR, file as string), "utf8");
}

/** Pull the quoted values out of `CHECK (<column> IN ('a', 'b', ...))`. */
function checkConstraintValues(sql: string, column: string): string[] {
  const pattern = new RegExp(`${column}\\s+IN\\s*\\(([^)]*)\\)`, "i");
  const match = pattern.exec(sql);
  expect(match, `no CHECK ... IN (...) found for ${column}`).not.toBeNull();
  return Array.from((match as RegExpExecArray)[1].matchAll(/'([^']+)'/g)).map((entry) => entry[1]);
}

describe("corridor vocabulary matches the database", () => {
  it("offers exactly the corridor types the CHECK constraint allows", () => {
    const allowed = checkConstraintValues(readCorridorMigration(), "corridor_type");
    expect([...CORRIDOR_TYPES].sort()).toEqual([...allowed].sort());
  });

  it("offers exactly the LOS grades the CHECK constraint allows", () => {
    const allowed = checkConstraintValues(readCorridorMigration(), "los_grade");
    expect([...CORRIDOR_LOS_GRADES].sort()).toEqual([...allowed].sort());
  });

  it("uses the column's own DEFAULT as the form default", () => {
    const sql = readCorridorMigration();
    const match = /corridor_type\s+text\s+NOT NULL\s+DEFAULT\s+'([^']+)'/i.exec(sql);
    expect(match, "no DEFAULT found on corridor_type").not.toBeNull();
    expect(DEFAULT_CORRIDOR_TYPE).toBe((match as RegExpExecArray)[1]);
  });

  it("labels every value, so no dropdown can render a blank option", () => {
    for (const type of CORRIDOR_TYPES) {
      expect(CORRIDOR_TYPE_LABELS[type], `no label for corridor type ${type}`).toBeTruthy();
    }
    for (const grade of CORRIDOR_LOS_GRADES) {
      expect(CORRIDOR_LOS_GRADE_LABELS[grade], `no label for LOS grade ${grade}`).toBeTruthy();
    }
  });

  it("guards the guard — the migration really was read", () => {
    const sql = readCorridorMigration();
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.project_corridors");
    expect(checkConstraintValues(sql, "corridor_type").length).toBeGreaterThan(1);
  });
});

describe("corridor vocabulary type guards", () => {
  it("accepts known values and rejects everything else", () => {
    expect(isCorridorType("arterial")).toBe(true);
    expect(isCorridorType("monorail")).toBe(false);
    expect(isCorridorType(null)).toBe(false);
    expect(isCorridorType(undefined)).toBe(false);

    expect(isCorridorLosGrade("A")).toBe(true);
    expect(isCorridorLosGrade("G")).toBe(false);
    // Lowercase is a different value to Postgres; do not quietly coerce it.
    expect(isCorridorLosGrade("a")).toBe(false);
  });
});
