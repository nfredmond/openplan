import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260424000073_workspace_invitations.sql"),
  "utf8"
);

describe("workspace invitations migration", () => {
  it("stores hashed invitation tokens without a plaintext token column", () => {
    expect(migrationSql).toMatch(/token_hash text not null unique/i);
    expect(migrationSql).toMatch(/token_prefix text/i);
    expect(migrationSql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS workspace_invitations_one_pending_per_email_idx/i);
    expect(migrationSql).not.toMatch(/\btoken text\b/i);
  });

  it("enables RLS with member read access and service-role-only writes", () => {
    expect(migrationSql).toMatch(/ALTER TABLE public\.workspace_invitations ENABLE ROW LEVEL SECURITY/i);
    expect(migrationSql).toMatch(/CREATE POLICY workspace_invitations_member_read/i);
    expect(migrationSql).toMatch(/auth\.uid\(\)/i);
    expect(migrationSql).toMatch(/REVOKE ALL ON TABLE public\.workspace_invitations FROM PUBLIC, anon, authenticated/i);
    expect(migrationSql).toMatch(/GRANT SELECT ON TABLE public\.workspace_invitations TO authenticated/i);
    expect(migrationSql).toMatch(/GRANT ALL ON TABLE public\.workspace_invitations TO service_role/i);
  });

  it("pins trigger function search_path and keeps the migration append-only", () => {
    expect(migrationSql).toMatch(/SET search_path = public/i);
    expect(migrationSql).toMatch(/DROP TRIGGER IF EXISTS trg_set_workspace_invitations_updated_at/i);
    expect(migrationSql).not.toMatch(/DROP TABLE/i);
  });

  it("adds an atomic service-role acceptance function", () => {
    expect(migrationSql).toMatch(/CREATE OR REPLACE FUNCTION public\.accept_workspace_invitation/i);
    expect(migrationSql).toMatch(/RETURNS TABLE\(final_role text, membership_changed boolean\)/i);
    expect(migrationSql).toMatch(/FOR UPDATE/i);
    expect(migrationSql).toMatch(/GRANT EXECUTE ON FUNCTION public\.accept_workspace_invitation\(uuid, uuid, uuid, text\) TO service_role/i);
    expect(migrationSql).toMatch(/REVOKE ALL ON FUNCTION public\.accept_workspace_invitation\(uuid, uuid, uuid, text\) FROM PUBLIC, anon, authenticated/i);
  });
});
