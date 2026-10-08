-- Recover exact legacy artifact registration without enabling stage replay.
CREATE TABLE public.model_legacy_artifact_receipts (
 artifact_id uuid PRIMARY KEY,
 run_id uuid NOT NULL REFERENCES public.model_runs(id),
 request_payload jsonb NOT NULL,
 response_payload jsonb NOT NULL
);
CREATE INDEX model_legacy_artifact_receipts_run_idx ON public.model_legacy_artifact_receipts(run_id);
ALTER TABLE public.model_legacy_artifact_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.model_legacy_artifact_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.record_legacy_model_artifact(p_workspace uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 fields text[]:=ARRAY['id','run_id','stage_id','artifact_type','file_url','file_size_bytes','content_hash','metadata_json'];
 key text; identity uuid; run uuid; stage uuid; request jsonb; response jsonb;
 saved public.model_legacy_artifact_receipts%ROWTYPE;
 parent public.model_runs%ROWTYPE; artifact public.model_run_artifacts%ROWTYPE;
BEGIN
 IF p_workspace IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
  OR NOT(p_payload ?& fields) OR (p_payload-fields)<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid legacy artifact fields'; END IF;
 FOREACH key IN ARRAY ARRAY['id','run_id','stage_id'] LOOP
  IF jsonb_typeof(p_payload->key) IS DISTINCT FROM 'string' OR p_payload->>key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Invalid legacy artifact identity'; END IF;
 END LOOP;
 FOREACH key IN ARRAY ARRAY['artifact_type','file_url'] LOOP
  IF jsonb_typeof(p_payload->key) IS DISTINCT FROM 'string' OR btrim(p_payload->>key)='' THEN RAISE EXCEPTION 'Invalid legacy artifact text'; END IF;
 END LOOP;
 IF jsonb_typeof(p_payload->'file_size_bytes') IS DISTINCT FROM 'number' OR p_payload->>'file_size_bytes' !~ '^[0-9]+$'
  OR jsonb_typeof(p_payload->'content_hash') IS DISTINCT FROM 'string' OR p_payload->>'content_hash' !~ '^[0-9a-f]{64}$'
  OR jsonb_typeof(p_payload->'metadata_json') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid legacy artifact bytes'; END IF;
 identity:=(p_payload->>'id')::uuid; run:=(p_payload->>'run_id')::uuid; stage:=(p_payload->>'stage_id')::uuid;
 request:=jsonb_build_object('workspace_id',p_workspace,'payload',p_payload);
 PERFORM pg_advisory_xact_lock(hashtextextended('legacy-artifact:'||identity::text,0));
 SELECT * INTO saved FROM public.model_legacy_artifact_receipts WHERE artifact_id=identity;
 IF FOUND THEN
  IF saved.request_payload IS DISTINCT FROM request THEN RAISE EXCEPTION 'Legacy artifact request changed'; END IF;
  RETURN saved.response_payload;
 END IF;
 SELECT * INTO parent FROM public.model_runs WHERE id=run FOR UPDATE;
 IF NOT FOUND OR parent.workspace_id IS DISTINCT FROM p_workspace THEN RAISE EXCEPTION 'Legacy artifact workspace mismatch'; END IF;
 IF parent.attempt_managed THEN RAISE EXCEPTION 'Managed artifact requires attempt-bound command'; END IF;
 IF parent.status IN('failed','cancelled') THEN RAISE EXCEPTION 'Stopped run cannot register new artifact'; END IF;
 PERFORM 1 FROM public.model_run_stages WHERE id=stage AND run_id=run AND NOT attempt_managed FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Legacy artifact stage mismatch'; END IF;
 SELECT * INTO artifact FROM public.model_run_artifacts WHERE id=identity FOR UPDATE;
 IF FOUND THEN
  IF artifact.attempt_id IS NOT NULL OR jsonb_build_object('id',artifact.id,'run_id',artifact.run_id,'stage_id',artifact.stage_id,'artifact_type',artifact.artifact_type,'file_url',artifact.file_url,'file_size_bytes',artifact.file_size_bytes,'content_hash',artifact.content_hash,'metadata_json',artifact.metadata_json) IS DISTINCT FROM p_payload THEN
   RAISE EXCEPTION 'Existing legacy artifact differs';
  END IF;
 ELSE
  INSERT INTO public.model_run_artifacts(id,run_id,stage_id,artifact_type,file_url,file_size_bytes,content_hash,metadata_json)
  VALUES(identity,run,stage,p_payload->>'artifact_type',p_payload->>'file_url',(p_payload->>'file_size_bytes')::bigint,p_payload->>'content_hash',p_payload->'metadata_json') RETURNING * INTO artifact;
 END IF;
 response:=to_jsonb(artifact);
 INSERT INTO public.model_legacy_artifact_receipts(artifact_id,run_id,request_payload,response_payload) VALUES(identity,run,request,response);
 RETURN response;
END;
$$;
REVOKE ALL ON FUNCTION public.record_legacy_model_artifact(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_legacy_model_artifact(uuid,jsonb) TO service_role;
