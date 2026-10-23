-- Procedural readiness accepts current managed custody without creating a
-- scientific claim. Reports still verifies full selected bytes on Save/Generate.
BEGIN;

-- Keep immutability, four-link census and legacy decisions on the original
-- invoker path. Only managed scientific custody moves to a private trigger.
CREATE OR REPLACE FUNCTION public.refuse_bound_comparison_snapshot_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
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
        -- Managed custody is checked by the private trigger below. These
        -- public-row reads and all original legacy checks retain caller RLS.
        AND NOT EXISTS (
          SELECT 1 FROM public.model_runs run
          WHERE run.id = link.model_run_id AND run.attempt_managed
        )
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

-- No ordinary role can call this function or read private custody through it.
-- Trigger execution returns only the unchanged pending snapshot row. The
-- original invoker checks, snapshot policies and full population trigger remain.
CREATE FUNCTION public.validate_managed_comparison_readiness()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_link public.scenario_comparison_model_run_links%ROWTYPE;
  v_run public.model_runs%ROWTYPE;
  v_set public.scenario_sets%ROWTYPE;
  v_instrument public.model_attempt_instrument_custody%ROWTYPE;
  v_projection jsonb;
  v_reference record;
  v_invoker text := coalesce(nullif(current_setting('role', true), 'none'), session_user);
