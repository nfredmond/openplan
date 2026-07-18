import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260718000089_project_bca_screenings.sql"),
  "utf8"
);

describe("project_bca_screenings migration", () => {
  it("creates an append-only screening table scoped to workspace and project", () => {
    expect(migrationSql).toMatch(/CREATE TABLE IF NOT EXISTS public\.project_bca_screenings/i);
    expect(migrationSql).toMatch(/workspace_id UUID NOT NULL REFERENCES public\.workspaces\(id\) ON DELETE CASCADE/i);
    expect(migrationSql).toMatch(/project_id UUID NOT NULL REFERENCES public\.projects\(id\) ON DELETE CASCADE/i);
    expect(migrationSql).toMatch(/inputs_json JSONB NOT NULL/i);
    expect(migrationSql).toMatch(/result_json JSONB NOT NULL/i);
    expect(migrationSql).toMatch(/engine_version TEXT NOT NULL/i);
    // Append-only: no UPDATE/DELETE grants or policies anywhere.
    expect(migrationSql).not.toMatch(/FOR UPDATE|FOR DELETE/i);
    expect(migrationSql).not.toMatch(/GRANT[^;]*\b(UPDATE|DELETE)\b[^;]*ON TABLE public\.project_bca_screenings TO authenticated/i);
  });

  it("locks the table behind member-scoped RLS like narrative drafts", () => {
    expect(migrationSql).toMatch(/ALTER TABLE public\.project_bca_screenings ENABLE ROW LEVEL SECURITY/i);
    expect(migrationSql).toMatch(/project_bca_screenings_member_read/);
    expect(migrationSql).toMatch(/project_bca_screenings_member_insert/);
    expect(migrationSql).toMatch(/created_by = auth\.uid\(\)/);
    expect(migrationSql).toMatch(/REVOKE ALL ON TABLE public\.project_bca_screenings FROM PUBLIC, anon/i);
    expect(migrationSql).toMatch(/GRANT SELECT, INSERT ON TABLE public\.project_bca_screenings TO authenticated/i);
    expect(migrationSql).toMatch(/GRANT ALL ON TABLE public\.project_bca_screenings TO service_role/i);
  });

  it("indexes the latest-per-project read path and documents screening-grade intent", () => {
    expect(migrationSql).toMatch(/project_bca_screenings_project_idx[\s\S]*project_id, created_at DESC/i);
    expect(migrationSql).toMatch(/project_bca_screenings_workspace_idx[\s\S]*workspace_id, created_at DESC/i);
    expect(migrationSql).toMatch(/COMMENT ON TABLE public\.project_bca_screenings/i);
    expect(migrationSql).toMatch(/recomputed server-side/i);
    expect(migrationSql).toMatch(/not an application BCA of record/i);
  });

  it("exposes a security_invoker latest-per-project view so the workspace read needs no row cap", () => {
    expect(migrationSql).toMatch(/CREATE OR REPLACE VIEW public\.project_bca_screenings_latest/i);
    expect(migrationSql).toMatch(/WITH \(security_invoker = true\)/i);
    expect(migrationSql).toMatch(/SELECT DISTINCT ON \(project_id\)/i);
    expect(migrationSql).toMatch(/ORDER BY project_id, created_at DESC/i);
    expect(migrationSql).toMatch(/GRANT SELECT ON public\.project_bca_screenings_latest TO authenticated/i);
    expect(migrationSql).toMatch(/REVOKE ALL ON public\.project_bca_screenings_latest FROM PUBLIC, anon/i);
  });
});
