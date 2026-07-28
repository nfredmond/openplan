import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Migration-content guard for document narrative drafts (20260727000013).
 *
 * The table stores AI-drafted, operator-accepted narrative blocks for report
 * sections and RTP chapters. The guard pins the honesty-critical shape:
 * grounding metadata and facts_hash are NOT NULL (no draft without its
 * validation record), the review state machine is CHECK-constrained, members
 * can only ever UPDATE the review fields (column-scoped grant — the draft body
 * and its grounding record are immutable at the database level), and nothing
 * destructive appears.
 */

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260727000013_document_narrative_drafts.sql",
);

const sql = readFileSync(migrationPath, "utf8");
// Executable statements only — comments may legitimately NAME forbidden
// constructs while explaining why they are absent.
const sqlWithoutComments = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("document narrative drafts migration", () => {
  it("creates the table additively with the workspace cascade", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.document_narrative_drafts/);
    expect(sql).toMatch(
      /workspace_id UUID NOT NULL REFERENCES public\.workspaces\(id\) ON DELETE CASCADE/,
    );
  });

  it("constrains target kinds and the review state machine", () => {
    expect(sql).toMatch(/target_kind TEXT NOT NULL CHECK \(target_kind IN \('report_section', 'rtp_chapter'\)\)/);
    expect(sql).toMatch(
      /status TEXT NOT NULL DEFAULT 'draft' CHECK \(status IN \('draft', 'accepted', 'dismissed'\)\)/,
    );
    // Report-section drafts must name a section; chapter drafts must not.
    expect(sql).toMatch(/document_narrative_drafts_section_key_shape/);
    expect(sql).toMatch(/target_kind = 'report_section' AND section_key IS NOT NULL/);
    expect(sql).toMatch(/target_kind = 'rtp_chapter' AND section_key IS NULL/);
  });

  it("never stores a draft without its grounding record and facts hash", () => {
    expect(sql).toMatch(/draft_markdown TEXT NOT NULL/);
    expect(sql).toMatch(/model TEXT NOT NULL/);
    expect(sql).toMatch(/grounding_json JSONB NOT NULL/);
    expect(sql).toMatch(/grounded_sentence_count INT NOT NULL/);
    expect(sql).toMatch(/total_sentence_count INT NOT NULL/);
    expect(sql).toMatch(/facts_hash TEXT NOT NULL/);
  });

  it("indexes workspace and target lookups", () => {
    expect(sql).toMatch(/ON public\.document_narrative_drafts\(workspace_id\)/);
    expect(sql).toMatch(/ON public\.document_narrative_drafts\(target_kind, target_id, section_key\)/);
  });

  it("enables RLS with guarded member read/insert/update policies", () => {
    expect(sql).toMatch(/ALTER TABLE public\.document_narrative_drafts ENABLE ROW LEVEL SECURITY/);
    for (const policy of [
      "document_narrative_drafts_member_read",
      "document_narrative_drafts_member_insert",
      "document_narrative_drafts_member_update",
    ]) {
      expect(sql).toMatch(new RegExp(policy));
    }
    // Policy creation is guarded so re-running the migration is safe.
    expect(sql.match(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_policies/g)?.length).toBe(3);
    // Inserts are pinned to the authoring member.
    expect(sql).toMatch(/created_by = auth\.uid\(\)/);
  });

  it("limits member updates to the review fields via a column-scoped grant", () => {
    expect(sqlWithoutComments).toMatch(
      /GRANT UPDATE \(status, accepted_markdown, accepted_by, accepted_at\)\s+ON public\.document_narrative_drafts TO authenticated/,
    );
    // No table-wide UPDATE (or ALL) may reach authenticated — the draft body,
    // grounding record, and facts hash stay immutable to members.
    expect(sqlWithoutComments).not.toMatch(/GRANT SELECT, INSERT, UPDATE ON/);
    expect(sqlWithoutComments).not.toMatch(/GRANT UPDATE ON TABLE public\.document_narrative_drafts/);
    expect(sqlWithoutComments).not.toMatch(/GRANT ALL ON TABLE public\.document_narrative_drafts TO authenticated/);
    expect(sqlWithoutComments).toMatch(/REVOKE ALL ON TABLE public\.document_narrative_drafts FROM PUBLIC, anon/);
  });

  it("destroys nothing", () => {
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/DROP COLUMN/i);
    expect(sql).not.toMatch(/\bDELETE FROM\b/i);
    expect(sql).not.toMatch(/\bUPDATE\b\s+public\./i);
  });
});
