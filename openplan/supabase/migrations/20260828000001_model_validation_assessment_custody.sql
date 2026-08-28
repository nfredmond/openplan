-- Rules-v4 model validation custody. Fresh assessments bind exact inputs and
-- outputs; historical rules 1-3 rows remain untouched in their existing tables.

CREATE TABLE public.modeling_validation_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  model_run_id uuid NOT NULL REFERENCES public.model_runs(id) ON DELETE RESTRICT,
  track text NOT NULL CHECK (track IN ('assignment', 'behavioral_demand')),
  model_output_artifact_id uuid NOT NULL REFERENCES public.model_run_artifacts(id) ON DELETE RESTRICT,
  validation_input_bundle_artifact_id uuid NOT NULL REFERENCES public.model_run_artifacts(id) ON DELETE RESTRICT,
  comparison_basis_artifact_id uuid NOT NULL REFERENCES public.model_run_artifacts(id) ON DELETE RESTRICT,
  model_validation_assessment_artifact_id uuid NOT NULL REFERENCES public.model_run_artifacts(id) ON DELETE RESTRICT,
  comparison_basis_sha256 text NOT NULL CHECK (comparison_basis_sha256 ~ '^[0-9a-f]{64}$'),
  validation_rules_version integer NOT NULL CHECK (validation_rules_version = 4),
  partition_json jsonb NOT NULL,
  planning_use text NOT NULL,
  scientific_outcome text NOT NULL CHECK (scientific_outcome IN ('pass', 'fail', 'inconclusive')),
  reasons_json jsonb NOT NULL CHECK (jsonb_typeof(reasons_json) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (model_validation_assessment_artifact_id)
);

CREATE INDEX modeling_validation_assessments_run_idx
  ON public.modeling_validation_assessments(model_run_id, created_at DESC);
CREATE INDEX modeling_validation_assessments_workspace_idx
  ON public.modeling_validation_assessments(workspace_id, created_at DESC);

ALTER TABLE public.modeling_validation_assessments ENABLE ROW LEVEL SECURITY;

CREATE POLICY modeling_validation_assessments_member_read
  ON public.modeling_validation_assessments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members member
      WHERE member.workspace_id = modeling_validation_assessments.workspace_id
        AND member.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.model_runs run
      WHERE run.id = modeling_validation_assessments.model_run_id
        AND run.workspace_id = modeling_validation_assessments.workspace_id
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.modeling_validation_assessments FROM anon, authenticated;
GRANT SELECT ON public.modeling_validation_assessments TO authenticated;

CREATE OR REPLACE FUNCTION public.validate_modeling_validation_assessment_custody()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
  v_run public.model_runs%ROWTYPE;
  v_output public.model_run_artifacts%ROWTYPE;
  v_input public.model_run_artifacts%ROWTYPE;
  v_basis public.model_run_artifacts%ROWTYPE;
  v_assessment public.model_run_artifacts%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.model_runs WHERE id = NEW.model_run_id;
  SELECT * INTO v_output FROM public.model_run_artifacts WHERE id = NEW.model_output_artifact_id;
  SELECT * INTO v_input FROM public.model_run_artifacts WHERE id = NEW.validation_input_bundle_artifact_id;
  SELECT * INTO v_basis FROM public.model_run_artifacts WHERE id = NEW.comparison_basis_artifact_id;
  SELECT * INTO v_assessment FROM public.model_run_artifacts WHERE id = NEW.model_validation_assessment_artifact_id;

  IF v_run.id IS NULL OR v_run.workspace_id <> NEW.workspace_id THEN
    RAISE EXCEPTION 'validation assessment run and workspace do not match';
  END IF;
  IF v_output.id IS NULL OR v_input.id IS NULL OR v_basis.id IS NULL OR v_assessment.id IS NULL
     OR v_output.run_id <> NEW.model_run_id OR v_input.run_id <> NEW.model_run_id
     OR v_basis.run_id <> NEW.model_run_id OR v_assessment.run_id <> NEW.model_run_id THEN
    RAISE EXCEPTION 'every bound validation artifact must belong to the same run';
  END IF;
  IF v_output.content_hash IS NULL OR v_output.content_hash !~ '^[0-9a-f]{64}$'
     OR v_input.content_hash IS NULL OR v_input.content_hash !~ '^[0-9a-f]{64}$'
     OR v_basis.content_hash IS NULL OR v_basis.content_hash !~ '^[0-9a-f]{64}$'
     OR v_assessment.content_hash IS NULL OR v_assessment.content_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'every bound validation artifact requires an exact SHA-256';
  END IF;
  IF v_input.artifact_type <> 'validation_input_bundle'
     OR v_basis.artifact_type <> 'model_comparison_basis'
     OR v_assessment.artifact_type <> 'model_validation_assessment' THEN
    RAISE EXCEPTION 'validation assessment artifact types do not match the custody contract';
  END IF;
  IF v_input.metadata_json->>'schema' IS DISTINCT FROM 'openplan.validation-input-bundle.v1'
     OR v_basis.metadata_json->>'schema' IS DISTINCT FROM 'openplan.model-comparison-basis.v1'
     OR v_assessment.metadata_json->>'schema' IS DISTINCT FROM 'openplan.model-validation-assessment.v1' THEN
    RAISE EXCEPTION 'validation assessment artifact schemas do not match the custody contract';
  END IF;
  IF v_basis.content_hash IS DISTINCT FROM NEW.comparison_basis_sha256
     OR v_input.metadata_json->>'comparison_basis_sha256' IS DISTINCT FROM NEW.comparison_basis_sha256
     OR v_assessment.metadata_json->>'comparison_basis_sha256' IS DISTINCT FROM NEW.comparison_basis_sha256 THEN
    RAISE EXCEPTION 'comparison basis hash does not match every bound artifact';
  END IF;
  IF (v_assessment.metadata_json->>'rules_version')::integer IS DISTINCT FROM NEW.validation_rules_version
     OR v_assessment.metadata_json->>'scientific_outcome' IS DISTINCT FROM NEW.scientific_outcome
     OR v_assessment.metadata_json->>'planning_use' IS DISTINCT FROM NEW.planning_use
     OR v_assessment.metadata_json->'partition' IS DISTINCT FROM NEW.partition_json
     OR v_assessment.metadata_json->'reasons' IS DISTINCT FROM NEW.reasons_json THEN
    RAISE EXCEPTION 'model validation assessment custody hash or outcome mismatch';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_modeling_validation_assessment_custody() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_modeling_validation_assessment_custody() TO service_role;

