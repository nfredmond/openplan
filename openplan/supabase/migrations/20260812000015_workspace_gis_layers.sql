-- Workspace GIS layers — the agency's OWN map data, uploaded once and drawn on
-- every map in the product.
--
-- WHAT WAS MISSING. A planner could put a GIS file in front of RESIDENTS
-- (engagement_context_layers, 20260729000002) but never in front of THEMSELVES.
-- The bike network, the city limits, the zoning, the parcel fabric — the four
-- layers a planning department actually opens every day — had nowhere to live,
-- so every OpenPlan map drew OpenPlan's own records over a bare basemap and the
-- planner kept a second window open on ArcGIS to see where anything was.
--
-- WHY THIS IS NOT engagement_context_layers WITH A WIDER SCOPE. That table
-- stores ONE JSONB FeatureCollection per layer, which is right for a campaign's
-- alignment sketch and wrong for a county parcel fabric: 200,000 features in a
-- single value is hundreds of megabytes read whole on every request, unqueryable
-- and impossible to filter to the map's viewport. The geometry here lives in
-- rows (20260812000016) so a request can ask for what is on screen. The two
-- tables stay separate for a second reason as well: a campaign layer is a
-- PUBLICATION (visible_to_participants makes it world-readable), and a workspace
-- layer is never public — it has no publication switch and no anon anything.
--
-- THREE TABLES, NOT ONE, BECAUSE RE-UPLOADING IS THE NORMAL CASE. Parcels are
-- republished annually. "2025 parcels vs 2026 parcels" is a real planning
-- question, and a layer that is overwritten cannot answer it. So identity and
-- style live on the LAYER, and every upload is a VERSION under it: old versions
-- stay readable and switchable, and current_version_id says which one the maps
-- draw. Retrofitting versioning after the first agency has uploaded is far more
-- expensive than the extra table now.
--
-- THE VERSION ROW IS ALSO THE INGEST JOB. There is no separate jobs table: a
-- county parcel shapefile is 50-200 MB, far past any serverless request body, so
-- the browser parses and reprojects it locally and POSTs features in batches
-- against the version it opened. Two records — a job and the version it
-- produces — could disagree about how many features arrived; one record cannot.
-- `ingest_status = 'ready'` is CHECK-constrained to mean feature_count reached
-- the count the client declared up front, so a half-uploaded layer can never
-- present as complete, whatever the route code does.
--
-- HOW THE COORDINATE REFERENCE SYSTEM IS RECORDED, AND THE ONE NEW BASIS.
-- srs_basis carries the engagement vocabulary unchanged, plus two members that
-- only exist because this lane accepts what that one refuses:
--   * 'planner_asserted' — the file had no .prj and a NAMED PERSON chose the
--     system from the registry. srs_asserted_by/at are then NOT NULL, enforced
--     both ways: an assertion must name its author, and evidence (a .prj, a spec
--     default) may never carry one. That is the claim-tier line drawn in SQL —
--     an assertion cannot be laundered into evidence by an UPDATE.
--   * 'gdal_detected' — a conversion worker read the system out of a format
--     OpenPlan cannot parse in-process (.gdb, .mdb). Still evidence from the
--     file, still not a person's guess.
-- reprojection_engine records WHO moved the coordinates ('openplan' in-browser,
-- 'gdal' in a worker, 'none' for data already in WGS84), because two engines
-- that could disagree must be distinguishable on the record years later.

