import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260719000096_engagement_near_duplicates.sql"),
  "utf8"
);

describe("engagement_near_duplicates migration", () => {
  it("enables pg_trgm and a GIN trigram index on body", () => {
    expect(migration).toContain("CREATE EXTENSION IF NOT EXISTS pg_trgm");
    expect(migration).toMatch(/USING gin \(body gin_trgm_ops\)/);
  });

  it("declares the pairs function with hardened scoping", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.engagement_near_duplicate_pairs(");
    expect(migration).toContain("SECURITY INVOKER");
    expect(migration).toContain("SET search_path = public, pg_catalog");
    expect(migration).toContain("JOIN engagement_campaigns ec ON ec.id = a.campaign_id");
    expect(migration).toContain("ec.workspace_id = p_workspace_id");
    expect(migration).toMatch(/a\.status <> 'rejected'/);
    // bounded so a form-letter clique can't emit an O(N^2) pair explosion
    expect(migration).toMatch(/LIMIT 2000/);
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.engagement_near_duplicate_pairs(uuid, uuid, double precision) TO authenticated;");
  });

  it("documents the lexical-not-semantic screening boundary", () => {
    expect(migration).toMatch(/NOT a semantic\/embedding model/i);
  });
});
