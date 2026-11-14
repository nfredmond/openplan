/** Source order only. Actual FK scheduling and concurrent transactions need PostgreSQL. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./migrations/read-migrations";

const sql = blankComments(readFileSync("supabase/migrations/20261018000003_award_condition_handoff.sql", "utf8"));

describe("award handoff Program deletion entry", () => {
  it("takes the existing mutex at DELETE statement entry, before the parent-row FK action", () => {
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+aaa_handoff_program_delete\s+BEFORE\s+DELETE\s+ON\s+public\.programs\s+FOR\s+EACH\s+STATEMENT\s+EXECUTE\s+FUNCTION\s+public\.handoff_statement_lock\(\)\s*;/i);
  });
});
