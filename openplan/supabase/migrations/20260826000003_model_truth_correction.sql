-- Truthful guided model completion and exact comparison custody.

CREATE TABLE public.scenario_comparison_model_run_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  comparison_snapshot_id uuid NOT NULL REFERENCES public.scenario_comparison_snapshots(id) ON DELETE CASCADE,
  model_run_id uuid NOT NULL REFERENCES public.model_runs(id) ON DELETE RESTRICT,
  method text NOT NULL CHECK (method IN ('aequilibrae', 'activitysim')),
  scenario_role text NOT NULL CHECK (scenario_role IN ('baseline', 'build')),
  artifact_type text NOT NULL CHECK (artifact_type IN ('link_volumes', 'activitysim_link_volumes')),
  artifact_sha256 text NOT NULL CHECK (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scenario_comparison_model_run_links_method_artifact CHECK (
    (method = 'aequilibrae' AND artifact_type = 'link_volumes') OR
    (method = 'activitysim' AND artifact_type = 'activitysim_link_volumes')
  ),
  CONSTRAINT scenario_comparison_model_run_links_role_unique
    UNIQUE (comparison_snapshot_id, method, scenario_role),
  CONSTRAINT scenario_comparison_model_run_links_run_unique
    UNIQUE (comparison_snapshot_id, model_run_id)
);

CREATE INDEX scenario_comparison_model_run_links_workspace_idx
  ON public.scenario_comparison_model_run_links(workspace_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.validate_scenario_comparison_model_run_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_snapshot public.scenario_comparison_snapshots%ROWTYPE;
  v_set public.scenario_sets%ROWTYPE;
  v_run public.model_runs%ROWTYPE;
  v_model public.models%ROWTYPE;
  v_expected_entry uuid;
BEGIN
  SELECT * INTO v_snapshot FROM public.scenario_comparison_snapshots WHERE id = NEW.comparison_snapshot_id;
  IF v_snapshot.id IS NULL THEN
    RAISE EXCEPTION 'comparison snapshot does not exist';
  END IF;
  SELECT * INTO v_set FROM public.scenario_sets WHERE id = v_snapshot.scenario_set_id;
  SELECT * INTO v_run FROM public.model_runs WHERE id = NEW.model_run_id;
  SELECT * INTO v_model FROM public.models WHERE id = v_run.model_id;

  IF v_set.id IS NULL OR v_run.id IS NULL OR v_model.id IS NULL THEN
    RAISE EXCEPTION 'comparison link target is incomplete';
  END IF;
  IF NEW.workspace_id <> v_set.workspace_id OR NEW.workspace_id <> v_run.workspace_id OR NEW.workspace_id <> v_model.workspace_id THEN
    RAISE EXCEPTION 'comparison link crosses workspaces';
  END IF;
  IF v_set.project_id IS NULL OR v_model.project_id IS DISTINCT FROM v_set.project_id OR v_run.project_id IS DISTINCT FROM v_set.project_id THEN
    RAISE EXCEPTION 'comparison link must stay on the snapshot project';
  END IF;
  IF v_model.scenario_set_id IS DISTINCT FROM v_set.id OR v_run.scenario_set_id IS DISTINCT FROM v_set.id THEN
    RAISE EXCEPTION 'comparison link must stay on the snapshot scenario set';
  END IF;
  IF v_model.config_json ->> 'guidedProjectComparison' <> 'openplan.project_comparison.v1'
     OR v_model.config_json ->> 'method' <> NEW.method THEN
    RAISE EXCEPTION 'comparison link method does not match the guided model';
  END IF;

  v_expected_entry := CASE WHEN NEW.scenario_role = 'baseline'
    THEN v_snapshot.baseline_entry_id ELSE v_snapshot.candidate_entry_id END;
  IF v_run.scenario_entry_id IS DISTINCT FROM v_expected_entry OR v_run.status <> 'succeeded' THEN
    RAISE EXCEPTION 'comparison link does not name the succeeded run for its scenario role';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.model_run_artifacts artifact
    WHERE artifact.run_id = v_run.id
      AND artifact.artifact_type = NEW.artifact_type
      AND artifact.content_hash = NEW.artifact_sha256
      AND artifact.content_hash ~ '^[0-9a-f]{64}$'
      AND artifact.file_url IS NOT NULL
      AND length(trim(artifact.file_url)) > 0
      AND artifact.file_size_bytes > 0
  ) THEN
    RAISE EXCEPTION 'comparison link does not match a verified output artifact';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_scenario_comparison_model_run_link_before_insert
