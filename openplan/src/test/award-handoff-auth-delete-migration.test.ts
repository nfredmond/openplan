/** Source order only. Managed Auth roles, FK actions and contention require PostgreSQL. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./migrations/read-migrations";

const sql = blankComments(readFileSync("supabase/migrations/20261018000003_award_condition_handoff.sql", "utf8"));

describe("award handoff actor deletion entry", () => {
  it("takes the existing mutex at hard-delete statement entry before the actor and membership cascade", () => {
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+aaa_handoff_auth_delete\s+BEFORE\s+DELETE\s+ON\s+auth\.users\s+FOR\s+EACH\s+STATEMENT\s+EXECUTE\s+FUNCTION\s+public\.handoff_statement_lock\(\)\s*;/i);
  });
});
