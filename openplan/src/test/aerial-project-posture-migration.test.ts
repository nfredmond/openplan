import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260722000006_aerial_project_posture_table.sql"),
  "utf8",
);

describe("aerial project posture migration", () => {
  it("creates an aerial-owned posture table keyed on project_id", () => {
    expect(migrationSql).toMatch(/CREATE TABLE IF NOT EXISTS aerial_project_posture/i);
    expect(migrationSql).toMatch(/project_id UUID PRIMARY KEY REFERENCES projects\(id\) ON DELETE CASCADE/i);
    expect(migrationSql).toMatch(/workspace_id UUID NOT NULL REFERENCES workspaces\(id\) ON DELETE CASCADE/i);
    expect(migrationSql).toMatch(/posture JSONB/i);
  });

  it("enforces the same workspace-member RLS posture as the other aerial tables", () => {
    expect(migrationSql).toMatch(/ALTER TABLE aerial_project_posture ENABLE ROW LEVEL SECURITY/i);
    expect(migrationSql).toMatch(/workspace_members_can_read_aerial_project_posture[\s\S]*FOR SELECT/i);
    expect(migrationSql).toMatch(/workspace_members_can_write_aerial_project_posture[\s\S]*FOR ALL/i);
    expect(migrationSql).toMatch(/workspace_id FROM workspace_members WHERE user_id = auth\.uid\(\)/i);
  });

  it("backfills the cached posture then retires the projects columns", () => {
    expect(migrationSql).toMatch(/INSERT INTO aerial_project_posture[\s\S]*FROM projects/i);
    expect(migrationSql).toMatch(/WHERE p\.aerial_posture IS NOT NULL/i);
    expect(migrationSql).toMatch(/DROP INDEX IF EXISTS projects_aerial_posture_updated_at_idx/i);
    expect(migrationSql).toMatch(/ALTER TABLE projects[\s\S]*DROP COLUMN IF EXISTS aerial_posture/i);
    expect(migrationSql).toMatch(/DROP COLUMN IF EXISTS aerial_posture_updated_at/i);
  });
});