BEFORE INSERT ON public.scenario_comparison_model_run_links
FOR EACH ROW EXECUTE FUNCTION public.validate_scenario_comparison_model_run_link();

CREATE OR REPLACE FUNCTION public.refuse_scenario_comparison_model_run_link_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'scenario comparison model-run links are append-only';
END;
$$;

CREATE TRIGGER refuse_scenario_comparison_model_run_link_update
BEFORE UPDATE ON public.scenario_comparison_model_run_links
FOR EACH ROW EXECUTE FUNCTION public.refuse_scenario_comparison_model_run_link_change();

CREATE TRIGGER refuse_scenario_comparison_model_run_link_delete
BEFORE DELETE ON public.scenario_comparison_model_run_links
FOR EACH ROW EXECUTE FUNCTION public.refuse_scenario_comparison_model_run_link_change();

ALTER TABLE public.scenario_comparison_model_run_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY scenario_comparison_model_run_links_read
ON public.scenario_comparison_model_run_links FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.workspace_members member
    WHERE member.workspace_id = scenario_comparison_model_run_links.workspace_id
      AND member.user_id = auth.uid()
  )
);

CREATE POLICY scenario_comparison_model_run_links_insert
ON public.scenario_comparison_model_run_links FOR INSERT
WITH CHECK (
  created_by = auth.uid()
  AND public.workspace_member_can_write(workspace_id)
);

REVOKE ALL ON public.scenario_comparison_model_run_links FROM anon;
GRANT SELECT, INSERT ON public.scenario_comparison_model_run_links TO authenticated;
GRANT ALL ON public.scenario_comparison_model_run_links TO service_role;

-- The project place is the sole geography source. This function does not infer
-- a replacement county, bbox, or workspace home geography.
CREATE OR REPLACE FUNCTION public.project_modeling_study_area_readiness(p_project_id uuid)
RETURNS TABLE(state text, tract_count bigint, detail text)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
  v_geometry jsonb;
  v_area public.geometry;
BEGIN
  SELECT project.place_geometry_geojson INTO v_geometry
  FROM public.projects project
  WHERE project.id = p_project_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'project_not_found'::text, 0::bigint, 'The project could not be read.'::text;
    RETURN;
  END IF;
  IF v_geometry IS NULL THEN
    RETURN QUERY SELECT 'missing_geometry'::text, 0::bigint,
      'Set this project''s study area before starting a worker model run.'::text;
    RETURN;
  END IF;

  BEGIN
    v_area := public.ST_SetSRID(public.ST_GeomFromGeoJSON(v_geometry::text), 4326);
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'invalid_geometry'::text, 0::bigint,
      'The stored project study area is not usable geometry. Review and save it again.'::text;
    RETURN;
  END;

  IF v_area IS NULL OR public.ST_IsEmpty(v_area) OR NOT public.ST_IsValid(v_area) THEN
    RETURN QUERY SELECT 'invalid_geometry'::text, 0::bigint,
      'The stored project study area is empty or invalid. Review and save it again.'::text;
    RETURN;
  END IF;

  RETURN QUERY
  WITH usable AS (
    SELECT tract.geoid
    FROM public.census_tracts tract
    WHERE tract.geometry IS NOT NULL
      AND public.ST_IsValid(tract.geometry)
      AND public.ST_Intersects(tract.geometry, v_area)
  ), counted AS (
    SELECT count(*)::bigint AS count FROM usable
  )
  SELECT
    CASE WHEN counted.count > 0 THEN 'ready' ELSE 'no_tracts' END,
    counted.count,
    CASE WHEN counted.count > 0
      THEN format('%s usable Census tract(s) intersect the stored project study area.', counted.count)
      ELSE 'No usable Census tracts intersect the stored project study area. Load tract coverage or repair the area before running.'
    END
  FROM counted;
END;
$$;

REVOKE ALL ON FUNCTION public.project_modeling_study_area_readiness(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.project_modeling_study_area_readiness(uuid) TO authenticated, service_role;

COMMENT ON TABLE public.scenario_comparison_model_run_links IS
  'Append-only custody links binding one guided ready snapshot to the exact four succeeded runs and method-specific output hashes it reviewed.';
COMMENT ON FUNCTION public.project_modeling_study_area_readiness(uuid) IS
  'Fails worker-model preflight closed unless the project''s stored polygon intersects at least one usable Census tract. Never substitutes another geography.';
