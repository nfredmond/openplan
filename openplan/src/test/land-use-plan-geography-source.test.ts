import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Source intent only. This allocated migration is not installed.
const sql = readFileSync("supabase/migrations/20261017014010_land_use_plan_context_geography.sql", "utf8")
  .replace(/--[^\n]*/g, "");
describe("land-use geography SQL source intent, not native enforcement", () => {
  it("attaches an invoker guard to inserts and updates without rewriting history", () => {
    expect(sql).toMatch(/CREATE FUNCTION public\.guard_land_use_plan_context_geography\(\)\s+RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER/);
    expect(sql).toMatch(/CREATE TRIGGER land_use_plan_context_zz_geography\s+BEFORE INSERT OR UPDATE ON public\.land_use_plans\s+FOR EACH ROW EXECUTE FUNCTION public\.guard_land_use_plan_context_geography\(\)/);
    expect(sql).toContain("SET search_path = pg_catalog, public, pg_temp");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.guard_land_use_plan_context_geography() FROM PUBLIC, anon, authenticated, service_role");
    expect(sql).not.toMatch(/SECURITY DEFINER|CREATE OR REPLACE|ALTER TABLE|UPDATE public\.|DELETE FROM|INSERT INTO|NOT VALID/);
  });
  it("requires exact label and JSON geometry agreement, with fail-closed null predicates", () => {
    expect(sql).toContain("AND NEW.geography_label = place->>'label'");
    expect(sql).toContain("AND NEW.geography_geojson = shape) IS NOT TRUE THEN");
    expect(sql).toContain("jsonb_typeof(place->'label') = 'string'");
    expect(sql).toContain("jsonb_typeof(shape->'coordinates') = 'array'");
    expect(sql).toContain("jsonb_array_length(ring) < 4");
    expect(sql).toContain("IF NEW.plan_context IS NULL THEN RETURN NEW; END IF;");
  });
  it("keeps no-op history edits separate from context/geography transitions", () => {
    expect(sql).toContain("IF NEW.plan_context IS NOT DISTINCT FROM OLD.plan_context\n       AND NEW.geography_label IS NOT DISTINCT FROM OLD.geography_label\n       AND NEW.geography_geojson IS NOT DISTINCT FROM OLD.geography_geojson THEN RETURN NEW; END IF;");
    expect(sql).toContain("IF OLD.plan_context IS NOT NULL AND NEW.plan_context IS NOT DISTINCT FROM OLD.plan_context THEN");
    expect(sql).toContain("IF OLD.plan_context IS NOT NULL AND NEW.plan_context IS NULL THEN");
    expect(sql).not.toContain("NEW.authority_label");
    expect(sql).not.toMatch(/NEW\.(?:plan_context|geography_label|geography_geojson)\s*:=/);
  });
  it("uses the narrow conflict identifier expected by PATCH", () => {
    const raises = [...sql.matchAll(/RAISE EXCEPTION USING ([^;]+);/g)].map(match => match[1]);
    expect(raises.length).toBeGreaterThan(0);
    expect(new Set(raises)).toEqual(new Set(["ERRCODE = 'PT409', MESSAGE = 'Land-use plan geography must match saved context'"]));
  });
});
