import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HOME_GEOGRAPHY_COLUMNS } from "@/lib/workspaces/home-geography";

const sql = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260723000005_workspace_home_geography.sql"),
  "utf8"
);

describe("workspace home geography migration", () => {
  it("adds the home geography to the existing workspaces table, not a new one", () => {
    // A `study_areas` table here would be a second, competing answer to
    // "where is this work?" — projects and model runs already carry theirs.
    expect(sql).toMatch(/ALTER TABLE workspaces/);
    expect(sql).not.toMatch(/CREATE TABLE/i);
  });

  it("declares every column the TypeScript select list reads", () => {
    for (const column of HOME_GEOGRAPHY_COLUMNS.split(", ")) {
      expect(sql, `missing column ${column}`).toMatch(
        new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\b`)
      );
    }
  });

  it("keeps the column names jurisdiction-neutral", () => {
    // Worldwide is the target: no country's vocabulary may leak into the
    // schema. Sources describe themselves through (source, kind, ref).
    const columnNames = [...sql.matchAll(/ADD COLUMN IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
    expect(columnNames.length).toBeGreaterThan(0);
    for (const name of columnNames) {
      expect(name, `${name} encodes a jurisdiction-specific concept`).not.toMatch(
        /fips|state|county|census|province|prefecture|zip/i
      );
    }
  });

  it("leaves every column nullable so 'not set' stays a legal state", () => {
    // A NOT NULL or a DEFAULT here would force every workspace to claim a
    // geography — and whatever was defaulted would be somebody's real place.
    const additions = sql.slice(sql.indexOf("ALTER TABLE workspaces"), sql.indexOf("-----"));
    expect(additions).not.toMatch(/NOT NULL/i);
    expect(additions).not.toMatch(/\bDEFAULT\b/i);
  });

  it("uses numeric bbox columns and jsonb geometry, not a written PostGIS value", () => {
    // supabase-js cannot send PostGIS values (repo convention:
    // projects_location.sql:7). Only a GENERATED ... STORED column is allowed.
    expect(sql).toMatch(/home_min_lon DOUBLE PRECISION/i);
    expect(sql).toMatch(/home_max_lat DOUBLE PRECISION/i);
    expect(sql).toMatch(/home_geometry_geojson JSONB/i);
    expect(sql).not.toMatch(/geometry\(/i);
  });

  it("requires a bounding box to be complete or absent", () => {
    expect(sql).toContain("workspaces_home_bbox_complete");
    expect(sql).toMatch(/num_nulls\(home_min_lon, home_min_lat, home_max_lon, home_max_lat\) IN \(0, 4\)/);
  });

  it("permits an antimeridian-crossing bbox but not an off-globe one", () => {
    // min_lon > max_lon is well-formed for Fiji or Chukotka; forbidding it
    // would bake a hemisphere assumption into the schema.
    expect(sql).toContain("workspaces_home_bbox_on_globe");
    expect(sql).toMatch(/home_min_lat <= home_max_lat/);
    expect(sql).not.toMatch(/home_min_lon\s*<=\s*home_max_lon/);
  });

  it("constrains the ISO codes and requires a country for a subdivision", () => {
    expect(sql).toMatch(/home_country_code ~ '\^\[A-Z\]\{2\}\$'/);
    expect(sql).toMatch(/home_subdivision_code ~ '\^\[A-Z0-9\]\{1,3\}\$'/);
    // A subdivision code with no country cannot be resolved to a jurisdiction.
    expect(sql).toMatch(/home_subdivision_code IS NULL[\s\S]{0,80}home_country_code IS NOT NULL/);
  });

  it("requires a source for a ref, so a stored id is always resolvable", () => {
    expect(sql).toContain("workspaces_home_geography_coherent");
    expect(sql).toMatch(/home_geography_ref IS NULL OR home_geography_source IS NOT NULL/);
  });

  it("does not constrain the kind vocabulary, which each source owns", () => {
    // A CHECK list here would mean editing this table to admit a new resolver.
    expect(sql).not.toMatch(/home_geography_kind\s+IN\s*\(/i);
  });

  it("adds constraints idempotently, matching the established workspaces pattern", () => {
    const constraintNames = [...sql.matchAll(/ADD CONSTRAINT (\w+)/g)].map((m) => m[1]);
    expect(constraintNames.length).toBeGreaterThan(0);
    for (const name of constraintNames) {
      expect(sql, `${name} is added without an existence guard`).toContain(
        `WHERE conname = '${name}'`
      );
    }
  });

  it("extends RLS rather than touching the existing workspace policies", () => {
    // `workspaces` already enables RLS with the member-scoped workspace_read
    // policy; new columns inherit it. Creating or altering a policy here would
    // risk widening read access to every tenant row.
    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).not.toMatch(/DROP POLICY/i);
    expect(sql).not.toMatch(/ALTER POLICY/i);
    expect(sql).not.toMatch(/DISABLE ROW LEVEL SECURITY/i);
  });
});
