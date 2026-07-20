import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260719000094_engagement_item_demographics.sql"),
  "utf8"
);

describe("engagement_item_demographics migration", () => {
  it("adds the per-campaign opt-in flag", () => {
    expect(migration).toMatch(/ALTER TABLE engagement_campaigns\s+ADD COLUMN IF NOT EXISTS demographics_enabled boolean NOT NULL DEFAULT false/);
  });

  it("creates a service-role-only table (RLS on, revoked from app roles)", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS engagement_item_demographics");
    expect(migration).toContain("ALTER TABLE engagement_item_demographics ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("REVOKE ALL ON public.engagement_item_demographics FROM anon, authenticated");
    // no per-row read policy — the aggregate function is the only read path
    expect(migration).not.toMatch(/CREATE POLICY[^;]*engagement_item_demographics/i);
  });

  it("stores only coarse bands (ZIP-3, not ZIP-5)", () => {
    expect(migration).toMatch(/zip3 text CHECK \(zip3 IS NULL OR zip3 ~ '\^\[0-9\]\{3\}\$'\)/);
    expect(migration).not.toMatch(/zip5|zip_5|\\\{5\\\}/);
  });

  it("exposes only a k-anonymized SECURITY DEFINER aggregate with a membership guard", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.engagement_demographics_summary(p_campaign_id uuid)");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = public, pg_catalog");
    expect(migration).toMatch(/JOIN workspace_members wm[\s\S]*wm\.user_id = auth\.uid\(\)/);
    // k-anonymity floor of 5 — including the residual 'suppressed' bucket, which
    // is only emitted when it itself aggregates >= 5 (HAVING), so no sub-5 group
    // size is ever disclosed.
    expect(migration).toContain("WHERE c.n >= 5");
    expect(migration).toContain("WHERE c.n < 5 GROUP BY c.dim HAVING sum(c.n) >= 5");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.engagement_demographics_summary(uuid) TO authenticated;");
  });

  it("documents the screening / non-civil-rights boundary", () => {
    expect(migration).toMatch(/NOT a statistical sample or a civil-rights determination/i);
  });
});
