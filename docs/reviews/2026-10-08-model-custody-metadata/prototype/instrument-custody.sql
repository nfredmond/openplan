CREATE TABLE public.model_attempt_instrument_custody (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  model_run_id uuid NOT NULL REFERENCES public.model_runs(id) ON DELETE RESTRICT,
  input_bundle_artifact_id uuid NOT NULL UNIQUE REFERENCES public.model_run_artifacts(id) ON DELETE RESTRICT,
  match_audit_artifact_id uuid NOT NULL UNIQUE REFERENCES public.model_run_artifacts(id) ON DELETE RESTRICT,
  comparison_basis_artifact_id uuid NOT NULL UNIQUE REFERENCES public.model_run_artifacts(id) ON DELETE RESTRICT,
  assessment_artifact_id uuid NOT NULL UNIQUE REFERENCES public.model_run_artifacts(id) ON DELETE RESTRICT,
  diagnosis_artifact_id uuid NOT NULL UNIQUE REFERENCES public.model_run_artifacts(id) ON DELETE RESTRICT,
  input_bundle_sha256 text NOT NULL CHECK (input_bundle_sha256 ~ '^[0-9a-f]{64}$'),
  match_audit_sha256 text NOT NULL CHECK (match_audit_sha256 ~ '^[0-9a-f]{64}$'),
  comparison_basis_sha256 text NOT NULL CHECK (comparison_basis_sha256 ~ '^[0-9a-f]{64}$'),
  assessment_sha256 text NOT NULL CHECK (assessment_sha256 ~ '^[0-9a-f]{64}$'),
  diagnosis_sha256 text NOT NULL CHECK (diagnosis_sha256 ~ '^[0-9a-f]{64}$'),
  scientific_outcome text NOT NULL CHECK (scientific_outcome = 'inconclusive'),
  created_at timestamptz NOT NULL DEFAULT now(),
  attempt_id uuid NOT NULL REFERENCES public.model_stage_attempts(id),
  stage_id uuid NOT NULL REFERENCES public.model_run_stages(id),
  demand_method text NOT NULL CHECK (demand_method IN ('aequilibrae','activitysim')),
  model_output_artifact_id uuid NOT NULL REFERENCES public.model_run_artifacts(id),
  model_output_sha256 text NOT NULL CHECK (model_output_sha256 ~ '^[0-9a-f]{64}$')
);

ALTER TABLE public.model_attempt_instrument_custody ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.model_attempt_instrument_custody FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER validate_model_attempt_instrument BEFORE INSERT ON public.model_attempt_instrument_custody
 FOR EACH ROW EXECUTE FUNCTION public.validate_modeling_validation_instrument_v2_custody();
CREATE TRIGGER refuse_model_attempt_instrument_mutation BEFORE UPDATE OR DELETE ON public.model_attempt_instrument_custody
 FOR EACH ROW EXECUTE FUNCTION public.refuse_modeling_validation_instrument_v2_mutation();
