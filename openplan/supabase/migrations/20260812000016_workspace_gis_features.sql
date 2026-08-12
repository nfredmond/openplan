-- The geometry itself — one PostGIS row per shape, and the two functions that
-- put shapes in and take them out again.
--
-- WHY ROWS AND NOT A JSONB BLOB. engagement_context_layers stores one
-- FeatureCollection per layer and explains at length why that is right for a
-- campaign sketch. It is wrong here for one reason: scale. A county parcel
-- fabric is 200,000 shapes. In a single JSONB value that is hundreds of
-- megabytes read whole on every request, with no way to ask for the part of it
-- that is on screen. In rows behind a GiST index, the viewport IS the query.
--
-- WHY supabase-js CANNOT TOUCH THIS TABLE DIRECTLY, and why both directions are
-- functions. A PostGIS `geometry` column is transported by PostgREST as hex
-- EWKB — unreadable to the client — and there is no way to write one from a
-- JSON insert at all. So the two directions are SQL functions, both
-- SECURITY INVOKER so the caller's RLS still decides every row, exactly as
-- kb_search_chunks does. There is no service-role path into this table.
--
-- THE WGS84 BOUND IS A CONSTRAINT, NOT A CONVENTION. A shapefile in State Plane
-- feet read as if it were degrees produces coordinates in the millions. That is
-- the single most common legacy-GIS failure, and its symptom is a layer that
-- lands in the ocean — or, worse, one that lands somewhere plausible. The
-- checks live in the CRS lane where they can explain themselves; this CHECK is
-- the last net, so a coordinate outside the world cannot be stored by any path,
-- including one written years from now by someone who never read that lane.

CREATE TABLE IF NOT EXISTS public.workspace_gis_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  version_id UUID NOT NULL
    REFERENCES public.workspace_gis_layer_versions(id) ON DELETE CASCADE,
  -- layer_id and workspace_id are denormalized from the version: the RLS
  -- predicate and the "everything in this layer" read would otherwise join two
  -- tables per row. They are written by the append function from the version
  -- row, never supplied by a client, so they cannot disagree with it.
  layer_id UUID NOT NULL
    REFERENCES public.workspace_gis_layers(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  -- Position in the source file, which is also the draw order. It exists so a
  -- retried upload batch is IDEMPOTENT: see the UNIQUE below.
  feature_index INTEGER NOT NULL CHECK (feature_index >= 0),

  geom geometry(Geometry, 4326) NOT NULL,

  -- The feature's own attributes, verbatim from the file. Object-typed so a
  -- caller can always spread it; empty when the source carried none.
  properties JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(properties) = 'object'),

  -- THE LAST NET. ST_XMin/XMax/YMin/YMax are IMMUTABLE, so this is a legal
  -- CHECK, and it makes "no shape outside the world" a property of the table
  -- rather than a promise made by whichever code path happened to write it.
  CONSTRAINT workspace_gis_features_within_wgs84 CHECK (
    ST_XMin(geom) >= -180 AND ST_XMax(geom) <= 180
    AND ST_YMin(geom) >= -90 AND ST_YMax(geom) <= 90
  ),

  -- IDEMPOTENT BATCHES. A browser uploading 200,000 features in batches will
  -- retry one; without this, the retry doubles those shapes and the version's
  -- feature_count runs past its declared total. With it, the retry inserts
  -- nothing, the append function reports 0 inserted, and the count stays exact.
  CONSTRAINT workspace_gis_features_unique_index UNIQUE (version_id, feature_index)
);

-- The viewport query. Everything this table exists for goes through it.
CREATE INDEX IF NOT EXISTS workspace_gis_features_geom_idx
  ON public.workspace_gis_features USING GIST (geom);

CREATE INDEX IF NOT EXISTS workspace_gis_features_version_idx
  ON public.workspace_gis_features(version_id, feature_index);