------------------------------------------------------------------------------
-- 1. LAYERS — identity, scope, and how the layer draws.
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workspace_gis_layers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  -- NULL = agency-wide, which is the common case for a basemap-style layer
  -- (city limits, zoning). A project id narrows it, mirroring how the Document
  -- Library treats project scope: the scope is a filter, never a wall.
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,

  -- The legend entry. An unlabelled line teaches a planner nothing.
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  description TEXT,

  -- HOW IT DRAWS. Four controls, deliberately not a Mapbox style JSON: a style
  -- language in a text column is a second product to maintain and a way to put
  -- arbitrary expressions into a map render path.
  --
  -- The swatch and the line are the same value, as in engagement: a legend that
  -- can disagree with the map is worse than no legend.
  display_color TEXT NOT NULL DEFAULT '#94a3b8'
    CHECK (display_color ~ '^#[0-9a-fA-F]{6}$'),
  display_opacity NUMERIC NOT NULL DEFAULT 0.8
    CHECK (display_opacity > 0 AND display_opacity <= 1),
  display_line_width NUMERIC NOT NULL DEFAULT 1.5
    CHECK (display_line_width > 0 AND display_line_width <= 12),

  -- Which ATTRIBUTE labels the shapes on the map, or NULL for no labels (the
  -- default). Free text on purpose: it names a field in the planner's own file,
  -- which is data, not a vocabulary this schema may fix. Whether the field still
  -- exists is a property of the CURRENT VERSION and is disclosed by the reader,
  -- never repaired silently — a label that quietly stops rendering because a new
  -- upload renamed a column is a map that changed what it says with no notice.
  label_field TEXT CHECK (label_field IS NULL OR btrim(label_field) <> ''),

  -- Uploading is not switching on. A layer the planner has not chosen to see
  -- must not appear under their project records the next time they open a map.
  default_visible BOOLEAN NOT NULL DEFAULT FALSE,

  -- Draw order WITHIN the workspace-layer group only. Workspace layers always
  -- sit beneath OpenPlan's own feature layers; this cannot lift one above them.
  sort_order INTEGER NOT NULL DEFAULT 0,

  -- Which upload the maps draw. NULL until the first version finalizes, so a
  -- layer whose first ingest is still running (or failed) draws nothing rather
  -- than drawing a partial one. Constrained by trigger below: it may only ever
  -- point at a READY version OF THIS LAYER.
  current_version_id UUID,

  -- Offered wherever deletion is refused. An adopted plan citing a layer must
  -- keep resolving, so the honest alternative to deleting is putting it away.
  archived_at TIMESTAMPTZ,

  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Two live layers with the same name give a planner two identical toggles.
-- Archived names are released: an agency that archived "Parcels (2019)" and
-- calls the new upload "Parcels" must not be blocked by a layer nobody draws.
CREATE UNIQUE INDEX IF NOT EXISTS workspace_gis_layers_unique_live_name
  ON public.workspace_gis_layers(workspace_id, lower(btrim(name)))
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS workspace_gis_layers_workspace_idx
  ON public.workspace_gis_layers(workspace_id, sort_order, created_at);

-- The map panel's read: live layers for this workspace, in draw order.
CREATE INDEX IF NOT EXISTS workspace_gis_layers_live_idx
  ON public.workspace_gis_layers(workspace_id, sort_order)
  WHERE archived_at IS NULL;

