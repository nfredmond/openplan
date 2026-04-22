-- Phase 3 Slice K2 — cartographic map surface for census_tracts.
--
-- Two things added here:
--   1. `census_tracts_map` — read-only view that returns each tract with
--      its geometry pre-converted to GeoJSON as jsonb plus the pct_*
--      computed fields, so the /api/map-features/census-tracts route
--      can emit a FeatureCollection without an RPC round-trip.
--   2. `seed_public_census_tract(...)` — demo-seed helper that accepts
--      a GeoJSON MultiPolygon payload, converts it to geometry(MultiPolygon,
--      4326), and upserts on the geoid primary key. Needed because the
--      Supabase JS client can't send PostGIS geometry values directly;
--      this function is the minimum surface to close that gap for the
--      NCTC demo seed. Locked down to service_role only.
--
-- The view uses security_invoker = true so the underlying census_tracts
-- SELECT policy (added in 20260420000062_public_data_select_policies.sql)
-- governs access. No new advisor warnings expected.

CREATE OR REPLACE VIEW census_tracts_map
WITH (security_invoker = true) AS
SELECT
  geoid,
  state_fips,
  county_fips,
  name,
  ST_AsGeoJSON(geometry)::jsonb AS geometry_geojson,
  pop_total,
  households,
  pct_nonwhite,
  pct_zero_vehicle,
  pct_poverty
FROM census_tracts_computed;

GRANT SELECT ON census_tracts_map TO anon, authenticated;

CREATE OR REPLACE FUNCTION seed_public_census_tract(
  p_geoid TEXT,
  p_state_fips TEXT,
  p_county_fips TEXT,
  p_name TEXT,
  p_geometry_geojson JSONB,
  p_pop_total INTEGER,
  p_pop_white INTEGER,
  p_households INTEGER,
  p_households_zero_vehicle INTEGER,
  p_median_household_income INTEGER,
  p_pop_below_poverty INTEGER
) RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  INSERT INTO census_tracts (
    geoid, state_fips, county_fips, name, geometry,
    pop_total, pop_white, households, households_zero_vehicle,
    median_household_income, pop_below_poverty
  ) VALUES (
    p_geoid, p_state_fips, p_county_fips, p_name,
    ST_SetSRID(ST_GeomFromGeoJSON(p_geometry_geojson::text), 4326)::geometry(MultiPolygon, 4326),
    p_pop_total, p_pop_white, p_households, p_households_zero_vehicle,
    p_median_household_income, p_pop_below_poverty
  )
  ON CONFLICT (geoid) DO UPDATE SET
    state_fips = EXCLUDED.state_fips,
    county_fips = EXCLUDED.county_fips,
    name = EXCLUDED.name,
    geometry = EXCLUDED.geometry,
    pop_total = EXCLUDED.pop_total,
    pop_white = EXCLUDED.pop_white,
    households = EXCLUDED.households,
    households_zero_vehicle = EXCLUDED.households_zero_vehicle,
    median_household_income = EXCLUDED.median_household_income,
    pop_below_poverty = EXCLUDED.pop_below_poverty,
    updated_at = now();
END;
$$;

REVOKE EXECUTE ON FUNCTION seed_public_census_tract(
  TEXT, TEXT, TEXT, TEXT, JSONB, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION seed_public_census_tract(
  TEXT, TEXT, TEXT, TEXT, JSONB, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER
) TO service_role;