ALTER TABLE public.workspace_gis_features ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'workspace_gis_features'
      AND policyname = 'workspace_gis_features_member_read'
  ) THEN
    CREATE POLICY workspace_gis_features_member_read
      ON public.workspace_gis_features
      FOR SELECT USING (
        workspace_id IN (
          SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'workspace_gis_features'
      AND policyname = 'workspace_gis_features_writer_insert'
  ) THEN
    CREATE POLICY workspace_gis_features_writer_insert
      ON public.workspace_gis_features
      FOR INSERT WITH CHECK (public.workspace_member_can_write(workspace_id));
  END IF;

  -- NO UPDATE POLICY, DELIBERATELY. A stored shape is never edited: a corrected
  -- file is a new VERSION, which is the whole reason versions exist. Editing
  -- geometry in place would change what every map in the workspace draws with
  -- no record that anything moved.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'workspace_gis_features'
      AND policyname = 'workspace_gis_features_writer_delete'
  ) THEN
    CREATE POLICY workspace_gis_features_writer_delete
      ON public.workspace_gis_features
      FOR DELETE USING (public.workspace_member_can_write(workspace_id));
  END IF;
END
$$;

REVOKE ALL ON TABLE public.workspace_gis_features FROM PUBLIC, anon;
-- No UPDATE grant: there is no UPDATE policy to open. See above.
GRANT SELECT, INSERT, DELETE ON TABLE public.workspace_gis_features TO authenticated;
GRANT ALL ON TABLE public.workspace_gis_features TO service_role;

