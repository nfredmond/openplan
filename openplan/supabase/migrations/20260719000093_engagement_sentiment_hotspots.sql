-- E3 — screening-grade spatial hotspots of engagement sentiment. Detect where
-- approved resident contributions cluster in space and whether a cluster's share
-- of NEGATIVE-sentiment comments is elevated versus the campaign/workspace-wide
-- baseline. This is the "PostGIS statistical hotspot" white-space no pure
-- engagement vendor ships.
--
-- Method (deliberately legible, NOT inferential):
--   1. ST_ClusterDBSCAN over approved pins → dense spatial clusters (eps meters,
--      min points). DBSCAN "noise" points (cluster NULL) are dropped, not tested.
--   2. Per cluster, a one-sample proportion z: (cluster_negative_share -
--      global_negative_share) / sqrt(P(1-P)/n). We return the RAW z-score only —
--      Postgres has no normal CDF, and manufacturing a p-value from an erf
--      approximation would be false precision. The caller (src/lib/engagement/
--      hotspots.ts) applies a Bonferroni-adjusted z threshold and a minimum
--      expected-count gate, and stamps the screening caveat. Sentiment is NOT a
--      column: it is AI-derived (E1 synthesis) and supplied as p_negative_item_ids
--      — a proxy, never ground truth.
--
-- SECURITY INVOKER: the caller's RLS on engagement_items / engagement_campaigns
-- applies, so a member only ever clusters their own workspace's approved items;
-- p_workspace_id is a further explicit scope and p_campaign_id an optional narrow.
-- Same seq-scan cost profile as engagement_items_near_geometry (no spatial index
-- on the JSONB geometry) — fine at screening volumes (hundreds of approved items).
--
-- Projection note: ST_ClusterDBSCAN has no geography overload, so eps is in the
-- input SRID's units. We cluster in EPSG:3857 (meters) but Web Mercator inflates
-- ground distance by 1/cos(latitude); at California latitudes that is ~28%, too
-- much to ignore for a distance threshold. We divide eps by cos(dataset-centroid
-- latitude) so the threshold is honest ground meters. The cluster footprint is a
-- buffered convex hull (same correction) — an indicative extent, not a boundary.

CREATE OR REPLACE FUNCTION public.engagement_sentiment_hotspots(
  p_workspace_id uuid,
  p_eps_meters double precision DEFAULT 250,
  p_min_points integer DEFAULT 5,
  p_negative_item_ids uuid[] DEFAULT '{}',
  p_campaign_id uuid DEFAULT NULL
)
RETURNS TABLE (
  cluster_id integer,
  n_items bigint,
  n_negative bigint,
  cluster_negative_share double precision,
  global_negative_share double precision,
  z_score double precision,
  centroid_lng double precision,
  centroid_lat double precision,
  footprint_geojson text,
  item_ids uuid[]
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  WITH candidates AS (
    SELECT
      ei.id,
      (ei.id = ANY (COALESCE(p_negative_item_ids, '{}'::uuid[]))) AS is_negative,
      COALESCE(
        ST_SetSRID(ST_GeomFromGeoJSON(ei.geometry::text), 4326),
        ST_SetSRID(ST_MakePoint(ei.longitude, ei.latitude), 4326)
      ) AS geom
    FROM engagement_items ei
    JOIN engagement_campaigns ec ON ec.id = ei.campaign_id
    WHERE ec.workspace_id = p_workspace_id
      AND (p_campaign_id IS NULL OR ei.campaign_id = p_campaign_id)
      AND ei.status = 'approved'
      AND (ei.geometry IS NOT NULL OR (ei.latitude IS NOT NULL AND ei.longitude IS NOT NULL))
  ),
  ctr AS (
    -- cos(latitude) at the dataset centroid; floored so it stays sane near the
    -- poles and never divides by zero. Empty input → coslat = 1 (unused).
    SELECT GREATEST(COALESCE(cos(radians(ST_Y(ST_Centroid(ST_Collect(geom))))), 1.0), 0.01) AS coslat
    FROM candidates
  ),
  g AS (
    SELECT
      count(*)::double precision AS n_all,
      count(*) FILTER (WHERE is_negative)::double precision AS n_neg
    FROM candidates
  ),
  clustered AS (
    SELECT
      c.id,
      c.is_negative,
      c.geom,
      ST_ClusterDBSCAN(
        ST_Transform(c.geom, 3857),
        eps := GREATEST(p_eps_meters, 1) / (SELECT coslat FROM ctr),
        minpoints := GREATEST(p_min_points, 2)
      ) OVER () AS cid
    FROM candidates c
  )
  SELECT
    cl.cid AS cluster_id,
    count(*) AS n_items,
    count(*) FILTER (WHERE cl.is_negative) AS n_negative,
    (count(*) FILTER (WHERE cl.is_negative))::double precision / NULLIF(count(*), 0) AS cluster_negative_share,
    g.n_neg / NULLIF(g.n_all, 0) AS global_negative_share,
    CASE
      WHEN g.n_all = 0 OR g.n_neg = 0 OR g.n_neg = g.n_all THEN NULL
      ELSE (
        (count(*) FILTER (WHERE cl.is_negative))::double precision / NULLIF(count(*), 0)
        - g.n_neg / g.n_all
      ) / sqrt((g.n_neg / g.n_all) * (1 - g.n_neg / g.n_all) / count(*))
    END AS z_score,
    ST_X(ST_Centroid(ST_Collect(cl.geom))) AS centroid_lng,
    ST_Y(ST_Centroid(ST_Collect(cl.geom))) AS centroid_lat,
    ST_AsGeoJSON(
      ST_Transform(
        ST_Buffer(
          ST_ConvexHull(ST_Collect(ST_Transform(cl.geom, 3857))),
          GREATEST(p_eps_meters * 0.25, 30) / (SELECT coslat FROM ctr)
        ),
        4326
      ),
      6
    ) AS footprint_geojson,
    array_agg(cl.id) AS item_ids
  FROM clustered cl CROSS JOIN g
  WHERE cl.cid IS NOT NULL
  GROUP BY cl.cid, g.n_all, g.n_neg
  ORDER BY z_score DESC NULLS LAST;
$$;

COMMENT ON FUNCTION public.engagement_sentiment_hotspots(uuid, double precision, integer, uuid[], uuid) IS
  'Screening-grade engagement hotspots: ST_ClusterDBSCAN over approved pins + a one-sample proportion z of cluster negative-share vs the global baseline, workspace-scoped (SECURITY INVOKER → caller RLS applies), optional p_campaign_id narrow. Returns the RAW z-score; the app (E3 hotspots.ts) applies Bonferroni + min-expected-count gating and the screening caveat. Sentiment is AI-derived (E1), a proxy — NOT inferential, NOT a representativeness finding.';

GRANT EXECUTE ON FUNCTION public.engagement_sentiment_hotspots(uuid, double precision, integer, uuid[], uuid) TO authenticated;
