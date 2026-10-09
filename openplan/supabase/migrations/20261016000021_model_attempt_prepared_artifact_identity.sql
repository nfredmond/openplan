-- Preserve artifact identities prepared before managed output registration.
-- Existing rows and receipts stay unchanged; collisions refuse the new insert.
BEGIN;

CREATE OR REPLACE FUNCTION public.write_model_attempt_artifact(p_request_id uuid,p_attempt_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_request jsonb; v_receipt public.model_artifact_write_receipts%ROWTYPE;
 v_attempt public.model_stage_attempts%ROWTYPE; v_run public.model_runs%ROWTYPE;
 v_stage public.model_run_stages%ROWTYPE; v_artifact public.model_run_artifacts%ROWTYPE;
 v_response jsonb; v_id uuid := gen_random_uuid();
BEGIN
 IF p_request_id IS NULL OR p_attempt_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
     OR jsonb_typeof(p_payload->'artifact_type') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_payload->'file_url') IS DISTINCT FROM 'string'
     OR coalesce(p_payload->>'content_hash','') !~ '^[0-9a-f]{64}$'
     OR coalesce(p_payload->>'file_size_bytes','') !~ '^[0-9]+$'
     OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('artifact_type','file_url','file_size_bytes','content_hash','metadata_json','id')) THEN
  RAISE EXCEPTION 'Invalid attempt artifact payload';
 END IF;
 IF p_payload ? 'id' THEN
  IF jsonb_typeof(p_payload->'id') IS DISTINCT FROM 'string'
      OR coalesce(p_payload->>'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
   RAISE EXCEPTION 'Invalid prepared artifact identity';
  END IF;
  v_id := (p_payload->>'id')::uuid;
 END IF;
 v_request := jsonb_build_object('attempt_id',p_attempt_id,'payload',p_payload);
 PERFORM pg_advisory_xact_lock(hashtextextended('model-artifact-write:'||p_request_id::text,0));
 SELECT * INTO v_receipt FROM public.model_artifact_write_receipts WHERE request_id=p_request_id;
 IF FOUND THEN
  IF v_receipt.request_payload IS DISTINCT FROM v_request THEN
   RAISE EXCEPTION 'Model artifact request identity reused with different payload';
  END IF;
  RETURN v_receipt.response_payload;
 END IF;
 SELECT * INTO v_attempt FROM public.model_stage_attempts WHERE id=p_attempt_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Model artifact attempt not found'; END IF;
 SELECT * INTO v_run FROM public.model_runs WHERE id=v_attempt.run_id FOR UPDATE;
 SELECT * INTO v_stage FROM public.model_run_stages WHERE id=v_attempt.stage_id FOR UPDATE;
 IF v_stage.active_attempt_id IS DISTINCT FROM p_attempt_id OR v_stage.status<>'running'
     OR v_run.status NOT IN ('queued','running') OR v_attempt.revoked_at IS NOT NULL THEN
  RAISE EXCEPTION 'Model artifact attempt no longer owns work';
 END IF;
 INSERT INTO public.model_artifact_write_context VALUES(txid_current(),v_id,p_attempt_id);
 INSERT INTO public.model_run_artifacts(id,run_id,stage_id,attempt_id,artifact_type,file_url,file_size_bytes,content_hash,metadata_json)
 VALUES(v_id,v_run.id,v_stage.id,p_attempt_id,p_payload->>'artifact_type',p_payload->>'file_url',
   (p_payload->>'file_size_bytes')::bigint,p_payload->>'content_hash',coalesce(p_payload->'metadata_json','{}'::jsonb))
 RETURNING * INTO v_artifact;
 DELETE FROM public.model_artifact_write_context WHERE transaction_id=txid_current() AND artifact_id=v_id;
 v_response := to_jsonb(v_artifact);
 INSERT INTO public.model_artifact_write_receipts VALUES(p_request_id,v_request,v_response);
 RETURN v_response;
END;
$$;
REVOKE ALL ON FUNCTION public.write_model_attempt_artifact(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.write_model_attempt_artifact(uuid,uuid,jsonb) TO service_role;

COMMIT;
