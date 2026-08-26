import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260825000003_safety_road_context_cache.sql",
  "utf8"
);
const scopeGuardMigration = readFileSync(
  "supabase/migrations/20260825000004_safety_road_context_scope_guard.sql",
  "utf8"
);

describe("Safety road-context cache migration", () => {
  it("stores only registered US road evidence with explicit provenance", () => {
    expect(migration).toMatch(/country_code text NOT NULL DEFAULT 'US' CHECK \(country_code = 'US'\)/i);
    expect(migration).toMatch(/source_id text NOT NULL CHECK \(source_id IN \('us-census-tiger-line-cache', 'osm-network-cache'\)\)/i);
    expect(migration).toMatch(/source_vintage text NOT NULL/i);
    expect(migration).toMatch(/road_name text NOT NULL/i);
    expect(migration).toMatch(/geometry_geojson jsonb NOT NULL/i);
  });

  it("is workspace-readable but service-authored", () => {
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/FOR SELECT USING[\s\S]*workspace_members/i);
    expect(migration).toMatch(/REVOKE ALL ON TABLE public\.safety_road_context_features FROM PUBLIC, anon, authenticated/i);
    expect(migration).toMatch(/GRANT SELECT ON TABLE public\.safety_road_context_features TO authenticated/i);
    expect(migration).toMatch(/GRANT ALL ON TABLE public\.safety_road_context_features TO service_role/i);
    expect(migration).not.toMatch(/CREATE POLICY[^;]+FOR (?:INSERT|UPDATE|DELETE|ALL)/i);
  });

  it("makes a cross-workspace project cache row unstorable", () => {
    expect(scopeGuardMigration).toMatch(/WHERE p\.id = NEW\.project_id AND p\.workspace_id = NEW\.workspace_id/i);
    expect(scopeGuardMigration).toMatch(/BEFORE INSERT OR UPDATE OF workspace_id, project_id/i);
    expect(scopeGuardMigration).toMatch(/RAISE EXCEPTION 'Safety road context project must belong to its workspace'/i);
  });
});
