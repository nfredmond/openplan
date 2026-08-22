-- The engagement <-> safety seam: for each mapped resident comment on a
-- campaign, what the CRASH RECORD says about that same place.
--
-- WHAT THIS FUNCTION DOES NOT DO. It does not decide that a comment is "about"
-- the crashes near it, and it returns no verdict, score or flag. It returns
-- counts and a distance. The pairing of a concern with a collision is a
-- judgement a planner makes; proximity is the only thing arithmetic can
-- establish, and this is the arithmetic.
--
-- COVERAGE IS RETURNED ALONGSIDE THE COUNTS, AND THAT IS THE POINT.
-- `safety_crashes` holds only what a workspace has actually acquired, so a
-- comment with no crashes near it has two completely different explanations:
-- nothing happened there, or nobody ever asked. Every row therefore carries
-- whether a READY ingest's bounding box contains it (`covered_by_ingest`), the
-- YEARS those ingests requested, and how completely each expressed severity.
-- Without that a resident who correctly flagged a dangerous corner in a state
-- with no acquired data would be rendered as unsupported by the record.
--
-- SECURITY INVOKER: the caller's RLS on engagement_items, engagement_campaigns,
-- safety_crashes and safety_crash_ingests all apply. `p_workspace_id` is a
-- further explicit scope on the two tables that carry one.
--
-- THE BOUNDING-BOX PREDICATE IS LOAD-BEARING FOR SPEED, NOT FOR CORRECTNESS.
-- `sc.geom && ST_Expand(...)` uses idx_safety_crashes_geom to shrink the
-- candidate set; `ST_DWithin(geography)` then decides membership on the true
-- spheroid. The box therefore only has to be a SUPERSET of the true circle — but
-- if it is ever a subset, edge crashes vanish with no error anywhere.
--
-- 110000 IS BELOW THE SMALLEST REAL METRE-PER-DEGREE, ON PURPOSE. A degree of
-- latitude on WGS84 runs from about 110,574 m at the equator to 111,694 m at the
-- pole. Dividing by a number BELOW that minimum makes the box slightly too big,
-- which costs a few candidate rows; dividing by the mean (111,320) makes it too
-- SMALL near the equator, which drops real crashes. Measured 2026-08-21 against
-- live PostGIS: the mean failed to contain a due-north probe at every latitude
-- up to 51.5 degrees, and a due-east probe at the equator. 110000 covers all
-- 38,664 combinations of 179 latitudes x 6 radii x 36 bearings.
-- The cosine floor keeps the longitude expansion finite near the poles, where a
-- degree of longitude collapses to nothing.

