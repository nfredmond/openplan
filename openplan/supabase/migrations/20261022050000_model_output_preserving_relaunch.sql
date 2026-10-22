-- Same-run fresh attempts preserve prior outputs, scientific custody and receipts.
-- Install before the matching recovery UI. Historical and unbound scientific
-- records remain held for reconciliation. No output rows or bytes are rewritten.
BEGIN;
ALTER TABLE public.model_run_relaunch_receipts ADD COLUMN prior_attempts jsonb, ADD COLUMN retry_transaction_id bigint;
CREATE TRIGGER refuse_model_run_relaunch_receipt_mutation BEFORE UPDATE OR DELETE ON public.model_run_relaunch_receipts
 FOR EACH ROW EXECUTE FUNCTION public.refuse_model_recovery_receipt_mutation();

-- Private eligibility check, called with the parent locked by lifecycle commands.
CREATE FUNCTION public.model_output_retry_refusal(p_run uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE parent public.model_runs%ROWTYPE;
BEGIN
 SELECT * INTO parent FROM public.model_runs WHERE id=p_run;
 IF parent.id IS NULL OR NOT parent.attempt_managed OR parent.engine_key NOT IN('aequilibrae','behavioral_demand')
   OR NOT EXISTS(SELECT 1 FROM public.model_execution_custody_enrollment WHERE run_id=p_run AND provenance='new_run') THEN
  RETURN 'This execution has no reconciled managed attempt identity.';
 END IF;
 IF parent.status NOT IN('failed','cancelled') THEN RETURN 'Only a failed or cancelled run can start a fresh attempt.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.model_run_stages WHERE run_id=p_run)
   OR EXISTS(SELECT 1 FROM public.model_run_stages WHERE run_id=p_run AND (NOT attempt_managed OR status IN('queued','running'))) THEN
  RETURN 'The retained stage set needs reconciliation.';
 END IF;
 IF parent.input_snapshot_json ? 'populationReplacement' OR parent.input_snapshot_json#>>'{commonPopulation,mode}'='restore_checkpoint' THEN
  RETURN 'Registered population replacement publication is not attempt-aware. Its original records remain retained.';
 END IF;
 IF EXISTS(SELECT 1 FROM public.modeling_claim_decisions WHERE model_run_id=p_run)
   OR EXISTS(SELECT 1 FROM public.modeling_validation_results WHERE model_run_id=p_run)
   OR EXISTS(SELECT 1 FROM public.modeling_validation_assessments WHERE model_run_id=p_run)
   OR EXISTS(SELECT 1 FROM public.modeling_validation_instrument_v2_custody WHERE model_run_id=p_run)
   OR EXISTS(SELECT 1 FROM public.modeling_source_manifests WHERE model_run_id=p_run)
   OR EXISTS(SELECT 1 FROM public.modeling_validation_structural_diagnoses WHERE model_run_id=p_run)
   OR EXISTS(SELECT 1 FROM public.modeling_structural_demand_diagnosis_custody WHERE model_run_id=p_run)
   OR EXISTS(SELECT 1 FROM public.modeling_distributed_work_loading_custody WHERE model_run_id=p_run)
   OR EXISTS(SELECT 1 FROM public.model_legacy_artifact_receipts WHERE run_id=p_run)
   OR EXISTS(SELECT 1 FROM public.model_legacy_kpi_receipts WHERE run_id=p_run)
   OR EXISTS(SELECT 1 FROM public.model_assessment_command_receipts WHERE run_id=p_run) THEN
  RETURN 'Legacy scientific or output records have no attempt association. They remain retained and unassessed for retry.';
 END IF;
 IF EXISTS(SELECT 1 FROM public.model_run_kpis k LEFT JOIN public.model_stage_attempts a ON a.id=k.attempt_id AND a.run_id=k.run_id WHERE k.run_id=p_run AND a.id IS NULL)
   OR EXISTS(SELECT 1 FROM public.model_run_artifacts o LEFT JOIN public.model_stage_attempts a ON a.id=o.attempt_id AND a.run_id=o.run_id AND a.stage_id=o.stage_id WHERE o.run_id=p_run AND a.id IS NULL) THEN
  RETURN 'An output is not bound to its producing attempt.';
 END IF;
 RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.model_output_retry_refusal(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.inspect_model_output_retry(p_workspace_id uuid,p_run_id uuid,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE reason text;
BEGIN
 PERFORM 1 FROM public.model_runs WHERE id=p_run_id AND workspace_id=p_workspace_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Model recovery scope mismatch'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id AND role IN('owner','admin') FOR SHARE NOWAIT) THEN
  RAISE EXCEPTION 'Model recovery requires an owner or administrator' USING ERRCODE='42501';
 END IF;
 PERFORM id FROM public.model_run_stages WHERE run_id=p_run_id ORDER BY id FOR SHARE;
 reason:=public.model_output_retry_refusal(p_run_id);
 RETURN CASE WHEN reason IS NULL THEN jsonb_build_object('state','available') ELSE jsonb_build_object('state','unavailable','reason',reason) END;
END;
$$;
REVOKE ALL ON FUNCTION public.inspect_model_output_retry(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.inspect_model_output_retry(uuid,uuid,uuid) TO service_role;

-- The original five-argument prototype stays refusing. This scoped overload
-- uses the existing owner/admin recovery decision and frozen expected state.
CREATE FUNCTION public.relaunch_model_run_attempts(p_request_id uuid,p_workspace_id uuid,p_run_id uuid,p_actor_id uuid,p_expected_state jsonb,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE parent public.model_runs%ROWTYPE; saved public.model_run_relaunch_receipts%ROWTYPE;
 request jsonb; response jsonb; stages jsonb; attempts jsonb; refusal text;
BEGIN
 IF p_request_id IS NULL OR p_workspace_id IS NULL OR p_run_id IS NULL OR p_actor_id IS NULL
  OR p_expected_state IS NULL OR jsonb_typeof(p_expected_state)<>'object'
  OR p_reason IS NULL OR length(btrim(p_reason))=0 OR length(p_reason)>2000 THEN RAISE EXCEPTION 'Invalid model retry decision'; END IF;
 request:=jsonb_build_object('workspace_id',p_workspace_id,'run_id',p_run_id,'actor_id',p_actor_id,'expected_state',p_expected_state,'reason',p_reason,'decision','retry_execution');
 PERFORM pg_advisory_xact_lock(hashtextextended('model-run-relaunch:'||p_request_id::text,0));
 SELECT * INTO parent FROM public.model_runs WHERE id=p_run_id FOR UPDATE;
 IF NOT FOUND OR parent.workspace_id IS DISTINCT FROM p_workspace_id THEN RAISE EXCEPTION 'Model recovery scope mismatch'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id AND role IN('owner','admin') FOR SHARE NOWAIT) THEN
  RAISE EXCEPTION 'Model recovery requires an owner or administrator' USING ERRCODE='42501';
 END IF;
 SELECT * INTO saved FROM public.model_run_relaunch_receipts WHERE request_id=p_request_id;
 IF FOUND THEN
  IF saved.request_payload IS DISTINCT FROM request THEN RAISE EXCEPTION 'Model retry request identity reused with different payload' USING ERRCODE='23505'; END IF;
  RETURN saved.response_payload;
 END IF;
 PERFORM id FROM public.model_run_stages WHERE run_id=p_run_id ORDER BY id FOR UPDATE;
 IF p_expected_state IS DISTINCT FROM public.model_recovery_expected_state(p_run_id) THEN RAISE EXCEPTION 'Model recovery state changed' USING ERRCODE='40001'; END IF;
 refusal:=public.model_output_retry_refusal(p_run_id);
 IF refusal IS NOT NULL THEN RAISE EXCEPTION '%',refusal USING ERRCODE='55000'; END IF;
 SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) INTO stages FROM public.model_run_stages s WHERE run_id=p_run_id;
 SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) INTO attempts FROM public.model_stage_attempts a WHERE run_id=p_run_id;
 response:=jsonb_build_object('schema','openplan.model-output-retry.v1','request_id',p_request_id,'request_payload',request,'outcome','fresh_attempt_queued','run_id',p_run_id,'run_status','queued','outputs_preserved',true,'scientific_claim_changed',false,'process_termination_verified',false,'model_resumed',false);
 INSERT INTO public.model_run_relaunch_receipts(request_id,request_payload,response_payload,prior_run,prior_stages,prior_attempts,retry_transaction_id)
  VALUES(p_request_id,request,response,to_jsonb(parent),stages,attempts,txid_current());
 INSERT INTO public.model_run_write_context VALUES(txid_current(),p_run_id);
 INSERT INTO public.model_stage_write_context(transaction_id,stage_id,attempt_id)
  SELECT txid_current(),id,NULL FROM public.model_run_stages WHERE run_id=p_run_id;
 UPDATE public.model_stage_attempts SET revoked_at=coalesce(revoked_at,clock_timestamp()),revocation_reason=coalesce(revocation_reason,'Fresh attempt authorized after recovery review') WHERE run_id=p_run_id;
 UPDATE public.model_run_stages SET active_attempt_id=NULL,status='queued',error_message=NULL,log_tail=NULL,started_at=NULL,completed_at=NULL WHERE run_id=p_run_id;
 UPDATE public.model_runs SET status='queued',result_summary_json='{}'::jsonb,source_analysis_run_id=NULL,started_at=NULL,completed_at=NULL,error_message=NULL,
  failure_count=failure_count+CASE WHEN parent.status='failed' THEN 1 ELSE 0 END,
  last_failure_message=CASE WHEN parent.status='failed' THEN parent.error_message ELSE last_failure_message END WHERE id=p_run_id;
 DELETE FROM public.model_stage_write_context WHERE transaction_id=txid_current() AND stage_id IN(SELECT id FROM public.model_run_stages WHERE run_id=p_run_id);
 DELETE FROM public.model_run_write_context WHERE transaction_id=txid_current() AND run_id=p_run_id;
 RETURN response;
END;
$$;
REVOKE ALL ON FUNCTION public.relaunch_model_run_attempts(uuid,uuid,uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.relaunch_model_run_attempts(uuid,uuid,uuid,uuid,jsonb,text) TO service_role;

CREATE OR REPLACE FUNCTION public.guard_retained_model_outputs() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior jsonb; following jsonb; run uuid; next_run uuid; scoped record; retained boolean:=false;
BEGIN
 prior:=to_jsonb(OLD);
 IF TG_OP='UPDATE' THEN following:=to_jsonb(NEW); END IF;
 IF TG_TABLE_NAME='model_runs' THEN run:=OLD.id; next_run:=(following->>'id')::uuid;
 ELSIF TG_TABLE_NAME IN('modeling_claim_decisions','modeling_validation_results') THEN run:=(prior->>'model_run_id')::uuid; next_run:=(following->>'model_run_id')::uuid;
 ELSE run:=(prior->>'run_id')::uuid; next_run:=(following->>'run_id')::uuid;
 END IF;
 -- Serialize against the parent lock held by command registration.
 FOR scoped IN SELECT id FROM public.model_runs WHERE id IN(run,next_run) ORDER BY id FOR UPDATE LOOP
  IF public.model_run_has_retained_commands(scoped.id) THEN retained:=true; END IF;
 END LOOP;
 IF retained THEN
  IF TG_TABLE_NAME='model_runs' AND TG_OP='UPDATE' THEN
   IF (NEW.status='queued' AND NOT (NEW.attempt_managed AND OLD.attempt_managed AND EXISTS(SELECT 1 FROM public.model_run_relaunch_receipts r WHERE r.retry_transaction_id=txid_current() AND r.prior_run->>'id'=OLD.id::text AND r.request_payload->>'decision'='retry_execution')))
      OR NEW.input_snapshot_json IS DISTINCT FROM OLD.input_snapshot_json
      OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
      OR NEW.model_id IS DISTINCT FROM OLD.model_id
      OR NEW.engine_key IS DISTINCT FROM OLD.engine_key THEN
    RAISE EXCEPTION 'Retained model outputs require continuation reconciliation' USING ERRCODE='55000';
   END IF;
  ELSIF TG_TABLE_NAME='model_run_stages' AND TG_OP='UPDATE' THEN
   IF (NEW.status='queued' AND NOT (NEW.attempt_managed AND OLD.attempt_managed AND EXISTS(SELECT 1 FROM public.model_run_relaunch_receipts r WHERE r.retry_transaction_id=txid_current() AND r.prior_run->>'id'=OLD.run_id::text AND r.request_payload->>'decision'='retry_execution'))) AND OLD.status IS DISTINCT FROM NEW.status
      OR NEW.run_id IS DISTINCT FROM OLD.run_id
      OR NEW.stage_name IS DISTINCT FROM OLD.stage_name
      OR NEW.sort_order IS DISTINCT FROM OLD.sort_order THEN
    RAISE EXCEPTION 'Retained model outputs require continuation reconciliation' USING ERRCODE='55000';
   END IF;
  ELSIF TG_OP='DELETE' OR following IS DISTINCT FROM prior THEN
   RAISE EXCEPTION 'Retained model outputs cannot be replaced or deleted' USING ERRCODE='55000';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_retained_model_outputs() FROM PUBLIC,anon,authenticated,service_role;

-- Preserve the first observed start. Later starts have their own immutable
-- claim receipts and attempt identities, never a fabricated historical start.
CREATE OR REPLACE FUNCTION public.retain_model_stage_execution_start() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.status<>'running' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.status='running' THEN RETURN NEW; END IF;
 PERFORM id FROM public.model_runs WHERE id=NEW.run_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.model_stage_execution_starts WHERE stage_id=NEW.id) THEN
  IF TG_OP='UPDATE' AND OLD.status='queued' AND NEW.attempt_managed AND NEW.active_attempt_id IS NOT NULL
    AND EXISTS(SELECT 1 FROM public.model_stage_write_context c WHERE c.transaction_id=txid_current() AND c.stage_id=NEW.id AND c.attempt_id=NEW.active_attempt_id)
    AND EXISTS(SELECT 1 FROM public.model_stage_attempts a WHERE a.id=NEW.active_attempt_id AND a.stage_id=NEW.id AND a.run_id=NEW.run_id AND a.revoked_at IS NULL)
    AND EXISTS(SELECT 1 FROM public.model_run_relaunch_receipts r WHERE r.prior_run->>'id'=NEW.run_id::text AND r.request_payload->>'decision'='retry_execution'
      AND r.prior_stages @> jsonb_build_array(jsonb_build_object('id',NEW.id))) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Model stage already started; reconcile before execution' USING ERRCODE='55000';
 END IF;
 IF TG_OP='UPDATE' AND OLD.status<>'queued' THEN RAISE EXCEPTION 'Model stage start requires queued state' USING ERRCODE='55000'; END IF;
 INSERT INTO public.model_stage_execution_starts(stage_id,run_id,boundary) VALUES(NEW.id,NEW.run_id,CASE WHEN TG_OP='INSERT' THEN 'inserted_running' ELSE 'queued_to_running' END);
 RETURN NEW;
END;
$$;
-- Keep established current-output readers on the existing atomic projection.
-- Wrong producers retain their rows and receipts but cannot supply named results.
CREATE OR REPLACE FUNCTION public.read_model_attempt_outputs(p_run_id uuid,p_workspace_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_run public.model_runs%ROWTYPE; v_outputs jsonb;
BEGIN
 SELECT * INTO v_run FROM public.model_runs WHERE id=p_run_id AND workspace_id=p_workspace_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Model output read scope mismatch'; END IF;
 WITH outputs AS (
  SELECT 'artifact'::text AS kind,id,run_id,stage_id,attempt_id,to_jsonb(t) AS record
    FROM public.model_run_artifacts t WHERE run_id=p_run_id
  UNION ALL
  SELECT 'kpi',id,run_id,NULL::uuid,attempt_id,to_jsonb(t)
    FROM public.model_run_kpis t WHERE run_id=p_run_id
 ), classified AS (
  SELECT o.kind,o.id,o.record,
   CASE
    WHEN o.attempt_id IS NULL THEN 'legacy_unknown'
    WHEN a.id IS NULL OR s.id IS NULL OR (o.kind='artifact' AND o.stage_id IS DISTINCT FROM a.stage_id) THEN 'invalid_binding'
    WHEN a.revoked_at IS NOT NULL OR s.active_attempt_id IS DISTINCT FROM a.id OR s.status NOT IN ('running','succeeded') OR v_run.status NOT IN ('running','succeeded') THEN 'retained_inactive'
    WHEN o.kind='kpi' AND (o.record->>'kpi_name') IN
      ('total_trips','daily_vmt','resident_vmt_per_capita','vmt_per_capita','co2e_metric_tons_year','co2e_kg_per_capita_day','activitysim_trips','activitysim_runtime_mode','activitysim_daily_vmt')
      AND s.stage_name IS DISTINCT FROM CASE
        WHEN o.record->>'kpi_name' IN ('activitysim_trips','activitysim_runtime_mode') THEN 'ActivitySim Bundle & Preflight'
        WHEN o.record->>'kpi_name'='activitysim_daily_vmt' THEN 'ActivitySim Network Assignment'
        ELSE 'Artifact Extraction' END THEN 'invalid_binding'
    WHEN o.kind='artifact' AND o.record->>'artifact_type' IN ('link_volumes','volumes_geojson','activitysim_link_volumes')
      AND s.stage_name IS DISTINCT FROM CASE WHEN o.record->>'artifact_type'='activitysim_link_volumes'
        THEN 'ActivitySim Network Assignment' ELSE 'Artifact Extraction' END THEN 'invalid_binding'
    WHEN s.status='succeeded' THEN 'current_completed'
    ELSE 'current_in_progress'
   END AS ownership_state
  FROM outputs o
  LEFT JOIN public.model_stage_attempts a ON a.id=o.attempt_id AND a.run_id=o.run_id
  LEFT JOIN public.model_run_stages s ON s.id=a.stage_id AND s.run_id=o.run_id
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object('kind',kind,'ownership_state',ownership_state,'record',record) ORDER BY kind,id),'[]'::jsonb)
 INTO v_outputs FROM classified;
 RETURN jsonb_build_object('run_id',v_run.id,'run_status',v_run.status,'outputs',v_outputs);
END;
$$;
COMMIT;