BEGIN
  IF TG_NARGS <> 0 OR TG_TABLE_SCHEMA <> 'public'
     OR TG_TABLE_NAME <> 'scenario_comparison_snapshots' OR TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'Invalid managed comparison readiness trigger context';
  END IF;
  IF OLD.status <> 'draft' OR NEW.status <> 'ready' THEN RETURN NEW; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.scenario_set_id IS DISTINCT FROM OLD.scenario_set_id THEN
    RAISE EXCEPTION 'evidence-bound comparison snapshot semantics are immutable';
  END IF;
  -- Legacy and ordinary comparisons keep their complete existing role path.
  -- The preceding population trigger holds the relevant run locks.
  IF NOT EXISTS (SELECT 1 FROM public.scenario_comparison_model_run_links link
    JOIN public.model_runs run ON run.id = link.model_run_id
    WHERE link.comparison_snapshot_id = OLD.id AND run.attempt_managed) THEN RETURN NEW; END IF;
  SELECT * INTO STRICT v_set FROM public.scenario_sets WHERE id = NEW.scenario_set_id;
  -- Match the existing snapshot UPDATE membership policy, using the real SQL
  -- invoker role rather than caller-controlled JWT role metadata. Hold ordinary
  -- membership through admission. RLS still decides the outer UPDATE itself.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles role
      WHERE role.rolname = v_invoker AND (role.rolsuper OR role.rolbypassrls)) THEN
    PERFORM 1 FROM public.workspace_members member
      WHERE member.workspace_id = v_set.workspace_id AND member.user_id = auth.uid() FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Comparison snapshot membership is required' USING ERRCODE = '42501'; END IF;
  END IF;
    -- Lifecycle commands lock the parent before changing attempts or outputs.
    -- Keep that authority fixed through this readiness update and the existing
    -- full population validator, which already ran in this same statement.
    PERFORM run.id FROM public.model_runs run
      WHERE run.id IN (SELECT link.model_run_id FROM public.scenario_comparison_model_run_links link
        WHERE link.comparison_snapshot_id = OLD.id)
      ORDER BY run.id FOR SHARE;
    FOR v_link IN SELECT link.* FROM public.scenario_comparison_model_run_links link
      WHERE link.comparison_snapshot_id = OLD.id ORDER BY link.model_run_id, link.id
    LOOP
      SELECT * INTO STRICT v_run FROM public.model_runs WHERE id = v_link.model_run_id;
      IF NOT v_run.attempt_managed THEN CONTINUE; END IF;

      IF v_link.workspace_id IS DISTINCT FROM v_set.workspace_id
         OR v_run.workspace_id IS DISTINCT FROM v_link.workspace_id OR v_run.status <> 'succeeded'
         OR v_run.project_id IS DISTINCT FROM v_set.project_id
         OR v_run.scenario_set_id IS DISTINCT FROM NEW.scenario_set_id
         OR v_run.scenario_entry_id IS DISTINCT FROM (CASE v_link.scenario_role
           WHEN 'baseline' THEN NEW.baseline_entry_id ELSE NEW.candidate_entry_id END) THEN
        RAISE EXCEPTION 'managed comparison requires exact current inconclusive instrument custody';
      END IF;
      -- Use the installed selector, including its named producer policy. Do not
      -- treat retained, invalid or merely running evidence as completed output.
      v_projection := public.read_model_attempt_outputs(v_run.id, v_link.workspace_id);
      IF (SELECT count(*) FROM public.model_attempt_instrument_custody instrument
          WHERE instrument.workspace_id = v_link.workspace_id AND instrument.model_run_id = v_run.id
            AND instrument.demand_method = v_link.method
            AND instrument.model_output_artifact_id = v_link.model_run_artifact_id
            AND instrument.model_output_sha256 = v_link.artifact_sha256) <> 1 THEN
        RAISE EXCEPTION 'managed comparison requires exact current inconclusive instrument custody';
      END IF;
      SELECT * INTO STRICT v_instrument FROM public.model_attempt_instrument_custody instrument
        WHERE instrument.workspace_id = v_link.workspace_id AND instrument.model_run_id = v_run.id
          AND instrument.demand_method = v_link.method
          AND instrument.model_output_artifact_id = v_link.model_run_artifact_id
          AND instrument.model_output_sha256 = v_link.artifact_sha256;
      -- The command and its installed insert validator bind all five v2 types,
      -- schemas and hashes. Its immutable exact receipt proves that admission.
      -- Compare the timestamp as an instant across session time zones.
      IF v_instrument.scientific_outcome IS DISTINCT FROM 'inconclusive'
         OR NOT EXISTS (SELECT 1 FROM public.model_attempt_instrument_receipts receipt
           WHERE receipt.response_payload - 'created_at' = to_jsonb(v_instrument) - 'created_at'
             AND (receipt.response_payload->>'created_at')::timestamptz = v_instrument.created_at) THEN
        RAISE EXCEPTION 'managed comparison requires exact current inconclusive instrument custody';
      END IF;
      FOR v_reference IN SELECT * FROM (VALUES
        (v_instrument.model_output_artifact_id, v_instrument.model_output_sha256),
        (v_instrument.input_bundle_artifact_id, v_instrument.input_bundle_sha256),
        (v_instrument.match_audit_artifact_id, v_instrument.match_audit_sha256),
        (v_instrument.comparison_basis_artifact_id, v_instrument.comparison_basis_sha256),
        (v_instrument.assessment_artifact_id, v_instrument.assessment_sha256),
        (v_instrument.diagnosis_artifact_id, v_instrument.diagnosis_sha256)
      ) AS refs(artifact_id, artifact_sha256)
      LOOP
        IF NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_projection->'outputs') projected
          JOIN public.model_run_artifacts artifact ON artifact.id = v_reference.artifact_id
          WHERE projected->>'kind' = 'artifact'
            AND projected->>'ownership_state' = 'current_completed'
            AND projected->'record' = to_jsonb(artifact)
            AND artifact.run_id = v_run.id AND artifact.stage_id = v_instrument.stage_id
            AND artifact.attempt_id = v_instrument.attempt_id
            AND artifact.content_hash = v_reference.artifact_sha256
            AND artifact.file_size_bytes > 0 AND length(btrim(artifact.file_url)) > 0
        ) THEN
          RAISE EXCEPTION 'managed comparison requires exact current inconclusive instrument custody';
        END IF;
      END LOOP;
    END LOOP;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.validate_managed_comparison_readiness() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.validate_managed_comparison_readiness() FROM PUBLIC, anon, authenticated, service_role;
-- Run after zz_validate_common_population_comparison_snapshot. Its complete
-- scope, writer-role and population checks precede any private custody read.
CREATE TRIGGER zzz_validate_managed_comparison_readiness
BEFORE UPDATE ON public.scenario_comparison_snapshots
FOR EACH ROW EXECUTE FUNCTION public.validate_managed_comparison_readiness();

COMMIT;
