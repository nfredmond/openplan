import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260722000008_engagement_close_loop.sql"),
  "utf8"
);

describe("engagement_closeloop_entries migration", () => {
  it("creates the entries table scoped to a campaign with a cascade", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS engagement_closeloop_entries");
    expect(migration).toMatch(/campaign_id\s+uuid NOT NULL REFERENCES engagement_campaigns\(id\) ON DELETE CASCADE/);
    expect(migration).toMatch(/category_id\s+uuid REFERENCES engagement_categories\(id\) ON DELETE SET NULL/);
  });

  it("constrains status to draft|published and defaults to draft (never auto-published)", () => {
    expect(migration).toMatch(/status\s+text NOT NULL DEFAULT 'draft' CHECK \(status IN \('draft','published'\)\)/);
  });

  it("records honest AI provenance and item source trail", () => {
    expect(migration).toMatch(/ai_assisted\s+boolean NOT NULL DEFAULT false/);
    expect(migration).toMatch(/source_item_ids uuid\[\] NOT NULL DEFAULT '\{\}'::uuid\[\]/);
  });

  it("keeps published_at consistent with status via a trigger", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION sync_closeloop_published_at()");
    expect(migration).toMatch(/IF NEW\.status = 'published' THEN/);
    expect(migration).toMatch(/NEW\.published_at = NULL/); // cleared on unpublish
    expect(migration).toContain("CREATE TRIGGER trg_closeloop_published_at");
    // reuse the shared updated_at trigger, not a redefinition
    expect(migration).toContain("EXECUTE FUNCTION set_engagement_updated_at()");
  });

  it("is operator-scoped (RLS on, 4 policies via campaign->workspace join), not the sensitive service-role posture", () => {
    expect(migration).toContain("ALTER TABLE engagement_closeloop_entries ENABLE ROW LEVEL SECURITY");
    for (const action of ["read", "insert", "update", "delete"]) {
      expect(migration).toContain(`engagement_closeloop_entries_${action}`);
    }
    expect(migration).toMatch(/JOIN workspace_members wm ON wm\.workspace_id = campaign\.workspace_id/);
    expect(migration).toMatch(/wm\.user_id = auth\.uid\(\)/);
    // operator-authored, NOT public-submitted → must NOT revoke like the sensitive
    // survey response tables do.
    expect(migration).not.toContain("REVOKE ALL ON public.engagement_closeloop_entries");
  });

  it("indexes the published public read", () => {
    expect(migration).toMatch(/CREATE INDEX IF NOT EXISTS idx_closeloop_published[\s\S]*WHERE status = 'published'/);
  });
});
