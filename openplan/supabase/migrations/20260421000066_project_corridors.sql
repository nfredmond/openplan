-- Phase 3 Slice E — project corridors on the cartographic backdrop.
--
-- Simple display-only corridor table. Mirrors the project-markers pattern
-- from 20260421000065 (workspace-scoped, no network-package scaffolding).
-- Corridors here are planning-level LineStrings a project wants to
-- surface on the shell backdrop — not transportation-modeling network
-- corridors, which live under `network_packages` + `network_corridors`
-- (see 20260318000027 / 20260318000028) and require the full model
-- package chain to seed.
--
-- Geometry is stored as jsonb GeoJSON LineString — cheaper than
-- geography(LineString, 4326), matches the AOI (polygon) and project
-- marker (point) storage shapes, and is read-only for the backdrop so
-- no PostGIS index is needed.

CREATE TABLE IF NOT EXISTS public.project_corridors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  name text NOT NULL,
  corridor_type text NOT NULL DEFAULT 'arterial'
    CHECK (corridor_type IN ('highway', 'arterial', 'transit', 'bike', 'trail', 'custom')),
  los_grade text
    CHECK (los_grade IS NULL OR los_grade IN ('A', 'B', 'C', 'D', 'E', 'F')),
  geometry_geojson jsonb NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_corridors_workspace
  ON public.project_corridors(workspace_id);

CREATE INDEX IF NOT EXISTS idx_project_corridors_project
  ON public.project_corridors(project_id);

ALTER TABLE public.project_corridors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_corridors_select" ON public.project_corridors;
CREATE POLICY "project_corridors_select" ON public.project_corridors
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = project_corridors.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "project_corridors_insert" ON public.project_corridors;
CREATE POLICY "project_corridors_insert" ON public.project_corridors
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = project_corridors.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "project_corridors_update" ON public.project_corridors;
CREATE POLICY "project_corridors_update" ON public.project_corridors
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = project_corridors.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "project_corridors_delete" ON public.project_corridors;
CREATE POLICY "project_corridors_delete" ON public.project_corridors
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = project_corridors.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

COMMENT ON TABLE public.project_corridors IS
  'Display-only corridor LineStrings surfaced on the cartographic backdrop. Not the transportation-modeling network_corridors chain.';
COMMENT ON COLUMN public.project_corridors.geometry_geojson IS
  'GeoJSON LineString object with [lng, lat] coordinate pairs. Validated by isCorridorLineGeoJson at application layer before write / render.';
COMMENT ON COLUMN public.project_corridors.los_grade IS
  'Optional Level-of-Service grade (A-F) used by the backdrop paint to color the line.';
