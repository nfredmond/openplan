-- Census tracts carry the ACS UNIVERSES their rates are computed against.
--
-- ============================================================ THE DEFECT
--
-- `census_tracts` stores three counts drawn from three DIFFERENT ACS tables:
--
--   pop_total          B01003_001E  total population
--   pop_white          B03002_003E  white, not Hispanic or Latino
--   pop_below_poverty  B17001_002E  income in the past 12 months below poverty
--
-- and every rate built from them divided by `pop_total`. For the poverty rate
-- that is the wrong denominator. B17001's universe is "the population FOR WHOM
-- POVERTY STATUS IS DETERMINED", which excludes people in institutionalised
-- group quarters, military barracks and college dormitories. `pop_total`
-- counts them. So the denominator is always the larger number and the computed
-- poverty rate is ALWAYS TOO LOW — by a few percent in an ordinary tract, and
-- by a great deal in a tract containing a prison, a university or a barracks.
--
-- THAT IS NOT A COSMETIC DIFFERENCE. `src/lib/title-vi/service-equity.ts`
-- sorts each tract into the low-income FOCUS group or the COMPARISON group by
-- exactly this rate, against a threshold the agency itself adopted. Understating
-- it moves tracts out of the protected group — the direction that makes a
-- disparity disappear — in precisely the places a Title VI review exists to
-- look at. The same wrong denominator was found and fixed in the corridor
-- rollup on 2026-08-06 (`src/lib/data-sources/census.ts` now carries
-- `povertyUniverse` and `raceUniverse` per tract); this table never got them,
-- so the tract-level surfaces kept computing the old way and the equity
-- choropleth disagreed with the corridor figure for the same ground.
--
-- The race share has the milder version of the same fault: numerator from
-- B03002, denominator from B01003. The two are both "total population" and
-- differ little in practice, but they are separate estimates and mixing tables
-- is what produced the poverty defect. Both universes are stored here so
-- neither rate has to borrow the other's denominator.
--
-- ====================================================== NO SILENT FALLBACK
--
-- A rate whose universe is unknown is NULL, never a rate computed against
-- `pop_total` instead. Tracts loaded before this migration have no universe and
-- cannot get one without re-reading ACS, so they report as NOT MEASURED and the
-- product offers the reload that fixes them. Filling the gap with the old
-- arithmetic would reintroduce the defect while claiming it had been fixed.
--
-- ==================================================== WHY THE VIEWS ARE DROPPED
--
-- `census_tracts_computed` is `SELECT *, <computed>`. Two new table columns
-- expand into the middle of its column list, and CREATE OR REPLACE VIEW may
-- only append columns — it cannot insert or reorder. So both views are dropped
-- and rebuilt, `census_tracts_map` first because it selects from the other.
--
-- A dropped view loses its privileges, and Supabase's default privileges then
-- hand the rebuilt view the full set — INSERT, UPDATE, DELETE, TRUNCATE — to
-- `anon` and `authenticated`, which is how both views came to hold them today.
-- They are re-granted BY NAME below, SELECT only. That is deliberately tighter
-- than what was there before and is the posture 20260730000009 established for
-- the base table: no anonymous caller has any business writing public reference
-- data that every workspace's equity analysis reads. Nothing wrote through
-- these views — the one writer is `seed_public_census_tract`, which is
-- service_role and goes to the base table.

ALTER TABLE census_tracts
  ADD COLUMN IF NOT EXISTS poverty_universe INTEGER;

ALTER TABLE census_tracts
  ADD COLUMN IF NOT EXISTS race_universe INTEGER;

COMMENT ON COLUMN census_tracts.poverty_universe IS
  'ACS B17001_001E — population for whom poverty status is determined. The ONLY correct denominator for pop_below_poverty. NULL means this tract predates the universe columns: report it as not measured and reload the county, never divide by pop_total.';

COMMENT ON COLUMN census_tracts.race_universe IS
  'ACS B03002_001E — universe of the Hispanic-origin-by-race table, and the denominator for a minority share built from pop_white. NULL means not measured; reload the county.';

DROP VIEW IF EXISTS census_tracts_map;
DROP VIEW IF EXISTS census_tracts_computed;

CREATE VIEW census_tracts_computed
WITH (security_invoker = true) AS
SELECT *,
  CASE WHEN race_universe > 0
    THEN ROUND(100.0 * (race_universe - pop_white) / race_universe, 1)
  END AS pct_nonwhite,
  CASE WHEN households > 0
    THEN ROUND(100.0 * households_zero_vehicle / households, 1)
  END AS pct_zero_vehicle,
  CASE WHEN poverty_universe > 0
    THEN ROUND(100.0 * pop_below_poverty / poverty_universe, 1)
  END AS pct_poverty
FROM census_tracts;

CREATE VIEW census_tracts_map
WITH (security_invoker = true) AS
SELECT
  geoid,
  state_fips,
  county_fips,
  name,
  ST_AsGeoJSON(geometry)::jsonb AS geometry_geojson,
  pop_total,
  households,
  poverty_universe,
  race_universe,
  pct_nonwhite,
  pct_zero_vehicle,
  pct_poverty
FROM census_tracts_computed;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON census_tracts_computed FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON census_tracts_map FROM anon, authenticated;

GRANT SELECT ON census_tracts_computed TO anon, authenticated;
GRANT SELECT ON census_tracts_map TO anon, authenticated;

-- The seed function gains the two universes. The 11-argument signature is
-- DROPPED rather than left beside the new one: an overload that omits the
-- universes is a writer that silently produces unmeasurable tracts, and the
-- only caller (`src/lib/data-sources/census-tract-ingest.ts`) passes named
-- arguments, so a stale overload would be selected by omission rather than by
-- intent.
DROP FUNCTION IF EXISTS seed_public_census_tract(
  TEXT, TEXT, TEXT, TEXT, JSONB, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER
);

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
  p_pop_below_poverty INTEGER,
  p_poverty_universe INTEGER,
  p_race_universe INTEGER
) RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  INSERT INTO census_tracts (
    geoid, state_fips, county_fips, name, geometry,
    pop_total, pop_white, households, households_zero_vehicle,
    median_household_income, pop_below_poverty, poverty_universe, race_universe
  ) VALUES (
    p_geoid, p_state_fips, p_county_fips, p_name,
    ST_SetSRID(ST_GeomFromGeoJSON(p_geometry_geojson::text), 4326)::geometry(MultiPolygon, 4326),
    p_pop_total, p_pop_white, p_households, p_households_zero_vehicle,
    p_median_household_income, p_pop_below_poverty, p_poverty_universe, p_race_universe
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
    poverty_universe = EXCLUDED.poverty_universe,
    race_universe = EXCLUDED.race_universe,
    updated_at = now();
END;
$$;

REVOKE EXECUTE ON FUNCTION seed_public_census_tract(
  TEXT, TEXT, TEXT, TEXT, JSONB, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION seed_public_census_tract(
  TEXT, TEXT, TEXT, TEXT, JSONB, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER
) TO service_role;