------------------------------------------------------------------------------
-- 2. VERSIONS — one row per upload, and the ingest job that produced it.
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workspace_gis_layer_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  layer_id UUID NOT NULL REFERENCES public.workspace_gis_layers(id) ON DELETE CASCADE,
  -- Denormalized from the layer for the same reason engagement_context_layers
  -- denormalizes it: every policy below keys off it, and reaching the workspace
  -- through a subquery on the parent would run that subquery per row.
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  -- 1, 2, 3 … within the layer. What the planner sees in the version history.
  version_number INTEGER NOT NULL CHECK (version_number >= 1),

  -- WHERE IT CAME FROM, kept so a layer can be re-explained years later.
  source_format TEXT NOT NULL
    CHECK (source_format IN ('geojson', 'kml', 'kmz', 'shapefile_zip', 'file_geodatabase')),
  source_filename TEXT NOT NULL CHECK (btrim(source_filename) <> ''),
  source_byte_size BIGINT NOT NULL CHECK (source_byte_size >= 0),

  -- WHERE THE ORIGINAL FILE IS KEPT, when it is kept.
  --
  -- NOTHING WRITES THESE YET, AND THAT IS DELIBERATE RATHER THAN FORGOTTEN.
  -- Retaining the upload means a browser-direct-to-storage transfer (the file
  -- is 200 MB; no request body will carry it), which is a transport this
  -- repository does not yet have anywhere. Shipping the bucket and the columns
  -- with no writer would be a capability that exists in the schema and nowhere
  -- a planner can reach. So the columns stand, constrained to be both-or-
  -- neither, and every reader answers "the original is not held" honestly until
  -- the retention lane lands. `hasStoredSource` in the TypeScript contract is
  -- derived from storage_bucket for exactly that reason.
  storage_bucket TEXT,
  storage_path TEXT,

  -- THE COORDINATE REFERENCE SYSTEM AND HOW IT WAS ESTABLISHED. See the header:
  -- 'planner_asserted' is the only member that is not evidence from the file,
  -- and it is the only one allowed to carry an author.
  srs_authority TEXT,
  srs_code TEXT,
  srs_name TEXT NOT NULL CHECK (btrim(srs_name) <> ''),
  srs_basis TEXT NOT NULL
    CHECK (srs_basis IN (
      'prj_file',
      'geojson_crs_member',
      'geojson_rfc7946_default',
      'kml_specification',
      'gdal_detected',
      'planner_asserted'
    )),
  srs_asserted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  srs_asserted_at TIMESTAMPTZ,

  -- WHO MOVED THE COORDINATES. 'none' means the source was already WGS84.
  reprojection_engine TEXT NOT NULL DEFAULT 'none'
    CHECK (reprojection_engine IN ('none', 'openplan', 'gdal')),

  -- THE PERMANENT DATUM CAVEAT, or NULL when there is nothing to say. A NAD27
  -- layer transformed without a NADCON grid can sit ~100 m from truth in the
  -- western US; that sentence rides with the layer everywhere it appears, and
  -- the person who accepted it is recorded. Accepting a known, disclosed error
  -- is what keeps the "super old shapefiles" a planning department actually
  -- holds usable; hiding it would be the defect.
  datum_shift_note TEXT,
  datum_acknowledged_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  datum_acknowledged_at TIMESTAMPTZ,

  -- WHAT IS DRAWABLE, so a panel can describe a layer without loading geometry.
  geometry_kinds TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  -- THE ATTRIBUTE SCHEMA the planner can label and inspect by: an array of
  -- {name, type} objects read from the file (a shapefile's .dbf header, a
  -- GeoJSON's property keys). Data, not a vocabulary — no field-name registry.
  attribute_fields JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(attribute_fields) = 'array'),
  -- Which character encoding the attribute text was read as, and whether that
  -- was the file's own declaration (.cpg) or OpenPlan's fallback. A planner
  -- seeing mojibake in a street name needs to know which of the two happened.
  attribute_encoding TEXT,
  attribute_encoding_is_fallback BOOLEAN NOT NULL DEFAULT FALSE,

  -- THE DISCLOSURE CONTRACT, field for field with MapLayerDisclosure and with
  -- engagement_context_layers, so all three read as one vocabulary. Counted in
  -- SHAPES (one drawn geometry each), not source features.
  --
  -- declared_feature_count is what the CLIENT said it would send when it opened
  -- the ingest, computed after drops and after the operator cap. feature_count
  -- is what actually arrived. 'ready' requires them equal — that is the whole
  -- completion rule, and it is in the database rather than in a route.
  declared_feature_count INTEGER NOT NULL CHECK (declared_feature_count >= 0),
  feature_count INTEGER NOT NULL DEFAULT 0 CHECK (feature_count >= 0),
  source_feature_count INTEGER NOT NULL CHECK (source_feature_count >= 0),
  dropped_feature_count INTEGER NOT NULL DEFAULT 0 CHECK (dropped_feature_count >= 0),
  truncated BOOLEAN NOT NULL DEFAULT FALSE,

  -- [west, south, east, north] in WGS84, or NULL when nothing drawable survived.
  bbox JSONB,

  ingest_status TEXT NOT NULL DEFAULT 'receiving'
    CHECK (ingest_status IN ('receiving', 'ready', 'failed')),
  -- A FIXED failure vocabulary, never a free-form message: the sentence a
  -- planner reads is written in TypeScript from this code, so a raw driver
  -- error can never reach a screen as an explanation.
  ingest_failure_reason TEXT
    CHECK (ingest_failure_reason IS NULL OR ingest_failure_reason IN (
      'abandoned',
      'client_reported_failure',
      'feature_cap_exceeded',
      'geometry_rejected',
      'worker_conversion_failed'
    )),
  finalized_at TIMESTAMPTZ,

  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT workspace_gis_layer_versions_unique_number UNIQUE (layer_id, version_number),

  -- Bytes are held, or they are not. A path with no bucket is a dangling
  -- reference nothing can dereference.
  CONSTRAINT workspace_gis_layer_versions_storage_is_whole CHECK (
    (storage_bucket IS NULL) = (storage_path IS NULL)
  ),

  -- THE CLAIM-TIER LINE, IN SQL, BOTH DIRECTIONS. An assertion must name the
  -- person who made it; evidence read from a file must not pretend someone
  -- asserted it. An UPDATE that promoted 'planner_asserted' to 'prj_file'
  -- while leaving the author behind fails here rather than quietly turning one
  -- planner's guess into the file's own testimony.
  CONSTRAINT workspace_gis_layer_versions_assertion_has_an_author CHECK (
    (srs_basis = 'planner_asserted')
      = (srs_asserted_by IS NOT NULL AND srs_asserted_at IS NOT NULL)
  ),

  -- Nobody can acknowledge a caveat that was never recorded.
  CONSTRAINT workspace_gis_layer_versions_acknowledgement_needs_a_note CHECK (
    datum_acknowledged_by IS NULL OR datum_shift_note IS NOT NULL
  ),

  -- Same arithmetic as buildMapLayerDisclosure: what was kept plus what was
  -- dropped fell short of what the file held.
  CONSTRAINT workspace_gis_layer_versions_truncation_coherent CHECK (
    truncated = ((declared_feature_count + dropped_feature_count) < source_feature_count)
  ),
  CONSTRAINT workspace_gis_layer_versions_counts_coherent CHECK (
    (declared_feature_count + dropped_feature_count) <= source_feature_count
  ),

  -- THE COMPLETION RULE. A version is 'ready' only when every feature it
  -- promised arrived. No route can mark a half-uploaded layer complete, and a
  -- crashed browser leaves a version stuck at 'receiving' — visibly unfinished
  -- — instead of a layer with holes in it that nothing distinguishes from a
  -- layer that genuinely ends there.
  CONSTRAINT workspace_gis_layer_versions_ready_is_complete CHECK (
    ingest_status <> 'ready'
      OR (finalized_at IS NOT NULL AND feature_count = declared_feature_count)
  ),
  CONSTRAINT workspace_gis_layer_versions_failure_has_a_reason CHECK (
    (ingest_status = 'failed') = (ingest_failure_reason IS NOT NULL)
  ),
  CONSTRAINT workspace_gis_layer_versions_never_overfills CHECK (
    feature_count <= declared_feature_count
  )
);

