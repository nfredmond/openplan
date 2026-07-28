import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Migration-content guard for pursuit kind + solicitation fields
 * (20260727000015). Additive columns on funding_opportunities with a guarded
 * CHECK: every existing row defaults to 'grant', nothing is destroyed, and
 * the vocabulary is pinned at the database.
 */

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260727000015_pursuit_kind_and_solicitation.sql",
);

const sql = readFileSync(migrationPath, "utf8");
const sqlWithoutComments = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("pursuit kind migration", () => {
  it("adds the four columns additively, defaulting every existing row to grant", () => {
    expect(sql).toMatch(
      /ADD COLUMN IF NOT EXISTS pursuit_kind TEXT NOT NULL DEFAULT 'grant'/,
    );
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS solicitation_number TEXT/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS submission_format_note TEXT/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS questions_due_at TIMESTAMPTZ/);
  });

  it("pins the pursuit vocabulary with a guarded CHECK (safe to re-run)", () => {
    expect(sqlWithoutComments).toMatch(
      /IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint\s*WHERE conname = 'funding_opportunities_pursuit_kind_check'/,
    );
    expect(sql).toMatch(/CHECK \(pursuit_kind IN \('grant', 'proposal'\)\)/);
  });

  it("destroys nothing", () => {
    expect(sqlWithoutComments).not.toMatch(/DROP TABLE/i);
    expect(sqlWithoutComments).not.toMatch(/DROP COLUMN/i);
    expect(sqlWithoutComments).not.toMatch(/\bDELETE FROM\b/i);
    expect(sqlWithoutComments).not.toMatch(/\bUPDATE\b\s+(public\.)?funding_opportunities/i);
  });
});
