import { describe, expect, it } from "vitest";

import { blankComments, readMigration } from "./migrations/read-migrations";

/**
 * Migration-content guard for project record assignees (20260811000006).
 *
 * Four things this migration decided, each of which is invisible once the
 * column exists and expensive to reverse later:
 *
 * 1. The column is NULLABLE with no default. NULL means "nobody is assigned",
 *    and every dated record predating this migration is exactly that. A NOT
 *    NULL column would have needed a backfill, and there is no honest value to
 *    backfill with — assigning every existing deliverable to whoever created it
 *    would invent a commitment nobody made.
 * 2. owner_label SURVIVES. It is a different fact (an external party with no
 *    account), and a migration that dropped it would have silently deleted the
 *    only record of who was on the hook for older work.
 * 3. ON DELETE SET NULL, deliberately diverging from
 *    `stage_gate_decisions.decided_by`, which is NOT NULL … ON DELETE RESTRICT.
 *    The divergence is the interesting part, so the header has to argue it: a
 *    future reader who finds two person-FKs with opposite delete behaviour and
 *    no explanation will assume one of them is a mistake and "fix" it. Making
 *    decided_by SET NULL would let a signed gate verdict become anonymous;
 *    making an assignment RESTRICT would make removing a departed teammate fail
 *    for a reason nobody can act on.
 * 4. No membership CHECK and no trigger. Membership is a multi-table question
 *    Postgres cannot express as a CHECK, and a trigger would be a second copy
 *    of an authorization rule that already lives on the write path.
 *
 * The comment-stripped text is what every "must not" assertion reads, because
 * the header NAMES the constructs it is explaining the absence of — a matcher
 * over the raw file would fail on the explanation rather than on the SQL. The
 * two header assertions read the comments ONLY, and are deliberately about
 * whether the decision is recorded at all, not about its wording.
 */

const FILE = "20260811000006_project_record_assignees.sql";
const sql = readMigration(FILE);
/** Executable SQL: comments blanked by the shared, tested stripper. */
const executable = blankComments(sql);
/** The inverse — comments only — so a header assertion cannot read live SQL. */
const commentsOnly = sql
  .split("\n")
  .map((line, index) => (executable.split("\n")[index] ?? "").trim() === "" ? line : "")
  .join("\n");

const TABLES = [
  "project_deliverables",
  "project_milestones",
  "project_submittals",
  "project_issues",
] as const;

describe("project record assignees migration", () => {
  it("adds a nullable assignee to each of the four dated record tables", () => {
    for (const table of TABLES) {
      expect(
        executable,
        `${table} must gain assignee_user_id additively`
      ).toMatch(
        new RegExp(
          `ALTER TABLE ${table}\\s+ADD COLUMN IF NOT EXISTS assignee_user_id UUID REFERENCES auth\\.users\\(id\\) ON DELETE SET NULL`
        )
      );
    }
  });

  it("leaves the column nullable and undefaulted — NULL is 'nobody', not a value to invent", () => {
    expect(executable).not.toMatch(/assignee_user_id UUID[^;]*NOT NULL/);
    expect(executable).not.toMatch(/assignee_user_id UUID[^;]*DEFAULT/);
    // No backfill of any kind: an UPDATE here would be inventing assignments.
    expect(executable).not.toMatch(/UPDATE\s+project_/i);
  });

  it("diverges from the decided_by precedent on purpose — SET NULL, never RESTRICT", () => {
    expect(executable.match(/ON DELETE SET NULL/g) ?? []).toHaveLength(4);
    expect(executable).not.toMatch(/assignee_user_id UUID REFERENCES auth\.users\(id\) ON DELETE RESTRICT/);
  });

  it("records that divergence in the header, naming the precedent it departs from", () => {
    // Not a wording check: the point is that the file itself carries the
    // argument, so the next person to read two opposite person-FKs finds the
    // reason instead of assuming one is a bug.
    expect(commentsOnly).toMatch(/stage_gate_decisions\.decided_by/);
    expect(commentsOnly).toMatch(/RESTRICT/);
    expect(commentsOnly).toMatch(/ON DELETE SET NULL/);
  });

  it("keeps owner_label — the external-party lane is a different fact", () => {
    expect(executable).not.toMatch(/DROP COLUMN/i);
    // No statement touches it. (The column name DOES appear in this file's
    // COMMENT ON COLUMN literals, which are executable and are supposed to say
    // that the two lanes are different — so the assertion is about ALTERs, not
    // about the name being absent.)
    expect(executable).not.toMatch(/ALTER TABLE[^;]*owner_label/i);
    expect(commentsOnly).toMatch(/owner_label/i);
  });

  it("indexes assigned rows only, paired with the date each queue sorts by", () => {
    expect(executable).toMatch(
      /CREATE INDEX IF NOT EXISTS project_deliverables_assignee_due_idx\s+ON project_deliverables\(assignee_user_id, due_date\)\s+WHERE assignee_user_id IS NOT NULL/
    );
    expect(executable).toMatch(
      /CREATE INDEX IF NOT EXISTS project_milestones_assignee_target_idx\s+ON project_milestones\(assignee_user_id, target_date\)\s+WHERE assignee_user_id IS NOT NULL/
    );
    expect(executable).toMatch(
      /CREATE INDEX IF NOT EXISTS project_submittals_assignee_due_idx\s+ON project_submittals\(assignee_user_id, due_date\)\s+WHERE assignee_user_id IS NOT NULL/
    );
    // project_issues has no date column of its own; ordering by creation is the
    // honest pairing, and the queue renders issues undated because of it.
    expect(executable).toMatch(
      /CREATE INDEX IF NOT EXISTS project_issues_assignee_created_idx\s+ON project_issues\(assignee_user_id, created_at\)\s+WHERE assignee_user_id IS NOT NULL/
    );
    expect(executable.match(/WHERE assignee_user_id IS NOT NULL/g) ?? []).toHaveLength(4);
  });

  it("enforces membership on the write path, not with a CHECK or a trigger", () => {
    expect(executable).not.toMatch(/CREATE\s+(OR REPLACE\s+)?TRIGGER/i);
    expect(executable).not.toMatch(/CREATE\s+(OR REPLACE\s+)?FUNCTION/i);
    expect(executable).not.toMatch(/CHECK\s*\(/);
    expect(executable).not.toMatch(/workspace_members/);
  });

  it("is additive — nothing destructive of any kind", () => {
    for (const destructive of [/DROP TABLE/i, /DROP COLUMN/i, /DROP POLICY/i, /TRUNCATE/i, /DELETE FROM/i]) {
      expect(executable, `${destructive} must not appear`).not.toMatch(destructive);
    }
  });
});