CREATE INDEX IF NOT EXISTS workspace_gis_layer_versions_layer_idx
  ON public.workspace_gis_layer_versions(layer_id, version_number DESC);

CREATE INDEX IF NOT EXISTS workspace_gis_layer_versions_workspace_idx
  ON public.workspace_gis_layer_versions(workspace_id, created_at DESC);

-- The reaper's read: ingests that stopped responding.
CREATE INDEX IF NOT EXISTS workspace_gis_layer_versions_receiving_idx
  ON public.workspace_gis_layer_versions(created_at)
  WHERE ingest_status = 'receiving';

-- The circular reference, added after both tables exist. ON DELETE SET NULL:
-- deleting the drawn version un-draws the layer rather than deleting it.
ALTER TABLE public.workspace_gis_layers
  DROP CONSTRAINT IF EXISTS workspace_gis_layers_current_version_fk;
ALTER TABLE public.workspace_gis_layers
  ADD CONSTRAINT workspace_gis_layers_current_version_fk
  FOREIGN KEY (current_version_id)
  REFERENCES public.workspace_gis_layer_versions(id) ON DELETE SET NULL;

------------------------------------------------------------------------------
-- 3. WHAT A LAYER MAY POINT AT — enforced, not conventional.
------------------------------------------------------------------------------
-- A foreign key says current_version_id names a version. It cannot say the
-- version belongs to THIS layer, or that its ingest ever finished. Both of
-- those are how a map silently starts drawing a partial upload — or another
-- layer's geometry — so both are checked here, on the write, in one place.
CREATE OR REPLACE FUNCTION public.workspace_gis_current_version_is_drawable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_layer_id UUID;
  v_status   TEXT;