CREATE TRIGGER validate_modeling_validation_assessment_custody
BEFORE INSERT ON public.modeling_validation_assessments
FOR EACH ROW EXECUTE FUNCTION public.validate_modeling_validation_assessment_custody();

CREATE OR REPLACE FUNCTION public.refuse_modeling_validation_assessment_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'model validation assessment custody is append-only';
END;
$$;

REVOKE ALL ON FUNCTION public.refuse_modeling_validation_assessment_mutation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refuse_modeling_validation_assessment_mutation() TO service_role;

CREATE TRIGGER refuse_modeling_validation_assessment_mutation
BEFORE UPDATE OR DELETE ON public.modeling_validation_assessments
FOR EACH ROW EXECUTE FUNCTION public.refuse_modeling_validation_assessment_mutation();

CREATE OR REPLACE FUNCTION public.refuse_bound_model_validation_artifact_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.modeling_validation_assessments custody
    WHERE OLD.id IN (
      custody.model_output_artifact_id,
      custody.validation_input_bundle_artifact_id,
      custody.comparison_basis_artifact_id,
      custody.model_validation_assessment_artifact_id
    )
  ) THEN
    RAISE EXCEPTION 'artifact is bound to immutable model validation assessment custody';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.refuse_bound_model_validation_artifact_mutation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refuse_bound_model_validation_artifact_mutation() TO service_role;

CREATE TRIGGER refuse_bound_model_validation_artifact_mutation
BEFORE UPDATE OR DELETE ON public.model_run_artifacts
FOR EACH ROW EXECUTE FUNCTION public.refuse_bound_model_validation_artifact_mutation();

CREATE OR REPLACE FUNCTION public.record_modeling_validation_assessment(
  p_workspace_id uuid,
  p_model_run_id uuid,
  p_stage_id uuid,
  p_track text,
  p_model_output_artifact_id uuid,
  p_validation_input_file_url text,
  p_validation_input_size bigint,
  p_validation_input_sha256 text,
  p_validation_input_metadata jsonb,
  p_comparison_basis_file_url text,
  p_comparison_basis_size bigint,
  p_comparison_basis_sha256 text,
  p_comparison_basis_metadata jsonb,
  p_assessment_file_url text,
  p_assessment_size bigint,
  p_assessment_sha256 text,
  p_assessment_metadata jsonb,
  p_partition jsonb,
  p_planning_use text,
  p_scientific_outcome text,
  p_reasons jsonb
)
RETURNS public.modeling_validation_assessments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
  v_input_id uuid;
  v_basis_id uuid;
  v_assessment_id uuid;
  v_row public.modeling_validation_assessments%ROWTYPE;
