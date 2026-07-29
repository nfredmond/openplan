-- Operator-supplied GIS context layers for engagement campaigns.
--
-- WHAT WAS MISSING. A resident opening an engagement portal saw a basemap and
-- nothing else. The proposed alignment, the parcel boundaries, the existing bike
-- network, the study limits — none of it could be put on the map the resident
-- draws on. So every comment was collected against a blank slate: "widen it
-- here" with no "it" on screen, and a project manager reasonably concluded
-- OpenPlan could not run their project. This table is the missing half of the
-- participant map.
--
-- WHY THE GEOMETRY LIVES IN A COLUMN AND NOT IN A BUCKET. What the map consumes
-- is a GeoJSON FeatureCollection, and the portal already loads its whole payload
-- in one service-role read. Every existing bucket restricts itself to a mime
-- family that excludes geodata (engagement-photos is images, kb-documents is
-- documents), so a bucket would mean a new bucket plus a second authorization
-- surface in storage.objects plus signed-URL minting — signing, for a resource
-- whose entire purpose is to be world-readable through the share link. The
-- upload is parsed, normalized to WGS84 GeoJSON, and bounded BEFORE it is
-- stored (src/lib/engagement/context-layer-import.ts), so what lands in
-- `features` is a known shape of a known size rather than an opaque blob.
--
-- THE PUBLICATION SWITCH, AND WHY THIS TABLE HAS NO ANON POLICY.
-- `visible_to_participants` defaults to FALSE: uploading a layer is not
-- publishing it. When an operator turns it on, that layer becomes readable by
-- ANYONE holding the campaign's share link — the engagement portal is
-- unauthenticated by design, so "participant-visible" and "world-readable" are
-- the same sentence. A parcel layer with owner names in it would be published
-- to the internet.
--
-- That publication is deliberately NOT expressed as an anon RLS policy. anon
-- gets no policy and no grant on this table at all. Publication happens in ONE
-- place — the service-role portal loader, which filters on
-- `visible_to_participants = true` AND the campaign's own share_token AND
-- status = 'active' — so there is a single, readable, testable statement of
-- what the public can see. An anon SELECT policy would additionally expose
-- every published layer through PostgREST directly to anyone with the project's
-- public anon key, campaign link or not, and would make the "is this public?"
-- question something you answer by reading policy predicates instead of one
-- query. The operator UI states the consequence in words next to the switch;
-- the honesty of that sentence is what makes the default-off meaningful.
--
-- SIZE AND FEATURE BOUNDS ARE OPERATOR CONFIGURATION, NOT A TIER. See
-- src/lib/engagement/context-layers.ts: two optional env vars in the
-- `src/lib/config/run-cap.ts` mould, unset = unlimited. A layer that hit the
-- feature cap stores `truncated = true` and the count it was cut from, because
-- a map that quietly draws 500 of 2,000 parcels tells the resident something
-- false about where the project ends.