BEGIN
  IF NEW.current_version_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT layer_id, ingest_status
    INTO v_layer_id, v_status
    FROM public.workspace_gis_layer_versions
   WHERE id = NEW.current_version_id;

  IF v_layer_id IS NULL THEN
    RAISE EXCEPTION 'workspace_gis_layers.current_version_id % names no version', NEW.current_version_id;
  END IF;

  IF v_layer_id <> NEW.id THEN
    RAISE EXCEPTION 'workspace_gis_layers.current_version_id % belongs to layer %, not %',
      NEW.current_version_id, v_layer_id, NEW.id;
  END IF;

  IF v_status <> 'ready' THEN
    RAISE EXCEPTION 'workspace_gis_layers.current_version_id % is %, not ready — a layer may not draw an unfinished upload',
      NEW.current_version_id, v_status;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.workspace_gis_current_version_is_drawable() IS
  'Refuses a current_version_id that names another layer''s version or one whose ingest has not finished. A layer may only ever draw a complete upload of its own.';

DROP TRIGGER IF EXISTS workspace_gis_layers_current_version_guard ON public.workspace_gis_layers;
CREATE TRIGGER workspace_gis_layers_current_version_guard
  BEFORE INSERT OR UPDATE OF current_version_id ON public.workspace_gis_layers
  FOR EACH ROW EXECUTE FUNCTION public.workspace_gis_current_version_is_drawable();

