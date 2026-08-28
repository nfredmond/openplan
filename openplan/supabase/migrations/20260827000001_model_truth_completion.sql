-- Complete exact guided-model custody, immutable ready snapshots, and launch-geometry truth.

ALTER TABLE public.scenario_comparison_model_run_links
  ADD COLUMN model_run_artifact_id uuid REFERENCES public.model_run_artifacts(id) ON DELETE RESTRICT,
  ADD COLUMN assignment_profile_sha256 text,
  ADD COLUMN network_settings_sha256 text,
  ADD COLUMN network_state_sha256 text,
  ADD COLUMN scenario_assumptions_json jsonb;

ALTER TABLE public.scenario_comparison_model_run_links
  ADD CONSTRAINT scenario_comparison_model_run_links_profile_sha256
    CHECK (assignment_profile_sha256 IS NULL OR assignment_profile_sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT scenario_comparison_model_run_links_settings_sha256
    CHECK (network_settings_sha256 IS NULL OR network_settings_sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT scenario_comparison_model_run_links_state_sha256
    CHECK (network_state_sha256 IS NULL OR network_state_sha256 ~ '^[0-9a-f]{64}$');

CREATE UNIQUE INDEX scenario_comparison_model_run_links_artifact_unique
  ON public.scenario_comparison_model_run_links(comparison_snapshot_id, model_run_artifact_id)
  WHERE model_run_artifact_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.model_truth_canonical_jsonb(value jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_catalog
AS $$
DECLARE
  result text;
BEGIN
  CASE jsonb_typeof(value)
    WHEN 'object' THEN
      SELECT '{' || coalesce(string_agg(to_jsonb(item.key)::text || ':' || public.model_truth_canonical_jsonb(item.value), ',' ORDER BY item.key), '') || '}'
        INTO result
        FROM jsonb_each(value) AS item;
    WHEN 'array' THEN
      SELECT '[' || coalesce(string_agg(public.model_truth_canonical_jsonb(item.value), ',' ORDER BY item.ordinality), '') || ']'
        INTO result
        FROM jsonb_array_elements(value) WITH ORDINALITY AS item(value, ordinality);
    ELSE
      result := value::text;
  END CASE;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_scenario_comparison_model_run_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
  v_snapshot public.scenario_comparison_snapshots%ROWTYPE;
  v_set public.scenario_sets%ROWTYPE;
  v_run public.model_runs%ROWTYPE;
  v_model public.models%ROWTYPE;
  v_artifact public.model_run_artifacts%ROWTYPE;
  v_stage public.model_run_stages%ROWTYPE;
  v_expected_entry uuid;
  v_expected_assumptions jsonb;
  v_expected_engine text;
  v_expected_stage text;
  v_profile_payload text;
  v_settings_payload text;
  v_state_record jsonb;
BEGIN
  IF NEW.model_run_artifact_id IS NULL
     OR NEW.assignment_profile_sha256 IS NULL
     OR NEW.network_settings_sha256 IS NULL
     OR NEW.network_state_sha256 IS NULL
     OR NEW.scenario_assumptions_json IS NULL THEN
    RAISE EXCEPTION 'comparison link is missing exact artifact, network, or assumption custody';
  END IF;

  SELECT * INTO v_snapshot FROM public.scenario_comparison_snapshots WHERE id = NEW.comparison_snapshot_id;
  IF v_snapshot.id IS NULL THEN RAISE EXCEPTION 'comparison snapshot does not exist'; END IF;
  SELECT * INTO v_set FROM public.scenario_sets WHERE id = v_snapshot.scenario_set_id;
  SELECT * INTO v_run FROM public.model_runs WHERE id = NEW.model_run_id;
  SELECT * INTO v_model FROM public.models WHERE id = v_run.model_id;
  SELECT * INTO v_artifact FROM public.model_run_artifacts WHERE id = NEW.model_run_artifact_id;
  SELECT * INTO v_stage FROM public.model_run_stages WHERE id = v_artifact.stage_id;

  IF v_set.id IS NULL OR v_run.id IS NULL OR v_model.id IS NULL OR v_artifact.id IS NULL OR v_stage.id IS NULL THEN
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
     OR v_model.config_json ->> 'method' <> NEW.method
     OR v_model.config_json -> 'networkBasis' IS DISTINCT FROM
       '{"kind":"worker_osm_snapshot","source":"OpenStreetMap","identity":"network_state_digest","comparisonRule":"exact_digest_match"}'::jsonb THEN
    RAISE EXCEPTION 'comparison link does not match the complete guided model contract';
  END IF;

  v_expected_entry := CASE WHEN NEW.scenario_role = 'baseline'
    THEN v_snapshot.baseline_entry_id ELSE v_snapshot.candidate_entry_id END;
  SELECT assumptions_json INTO v_expected_assumptions
    FROM public.scenario_entries WHERE id = v_expected_entry AND scenario_set_id = v_set.id;
  IF NOT FOUND OR v_run.scenario_entry_id IS DISTINCT FROM v_expected_entry OR v_run.status <> 'succeeded' THEN
    RAISE EXCEPTION 'comparison link does not name the succeeded run for its scenario role';
  END IF;
  IF coalesce(v_run.assumption_snapshot_json, '{}'::jsonb) IS DISTINCT FROM coalesce(v_expected_assumptions, '{}'::jsonb)
     OR NEW.scenario_assumptions_json IS DISTINCT FROM coalesce(v_expected_assumptions, '{}'::jsonb) THEN
    RAISE EXCEPTION 'comparison link assumptions do not exactly match the current scenario and run snapshot';
  END IF;

  v_expected_engine := CASE NEW.method WHEN 'aequilibrae' THEN 'aequilibrae' ELSE 'behavioral_demand' END;
  v_expected_stage := CASE NEW.method WHEN 'aequilibrae' THEN 'Artifact Extraction' ELSE 'ActivitySim Network Assignment' END;
  IF v_run.engine_key <> v_expected_engine OR v_stage.run_id <> v_run.id OR v_stage.status <> 'succeeded' OR v_stage.stage_name <> v_expected_stage THEN
    RAISE EXCEPTION 'comparison link engine or succeeded output stage does not match its method';
  END IF;
  IF v_artifact.run_id <> v_run.id OR v_artifact.artifact_type <> NEW.artifact_type
     OR v_artifact.content_hash <> NEW.artifact_sha256
     OR v_artifact.content_hash !~ '^[0-9a-f]{64}$'
     OR v_artifact.file_url IS NULL OR length(trim(v_artifact.file_url)) = 0
     OR v_artifact.file_size_bytes IS NULL OR v_artifact.file_size_bytes <= 0 THEN
    RAISE EXCEPTION 'comparison link does not match its exact verified output artifact';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.model_run_artifacts newer
    WHERE newer.run_id = v_run.id
      AND newer.artifact_type = NEW.artifact_type
      AND (newer.created_at, newer.id) > (v_artifact.created_at, v_artifact.id)
  ) THEN
    RAISE EXCEPTION 'comparison link must bind the deterministic latest method artifact';
  END IF;

  v_profile_payload := v_artifact.metadata_json ->> 'assignment_profile_payload_json';
  v_settings_payload := v_artifact.metadata_json ->> 'network_settings_payload_json';
  v_state_record := v_artifact.metadata_json -> 'network_state_record';
  IF v_artifact.metadata_json ->> 'assignment_profile_digest' <> NEW.assignment_profile_sha256
     OR v_artifact.metadata_json ->> 'network_settings_digest' <> NEW.network_settings_sha256
     OR v_artifact.metadata_json ->> 'network_state_digest' <> NEW.network_state_sha256
     OR v_profile_payload IS NULL OR v_profile_payload::jsonb IS DISTINCT FROM v_artifact.metadata_json -> 'assignment_profile'
     OR encode(extensions.digest(convert_to(v_profile_payload, 'UTF8'), 'sha256'), 'hex') <> NEW.assignment_profile_sha256
     OR v_settings_payload IS NULL OR v_settings_payload::jsonb IS DISTINCT FROM v_artifact.metadata_json -> 'network_settings'
     OR encode(extensions.digest(convert_to(v_settings_payload, 'UTF8'), 'sha256'), 'hex') <> NEW.network_settings_sha256
     OR v_state_record IS NULL
     OR v_state_record ->> 'network_settings_digest' <> NEW.network_settings_sha256
     OR encode(extensions.digest(convert_to(public.model_truth_canonical_jsonb(v_state_record), 'UTF8'), 'sha256'), 'hex') <> NEW.network_state_sha256 THEN
    RAISE EXCEPTION 'comparison link artifact identity is missing, corrupt, or inconsistent';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.scenario_comparison_model_run_links peer
    WHERE peer.comparison_snapshot_id = NEW.comparison_snapshot_id
      AND (peer.assignment_profile_sha256 IS DISTINCT FROM NEW.assignment_profile_sha256
        OR peer.network_settings_sha256 IS DISTINCT FROM NEW.network_settings_sha256
        OR peer.network_state_sha256 IS DISTINCT FROM NEW.network_state_sha256)
  ) THEN
    RAISE EXCEPTION 'all four comparison outputs must share exact assignment and network identity';
  END IF;
  RETURN NEW;
EXCEPTION WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'comparison link artifact payload is not valid JSON';
END;
$$;

CREATE OR REPLACE FUNCTION public.refuse_bound_model_artifact_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  IF EXISTS (
    SELECT 1 FROM public.scenario_comparison_model_run_links link
    WHERE link.model_run_artifact_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'a comparison-bound model artifact is immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER refuse_bound_model_artifact_update
BEFORE UPDATE ON public.model_run_artifacts
FOR EACH ROW EXECUTE FUNCTION public.refuse_bound_model_artifact_change();

CREATE TRIGGER refuse_bound_model_artifact_delete
BEFORE DELETE ON public.model_run_artifacts
FOR EACH ROW EXECUTE FUNCTION public.refuse_bound_model_artifact_change();

CREATE OR REPLACE FUNCTION public.refuse_bound_comparison_snapshot_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.scenario_comparison_model_run_links link
    WHERE link.comparison_snapshot_id = OLD.id
  ) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'an evidence-bound comparison snapshot is immutable'; END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'updated_at']) THEN
    RAISE EXCEPTION 'evidence-bound comparison snapshot semantics are immutable';
  END IF;
  IF NOT ((OLD.status = 'draft' AND NEW.status = 'ready') OR (OLD.status = 'ready' AND NEW.status = 'archived') OR OLD.status = NEW.status) THEN
    RAISE EXCEPTION 'evidence-bound comparison snapshot status transition is invalid';
  END IF;
  IF OLD.status = 'draft' AND NEW.status = 'ready' THEN
    IF (SELECT count(*) FROM public.scenario_comparison_model_run_links link WHERE link.comparison_snapshot_id = OLD.id) <> 4 THEN
      RAISE EXCEPTION 'a ready guided comparison requires all four exact model-run links';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.scenario_comparison_model_run_links link
      WHERE link.comparison_snapshot_id = OLD.id
        AND NOT EXISTS (
          SELECT 1 FROM public.modeling_claim_decisions decision
          WHERE decision.model_run_id = link.model_run_id
            AND decision.track = CASE link.method WHEN 'aequilibrae' THEN 'assignment' ELSE 'behavioral_demand' END
        )
    ) THEN
      RAISE EXCEPTION 'all four exact guided runs need track-matched validation decisions';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER refuse_bound_comparison_snapshot_update