CREATE OR REPLACE FUNCTION public.engagement_items_with_nearby_crashes(
  p_workspace_id uuid,
  p_campaign_id uuid,
  p_radius_meters double precision,
  p_from_year integer DEFAULT NULL,
  p_to_year integer DEFAULT NULL
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
  covered_by_ingest boolean,
  coverage_years integer[],
  coverage_severity_completeness text[],
  crash_total integer,
  fatal_count integer,
  severe_injury_count integer,
  injury_count integer,
  pdo_count integer,
  killed_total integer,
  injured_total integer,
  pedestrian_crashes integer,
  bicyclist_crashes integer,
  nearest_crash_meters double precision,
  earliest_crash_year integer,
  latest_crash_year integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  WITH radius AS (
    SELECT GREATEST(COALESCE(p_radius_meters, 0), 0) AS meters
  ),
  items AS (
    SELECT
      ei.id, ei.campaign_id, ei.category_id, ei.title, ei.body,
      ei.latitude, ei.longitude, ei.votes_count,
      COALESCE(
        ST_SetSRID(ST_GeomFromGeoJSON(ei.geometry::text), 4326),
        ST_SetSRID(ST_MakePoint(ei.longitude, ei.latitude), 4326)
      ) AS geom
    FROM engagement_items ei
    JOIN engagement_campaigns ec ON ec.id = ei.campaign_id
    WHERE ec.workspace_id = p_workspace_id
      AND ei.campaign_id = p_campaign_id
      -- Approved only, matching engagement_items_near_geometry: an unmoderated
      -- comment has not been established as a resident's genuine input, and the
      -- console discloses how many were excluded for that reason.
      AND ei.status = 'approved'
      AND (ei.geometry IS NOT NULL OR (ei.latitude IS NOT NULL AND ei.longitude IS NOT NULL))
  ),
  placed AS (
    SELECT
      i.*,
      i.geom::geography AS geog,
      -- Metres to degrees at THIS comment's latitude, deliberately generous —
      -- see the header. A wider box is only slower; a narrower one loses
      -- crashes without saying so.
      (SELECT meters FROM radius) / 110000.0 AS dy,
      (SELECT meters FROM radius)
        / (110000.0 * GREATEST(cos(radians(ST_Y(ST_Centroid(i.geom)))), 0.01)) AS dx
    FROM items i
  )
  SELECT
    p.id, p.campaign_id, p.category_id, p.title, p.body,
    p.latitude, p.longitude, p.votes_count,
    cov.covered, covyears.years, cov.completeness,
    COALESCE(c.crash_total, 0)::integer,
    COALESCE(c.fatal_count, 0)::integer,
    COALESCE(c.severe_injury_count, 0)::integer,
    COALESCE(c.injury_count, 0)::integer,
    COALESCE(c.pdo_count, 0)::integer,
    COALESCE(c.killed_total, 0)::integer,
    COALESCE(c.injured_total, 0)::integer,
    COALESCE(c.pedestrian_crashes, 0)::integer,
    COALESCE(c.bicyclist_crashes, 0)::integer,
    c.nearest_crash_meters,
    c.earliest_crash_year,
    c.latest_crash_year
  FROM placed p
  LEFT JOIN LATERAL (
    SELECT
      count(*)::integer AS crash_total,
      count(*) FILTER (WHERE sc.severity = 'fatal')::integer AS fatal_count,
      count(*) FILTER (WHERE sc.severity = 'severe_injury')::integer AS severe_injury_count,
      count(*) FILTER (WHERE sc.severity = 'injury')::integer AS injury_count,
      count(*) FILTER (WHERE sc.severity = 'pdo')::integer AS pdo_count,
      COALESCE(sum(sc.killed_count), 0)::integer AS killed_total,
      COALESCE(sum(sc.injured_count), 0)::integer AS injured_total,
      count(*) FILTER (WHERE sc.pedestrian_involved)::integer AS pedestrian_crashes,
      count(*) FILTER (WHERE sc.bicyclist_involved)::integer AS bicyclist_crashes,
      min(ST_Distance(sc.geom::geography, p.geog)) AS nearest_crash_meters,
      min(sc.collision_year)::integer AS earliest_crash_year,
      max(sc.collision_year)::integer AS latest_crash_year
    FROM safety_crashes sc
    WHERE sc.workspace_id = p_workspace_id
      AND (p_from_year IS NULL OR sc.collision_year >= p_from_year)
      AND (p_to_year IS NULL OR sc.collision_year <= p_to_year)
      AND sc.geom && ST_Expand(p.geom, p.dx, p.dy)
      AND ST_DWithin(sc.geom::geography, p.geog, (SELECT meters FROM radius))
  ) c ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      count(*) > 0 AS covered,
      array_agg(DISTINCT si.severity_completeness) AS completeness
    FROM safety_crash_ingests si
    WHERE si.workspace_id = p_workspace_id
      AND si.status = 'ready'
      -- The bbox IS what the adapter queried, so containment in it is exactly
      -- "this place was asked about".
      AND p.longitude BETWEEN si.min_lon AND si.max_lon
      AND p.latitude BETWEEN si.min_lat AND si.max_lat
  ) cov ON TRUE
  -- The union of what the covering acquisitions ASKED FOR, which is what bounds
  -- any statement about a quiet year. Sorted, so a reader sees a GAP rather than
  -- inferring a continuous range from two endpoints.
  --
  -- Separate from `cov` on purpose: unnesting the year arrays would drop an
  -- ingest that requested no years at all, and that ingest still covers the
  -- point. Coverage and the years it covered are two different questions.
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT y ORDER BY y) AS years
    FROM safety_crash_ingests si2, unnest(si2.years_requested) AS y
    WHERE si2.workspace_id = p_workspace_id
      AND si2.status = 'ready'
      AND p.longitude BETWEEN si2.min_lon AND si2.max_lon
      AND p.latitude BETWEEN si2.min_lat AND si2.max_lat
  ) covyears ON TRUE
  ORDER BY
    COALESCE(c.killed_total, 0) DESC,
    COALESCE(c.injured_total, 0) DESC,
    COALESCE(c.crash_total, 0) DESC,
    p.id;
$$;

COMMENT ON FUNCTION public.engagement_items_with_nearby_crashes(uuid, uuid, double precision, integer, integer) IS
  'Approved, mapped engagement items on one campaign with the crash record within p_radius_meters of each, plus whether any ready crash acquisition covered that point. Returns counts and distances only — never a verdict that a comment is about those crashes. SECURITY INVOKER, so caller RLS applies.';

GRANT EXECUTE ON FUNCTION public.engagement_items_with_nearby_crashes(uuid, uuid, double precision, integer, integer) TO authenticated;