------------------------------------------------------------------------------
-- 4. ROW SECURITY. Members read; writing members write. anon gets nothing:
-- workspace layers are never public, and there is no publication switch to
-- make them so — that is the deliberate difference from the engagement table.
------------------------------------------------------------------------------
ALTER TABLE public.workspace_gis_layers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_gis_layer_versions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'workspace_gis_layers'
      AND policyname = 'workspace_gis_layers_member_read'
  ) THEN
    CREATE POLICY workspace_gis_layers_member_read
      ON public.workspace_gis_layers
      FOR SELECT USING (
        workspace_id IN (
          SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'workspace_gis_layers'
      AND policyname = 'workspace_gis_layers_writer_insert'
  ) THEN
    CREATE POLICY workspace_gis_layers_writer_insert
      ON public.workspace_gis_layers
      FOR INSERT WITH CHECK (
        public.workspace_member_can_write(workspace_id)
        AND created_by = auth.uid()
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'workspace_gis_layers'
      AND policyname = 'workspace_gis_layers_writer_update'
  ) THEN
    CREATE POLICY workspace_gis_layers_writer_update
      ON public.workspace_gis_layers
      FOR UPDATE
      USING (public.workspace_member_can_write(workspace_id))
      WITH CHECK (public.workspace_member_can_write(workspace_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'workspace_gis_layers'
      AND policyname = 'workspace_gis_layers_writer_delete'
  ) THEN
    CREATE POLICY workspace_gis_layers_writer_delete
      ON public.workspace_gis_layers
      FOR DELETE USING (public.workspace_member_can_write(workspace_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'workspace_gis_layer_versions'
      AND policyname = 'workspace_gis_layer_versions_member_read'
  ) THEN
    CREATE POLICY workspace_gis_layer_versions_member_read
      ON public.workspace_gis_layer_versions
      FOR SELECT USING (
        workspace_id IN (
          SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'workspace_gis_layer_versions'
      AND policyname = 'workspace_gis_layer_versions_writer_insert'
  ) THEN
    CREATE POLICY workspace_gis_layer_versions_writer_insert
      ON public.workspace_gis_layer_versions
      FOR INSERT WITH CHECK (
        public.workspace_member_can_write(workspace_id)
        AND created_by = auth.uid()
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'workspace_gis_layer_versions'
      AND policyname = 'workspace_gis_layer_versions_writer_update'
  ) THEN
    CREATE POLICY workspace_gis_layer_versions_writer_update
      ON public.workspace_gis_layer_versions
      FOR UPDATE
      USING (public.workspace_member_can_write(workspace_id))
      WITH CHECK (public.workspace_member_can_write(workspace_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'workspace_gis_layer_versions'
      AND policyname = 'workspace_gis_layer_versions_writer_delete'
  ) THEN
    CREATE POLICY workspace_gis_layer_versions_writer_delete
      ON public.workspace_gis_layer_versions
      FOR DELETE USING (public.workspace_member_can_write(workspace_id));
  END IF;
END
$$;

-- 20260804000001 made new tables born with no client grants at all. These are
-- the doors the policies above promise; without them PostgREST answers
-- `permission denied` before RLS is ever consulted.
REVOKE ALL ON TABLE public.workspace_gis_layers FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.workspace_gis_layer_versions FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.workspace_gis_layers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.workspace_gis_layer_versions TO authenticated;
GRANT ALL ON TABLE public.workspace_gis_layers TO service_role;
GRANT ALL ON TABLE public.workspace_gis_layer_versions TO service_role;

COMMENT ON TABLE public.workspace_gis_layers IS
  'An agency''s own GIS layer — bike network, city limits, zoning, parcels — uploaded once and drawable on every map in the workspace. Identity and style only; geometry lives in workspace_gis_features under a version. Never public: no publication switch, no anon policy, no anon grant.';

COMMENT ON TABLE public.workspace_gis_layer_versions IS
  'One upload of a layer, and the ingest job that produced it. ingest_status = ''ready'' is CHECK-constrained to mean feature_count reached the declared count, so a partially uploaded layer can never present as complete. srs_basis records how the coordinate system was established; ''planner_asserted'' is the only member that is not evidence from the file, and it must name the person who asserted it.';

COMMENT ON COLUMN public.workspace_gis_layer_versions.srs_basis IS
  'How the coordinate reference system was established: ''prj_file'', ''geojson_crs_member'', ''geojson_rfc7946_default'', ''kml_specification'', ''gdal_detected'' (a conversion worker read it from a format OpenPlan cannot parse in-process), or ''planner_asserted'' (the file carried none and a named person chose it from the CRS registry). There is no value meaning "assumed". An assertion carries srs_asserted_by/at and evidence never does — enforced by CHECK in both directions, so an assertion cannot be promoted to evidence by an UPDATE.';

COMMENT ON COLUMN public.workspace_gis_layer_versions.datum_shift_note IS
  'The permanent positional caveat this layer carries everywhere it appears, or NULL when there is none. Set for pre-NAD83 data (NAD27 without a NADCON grid can sit ~100 m from truth in the western US) and recorded with the person who accepted it. Disclosed rather than refused, because these are exactly the legacy files a planning department holds.';

COMMENT ON COLUMN public.workspace_gis_layer_versions.reprojection_engine IS
  '''none'' (source was already WGS84), ''openplan'' (reprojected in-process by the CRS registry) or ''gdal'' (reprojected by a conversion worker using PROJ). Two engines that could disagree about where a shape lands must be distinguishable on the record.';
