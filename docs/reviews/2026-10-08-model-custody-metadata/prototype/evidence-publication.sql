-- Rollback-only candidate. Not an application migration or managed ingestion.
CREATE TABLE public.model_evidence_publication_receipts (
 request_id uuid PRIMARY KEY,
 run_id uuid NOT NULL REFERENCES public.model_runs(id),
 track text NOT NULL,
 request_payload jsonb NOT NULL,
 prior_evidence jsonb NOT NULL,
 response_payload jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX model_evidence_publication_receipts_run_track ON public.model_evidence_publication_receipts(run_id,track);
CREATE TABLE public.model_evidence_publication_context (
 transaction_id bigint NOT NULL,
 run_id uuid NOT NULL,
 track text NOT NULL,
 PRIMARY KEY(transaction_id,run_id,track)
);
ALTER TABLE public.model_evidence_publication_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_evidence_publication_context ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.model_evidence_publication_receipts,public.model_evidence_publication_context FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.read_legacy_model_evidence(p_workspace uuid,p_run uuid,p_track text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.model_runs WHERE id=p_run AND workspace_id=p_workspace) THEN
  RAISE EXCEPTION 'Model evidence scope mismatch';
 END IF;
 -- Refuse ambiguous legacy rows instead of silently adopting or deleting them.
 IF EXISTS(SELECT 1 FROM public.modeling_claim_decisions c WHERE c.model_run_id=p_run AND c.track=p_track
   AND (c.workspace_id IS DISTINCT FROM p_workspace OR c.county_run_id IS NOT NULL))
  OR EXISTS(SELECT 1 FROM public.modeling_validation_results m WHERE m.model_run_id=p_run AND m.track=p_track
   AND (m.workspace_id IS DISTINCT FROM p_workspace OR m.county_run_id IS NOT NULL)) THEN
  RAISE EXCEPTION 'Existing model evidence scope mismatch';
 END IF;
 SELECT jsonb_build_object(
  'claims',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.modeling_claim_decisions c WHERE model_run_id=p_run AND track=p_track),'[]'::jsonb),
  'metrics',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM public.modeling_validation_results m WHERE model_run_id=p_run AND track=p_track),'[]'::jsonb)
 ) INTO result;
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.read_legacy_model_evidence(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_legacy_model_evidence(uuid,uuid,text) TO service_role;

CREATE FUNCTION public.guard_retained_model_evidence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_run uuid; new_run uuid; old_track text; new_track text;
BEGIN
 IF TG_OP<>'INSERT' THEN old_run:=OLD.model_run_id; old_track:=OLD.track; END IF;
 IF TG_OP<>'DELETE' THEN new_run:=NEW.model_run_id; new_track:=NEW.track; END IF;
 PERFORM id FROM public.model_runs WHERE id IN(old_run,new_run) ORDER BY id FOR UPDATE;
 IF EXISTS(
  SELECT 1 FROM public.model_evidence_publication_receipts r
  WHERE ((r.run_id=old_run AND r.track=old_track) OR (r.run_id=new_run AND r.track=new_track))
   AND NOT EXISTS(SELECT 1 FROM public.model_evidence_publication_context c
    WHERE c.transaction_id=txid_current() AND c.run_id=r.run_id AND c.track=r.track)
 ) THEN RAISE EXCEPTION 'Retained model evidence requires publication command'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_retained_model_evidence() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER retained_model_evidence BEFORE INSERT OR UPDATE OR DELETE ON public.modeling_claim_decisions
 FOR EACH ROW EXECUTE FUNCTION public.guard_retained_model_evidence();
CREATE TRIGGER retained_model_evidence BEFORE INSERT OR UPDATE OR DELETE ON public.modeling_validation_results
 FOR EACH ROW EXECUTE FUNCTION public.guard_retained_model_evidence();

CREATE FUNCTION public.publish_legacy_model_evidence(p_request uuid,p_workspace uuid,p_run uuid,p_track text,p_expected jsonb,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 request jsonb; receipt public.model_evidence_publication_receipts%ROWTYPE;
 parent public.model_runs%ROWTYPE; previous jsonb; current_evidence jsonb;
 claim jsonb; metric jsonb; result jsonb; text_key text;
BEGIN
 IF p_request IS NULL OR p_workspace IS NULL OR p_run IS NULL OR p_track IS NULL
  OR p_track NOT IN('assignment','behavioral_demand') OR p_expected IS NULL
  OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
  OR NOT(p_payload ?& ARRAY['claim','metrics']) OR (p_payload - ARRAY['claim','metrics'])<>'{}'::jsonb THEN
  RAISE EXCEPTION 'Invalid model evidence publication';
 END IF;
 claim:=p_payload->'claim';
 IF jsonb_typeof(claim) IS DISTINCT FROM 'object' OR jsonb_typeof(p_payload->'metrics') IS DISTINCT FROM 'array'
  OR NOT(claim ?& ARRAY['workspace_id','model_run_id','track','claim_status','status_reason','validation_summary_json'])
  OR (claim-ARRAY['workspace_id','model_run_id','track','claim_status','status_reason','validation_summary_json'])<>'{}'::jsonb
  OR claim->>'workspace_id' IS DISTINCT FROM p_workspace::text OR claim->>'model_run_id' IS DISTINCT FROM p_run::text
  OR claim->>'track' IS DISTINCT FROM p_track
  OR claim->>'claim_status' IS DISTINCT FROM 'prototype_only'
  OR jsonb_typeof(claim->'status_reason') IS DISTINCT FROM 'string'
  OR jsonb_typeof(claim->'validation_summary_json') IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'Invalid or unsupported publication claim';
 END IF;
 -- This first candidate never promotes a scientific claim. Existing higher-tier
 -- policy and managed instrument ingestion require separate reviewed integration.
 FOR metric IN SELECT value FROM jsonb_array_elements(p_payload->'metrics') LOOP
  IF jsonb_typeof(metric) IS DISTINCT FROM 'object'
   OR NOT(metric ?& ARRAY['workspace_id','model_run_id','track','metric_key','metric_label','threshold_comparator','status','blocks_claim_grade','detail','metadata_json'])
   OR (metric-ARRAY['workspace_id','model_run_id','track','metric_key','metric_label','threshold_comparator','status','blocks_claim_grade','detail','metadata_json'])<>'{}'::jsonb
   OR metric->>'workspace_id' IS DISTINCT FROM p_workspace::text OR metric->>'model_run_id' IS DISTINCT FROM p_run::text
   OR metric->>'track' IS DISTINCT FROM p_track OR jsonb_typeof(metric->'blocks_claim_grade') IS DISTINCT FROM 'boolean'
   OR jsonb_typeof(metric->'metadata_json') IS DISTINCT FROM 'object' THEN
   RAISE EXCEPTION 'Invalid publication metric scope or fields';
  END IF;
  FOREACH text_key IN ARRAY ARRAY['metric_key','metric_label','threshold_comparator','status','detail'] LOOP
   IF jsonb_typeof(metric->text_key) IS DISTINCT FROM 'string' OR btrim(metric->>text_key)='' THEN
    RAISE EXCEPTION 'Invalid publication metric text';
   END IF;
  END LOOP;
 END LOOP;
 IF (SELECT count(*) FROM jsonb_array_elements(p_payload->'metrics'))<>(SELECT count(DISTINCT value->>'metric_key') FROM jsonb_array_elements(p_payload->'metrics')) THEN
  RAISE EXCEPTION 'Duplicate or missing publication metric';
 END IF;
 request:=jsonb_build_object('workspace',p_workspace,'run',p_run,'track',p_track,'expected',p_expected,'payload',p_payload);
 PERFORM pg_advisory_xact_lock(hashtextextended('model-evidence-publication:'||p_request::text,0));
 SELECT * INTO receipt FROM public.model_evidence_publication_receipts WHERE request_id=p_request;
 IF FOUND THEN
  IF receipt.request_payload IS DISTINCT FROM request THEN RAISE EXCEPTION 'Publication request payload changed'; END IF;
  RETURN receipt.response_payload;
 END IF;
 SELECT * INTO parent FROM public.model_runs WHERE id=p_run FOR UPDATE;
 IF NOT FOUND OR parent.workspace_id IS DISTINCT FROM p_workspace THEN RAISE EXCEPTION 'Publication workspace mismatch'; END IF;
 IF parent.attempt_managed THEN RAISE EXCEPTION 'Managed publication requires instrument ingestion'; END IF;
 previous:=public.read_legacy_model_evidence(p_workspace,p_run,p_track);
 IF previous IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Publication evidence changed'; END IF;
 INSERT INTO public.model_evidence_publication_context VALUES(txid_current(),p_run,p_track);
 DELETE FROM public.modeling_validation_results WHERE model_run_id=p_run AND track=p_track;
 INSERT INTO public.modeling_claim_decisions(workspace_id,model_run_id,track,claim_status,status_reason,validation_summary_json)
 VALUES(p_workspace,p_run,p_track,claim->>'claim_status',claim->>'status_reason',claim->'validation_summary_json')
 ON CONFLICT(model_run_id,track) DO UPDATE SET claim_status=EXCLUDED.claim_status,status_reason=EXCLUDED.status_reason,
  validation_summary_json=EXCLUDED.validation_summary_json,reasons_json='[]'::jsonb,decided_at=clock_timestamp();
 FOR metric IN SELECT value FROM jsonb_array_elements(p_payload->'metrics') LOOP
  INSERT INTO public.modeling_validation_results(workspace_id,model_run_id,track,metric_key,metric_label,threshold_comparator,status,blocks_claim_grade,detail,metadata_json)
  VALUES(p_workspace,p_run,p_track,metric->>'metric_key',metric->>'metric_label',metric->>'threshold_comparator',metric->>'status',(metric->>'blocks_claim_grade')::boolean,metric->>'detail',metric->'metadata_json');
 END LOOP;
 current_evidence:=public.read_legacy_model_evidence(p_workspace,p_run,p_track);
 result:=jsonb_build_object('request_id',p_request,'workspace_id',p_workspace,'run_id',p_run,'track',p_track,'evidence',current_evidence);
 INSERT INTO public.model_evidence_publication_receipts(request_id,run_id,track,request_payload,prior_evidence,response_payload)
 VALUES(p_request,p_run,p_track,request,previous,result);
 DELETE FROM public.model_evidence_publication_context WHERE transaction_id=txid_current() AND run_id=p_run AND track=p_track;
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.publish_legacy_model_evidence(uuid,uuid,uuid,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.publish_legacy_model_evidence(uuid,uuid,uuid,text,jsonb,jsonb) TO service_role;