CREATE TABLE public.model_attempt_instrument_receipts (
 request_id uuid PRIMARY KEY,request_payload jsonb NOT NULL,response_payload jsonb NOT NULL
);
ALTER TABLE public.model_attempt_instrument_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.model_attempt_instrument_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.record_model_attempt_instrument(p_request_id uuid,p_attempt_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_request jsonb; v_receipt public.model_attempt_instrument_receipts%ROWTYPE;
 v_attempt public.model_stage_attempts%ROWTYPE; v_run public.model_runs%ROWTYPE;
 v_stage public.model_run_stages%ROWTYPE; v_artifact public.model_run_artifacts%ROWTYPE;
 v_pair record; v_result public.model_attempt_instrument_custody%ROWTYPE;
BEGIN
 IF p_request_id IS NULL OR p_attempt_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
    OR coalesce(p_payload->>'demand_method','') NOT IN ('aequilibrae','activitysim')
    OR p_payload->>'scientific_outcome' IS DISTINCT FROM 'inconclusive'
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('demand_method','scientific_outcome','model_output_artifact_id','model_output_sha256','input_bundle_artifact_id','input_bundle_sha256','match_audit_artifact_id','match_audit_sha256','comparison_basis_artifact_id','comparison_basis_sha256','assessment_artifact_id','assessment_sha256','diagnosis_artifact_id','diagnosis_sha256')) THEN
  RAISE EXCEPTION 'Invalid attempt instrument payload';
 END IF;
 v_request := jsonb_build_object('attempt_id',p_attempt_id,'payload',p_payload);
 PERFORM pg_advisory_xact_lock(hashtextextended('model-instrument:'||p_request_id::text,0));
 SELECT * INTO v_receipt FROM public.model_attempt_instrument_receipts WHERE request_id=p_request_id;
 IF FOUND THEN
  IF v_receipt.request_payload IS DISTINCT FROM v_request THEN RAISE EXCEPTION 'Instrument request identity reused with different payload'; END IF;
  RETURN v_receipt.response_payload;
 END IF;
 SELECT * INTO v_attempt FROM public.model_stage_attempts WHERE id=p_attempt_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Instrument attempt not found'; END IF;
 SELECT * INTO v_run FROM public.model_runs WHERE id=v_attempt.run_id FOR UPDATE;
 SELECT * INTO v_stage FROM public.model_run_stages WHERE id=v_attempt.stage_id FOR UPDATE;
 IF v_stage.active_attempt_id IS DISTINCT FROM p_attempt_id OR v_stage.status<>'running'
    OR v_run.status NOT IN ('queued','running') OR v_attempt.revoked_at IS NOT NULL THEN
  RAISE EXCEPTION 'Instrument attempt no longer owns work';
 END IF;
 FOR v_pair IN SELECT * FROM (VALUES
  ('model_output'),
  ('input_bundle'),
  ('match_audit'),
  ('comparison_basis'),
  ('assessment'),
  ('diagnosis')
 ) AS refs(prefix) LOOP
  SELECT * INTO v_artifact FROM public.model_run_artifacts WHERE id=(p_payload->>(v_pair.prefix||'_artifact_id'))::uuid;
  IF v_artifact.id IS NULL OR v_artifact.run_id IS DISTINCT FROM v_run.id
     OR v_artifact.stage_id IS DISTINCT FROM v_stage.id OR v_artifact.attempt_id IS DISTINCT FROM p_attempt_id
     OR v_artifact.content_hash IS DISTINCT FROM p_payload->>(v_pair.prefix||'_sha256') THEN
   RAISE EXCEPTION 'Instrument artifact attempt, run, stage or hash mismatch';
  END IF;
  IF v_pair.prefix IN ('model_output','assessment') AND v_artifact.metadata_json->>'demand_method' IS DISTINCT FROM p_payload->>'demand_method' THEN
   RAISE EXCEPTION 'Instrument demand method does not match output and assessment';
  END IF;
 END LOOP;
 INSERT INTO public.model_attempt_instrument_custody(workspace_id,model_run_id,stage_id,attempt_id,demand_method,model_output_artifact_id,model_output_sha256,input_bundle_artifact_id,match_audit_artifact_id,comparison_basis_artifact_id,assessment_artifact_id,diagnosis_artifact_id,input_bundle_sha256,match_audit_sha256,comparison_basis_sha256,assessment_sha256,diagnosis_sha256,scientific_outcome)
 VALUES(v_run.workspace_id,v_run.id,v_stage.id,p_attempt_id,p_payload->>'demand_method',(p_payload->>'model_output_artifact_id')::uuid,p_payload->>'model_output_sha256',(p_payload->>'input_bundle_artifact_id')::uuid,(p_payload->>'match_audit_artifact_id')::uuid,(p_payload->>'comparison_basis_artifact_id')::uuid,(p_payload->>'assessment_artifact_id')::uuid,(p_payload->>'diagnosis_artifact_id')::uuid,p_payload->>'input_bundle_sha256',p_payload->>'match_audit_sha256',p_payload->>'comparison_basis_sha256',p_payload->>'assessment_sha256',p_payload->>'diagnosis_sha256',p_payload->>'scientific_outcome') RETURNING * INTO v_result;
 INSERT INTO public.model_attempt_instrument_receipts VALUES(p_request_id,v_request,to_jsonb(v_result));
 RETURN to_jsonb(v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.record_model_attempt_instrument(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_model_attempt_instrument(uuid,uuid,jsonb) TO service_role;