BEFORE UPDATE ON public.scenario_comparison_snapshots
FOR EACH ROW EXECUTE FUNCTION public.refuse_bound_comparison_snapshot_change();

CREATE TRIGGER refuse_bound_comparison_snapshot_delete
BEFORE DELETE ON public.scenario_comparison_snapshots
FOR EACH ROW EXECUTE FUNCTION public.refuse_bound_comparison_snapshot_change();

CREATE OR REPLACE FUNCTION public.refuse_bound_comparison_delta_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_snapshot_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.comparison_snapshot_id ELSE NEW.comparison_snapshot_id END;
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  IF EXISTS (
    SELECT 1 FROM public.scenario_comparison_model_run_links link
    WHERE link.comparison_snapshot_id = v_snapshot_id
  ) THEN
    RAISE EXCEPTION 'evidence-bound comparison indicator deltas are immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER refuse_bound_comparison_delta_insert
BEFORE INSERT ON public.scenario_comparison_indicator_deltas
FOR EACH ROW EXECUTE FUNCTION public.refuse_bound_comparison_delta_change();

CREATE TRIGGER refuse_bound_comparison_delta_update
BEFORE UPDATE ON public.scenario_comparison_indicator_deltas
FOR EACH ROW EXECUTE FUNCTION public.refuse_bound_comparison_delta_change();

