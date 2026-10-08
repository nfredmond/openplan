-- Recovery candidate only. Not an installed application migration.
CREATE TABLE public.model_assessment_command_receipts (
 request_id uuid PRIMARY KEY,
 run_id uuid NOT NULL REFERENCES public.model_runs(id),
 request_payload jsonb NOT NULL,
 response_payload jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.model_assessment_command_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.model_assessment_command_receipts FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.record_legacy_model_assessment(p_request uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 saved public.model_assessment_command_receipts%ROWTYPE;
 parent public.model_runs%ROWTYPE;
 assessment public.modeling_validation_assessments%ROWTYPE;
 workspace uuid; run uuid; stage uuid; artifact uuid; artifacts jsonb; result jsonb;
 field text; prefix text;
 fields text[]:=ARRAY['p_workspace_id','p_model_run_id','p_stage_id','p_track','p_model_output_artifact_id',
  'p_validation_input_file_url','p_validation_input_size','p_validation_input_sha256','p_validation_input_metadata',
  'p_comparison_basis_file_url','p_comparison_basis_size','p_comparison_basis_sha256','p_comparison_basis_metadata',
  'p_assessment_file_url','p_assessment_size','p_assessment_sha256','p_assessment_metadata',
  'p_partition','p_planning_use','p_scientific_outcome','p_reasons'];
BEGIN
 IF p_request IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
  OR NOT(p_payload ?& fields) OR (p_payload-fields)<>'{}'::jsonb THEN
  RAISE EXCEPTION 'Invalid retained assessment fields';
 END IF;
 FOREACH field IN ARRAY ARRAY['p_workspace_id','p_model_run_id','p_stage_id','p_model_output_artifact_id'] LOOP
  IF jsonb_typeof(p_payload->field) IS DISTINCT FROM 'string'
   OR p_payload->>field !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
   RAISE EXCEPTION 'Invalid retained assessment identity';
  END IF;
 END LOOP;
 FOREACH prefix IN ARRAY ARRAY['p_validation_input','p_comparison_basis','p_assessment'] LOOP
  IF jsonb_typeof(p_payload->(prefix||'_file_url')) IS DISTINCT FROM 'string'
   OR btrim(p_payload->>(prefix||'_file_url'))=''
   OR jsonb_typeof(p_payload->(prefix||'_size')) IS DISTINCT FROM 'number'
   OR p_payload->>(prefix||'_size') !~ '^[0-9]+$'
   OR jsonb_typeof(p_payload->(prefix||'_sha256')) IS DISTINCT FROM 'string'
   OR p_payload->>(prefix||'_sha256') !~ '^[0-9a-f]{64}$'
   OR jsonb_typeof(p_payload->(prefix||'_metadata')) IS DISTINCT FROM 'object' THEN
   RAISE EXCEPTION 'Invalid retained assessment artifact fields';
  END IF;
 END LOOP;
 IF p_payload->>'p_track' NOT IN('assignment','behavioral_demand')
  OR jsonb_typeof(p_payload->'p_track') IS DISTINCT FROM 'string'
  OR p_payload->>'p_scientific_outcome' NOT IN('pass','fail','inconclusive')
  OR jsonb_typeof(p_payload->'p_scientific_outcome') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'p_planning_use') IS DISTINCT FROM 'string'
  OR btrim(p_payload->>'p_planning_use')=''
  OR jsonb_typeof(p_payload->'p_partition') IS DISTINCT FROM 'object'
  OR jsonb_typeof(p_payload->'p_reasons') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Invalid retained assessment scope or outcome';
 END IF;
 workspace:=(p_payload->>'p_workspace_id')::uuid; run:=(p_payload->>'p_model_run_id')::uuid;
 stage:=(p_payload->>'p_stage_id')::uuid; artifact:=(p_payload->>'p_model_output_artifact_id')::uuid;
 PERFORM pg_advisory_xact_lock(hashtextextended('model-assessment-command:'||p_request::text,0));
 SELECT * INTO saved FROM public.model_assessment_command_receipts WHERE request_id=p_request;
 IF FOUND THEN
  IF saved.request_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'Assessment request payload changed'; END IF;
  RETURN saved.response_payload;
 END IF;
 SELECT * INTO parent FROM public.model_runs WHERE id=run FOR UPDATE;
 IF NOT FOUND OR parent.workspace_id IS DISTINCT FROM workspace THEN RAISE EXCEPTION 'Assessment command workspace mismatch'; END IF;
 IF parent.attempt_managed THEN RAISE EXCEPTION 'Managed assessment requires attempt-bound ingestion'; END IF;
 IF parent.status IN('failed','cancelled') THEN RAISE EXCEPTION 'Stopped run cannot record new assessment'; END IF;
 SELECT * INTO assessment FROM public.record_modeling_validation_assessment(
  workspace,run,stage,p_payload->>'p_track',artifact,
  p_payload->>'p_validation_input_file_url',(p_payload->>'p_validation_input_size')::bigint,p_payload->>'p_validation_input_sha256',p_payload->'p_validation_input_metadata',
  p_payload->>'p_comparison_basis_file_url',(p_payload->>'p_comparison_basis_size')::bigint,p_payload->>'p_comparison_basis_sha256',p_payload->'p_comparison_basis_metadata',
  p_payload->>'p_assessment_file_url',(p_payload->>'p_assessment_size')::bigint,p_payload->>'p_assessment_sha256',p_payload->'p_assessment_metadata',
  p_payload->'p_partition',p_payload->>'p_planning_use',p_payload->>'p_scientific_outcome',p_payload->'p_reasons');
 SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) INTO artifacts FROM public.model_run_artifacts a
  WHERE id IN(assessment.validation_input_bundle_artifact_id,assessment.comparison_basis_artifact_id,assessment.model_validation_assessment_artifact_id);
 result:=jsonb_build_object('request_id',p_request,'assessment',to_jsonb(assessment),'artifacts',artifacts);
 INSERT INTO public.model_assessment_command_receipts(request_id,run_id,request_payload,response_payload)
 VALUES(p_request,run,p_payload,result);
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.record_legacy_model_assessment(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_legacy_model_assessment(uuid,jsonb) TO service_role;
