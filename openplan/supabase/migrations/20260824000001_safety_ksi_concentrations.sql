-- Ranked concentrations of observed fatal and serious-injury crashes.
--
-- The map query is deliberately capped, so clustering the dots returned to the
-- browser would rank an arbitrary slice in larger places. This function works
-- over every RLS-visible crash in the requested study area. It receives the
-- severity vocabulary from the caller instead of hardcoding a jurisdiction's
-- bands, and its optional project scope follows the acquisition link.
--
-- ST_ClusterDBSCAN has no geography overload. EPSG:3857 is used only after
-- correcting the requested ground radius by the dataset-centroid latitude;
-- the correction is recomputed for every geography and floored near the poles.
-- The result is a screening concentration, not an intersection, corridor, HIN,
-- rate, or causal finding.

CREATE OR REPLACE FUNCTION public.safety_ksi_concentrations(
  p_workspace_id uuid,
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

COMMENT ON FUNCTION public.safety_ksi_concentrations(uuid, double precision, double precision, double precision, double precision, uuid, text[], double precision, integer, integer) IS
  'Ranks RLS-visible concentrations of observed fatal and serious-injury crash records within a requested study area. Screening locations only: not intersections, corridors, rates, causal findings, or a High Injury Network.';

REVOKE ALL ON FUNCTION public.safety_ksi_concentrations(uuid, double precision, double precision, double precision, double precision, uuid, text[], double precision, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.safety_ksi_concentrations(uuid, double precision, double precision, double precision, double precision, uuid, text[], double precision, integer, integer) TO authenticated, service_role;
