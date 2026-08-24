-- Census-tract context for mapped fatal and serious-injury crashes.
--
-- This is a US data adapter over the existing public Census tract table, not a
-- core safety assumption. Places without loaded tract demographics return no
-- rows while the crash workflow remains available. Counts are observed crash
-- records; demographic percentages are context, never a causal or legal
-- disparity verdict.

CREATE OR REPLACE FUNCTION public.safety_ksi_tract_burden(
  p_workspace_id uuid,
  p_min_lon double precision,
  p_min_lat double precision,
  p_max_lon double precision,
  p_max_lat double precision,
  p_project_id uuid DEFAULT NULL,
  p_severities text[] DEFAULT ARRAY['fatal', 'severe_injury']::text[],
  p_result_limit integer DEFAULT 10
)
RETURNS TABLE (
  rank integer,
  geoid text,
  tract_name text,
  ksi_crash_count bigint,
  fatal_crash_count bigint,
  serious_injury_crash_count bigint,
  population bigint,
  ksi_per_100k double precision,
  pct_poverty double precision,
  pct_nonwhite double precision,
  pct_zero_vehicle double precision,
  area_median_pct_poverty double precision,
  area_median_pct_nonwhite double precision,
  area_median_pct_zero_vehicle double precision
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  WITH area AS (
    SELECT ST_MakeEnvelope(p_min_lon, p_min_lat, p_max_lon, p_max_lat, 4326) AS geom
  ),
  tracts AS (
    SELECT
      t.geoid,
      t.name,
      t.geometry,
      t.pop_total,
      CASE WHEN t.pop_total > 0
        THEN 100.0 * t.pop_below_poverty::double precision / t.pop_total
      END AS pct_poverty,
      CASE WHEN t.pop_total > 0
        THEN 100.0 * (t.pop_total - t.pop_white)::double precision / t.pop_total
      END AS pct_nonwhite,
      CASE WHEN t.households > 0
        THEN 100.0 * t.households_zero_vehicle::double precision / t.households
      END AS pct_zero_vehicle
    FROM census_tracts t, area
    WHERE ST_Intersects(t.geometry, area.geom)
  ),
  area_medians AS (
    SELECT
      percentile_cont(0.5) WITHIN GROUP (ORDER BY pct_poverty)
        FILTER (WHERE pct_poverty IS NOT NULL) AS poverty,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY pct_nonwhite)
        FILTER (WHERE pct_nonwhite IS NOT NULL) AS nonwhite,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY pct_zero_vehicle)
        FILTER (WHERE pct_zero_vehicle IS NOT NULL) AS zero_vehicle
    FROM tracts
  ),
  crashes AS (
    SELECT c.geom, c.severity
    FROM safety_crashes c
    WHERE c.workspace_id = p_workspace_id
      AND c.longitude BETWEEN p_min_lon AND p_max_lon
      AND c.latitude BETWEEN p_min_lat AND p_max_lat
      AND c.severity = ANY (COALESCE(p_severities, '{}'::text[]))
      AND (
        p_project_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM safety_crash_ingests i
          WHERE i.id = c.ingest_id
            AND i.workspace_id = p_workspace_id
            AND i.project_id = p_project_id
        )
      )
  ),
  burden AS (
    SELECT
      t.geoid,
      t.name,
      t.pop_total,
      t.pct_poverty,
      t.pct_nonwhite,
      t.pct_zero_vehicle,
      count(*)::bigint AS ksi_crash_count,
      count(*) FILTER (WHERE c.severity = 'fatal')::bigint AS fatal_crash_count,
      count(*) FILTER (WHERE c.severity = 'severe_injury')::bigint AS serious_injury_crash_count
    FROM tracts t
    JOIN crashes c ON ST_Covers(t.geometry, c.geom)
    GROUP BY t.geoid, t.name, t.pop_total, t.pct_poverty, t.pct_nonwhite, t.pct_zero_vehicle
  ),
  ranked AS (
    SELECT
      row_number() OVER (ORDER BY ksi_crash_count DESC, fatal_crash_count DESC, geoid)::integer AS rank,
      *
    FROM burden
  )
  SELECT
    r.rank,
    r.geoid,
    r.name,
    r.ksi_crash_count,
    r.fatal_crash_count,
    r.serious_injury_crash_count,
    r.pop_total::bigint,
    CASE WHEN r.pop_total > 0
      THEN r.ksi_crash_count::double precision * 100000.0 / r.pop_total
    END,
    r.pct_poverty,
    r.pct_nonwhite,
    r.pct_zero_vehicle,
    m.poverty,
    m.nonwhite,
    m.zero_vehicle
  FROM ranked r
  CROSS JOIN area_medians m
  ORDER BY r.rank
  LIMIT LEAST(GREATEST(p_result_limit, 1), 50);
$$;

COMMENT ON FUNCTION public.safety_ksi_tract_burden(uuid, double precision, double precision, double precision, double precision, uuid, text[], integer) IS
  'Ranks mapped KSI crash counts by loaded US Census tract and returns demographic context relative to the requested area. Screening context only; not an exposure-adjusted, causal, protected-class, or legal disparity finding.';

REVOKE ALL ON FUNCTION public.safety_ksi_tract_burden(uuid, double precision, double precision, double precision, double precision, uuid, text[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.safety_ksi_tract_burden(uuid, double precision, double precision, double precision, double precision, uuid, text[], integer) TO authenticated, service_role;