BEGIN
  IF p_stage_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.model_run_stages stage
    WHERE stage.id = p_stage_id AND stage.run_id = p_model_run_id
  ) THEN
    RAISE EXCEPTION 'validation assessment stage does not belong to the run';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.model_runs run
    WHERE run.id = p_model_run_id AND run.workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'validation assessment run does not belong to the workspace';
  END IF;

  INSERT INTO public.model_run_artifacts (
    run_id, stage_id, artifact_type, file_url, file_size_bytes, content_hash, metadata_json
  ) VALUES (
    p_model_run_id, p_stage_id, 'validation_input_bundle', p_validation_input_file_url,
    p_validation_input_size, p_validation_input_sha256, p_validation_input_metadata
  ) RETURNING id INTO v_input_id;

  INSERT INTO public.model_run_artifacts (
    run_id, stage_id, artifact_type, file_url, file_size_bytes, content_hash, metadata_json
  ) VALUES (
    p_model_run_id, p_stage_id, 'model_comparison_basis', p_comparison_basis_file_url,
    p_comparison_basis_size, p_comparison_basis_sha256, p_comparison_basis_metadata
  ) RETURNING id INTO v_basis_id;

  INSERT INTO public.model_run_artifacts (
    run_id, stage_id, artifact_type, file_url, file_size_bytes, content_hash, metadata_json
  ) VALUES (
    p_model_run_id, p_stage_id, 'model_validation_assessment', p_assessment_file_url,
    p_assessment_size, p_assessment_sha256, p_assessment_metadata
  ) RETURNING id INTO v_assessment_id;

  INSERT INTO public.modeling_validation_assessments (
    workspace_id, model_run_id, track, model_output_artifact_id,
    validation_input_bundle_artifact_id, comparison_basis_artifact_id,
    model_validation_assessment_artifact_id, comparison_basis_sha256,
    validation_rules_version, partition_json, planning_use, scientific_outcome, reasons_json
  ) VALUES (
    p_workspace_id, p_model_run_id, p_track, p_model_output_artifact_id,
    v_input_id, v_basis_id, v_assessment_id, p_comparison_basis_sha256,
    4, p_partition, p_planning_use, p_scientific_outcome, p_reasons
  ) RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.record_modeling_validation_assessment(
  uuid, uuid, uuid, text, uuid,
  text, bigint, text, jsonb,
  text, bigint, text, jsonb,
  text, bigint, text, jsonb,
  jsonb, text, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_modeling_validation_assessment(
  uuid, uuid, uuid, text, uuid,
  text, bigint, text, jsonb,
  text, bigint, text, jsonb,
  text, bigint, text, jsonb,
  jsonb, text, text, jsonb
) TO service_role;

COMMENT ON TABLE public.modeling_validation_assessments IS
  'Append-only custody binding one rules-v4 scientific assessment to exact model output, validation input, comparison basis, and assessment artifacts.';

-- Resolve the exact launched polygon against the geography OpenPlan already
-- stores, rather than guessing a state from a bounding box.  The function
-- deliberately returns every intersected subdivision and no preferred/first
-- one.  `census_tracts` is the existing nationwide/territory geography spine;
-- an empty result is unresolved coverage, never evidence that the polygon is
-- outside the United States.
CREATE OR REPLACE FUNCTION public.resolve_modeling_observed_count_geography(
  p_run_geometry jsonb
)
RETURNS TABLE(state text, state_fips_json jsonb, tract_count bigint, detail text)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
  v_run_area public.geometry;
BEGIN
  IF p_run_geometry IS NULL THEN
    RETURN QUERY SELECT 'unresolved', '[]'::jsonb, 0::bigint,
      'The launched model run has no study-area geometry.';
    RETURN;
  END IF;

  BEGIN
    v_run_area := public.ST_SetSRID(public.ST_GeomFromGeoJSON(p_run_geometry::text), 4326);
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'unresolved', '[]'::jsonb, 0::bigint,
      'The launched study-area geometry could not be resolved.';
    RETURN;
  END;

  IF v_run_area IS NULL OR public.ST_IsEmpty(v_run_area)
     OR NOT public.ST_IsValid(v_run_area)
     OR public.GeometryType(v_run_area) NOT IN ('POLYGON', 'MULTIPOLYGON') THEN
    RETURN QUERY SELECT 'unresolved', '[]'::jsonb, 0::bigint,
      'The launched study area is not a valid polygon.';
    RETURN;
  END IF;

  RETURN QUERY
  WITH intersected AS (
    SELECT tract.state_fips
    FROM public.census_tracts tract
    WHERE tract.geometry IS NOT NULL
      AND public.ST_IsValid(tract.geometry)
      AND public.ST_Intersects(tract.geometry, v_run_area)
  ), subdivisions AS (
    SELECT DISTINCT state_fips
    FROM intersected
    WHERE state_fips ~ '^[0-9]{2}$'
  )
  SELECT
    CASE WHEN EXISTS (SELECT 1 FROM subdivisions) THEN 'resolved' ELSE 'unresolved' END,
    COALESCE((SELECT jsonb_agg(state_fips ORDER BY state_fips) FROM subdivisions), '[]'::jsonb),
    (SELECT count(*)::bigint FROM intersected),
    CASE
      WHEN EXISTS (SELECT 1 FROM subdivisions)
        THEN 'Every Census subdivision intersecting the exact launched polygon is frozen in the run snapshot.'
      ELSE 'No loaded Census tract intersects the exact launched polygon; its subdivision is unresolved.'
    END;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_modeling_observed_count_geography(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_modeling_observed_count_geography(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.resolve_modeling_observed_count_geography(jsonb) IS
  'Returns every loaded US subdivision intersecting an exact model-run polygon; never selects a first state or infers non-US from an empty result.';
