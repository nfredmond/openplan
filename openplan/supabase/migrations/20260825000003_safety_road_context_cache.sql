-- Frozen, project-scoped road geometry for Safety context and printable packets.
-- Adapters may cache only the two registered, open US road sources. Safety
-- never calls a live geocoder while presenting a crash location.

CREATE TABLE IF NOT EXISTS public.safety_road_context_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  country_code text NOT NULL DEFAULT 'US' CHECK (country_code = 'US'),
  source_id text NOT NULL CHECK (source_id IN ('us-census-tiger-line-cache', 'osm-network-cache')),
  source_label text NOT NULL,
  source_vintage text NOT NULL,
  source_feature_id text NOT NULL,
  road_name text NOT NULL,
  geometry_geojson jsonb NOT NULL,
  cached_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, project_id, source_id, source_vintage, source_feature_id)
);

CREATE INDEX IF NOT EXISTS safety_road_context_project_idx
  ON public.safety_road_context_features (workspace_id, project_id, cached_at DESC);

ALTER TABLE public.safety_road_context_features ENABLE ROW LEVEL SECURITY;

CREATE POLICY safety_road_context_features_read ON public.safety_road_context_features
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = safety_road_context_features.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

-- These rows are source evidence, not planner-authored content. Adapters write
-- them with the service role; signed-in workspace members can only read them.
REVOKE ALL ON TABLE public.safety_road_context_features FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.safety_road_context_features TO authenticated;
GRANT ALL ON TABLE public.safety_road_context_features TO service_role;

COMMENT ON TABLE public.safety_road_context_features IS
  'Frozen named US road lines used to match Safety concentrations and render local printable context. No live geocoder or paid tile dependency.';
