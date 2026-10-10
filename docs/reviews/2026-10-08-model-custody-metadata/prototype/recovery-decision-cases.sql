BEGIN;
CREATE FUNCTION public.proof_refuse_recovery_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Synthetic recovery receipt failure'; END;
$$;
DO $test$
DECLARE r uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); done uuid:=gen_random_uuid(); req uuid:=gen_random_uuid();
 workspace uuid; actor uuid; unauthorized uuid:=gen_random_uuid(); attempt uuid; claim jsonb; observed jsonb; expected jsonb; first jsonb; second jsonb;
 original_state jsonb; original_outputs jsonb; terminal_before jsonb; after_first jsonb; count_before bigint;
BEGIN
 SELECT m.workspace_id,m.user_id INTO workspace,actor FROM public.workspace_members m
  JOIN public.model_runs f ON f.workspace_id=m.workspace_id WHERE f.id='FIXTURE' AND m.role IN('owner','admin') ORDER BY m.user_id LIMIT 1;
 IF actor IS NULL THEN RAISE EXCEPTION 'Synthetic template owner missing'; END IF;
 INSERT INTO auth.users(id,email) VALUES(unauthorized,unauthorized::text||'@openplan.test');
 INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(workspace,unauthorized,'member');
 INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
  SELECT r,workspace_id,model_id,'aequilibrae','queued','Synthetic explicit recovery',actor FROM public.model_runs WHERE id='FIXTURE';
 INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order,completed_at)
  VALUES(done,r,'Completed predecessor','succeeded',1,clock_timestamp()),(s,r,'Interrupted assignment','queued',2,NULL);
 claim:=public.claim_model_stage_attempt(gen_random_uuid(),s,'synthetic-recovery-owner');attempt:=(claim->>'attempt_id')::uuid;
 PERFORM public.write_model_attempt_kpi(gen_random_uuid(),attempt,'{"kpi_name":"synthetic_before","kpi_label":"Synthetic before recovery","value":7}'::jsonb);
 SELECT jsonb_agg(to_jsonb(k) ORDER BY id) INTO original_outputs FROM public.model_run_kpis k WHERE run_id=r;
 SELECT to_jsonb(x)-'attempt_managed'-'active_attempt_id'-'updated_at' INTO terminal_before FROM public.model_run_stages x WHERE id=done;
 SET LOCAL ROLE service_role;
 observed:=public.inspect_model_run_recovery(workspace,r,actor);expected:=observed->'expected_state';
 RESET ROLE;
 IF observed->>'process_termination_verified'<>'false' OR observed->>'continuation_authorized'<>'false' THEN RAISE EXCEPTION 'Inspection invented authority'; END IF;
 -- A real synthetic member lacks recovery permission. No existing owner is demoted.
 BEGIN
  PERFORM public.abandon_model_run_execution(req,workspace,r,unauthorized,expected,'Synthetic recovery','{}');
  RAISE EXCEPTION 'Unauthorized recovery accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  PERFORM public.abandon_model_run_execution(req,gen_random_uuid(),r,actor,expected,'Synthetic recovery','{}');
  RAISE EXCEPTION 'Cross-workspace recovery accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Model recovery scope mismatch' THEN RAISE; END IF;
 END;
 -- Actual progress after inspection invalidates the reviewed stage version.
 PERFORM public.write_model_stage_attempt(gen_random_uuid(),attempt,'running','Synthetic progress after review',NULL);
 -- The timestamp trigger uses now(), so use a changed stage observation in this
 -- single transaction to test the same exact-state refusal deterministically.
 expected:=jsonb_set(expected,ARRAY['stages','1','status'],'"failed"'::jsonb);
 BEGIN
  PERFORM public.abandon_model_run_execution(req,workspace,r,actor,expected,'Synthetic recovery','{}');
  RAISE EXCEPTION 'Stale recovery accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Model recovery state changed' THEN RAISE; END IF;
 END;
 expected:=public.model_recovery_expected_state(r);original_state:=expected;
 SELECT count(*) INTO count_before FROM public.model_run_recovery_receipts;
 CREATE TRIGGER proof_refuse_recovery_receipt BEFORE INSERT ON public.model_run_recovery_receipts FOR EACH ROW EXECUTE FUNCTION public.proof_refuse_recovery_receipt();
 BEGIN
  PERFORM public.abandon_model_run_execution(req,workspace,r,actor,expected,'Synthetic recovery','{"scope":"unconfirmed"}');
  RAISE EXCEPTION 'Receipt failure was not exercised';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Synthetic recovery receipt failure' THEN RAISE; END IF;
 END;
 DROP TRIGGER proof_refuse_recovery_receipt ON public.model_run_recovery_receipts;
 IF public.model_recovery_expected_state(r) IS DISTINCT FROM original_state
  OR EXISTS(SELECT 1 FROM public.model_stage_attempts WHERE id=attempt AND revoked_at IS NOT NULL)
  OR (SELECT count(*) FROM public.model_run_recovery_receipts)<>count_before THEN RAISE EXCEPTION 'Receipt failure left recovery effects'; END IF;
 SET LOCAL ROLE service_role;
 first:=public.abandon_model_run_execution(req,workspace,r,actor,expected,'Synthetic operator abandons interrupted execution','{"scope":"unconfirmed"}');
 second:=public.abandon_model_run_execution(req,workspace,r,actor,expected,'Synthetic operator abandons interrupted execution','{"scope":"unconfirmed"}');
 RESET ROLE;
 IF first IS DISTINCT FROM second OR first->>'outcome'<>'execution_abandoned' OR first->>'run_status'<>'cancelled'
  OR first->>'process_termination_verified'<>'false' OR first->>'model_resumed'<>'false' OR first->>'continuation_authorized'<>'false'
  OR first->>'reported_evidence_verified'<>'false' THEN RAISE EXCEPTION 'Recovery receipt or replay differs'; END IF;
 IF (SELECT count(*) FROM public.model_run_recovery_receipts WHERE request_id=req)<>1 THEN RAISE EXCEPTION 'Recovery receipt not retained exactly once'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.model_run_recovery_receipts WHERE request_id=req AND prior_run->>'status'='running'
  AND jsonb_array_length(prior_stages)=2 AND jsonb_array_length(prior_attempts)=1 AND request_payload->'reported_evidence'='{"scope":"unconfirmed"}'::jsonb) THEN RAISE EXCEPTION 'Recovery custody incomplete'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.model_runs WHERE id=r AND status='cancelled')
  OR NOT EXISTS(SELECT 1 FROM public.model_run_stages WHERE id=s AND status='cancelled' AND active_attempt_id IS NULL)
  OR NOT EXISTS(SELECT 1 FROM public.model_stage_attempts WHERE id=attempt AND revoked_at IS NOT NULL) THEN RAISE EXCEPTION 'Recovery failed to revoke execution'; END IF;
 IF (SELECT jsonb_agg(to_jsonb(k) ORDER BY id) FROM public.model_run_kpis k WHERE run_id=r) IS DISTINCT FROM original_outputs
  OR (SELECT to_jsonb(x)-'attempt_managed'-'active_attempt_id'-'updated_at' FROM public.model_run_stages x WHERE id=done) IS DISTINCT FROM terminal_before THEN RAISE EXCEPTION 'Recovery altered prior outputs or completed work'; END IF;
 BEGIN
  PERFORM public.abandon_model_run_execution(req,workspace,r,actor,expected,'Changed reason','{}');
  RAISE EXCEPTION 'Changed recovery request accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Model recovery request identity reused with different payload' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM public.write_model_stage_attempt(gen_random_uuid(),attempt,'succeeded','Late worker',NULL);
  RAISE EXCEPTION 'Abandoned worker published completion';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Model stage attempt no longer owns work' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM public.write_model_attempt_kpi(gen_random_uuid(),attempt,'{"kpi_name":"synthetic_late","kpi_label":"Synthetic late write","value":9}'::jsonb);
  RAISE EXCEPTION 'Abandoned worker published KPI';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Model KPI attempt no longer owns work' THEN RAISE; END IF;
 END;
 BEGIN
  UPDATE public.model_run_recovery_receipts SET response_payload='{}' WHERE request_id=req;
  RAISE EXCEPTION 'Recovery receipt rewrite accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Model recovery receipt is immutable' THEN RAISE; END IF;
 END;
 IF EXISTS(SELECT 1 FROM public.model_stage_write_context) OR EXISTS(SELECT 1 FROM public.model_run_write_context) THEN RAISE EXCEPTION 'Recovery context leaked'; END IF;
 IF has_function_privilege('authenticated','public.abandon_model_run_execution(uuid,uuid,uuid,uuid,jsonb,text,jsonb)','EXECUTE')
  OR has_function_privilege('anon','public.inspect_model_run_recovery(uuid,uuid,uuid)','EXECUTE')
  OR has_table_privilege('service_role','public.model_run_recovery_receipts','INSERT') THEN RAISE EXCEPTION 'Recovery authority exposed'; END IF;
END;
$test$;
ROLLBACK;
