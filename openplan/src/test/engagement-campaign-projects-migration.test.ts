import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Migration-content guard for the campaign coverage join (20260810000003) —
 * one engagement campaign covering several projects.
 *
 * What has to be true in the DATABASE rather than only in the PATCH route,
 * because a route can be bypassed by the next writer and a constraint cannot:
 *
 *   - the pair is UNIQUE, so a campaign cannot cover the same project twice;
 *   - both FKs CASCADE, so deleting a campaign or a project cannot orphan a
 *     coverage row;
 *   - a cross-workspace pairing is UNSTORABLE (scope trigger), not merely
 *     unlikely;
 *   - the LEAD project's row is kept present by a trigger on
 *     engagement_campaigns itself, so every writer of project_id — this
 *     console, the campaign creator, the RTP-side creator, a future route —
 *     keeps the invariant without knowing it exists;
 *   - existing campaigns are backfilled, so "the join carries the full set
 *     including the lead" is true on the first read, and the backfill cannot
 *     be aborted by a legacy cross-workspace lead;
 *   - RLS is enabled with ROLE-AWARE write policies at the permissive layer
 *     (`workspace_member_can_write`, so no RESTRICTIVE companion is needed),
 *     grants are explicit (20260804000001 default-deny), and there is
 *     deliberately no UPDATE policy or UPDATE grant to authenticated — a link
 *     row is an immutable pair;
 *   - the lead-project semantics, and that RTP comment-response / report
 *     linkage stay lead-only tonight, are recorded ON THE TABLE where the
 *     next reader of the schema will find them.
 */

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260810000003_engagement_campaign_projects.sql"
);

const sql = readFileSync(migrationPath, "utf8");