CREATE TABLE IF NOT EXISTS public.engagement_context_layers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- workspace_id is denormalized from the campaign on purpose: every policy
  -- below and the shared `workspace_member_can_write` helper key off it, and a
  -- policy that reached the workspace through a subquery on
  -- engagement_campaigns would run that subquery per row of a layer list.
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.engagement_campaigns(id) ON DELETE CASCADE,

  -- WHAT THE RESIDENT READS. The name is the legend entry on the participant
  -- map. An unlabelled blue line teaches a resident nothing, so this is NOT
  -- NULL and the API requires it.
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  description TEXT,

  -- WHERE IT CAME FROM, kept so a layer can be re-explained years later.
  source_format TEXT NOT NULL
    CHECK (source_format IN ('geojson', 'kml', 'kmz', 'shapefile_zip')),
  source_filename TEXT NOT NULL,
  source_byte_size BIGINT NOT NULL CHECK (source_byte_size >= 0),

  -- THE COORDINATE REFERENCE SYSTEM, AND HOW IT WAS ESTABLISHED.
  --
  -- OpenPlan never asks a planner to pick a projection, because most planners do
  -- not know theirs and a wrong guess draws an alignment tens of metres from
  -- where it is. It reads the SRS from the upload — a shapefile's .prj, a legacy
  -- GeoJSON `crs` member — or it relies on a specification that fixes the answer
  -- (RFC 7946 GeoJSON and OGC KML are both WGS84 by definition). If none of
  -- those applies, the upload is REFUSED rather than assumed, so this column can
  -- never mean "we hoped".
  --
  -- `srs_basis` is the audit of that sentence: it names which of those routes
  -- was taken, so a layer that came from a .prj is distinguishable from one that
  -- inherited a spec default.
  srs_authority TEXT,
  srs_code TEXT,
  srs_name TEXT NOT NULL,
  srs_basis TEXT NOT NULL
    CHECK (srs_basis IN (
      'prj_file',
      'geojson_crs_member',
      'geojson_rfc7946_default',
      'kml_specification'
    )),

  -- WHAT IS ACTUALLY DRAWABLE. Point / LineString / Polygon after
  -- normalization, so the operator list and the participant legend can describe
  -- a layer without loading its geometry.
  geometry_kinds TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  -- THE DISCLOSURE CONTRACT, mirroring MapLayerDisclosure in
  -- src/lib/cartographic/layer-disclosure.ts field for field so the two read as
  -- one vocabulary: returned / matched / dropped / truncated.
  --
  -- ALL THREE COUNT SHAPES, NOT SOURCE FEATURES. One shape is one drawn
  -- geometry. A GeoJSON Feature carrying a GeometryCollection is expanded into
  -- one shape per member at import (Mapbox will not draw a GeometryCollection),
  -- so a four-Feature file can legitimately store twelve. Both sides of the
  -- coherence checks below, and both sides of the "showing N of M" sentence the
  -- participant legend renders, are in that one unit — which is why that
  -- sentence says "shapes" rather than "features".
  feature_count INTEGER NOT NULL CHECK (feature_count >= 0),
  source_feature_count INTEGER NOT NULL CHECK (source_feature_count >= 0),
  dropped_feature_count INTEGER NOT NULL DEFAULT 0 CHECK (dropped_feature_count >= 0),
  truncated BOOLEAN NOT NULL DEFAULT FALSE,

  -- The normalized WGS84 GeoJSON FeatureCollection the map draws.
  features JSONB NOT NULL,
  -- [west, south, east, north] in WGS84, or NULL when nothing drawable survived.
  bbox JSONB,

  -- HOW IT DRAWS. One operator-chosen colour per layer, which is also the
  -- legend swatch — a legend whose swatch could disagree with the line is worse
  -- than no legend.
  display_color TEXT NOT NULL DEFAULT '#94a3b8'
    CHECK (display_color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order INTEGER NOT NULL DEFAULT 0,

  -- THE PUBLICATION SWITCH. Default FALSE: see the header. Turning it on
  -- publishes this geometry to anyone with the campaign's share link.
  visible_to_participants BOOLEAN NOT NULL DEFAULT FALSE,

  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Two layers with the same name would produce two identical legend entries
  -- and no way for a resident to tell them apart.
  CONSTRAINT engagement_context_layers_unique_name UNIQUE (campaign_id, name),

  -- Truncation is a derived fact, and deriving it in two places is how the two
  -- come to disagree. Same arithmetic as buildMapLayerDisclosure: what was
  -- fetched (stored + dropped) fell short of what the file held.
  CONSTRAINT engagement_context_layers_truncation_coherent CHECK (
    truncated = ((feature_count + dropped_feature_count) < source_feature_count)
  ),

  CONSTRAINT engagement_context_layers_counts_coherent CHECK (
    (feature_count + dropped_feature_count) <= source_feature_count
  )
);

CREATE INDEX IF NOT EXISTS engagement_context_layers_campaign_idx
  ON public.engagement_context_layers(campaign_id, sort_order, created_at);

-- The participant read: published layers for one campaign, in draw order.
CREATE INDEX IF NOT EXISTS engagement_context_layers_participant_idx
  ON public.engagement_context_layers(campaign_id, sort_order)
  WHERE visible_to_participants;

CREATE INDEX IF NOT EXISTS engagement_context_layers_workspace_idx
  ON public.engagement_context_layers(workspace_id, created_at DESC);

ALTER TABLE public.engagement_context_layers ENABLE ROW LEVEL SECURITY;

