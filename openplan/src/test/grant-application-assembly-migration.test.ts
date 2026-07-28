import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Migration-content guard for grant application assembly (20260727000014).
 *
 * Four additive tables (sections, append-only section drafts, attachment
 * checklist, export register) plus a private storage bucket mirroring
 * report-artifacts. The guard pins the shapes the lib and routes depend on:
 * CHECK vocabularies, uniqueness, the never-AI column, append-only grants for
 * drafts/exports, RLS on all four tables, the guarded cross-reference FK, and
 * the absence of any destructive statement.
 */

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260727000014_grant_application_assembly.sql",
);

const sql = readFileSync(migrationPath, "utf8");
// Executable statements only — comments may legitimately NAME forbidden
// constructs while explaining why they are absent.
const sqlWithoutComments = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

const TABLES = [
  "funding_opportunity_application_sections",
  "funding_opportunity_section_drafts",
  "funding_opportunity_attachments",
  "funding_opportunity_application_exports",
] as const;

describe("grant application assembly migration", () => {
  it("creates all four tables additively, scoped to workspace and opportunity", () => {
    for (const table of TABLES) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    }
    expect(
      sql.match(/workspace_id UUID NOT NULL REFERENCES workspaces\(id\) ON DELETE CASCADE/g)?.length,
    ).toBe(4);
    expect(
      sql.match(
        /opportunity_id UUID NOT NULL REFERENCES funding_opportunities\(id\) ON DELETE CASCADE/g,
      )?.length,
    ).toBe(4);
  });

  it("pins the section vocabulary: source, status, and one row per key", () => {
    expect(sql).toMatch(/source TEXT NOT NULL CHECK \(source IN \('catalog', 'custom'\)\)/);
    expect(sql).toMatch(
      /status IN \('not_started', 'drafting', 'operator_review', 'final'\)/,
    );
    expect(sql).toMatch(/UNIQUE \(opportunity_id, section_key\)/);
  });

  it("persists the never-AI-drafted flag and the evidence emphasis on the section row", () => {
    expect(sql).toMatch(/ai_drafting_enabled BOOLEAN NOT NULL DEFAULT TRUE/);
    expect(sql).toMatch(/suggested_evidence JSONB NOT NULL DEFAULT '\[\]'::jsonb/);
  });

  it("chains drafts to sections and to prior drafts, with grounding columns", () => {
    expect(sql).toMatch(
      /section_id UUID NOT NULL REFERENCES funding_opportunity_application_sections\(id\) ON DELETE CASCADE/,
    );
    expect(sql).toMatch(
      /revision_of UUID REFERENCES funding_opportunity_section_drafts\(id\) ON DELETE SET NULL/,
    );
    expect(sql).toMatch(/revision_instructions TEXT/);
    for (const column of ["grounding_json JSONB", "grounded_sentence_count INTEGER", "total_sentence_count INTEGER"]) {
      expect(sql).toContain(column);
    }
  });

  it("adds the finalized_from_draft FK as a guarded constraint (safe to re-run)", () => {
    expect(sqlWithoutComments).toMatch(
      /IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint\s*WHERE conname = 'fo_application_sections_finalized_from_draft_fk'/,
    );
    expect(sql).toMatch(
      /FOREIGN KEY \(finalized_from_draft_id\)\s+REFERENCES funding_opportunity_section_drafts\(id\) ON DELETE SET NULL/,
    );
  });

  it("pins the attachment vocabulary and fulfillment links", () => {
    expect(sql).toMatch(/status IN \('missing', 'in_progress', 'attached', 'not_applicable'\)/);
    expect(sql).toMatch(/UNIQUE \(opportunity_id, attachment_key\)/);
    expect(sql).toMatch(/kb_document_id UUID REFERENCES kb_documents\(id\) ON DELETE SET NULL/);
    expect(sql).toMatch(
      /report_artifact_id UUID REFERENCES report_artifacts\(id\) ON DELETE SET NULL/,
    );
  });

  it("keeps drafts and exports append-only for authenticated users", () => {
    expect(sql).toMatch(
      /GRANT SELECT, INSERT ON TABLE funding_opportunity_section_drafts TO authenticated;/,
    );
    expect(sql).toMatch(
      /GRANT SELECT, INSERT ON TABLE funding_opportunity_application_exports TO authenticated;/,
    );
    // No UPDATE/DELETE grant may appear for either append-only table.
    expect(sqlWithoutComments).not.toMatch(
      /GRANT [^\n]*(UPDATE|DELETE)[^\n]*funding_opportunity_section_drafts TO authenticated/,
    );
    expect(sqlWithoutComments).not.toMatch(
      /GRANT [^\n]*(UPDATE|DELETE)[^\n]*funding_opportunity_application_exports TO authenticated/,
    );
  });

  it("enables RLS on all four tables with member policies, and revokes anon", () => {
    for (const table of TABLES) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`));
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON TABLE ${table} FROM PUBLIC, anon;`));
    }
    // Every policy gates on workspace membership; count both USING and CHECK sides.
    const membershipClauses = sql.match(
      /workspace_id IN \(\s*SELECT workspace_id FROM workspace_members WHERE user_id = auth\.uid\(\)\s*\)/g,
    );
    expect(membershipClauses?.length ?? 0).toBeGreaterThanOrEqual(12);
  });

  it("creates the private export bucket mirroring the report-artifacts policies", () => {
    expect(sql).toMatch(/'grant-application-exports',\s*'grant-application-exports',\s*false/);
    expect(sql).toMatch(/grant_application_exports_workspace_read/);
    expect(sql).toMatch(/grant_application_exports_workspace_insert/);
    expect(sql).toMatch(
      /split_part\(name, '\/', 1\) IN \(\s*SELECT workspace_id::text FROM workspace_members WHERE user_id = auth\.uid\(\)/,
    );
  });

  it("destroys nothing", () => {
    expect(sqlWithoutComments).not.toMatch(/DROP TABLE/i);
    expect(sqlWithoutComments).not.toMatch(/DROP COLUMN/i);
    expect(sqlWithoutComments).not.toMatch(/\bDELETE FROM\b/i);
    expect(sqlWithoutComments).not.toMatch(/\bUPDATE\b\s+(public\.)?funding_/i);
  });
});
