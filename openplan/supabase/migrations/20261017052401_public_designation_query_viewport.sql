-- Query one canonical or antimeridian viewport for the public designation map.
-- Count each matching feature once and refuse partial drawing above the cap.
-- SECURITY INVOKER retains caller RLS; installed SQL behavior needs native evidence.

CREATE FUNCTION public.workspace_gis_features_in_query_viewport(
  p_version_id pg_catalog.uuid,
  p_west pg_catalog.float8,
  p_south pg_catalog.float8,
  p_east pg_catalog.float8,
  p_north pg_catalog.float8,
  p_limit pg_catalog.int4
)
RETURNS TABLE (
  id pg_catalog.uuid,
  feature_index pg_catalog.int4,
  geometry_geojson pg_catalog.jsonb,
  properties pg_catalog.jsonb,
  matched_count pg_catalog.int8
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_west pg_catalog.float8;
  v_east pg_catalog.float8;
BEGIN
  IF p_version_id IS NULL OR p_west IS NULL OR p_south IS NULL
    OR p_east IS NULL OR p_north IS NULL OR p_limit IS NULL
    OR NOT (p_west BETWEEN -180 AND 180 AND p_east BETWEEN -180 AND 180
      AND p_south BETWEEN -90 AND 90 AND p_north BETWEEN -90 AND 90)
    OR p_south >= p_north OR p_west = p_east
    OR (p_west = 180 AND p_east = -180) OR p_limit < 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid canonical WGS84 query viewport or draw limit';
  END IF;

  v_west := CASE WHEN p_west = 180 THEN -180 ELSE p_west END;
  v_east := CASE WHEN p_east = -180 THEN 180 ELSE p_east END;

  RETURN QUERY
  WITH windows AS (
    SELECT
      CASE WHEN v_west < v_east
        THEN public.ST_MakeEnvelope(v_west, p_south, v_east, p_north, 4326) END AS ordinary,
      CASE WHEN v_west > v_east
        THEN public.ST_MakeEnvelope(v_west, p_south, 180, p_north, 4326) END AS eastern,
      CASE WHEN v_west > v_east
        THEN public.ST_MakeEnvelope(-180, p_south, v_east, p_north, 4326) END AS western,
      CASE WHEN v_west = -180 AND v_east < 180
        THEN public.ST_MakeEnvelope(180, p_south, 180, p_north, 4326) END AS positive_seam,
      CASE WHEN v_east = 180 AND v_west > -180
        THEN public.ST_MakeEnvelope(-180, p_south, -180, p_north, 4326) END AS negative_seam
  ),
  matched AS (
    SELECT f.id AS feature_id, f.feature_index AS idx
    FROM public.workspace_gis_features f
    CROSS JOIN windows w
    WHERE f.version_id = p_version_id
      AND (f.geom && w.ordinary OR f.geom && w.eastern OR f.geom && w.western
        OR f.geom && w.positive_seam OR f.geom && w.negative_seam)
  ),
  counted AS (
    SELECT pg_catalog.count(*) AS n FROM matched
  )
  SELECT drawn.id, drawn.feature_index, drawn.geometry_geojson, drawn.properties,
    counted.n AS matched_count
  FROM counted
  LEFT JOIN LATERAL (
    SELECT f.id, f.feature_index, public.ST_AsGeoJSON(f.geom)::pg_catalog.jsonb AS geometry_geojson, f.properties
    FROM matched
    JOIN public.workspace_gis_features f ON f.id = matched.feature_id
    ORDER BY matched.idx
    LIMIT CASE WHEN counted.n > p_limit THEN 0 ELSE p_limit END
  ) AS drawn ON TRUE;
END;
$$;

COMMENT ON FUNCTION public.workspace_gis_features_in_query_viewport(pg_catalog.uuid, pg_catalog.float8, pg_catalog.float8, pg_catalog.float8, pg_catalog.float8, pg_catalog.int4) IS
  'Canonical WGS84 query viewport for one GIS version. West greater than east selects both antimeridian intervals. Seam-touching views include either stored representation of the seam. Counts each feature row once using envelope overlap in one statement, draws all or no geometry at the cap, and returns a count-only row for zero or over-cap matches. SECURITY INVOKER preserves caller RLS. Invalid input raises instead of claiming an empty view.';

REVOKE ALL ON FUNCTION public.workspace_gis_features_in_query_viewport(pg_catalog.uuid, pg_catalog.float8, pg_catalog.float8, pg_catalog.float8, pg_catalog.float8, pg_catalog.int4) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_gis_features_in_query_viewport(pg_catalog.uuid, pg_catalog.float8, pg_catalog.float8, pg_catalog.float8, pg_catalog.float8, pg_catalog.int4) TO authenticated, service_role;