------------------------------------------------------------------------------
-- APPEND — the write half of the chunked ingest.
------------------------------------------------------------------------------
-- The browser parsed and reprojected the file (a 200 MB shapefile never fits in
-- a request body) and posts normalized WGS84 features in batches. Each batch
-- carries the index its first feature occupies in the source file, so a batch
-- is addressable and a retry is a no-op rather than a duplicate.
--
-- SECURITY INVOKER: the INSERT is subject to workspace_gis_features_writer_insert
-- and the version lookup to the caller's read policy, so a member of another
-- workspace cannot append to this layer even though the function is shared.
CREATE OR REPLACE FUNCTION public.workspace_gis_append_features(
  p_version_id UUID,
  p_start_index INTEGER,
  p_features JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_layer_id     UUID;
  v_workspace_id UUID;
  v_status       TEXT;
  v_inserted     INTEGER;
BEGIN
  IF jsonb_typeof(p_features) <> 'array' THEN
    RAISE EXCEPTION 'workspace_gis_append_features expects an array of GeoJSON features';
  END IF;

  IF p_start_index < 0 THEN
    RAISE EXCEPTION 'workspace_gis_append_features start index must be >= 0';
  END IF;

  SELECT layer_id, workspace_id, ingest_status
    INTO v_layer_id, v_workspace_id, v_status
    FROM public.workspace_gis_layer_versions
   WHERE id = p_version_id;

  -- Not found is indistinguishable from not-permitted here, on purpose: the
  -- caller's SELECT policy has already hidden other workspaces' versions, and
  -- telling an outsider that an id exists is itself a disclosure.
  IF v_layer_id IS NULL THEN
    RAISE EXCEPTION 'no ingest is open for version %', p_version_id;
  END IF;

  IF v_status <> 'receiving' THEN
    RAISE EXCEPTION 'version % is % — features may only be appended while an ingest is receiving', p_version_id, v_status;
  END IF;

  INSERT INTO public.workspace_gis_features
    (version_id, layer_id, workspace_id, feature_index, geom, properties)
  SELECT
    p_version_id,
    v_layer_id,
    v_workspace_id,
    p_start_index + (elem.ord - 1)::INTEGER,
    ST_SetSRID(ST_GeomFromGeoJSON(elem.value -> 'geometry'), 4326),
    CASE
      WHEN jsonb_typeof(elem.value -> 'properties') = 'object' THEN elem.value -> 'properties'
      ELSE '{}'::jsonb
    END
  FROM jsonb_array_elements(p_features) WITH ORDINALITY AS elem(value, ord)
  ON CONFLICT (version_id, feature_index) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- The running total lives on the version, so "is this ingest finished?" is
  -- one row read and not a COUNT(*) over a quarter of a million features.
  UPDATE public.workspace_gis_layer_versions
     SET feature_count = feature_count + v_inserted
   WHERE id = p_version_id;

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION public.workspace_gis_append_features(UUID, INTEGER, JSONB) IS
  'Appends one batch of normalized WGS84 GeoJSON features to an open ingest and returns how many rows were actually inserted. Idempotent: a retried batch conflicts on (version_id, feature_index) and inserts nothing, so the version''s feature_count stays exact. SECURITY INVOKER — the caller''s RLS governs both the version lookup and the insert.';

REVOKE ALL ON FUNCTION public.workspace_gis_append_features(UUID, INTEGER, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_gis_append_features(UUID, INTEGER, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_gis_append_features(UUID, INTEGER, JSONB) TO service_role;

------------------------------------------------------------------------------
-- READ — the viewport query, and the honest answer when there is too much.
------------------------------------------------------------------------------
-- THE COUNT ALWAYS COMES BACK, EVEN WHEN THE GEOMETRY DOES NOT. This function
-- returns at least one row always: when nothing matches, or when MORE matches
-- than p_limit, the single row carries a NULL id and the true matched count.
--
-- That shape exists because of the alternative. Every other map layer in this
-- product draws up to its cap and says "showing 500 of 2,000". For a parcel
-- fabric that sentence is a trap: an arbitrary 500 of 214,391 parcels draws a
-- shredded fabric, and a planner looking at holes in their own parcel layer
-- will believe the holes. So above the cap this draws NOTHING and the caller
-- says how many are there and to zoom in — which is the only reading of the
-- data that is true. Getting the count in the same round trip is what makes
-- that sentence cheap enough to always be right.
CREATE OR REPLACE FUNCTION public.workspace_gis_features_in_bbox(
  p_version_id UUID,
  p_west DOUBLE PRECISION,
  p_south DOUBLE PRECISION,
  p_east DOUBLE PRECISION,
  p_north DOUBLE PRECISION,
  p_limit INTEGER
)
RETURNS TABLE (
  id UUID,
  feature_index INTEGER,
  geometry_geojson JSONB,
  properties JSONB,
  matched_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  WITH matched AS (
    SELECT f.id AS feature_id, f.feature_index AS idx
    FROM public.workspace_gis_features f
    WHERE f.version_id = p_version_id
      AND f.geom && ST_MakeEnvelope(p_west, p_south, p_east, p_north, 4326)
  ),
  counted AS (
    SELECT count(*) AS n FROM matched
  )
  SELECT
    drawn.id,
    drawn.feature_index,
    drawn.geometry_geojson,
    drawn.properties,
    counted.n AS matched_count
  FROM counted
  LEFT JOIN LATERAL (
    SELECT f.id, f.feature_index, ST_AsGeoJSON(f.geom)::jsonb AS geometry_geojson, f.properties
    FROM matched
    JOIN public.workspace_gis_features f ON f.id = matched.feature_id
    ORDER BY matched.idx
    LIMIT CASE WHEN counted.n > GREATEST(p_limit, 0) THEN 0 ELSE GREATEST(p_limit, 0) END
  ) AS drawn ON TRUE
$$;

COMMENT ON FUNCTION public.workspace_gis_features_in_bbox(UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER) IS
  'Features of one layer version intersecting a WGS84 bounding box, as GeoJSON, plus the TRUE matched count on every row. Returns a single row with a NULL id when nothing matches OR when the match count exceeds p_limit — above the cap the layer draws nothing and says how many are there, because an arbitrary subset of a parcel fabric reads as holes in the fabric. SECURITY INVOKER: the caller''s RLS decides which rows exist.';

REVOKE ALL ON FUNCTION public.workspace_gis_features_in_bbox(UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_gis_features_in_bbox(UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_gis_features_in_bbox(UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER) TO service_role;

COMMENT ON TABLE public.workspace_gis_features IS
  'One shape of one workspace GIS layer version, in WGS84 PostGIS geometry with its source attributes. Written only through workspace_gis_append_features and read only through workspace_gis_features_in_bbox — both SECURITY INVOKER, so RLS governs every row. Never updated: a corrected file is a new version.';
