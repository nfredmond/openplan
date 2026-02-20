CREATE TABLE census_tracts (
  geoid TEXT PRIMARY KEY,
  state_fips TEXT NOT NULL,
  county_fips TEXT NOT NULL,
  name TEXT,
  geometry GEOMETRY(MultiPolygon, 4326) NOT NULL,
  pop_total INTEGER,
  pop_white INTEGER,
  pop_black INTEGER,
  pop_hispanic INTEGER,
  households INTEGER,
  households_zero_vehicle INTEGER,
  median_household_income INTEGER,
  pop_below_poverty INTEGER,
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_census_tracts_state ON census_tracts(state_fips);
CREATE INDEX idx_census_tracts_geom ON census_tracts USING GIST(geometry);

CREATE VIEW census_tracts_computed AS
SELECT *,
  CASE WHEN pop_total > 0
    THEN ROUND(100.0 * (pop_total - pop_white) / pop_total, 1)
  END AS pct_nonwhite,
  CASE WHEN households > 0
    THEN ROUND(100.0 * households_zero_vehicle / households, 1)
  END AS pct_zero_vehicle,
  CASE WHEN pop_total > 0
    THEN ROUND(100.0 * pop_below_poverty / pop_total, 1)
  END AS pct_poverty
FROM census_tracts;

CREATE TABLE lodes_od (
  id BIGSERIAL PRIMARY KEY,
  w_geocode TEXT NOT NULL,
  h_geocode TEXT NOT NULL,
  s000 INTEGER DEFAULT 0,
  sa01 INTEGER DEFAULT 0,
  sa02 INTEGER DEFAULT 0,
  sa03 INTEGER DEFAULT 0,
  se01 INTEGER DEFAULT 0,
  se02 INTEGER DEFAULT 0,
  se03 INTEGER DEFAULT 0,
  year INTEGER NOT NULL,
  state TEXT NOT NULL
);
CREATE INDEX idx_lodes_work ON lodes_od(w_geocode);
CREATE INDEX idx_lodes_home ON lodes_od(h_geocode);
CREATE INDEX idx_lodes_state_year ON lodes_od(state, year);

CREATE VIEW lodes_by_tract AS
SELECT
  SUBSTRING(w_geocode, 1, 11) AS work_tract_geoid,
  SUBSTRING(h_geocode, 1, 11) AS home_tract_geoid,
  SUM(s000) AS total_jobs,
  SUM(sa01) AS jobs_young,
  SUM(sa02) AS jobs_middle,
  SUM(sa03) AS jobs_older,
  SUM(se01) AS jobs_low_wage,
  year,
  state
FROM lodes_od
GROUP BY 1, 2, year, state;
