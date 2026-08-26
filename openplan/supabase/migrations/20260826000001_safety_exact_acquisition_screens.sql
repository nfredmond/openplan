-- Exact-acquisition variants of the Safety concentration and tract screens.
-- Repeated pulls can overlap byte-for-byte; project scope alone would count the
-- same reported collision more than once. Reports and the Safety workbench pass
-- the planner-selected acquisition ids to these functions.

CREATE OR REPLACE FUNCTION public.safety_ksi_concentrations_for_ingests(
  p_workspace_id uuid,
  p_ingest_ids uuid[],
  p_min_lon double precision,
  p_min_lat double precision,
  p_max_lon double precision,
  p_max_lat double precision,
  p_project_id uuid DEFAULT NULL,
  p_severities text[] DEFAULT ARRAY['fatal', 'severe_injury']::text[],
  p_radius_meters double precision DEFAULT 150,
  p_min_points integer DEFAULT 2,
  p_result_limit integer DEFAULT 10
)
RETURNS TABLE (
  rank integer,
  longitude double precision,
  latitude double precision,
  crash_count bigint,
  fatal_crash_count bigint,
  serious_injury_crash_count bigint,
  radius_meters double precision
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  WITH candidates AS (
    SELECT c.id, c.geom, c.severity
    FROM safety_crashes c
    WHERE c.workspace_id = p_workspace_id
      AND c.ingest_id = ANY (COALESCE(p_ingest_ids, '{}'::uuid[]))
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
  correction AS (
    SELECT GREATEST(
      COALESCE(cos(radians(ST_Y(ST_Centroid(ST_Collect(geom))))), 1.0),
      0.01
    ) AS coslat
    FROM candidates
  ),
  clustered AS (
    SELECT
      c.*,
      ST_ClusterDBSCAN(
        ST_Transform(c.geom, 3857),
        eps := GREATEST(p_radius_meters, 1) / (SELECT coslat FROM correction),
        minpoints := GREATEST(p_min_points, 2)
      ) OVER () AS cluster_id
    FROM candidates c
  ),
  aggregates AS (
    SELECT
      cluster_id,
      ST_X(ST_Centroid(ST_Collect(geom))) AS longitude,
      ST_Y(ST_Centroid(ST_Collect(geom))) AS latitude,
      count(*)::bigint AS crash_count,
      count(*) FILTER (WHERE severity = 'fatal')::bigint AS fatal_crash_count,
      count(*) FILTER (WHERE severity = 'severe_injury')::bigint AS serious_injury_crash_count
    FROM clustered
    WHERE cluster_id IS NOT NULL
    GROUP BY cluster_id
  ),
  ranked AS (
    SELECT
      row_number() OVER (
        ORDER BY crash_count DESC, fatal_crash_count DESC, cluster_id ASC
      )::integer AS rank,
      longitude,
      latitude,
      crash_count,
      fatal_crash_count,
      serious_injury_crash_count
    FROM aggregates
  )
  SELECT
    ranked.rank,
    ranked.longitude,
    ranked.latitude,
    ranked.crash_count,
    ranked.fatal_crash_count,
    ranked.serious_injury_crash_count,
    GREATEST(p_radius_meters, 1)::double precision AS radius_meters
  FROM ranked
  ORDER BY ranked.rank
  LIMIT LEAST(GREATEST(p_result_limit, 1), 50);
$$;

COMMENT ON FUNCTION public.safety_ksi_concentrations_for_ingests(uuid, uuid[], double precision, double precision, double precision, double precision, uuid, text[], double precision, integer, integer) IS
  'Ranks RLS-visible concentrations from only the explicitly selected crash acquisitions. Screening locations only.';
REVOKE ALL ON FUNCTION public.safety_ksi_concentrations_for_ingests(uuid, uuid[], double precision, double precision, double precision, double precision, uuid, text[], double precision, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.safety_ksi_concentrations_for_ingests(uuid, uuid[], double precision, double precision, double precision, double precision, uuid, text[], double precision, integer, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.safety_ksi_tract_burden_for_ingests(
  p_workspace_id uuid,
  p_ingest_ids uuid[],
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
      AND c.ingest_id = ANY (COALESCE(p_ingest_ids, '{}'::uuid[]))
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

COMMENT ON FUNCTION public.safety_ksi_tract_burden_for_ingests(uuid, uuid[], double precision, double precision, double precision, double precision, uuid, text[], integer) IS
  'Ranks mapped KSI crash counts by loaded US Census tract from only the explicitly selected crash acquisitions.';
REVOKE ALL ON FUNCTION public.safety_ksi_tract_burden_for_ingests(uuid, uuid[], double precision, double precision, double precision, double precision, uuid, text[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.safety_ksi_tract_burden_for_ingests(uuid, uuid[], double precision, double precision, double precision, double precision, uuid, text[], integer) TO authenticated, service_role;