-- Reads: any member of the owning workspace, viewers included. A viewer must be
-- able to see what the campaign is publishing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'engagement_context_layers'
      AND policyname = 'engagement_context_layers_member_read'
  ) THEN
    CREATE POLICY engagement_context_layers_member_read
      ON public.engagement_context_layers
      FOR SELECT USING (
        workspace_id IN (
          SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;

-- Writes are ROLE-AWARE rather than membership-only, so they need no companion
-- RESTRICTIVE gate from 20260728000006/7. Publishing a layer to the public
-- internet is unambiguously a write, and the viewer tier's contract is "read
-- everything, change nothing".
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'engagement_context_layers'
      AND policyname = 'engagement_context_layers_writer_insert'
  ) THEN
    CREATE POLICY engagement_context_layers_writer_insert
      ON public.engagement_context_layers
      FOR INSERT WITH CHECK (
        public.workspace_member_can_write(workspace_id)
        AND created_by = auth.uid()
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'engagement_context_layers'
      AND policyname = 'engagement_context_layers_writer_update'
  ) THEN
    CREATE POLICY engagement_context_layers_writer_update
      ON public.engagement_context_layers
      FOR UPDATE
      USING (public.workspace_member_can_write(workspace_id))
      WITH CHECK (public.workspace_member_can_write(workspace_id));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'engagement_context_layers'
      AND policyname = 'engagement_context_layers_writer_delete'
  ) THEN
    CREATE POLICY engagement_context_layers_writer_delete
      ON public.engagement_context_layers
      FOR DELETE USING (public.workspace_member_can_write(workspace_id));
  END IF;
END
$$;

-- anon is granted nothing on purpose. The public portal reads this table
-- through the service role, filtered on visible_to_participants + share_token +
-- active status; that route IS the publication rule. See the header.
REVOKE ALL ON TABLE public.engagement_context_layers FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.engagement_context_layers TO authenticated;
GRANT ALL ON TABLE public.engagement_context_layers TO service_role;

COMMENT ON TABLE public.engagement_context_layers IS
  'Operator-uploaded GIS context (alignments, parcels, existing networks) drawn beneath community input on engagement maps. Geometry is normalized to WGS84 GeoJSON at upload; the SRS is read from the file and the upload is refused when it cannot be established. visible_to_participants = true publishes the layer to anyone holding the campaign share link. Workspace members read; writing members insert, update, and delete; anon has no policy and no grant.';

COMMENT ON COLUMN public.engagement_context_layers.visible_to_participants IS
  'FALSE by default: uploading is not publishing. TRUE means this geometry is served to every unauthenticated visitor holding the campaign share link, i.e. it is world-readable. Enforced by the service-role portal loader, not by an anon policy.';

COMMENT ON COLUMN public.engagement_context_layers.srs_basis IS
  'How the coordinate reference system was established: ''prj_file'' (read from a shapefile .prj), ''geojson_crs_member'' (a legacy GeoJSON crs member naming CRS84/EPSG:4326), ''geojson_rfc7946_default'' (RFC 7946 fixes GeoJSON to WGS84), or ''kml_specification'' (OGC KML fixes coordinates to WGS84). There is no value meaning "assumed" — an undeterminable SRS is refused at upload.';

COMMENT ON COLUMN public.engagement_context_layers.truncated IS
  'TRUE when the operator-configured feature cap stopped the import short of the file''s contents. feature_count/source_feature_count/dropped_feature_count carry the same disclosure vocabulary as MapLayerDisclosure so the participant map can say "showing N of M" rather than silently drawing fewer shapes. All three count SHAPES (one drawn geometry each), not source GeoJSON Features: a Feature holding a GeometryCollection is expanded into one shape per member at import, so the counts and the sentence rendered from them are in the same unit.';

COMMENT ON COLUMN public.engagement_context_layers.dropped_feature_count IS
  'Shapes present in the uploaded file that are not on the map: coordinates outside the valid longitude/latitude range, or a shape type the importer refuses to place rather than place on a guess (a shapefile MultiPatch, for instance, whose only 2D reading would be a wrong one). Never silently zero — an undrawn shape must reach the layer''s legend note.';
