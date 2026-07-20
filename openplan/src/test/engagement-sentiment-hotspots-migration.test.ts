import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260719000093_engagement_sentiment_hotspots.sql"),
  "utf8"
);

describe("engagement_sentiment_hotspots migration", () => {
  it("declares the function with the screening-grade signature", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.engagement_sentiment_hotspots(");
    expect(migration).toContain("p_workspace_id uuid");
    expect(migration).toContain("p_negative_item_ids uuid[]");
    expect(migration).toContain("p_campaign_id uuid DEFAULT NULL");
  });

  it("uses the hardened SECURITY INVOKER + pinned search_path convention", () => {
    expect(migration).toContain("SECURITY INVOKER");
    expect(migration).toContain("SET search_path = public, pg_catalog");
  });

  it("scopes to the workspace's approved items by joining through the campaign", () => {
    expect(migration).toContain("JOIN engagement_campaigns ec ON ec.id = ei.campaign_id");
    expect(migration).toContain("ec.workspace_id = p_workspace_id");
    expect(migration).toContain("ei.status = 'approved'");
  });

  it("clusters with DBSCAN and builds geometry from the JSONB GeoJSON with a lat/lng fallback", () => {
    expect(migration).toContain("ST_ClusterDBSCAN");
    expect(migration).toContain("ST_GeomFromGeoJSON(ei.geometry::text)");
    expect(migration).toContain("ST_MakePoint(ei.longitude, ei.latitude)");
  });

  it("grants execute to authenticated and documents the screening boundary", () => {
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.engagement_sentiment_hotspots(uuid, double precision, integer, uuid[], uuid) TO authenticated;"
    );
    expect(migration).toMatch(/COMMENT ON FUNCTION public\.engagement_sentiment_hotspots/);
    expect(migration).toMatch(/NOT inferential/i);
  });

  it("does not manufacture a p-value in SQL (returns the raw z-score only)", () => {
    expect(migration).not.toMatch(/erf\s*\(/i);
    expect(migration).toMatch(/z_score/);
  });
});