CREATE TRIGGER refuse_bound_comparison_delta_delete
BEFORE DELETE ON public.scenario_comparison_indicator_deltas
FOR EACH ROW EXECUTE FUNCTION public.refuse_bound_comparison_delta_change();

REVOKE EXECUTE ON FUNCTION public.project_modeling_study_area_readiness(uuid) FROM authenticated, service_role;

CREATE OR REPLACE FUNCTION public.project_modeling_study_area_readiness(
  p_project_id uuid,
  p_run_geometry jsonb
)
RETURNS TABLE(state text, tract_count bigint, detail text)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
  v_stored_geometry jsonb;
  v_source text;
  v_kind text;
  v_ref text;
  v_stored_area public.geometry;
  v_run_area public.geometry;
  v_tract_count bigint;
  v_coverage_count bigint := 0;
BEGIN
  SELECT project.place_geometry_geojson, project.place_source, project.place_kind, project.place_ref
    INTO v_stored_geometry, v_source, v_kind, v_ref
    FROM public.projects project WHERE project.id = p_project_id;
  IF NOT FOUND THEN RETURN QUERY SELECT 'project_not_found', 0::bigint, 'The project could not be read.'; RETURN; END IF;
  IF v_stored_geometry IS NULL THEN
    RETURN QUERY SELECT 'missing_geometry', 0::bigint, 'Set this project''s study area before starting a worker model run.'; RETURN;
  END IF;
  IF p_run_geometry IS NULL THEN
    RETURN QUERY SELECT 'missing_run_geometry', 0::bigint, 'The launched worker run has no study-area geometry.'; RETURN;
  END IF;

  BEGIN
    v_stored_area := public.ST_SetSRID(public.ST_GeomFromGeoJSON(v_stored_geometry::text), 4326);
    v_run_area := public.ST_SetSRID(public.ST_GeomFromGeoJSON(p_run_geometry::text), 4326);
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'invalid_geometry', 0::bigint, 'The stored or launched project study area is not usable geometry.'; RETURN;
  END;
  IF v_stored_area IS NULL OR v_run_area IS NULL OR public.ST_IsEmpty(v_stored_area) OR public.ST_IsEmpty(v_run_area)
     OR NOT public.ST_IsValid(v_stored_area) OR NOT public.ST_IsValid(v_run_area) THEN
    RETURN QUERY SELECT 'invalid_geometry', 0::bigint, 'The stored or launched project study area is empty or invalid.'; RETURN;
  END IF;
  IF NOT public.ST_Equals(v_stored_area, v_run_area) THEN
    RETURN QUERY SELECT 'run_geometry_mismatch', 0::bigint,
      'The launched geometry does not exactly match this project''s saved study area. Save or launch the intended project boundary.'; RETURN;
  END IF;

  SELECT count(*)::bigint INTO v_tract_count
    FROM public.census_tracts tract
    WHERE tract.geometry IS NOT NULL AND public.ST_IsValid(tract.geometry)
      AND public.ST_Intersects(tract.geometry, v_run_area);
  IF v_tract_count > 0 THEN
    RETURN QUERY SELECT 'ready', v_tract_count, format('%s usable Census tract(s) intersect the exact launched project study area.', v_tract_count); RETURN;
  END IF;

  IF v_source = 'tigerweb' AND v_ref ~ '^[0-9]{5}$' AND v_kind = 'county' THEN
    SELECT count(*)::bigint INTO v_coverage_count FROM public.census_tracts tract
      WHERE tract.state_fips = left(v_ref, 2) AND tract.county_fips = right(v_ref, 3);
  ELSIF v_source = 'tigerweb' AND v_ref ~ '^[0-9]{2,7}$' AND v_kind IN ('city', 'cdp', 'place') THEN
    SELECT count(*)::bigint INTO v_coverage_count FROM public.census_tracts tract
      WHERE tract.state_fips = left(v_ref, 2);
  ELSE
    RETURN QUERY SELECT 'tract_coverage_unknown', 0::bigint,
      'No tract intersects the exact launched area, and this custom or multi-state boundary has no complete loaded-coverage registry.'; RETURN;
  END IF;

  IF v_coverage_count = 0 THEN
    RETURN QUERY SELECT 'tract_coverage_not_loaded', 0::bigint,
      'Census tract coverage for this project geography is not loaded.'; RETURN;
  END IF;
  RETURN QUERY SELECT 'outside_loaded_tract_coverage', 0::bigint,
    'Tract coverage for the recorded jurisdiction is loaded, but the exact launched area falls outside it.';
END;
$$;

REVOKE ALL ON FUNCTION public.project_modeling_study_area_readiness(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.project_modeling_study_area_readiness(uuid, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.project_modeling_study_area_readiness(uuid, jsonb) IS
  'Checks the actual launched project geometry, requires it to equal the saved project area, and distinguishes missing tract coverage from an area outside loaded coverage.';
