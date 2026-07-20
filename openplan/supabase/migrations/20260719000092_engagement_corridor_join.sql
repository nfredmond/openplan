-- E4 — the engagement <-> modeling wedge: spatially join resident engagement
-- contributions to a corridor/study-area geometry (a model run's corridor, a
-- project corridor, or any drawn polygon/line). engagement_items.geometry is
-- stored as JSONB (validated GeoJSON at submit time), so we build the PostGIS
-- geometry at query time via ST_GeomFromGeoJSON — same pattern as aerial AOIs.
--
-- SECURITY INVOKER: the caller's RLS on engagement_items / engagement_campaigns
-- applies, so a member only ever sees their own workspace's approved items. The
-- p_workspace_id argument is a further explicit scope. No spatial index exists on
-- the JSONB geometry, so this is a per-workspace seq scan — fine at screening
-- volumes (hundreds of approved items); revisit with a generated geometry column
-- if a workspace ever accumulates tens of thousands.

CREATE OR REPLACE FUNCTION public.engagement_items_near_geometry(
  p_workspace_id uuid,
  p_geometry jsonb,
  p_buffer_meters double precision DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  campaign_id uuid,
  category_id uuid,
  title text,
  body text,
  latitude double precision,
  longitude double precision,
  votes_count integer,
  distance_meters double precision
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  WITH corridor AS (
    SELECT ST_SetSRID(ST_GeomFromGeoJSON(p_geometry::text), 4326)::geography AS geog
  ),
  candidates AS (
    SELECT
      ei.id, ei.campaign_id, ei.category_id, ei.title, ei.body,
      ei.latitude, ei.longitude, ei.votes_count,
      COALESCE(
        ST_SetSRID(ST_GeomFromGeoJSON(ei.geometry::text), 4326),
        ST_SetSRID(ST_MakePoint(ei.longitude, ei.latitude), 4326)
      )::geography AS geog
    FROM engagement_items ei
    JOIN engagement_campaigns ec ON ec.id = ei.campaign_id
    WHERE ec.workspace_id = p_workspace_id
      AND ei.status = 'approved'
      AND (ei.geometry IS NOT NULL OR (ei.latitude IS NOT NULL AND ei.longitude IS NOT NULL))
  )
  SELECT
    c.id, c.campaign_id, c.category_id, c.title, c.body,
    c.latitude, c.longitude, c.votes_count,
    ST_Distance(c.geog, corridor.geog) AS distance_meters
  FROM candidates c, corridor
  WHERE ST_DWithin(c.geog, corridor.geog, GREATEST(p_buffer_meters, 0))
  ORDER BY distance_meters ASC;
$$;

COMMENT ON FUNCTION public.engagement_items_near_geometry(uuid, jsonb, double precision) IS
  'Approved engagement items within p_buffer_meters of a GeoJSON geometry, workspace-scoped (SECURITY INVOKER → caller RLS applies). Powers the engagement<->modeling corridor join (E4).';

GRANT EXECUTE ON FUNCTION public.engagement_items_near_geometry(uuid, jsonb, double precision) TO authenticated;