// Executable statements only: the header prose legitimately names statements
// the migration must not contain, and a matcher that read comments would
// either pass on prose or fail on it (the five-guards-in-one-day lesson).
const sqlWithoutComments = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("the engagement campaign projects migration", () => {
  it("creates the join with a unique pair and cascading FKs", () => {
    expect(sqlWithoutComments).toMatch(/CREATE TABLE IF NOT EXISTS engagement_campaign_projects/);
    expect(sqlWithoutComments).toMatch(/UNIQUE \(campaign_id, project_id\)/);
    expect(sqlWithoutComments).toMatch(
      /campaign_id UUID NOT NULL REFERENCES engagement_campaigns\(id\) ON DELETE CASCADE/
    );
    expect(sqlWithoutComments).toMatch(
      /project_id UUID NOT NULL REFERENCES projects\(id\) ON DELETE CASCADE/
    );
    expect(sqlWithoutComments).toMatch(
      /workspace_id UUID NOT NULL REFERENCES workspaces\(id\) ON DELETE CASCADE/
    );
  });

  it("makes a cross-workspace pairing unstorable, not merely unwritten", () => {
    expect(sqlWithoutComments).toMatch(/validate_engagement_campaign_project_scope/);
    expect(sqlWithoutComments).toMatch(
      /CREATE TRIGGER trg_engagement_campaign_projects_scope\s*\nBEFORE INSERT OR UPDATE ON engagement_campaign_projects/
    );
    // Both halves of the pairing are checked against the row's own workspace.
    expect(sqlWithoutComments).toMatch(/campaign_workspace_id <> NEW\.workspace_id/);
    expect(sqlWithoutComments).toMatch(/project_workspace_id <> NEW\.workspace_id/);
  });

  it("keeps the lead's coverage row present through a trigger on the campaign itself", () => {
    expect(sqlWithoutComments).toMatch(/sync_engagement_campaign_lead_project/);
    expect(sqlWithoutComments).toMatch(
      /AFTER INSERT OR UPDATE OF project_id ON engagement_campaigns/
    );
    // Idempotent ADD only: changing the lead must never delete coverage as a
    // side effect, so the trigger body may not contain a DELETE.
    expect(sqlWithoutComments).toMatch(/ON CONFLICT \(campaign_id, project_id\) DO NOTHING/);
    expect(sqlWithoutComments).not.toMatch(/DELETE FROM engagement_campaign_projects/i);
  });

  it("backfills existing leads, skipping (not aborting on) legacy cross-workspace rows", () => {
    expect(sqlWithoutComments).toMatch(
      /INSERT INTO engagement_campaign_projects \(workspace_id, campaign_id, project_id, created_by\)\s*\nSELECT c\.workspace_id, c\.id, c\.project_id, c\.created_by\s*\nFROM engagement_campaigns c/
    );
    // ONE mismatched legacy lead would otherwise abort the whole migration on
    // a self-hosted database nobody can inspect.
    expect(sqlWithoutComments).toMatch(/JOIN projects p ON p\.id = c\.project_id AND p\.workspace_id = c\.workspace_id/);
  });

  it("enables RLS with role-aware writes, and deliberately no UPDATE path", () => {
    expect(sqlWithoutComments).toMatch(
      /ALTER TABLE engagement_campaign_projects ENABLE ROW LEVEL SECURITY/
    );
    // Writes are role-aware AT THE PERMISSIVE LAYER — the intended shape for a
    // post-20260728000006 table — so the table needs no RESTRICTIVE companion
    // and never depends on the writer-gate migration's VALUES loop remembering
    // it. `viewer-write-denial-guard.test.ts` enforces the same fact from the
    // policy inventory side; this asserts the exact policies the migration
    // installs.
    expect(sqlWithoutComments).toMatch(
      /CREATE POLICY engagement_campaign_projects_read ON engagement_campaign_projects\s*\n\s*FOR SELECT/
    );
    expect(sqlWithoutComments).toMatch(
      /CREATE POLICY engagement_campaign_projects_writer_insert ON engagement_campaign_projects\s*\n\s*FOR INSERT WITH CHECK \(public\.workspace_member_can_write\(workspace_id\)\)/
    );
    expect(sqlWithoutComments).toMatch(
      /CREATE POLICY engagement_campaign_projects_writer_delete ON engagement_campaign_projects\s*\n\s*FOR DELETE USING \(public\.workspace_member_can_write\(workspace_id\)\)/
    );
    // No membership-only (role-blind) write policy may reappear: that shape is
    // exactly what would silently hand every workspace viewer a write path
    // until the retrofit gate migration remembered this table.
    expect(sqlWithoutComments).not.toMatch(
      /FOR (?:INSERT|DELETE)[^;]*workspace_id IN \(SELECT workspace_id FROM workspace_members/
    );
    // An immutable pair: no UPDATE policy, and no UPDATE grant for the client
    // role to pass a policy that does not exist.
    expect(sqlWithoutComments).not.toMatch(/FOR UPDATE/);
    expect(sqlWithoutComments).toMatch(
      /GRANT SELECT, INSERT, DELETE ON engagement_campaign_projects TO authenticated/
    );
    expect(sqlWithoutComments).not.toMatch(/UPDATE[^;]*TO authenticated/);
  });

  it("grants explicitly, because 20260804000001 made new tables deny-by-default", () => {
    expect(sqlWithoutComments).toMatch(
      /GRANT SELECT, INSERT, UPDATE, DELETE ON engagement_campaign_projects TO service_role/
    );
    // And never to the anonymous role: coverage is operator console state.
    expect(sqlWithoutComments).not.toMatch(/TO anon/i);
  });

  it("records the lead semantics, and the lead-only readers, on the table itself", () => {
    expect(sql).toMatch(/COMMENT ON TABLE engagement_campaign_projects/);
    expect(sql).toMatch(/LEAD project/);
    expect(sql).toMatch(/INCLUDING the lead/);
    // The recorded decision, not an oversight: RTP comment-response and report
    // linkage keep reading the lead column tonight.
    expect(sql).toMatch(/RTP comment-response and report linkage deliberately still read the lead/);
  });

  it("names no place, country or jurisdiction vocabulary", () => {
    for (const forbidden of [/\bfips\b/i, /\bcalifornia\b/i, /\bcounty\b/i, /\bcensus\b/i, /\btigerweb\b/i]) {
      expect(sqlWithoutComments).not.toMatch(forbidden);
    }
  });

  it("destroys nothing", () => {
    for (const destructive of [/DROP TABLE/i, /DROP COLUMN/i, /^\s*DELETE FROM/im, /TRUNCATE/i, /DROP POLICY/i]) {
      expect(sqlWithoutComments).not.toMatch(destructive);
    }
  });
});
