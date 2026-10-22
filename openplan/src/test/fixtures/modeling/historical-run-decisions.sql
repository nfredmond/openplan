-- Synthetic native relationships only. The enclosing test always rolls back.
CREATE TEMP TABLE decision_probe(workspace uuid, other_workspace uuid, owner_id uuid, admin_id uuid, viewer_id uuid, outsider_id uuid,
 model_id uuid, keep_run uuid, keep_stage uuid, keep_artifact uuid, close_run uuid, close_stage uuid, fresh_run uuid, fresh_stage uuid, request_id uuid);
INSERT INTO decision_probe SELECT gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
 gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid();
GRANT SELECT ON decision_probe TO authenticated,service_role;
INSERT INTO auth.users(id,email) SELECT u,u||'@example.test' FROM decision_probe,LATERAL unnest(ARRAY[owner_id,admin_id,viewer_id,outsider_id]) u;
INSERT INTO public.workspaces(id,name,slug) SELECT workspace,'Historical decision probe',workspace::text FROM decision_probe
 UNION ALL SELECT other_workspace,'Other decision probe',other_workspace::text FROM decision_probe;
INSERT INTO public.workspace_members(workspace_id,user_id,role)
 SELECT workspace,owner_id,'owner' FROM decision_probe UNION ALL SELECT workspace,admin_id,'admin' FROM decision_probe
 UNION ALL SELECT workspace,viewer_id,'viewer' FROM decision_probe UNION ALL SELECT other_workspace,outsider_id,'owner' FROM decision_probe;
INSERT INTO public.models(id,workspace_id,title,model_family) SELECT model_id,workspace,'Synthetic historical decision','travel_demand' FROM decision_probe;
INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title)
 SELECT keep_run,workspace,model_id,'aequilibrae','succeeded','Synthetic kept run' FROM decision_probe
 UNION ALL SELECT close_run,workspace,model_id,'behavioral_demand','running','Synthetic closed run' FROM decision_probe;
INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order)
 SELECT keep_stage,keep_run,'Assignment','succeeded',1 FROM decision_probe UNION ALL SELECT close_stage,close_run,'Assignment','succeeded',1 FROM decision_probe;
INSERT INTO public.model_run_artifacts(id,run_id,stage_id,artifact_type,file_url,file_size_bytes,content_hash)
 SELECT keep_artifact,keep_run,keep_stage,'link_volumes','local://synthetic-historical/link_volumes.csv',10,repeat('b',64) FROM decision_probe;
-- Recreate migration 18's enrollment of rows that existed before it ran.
ALTER TABLE public.model_execution_custody_enrollment DISABLE TRIGGER refuse_model_execution_enrollment_mutation;
UPDATE public.model_execution_custody_enrollment SET provenance='historical_unassessed'
 WHERE run_id IN(SELECT keep_run FROM decision_probe UNION ALL SELECT close_run FROM decision_probe);
ALTER TABLE public.model_execution_custody_enrollment ENABLE TRIGGER refuse_model_execution_enrollment_mutation;
CREATE TEMP TABLE decision_before AS
 SELECT (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.model_runs r WHERE r.model_id=p.model_id) runs,
  (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.model_run_stages s JOIN public.model_runs r ON r.id=s.run_id WHERE r.model_id=p.model_id) stages,
  (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.model_run_artifacts a WHERE a.run_id=p.keep_run) artifacts
 FROM decision_probe p;
CREATE FUNCTION pg_temp.expect_error(statement text, expected text, reason text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM=expected THEN RETURN; END IF;
  RAISE EXCEPTION '% (got %)',reason,SQLERRM;
 END;
 RAISE EXCEPTION '%',reason;
END $$;
CREATE FUNCTION pg_temp.decide(run uuid, actor uuid, outcome text, reason text, request uuid DEFAULT gen_random_uuid(), scope uuid DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
 SELECT format('SELECT public.record_historical_model_run_decision(%L,%L,%L,%L,%L,%L,%L)',
  request,coalesce(scope,(SELECT workspace FROM decision_probe)),run,actor,public.model_recovery_expected_state(run)::text,outcome,reason);
$$;
-- MUTATION SEAM
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF has_function_privilege(r,'public.record_historical_model_run_decision(uuid,uuid,uuid,uuid,jsonb,text,text)','EXECUTE') THEN RAISE EXCEPTION 'decision executable by %',r; END IF;
  IF has_function_privilege(r,'public.inspect_model_recovery_status(uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'status reader executable by %',r; END IF;
 END LOOP;
 IF NOT has_function_privilege('service_role','public.record_historical_model_run_decision(uuid,uuid,uuid,uuid,jsonb,text,text)','EXECUTE') THEN RAISE EXCEPTION 'service decision unavailable'; END IF;
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF has_table_privilege(r,'public.model_run_recovery_receipts','SELECT') OR has_table_privilege(r,'public.model_run_recovery_receipts','INSERT')
  THEN RAISE EXCEPTION 'receipt exposed'; END IF;
 END LOOP;
END $$;
SELECT pg_temp.expect_error(pg_temp.decide(keep_run,viewer_id,'kept_as_record','Viewer probe'),'Model recovery requires an owner or administrator','viewer decision accepted') FROM decision_probe;
SELECT pg_temp.expect_error(pg_temp.decide(keep_run,outsider_id,'kept_as_record','Outsider probe'),'Model recovery requires an owner or administrator','outsider decision accepted') FROM decision_probe;
SELECT pg_temp.expect_error(pg_temp.decide(keep_run,outsider_id,'kept_as_record','Wrong scope probe',gen_random_uuid(),other_workspace),'Model recovery scope mismatch','wrong workspace accepted') FROM decision_probe;
SELECT pg_temp.expect_error(pg_temp.decide(keep_run,owner_id,'resumed','Unknown outcome probe'),'Invalid historical model run decision','unknown outcome accepted') FROM decision_probe;
SELECT pg_temp.expect_error(pg_temp.decide(keep_run,owner_id,'kept_as_record','   '),'Invalid historical model run decision','blank reason accepted') FROM decision_probe;
SELECT pg_temp.expect_error(format('SELECT public.record_historical_model_run_decision(%L,%L,%L,%L,%L,%L,%L)',gen_random_uuid(),workspace,keep_run,admin_id,
 jsonb_set(public.model_recovery_expected_state(keep_run),'{updated_at}','"2001-01-01T00:00:00+00:00"')::text,'kept_as_record','Stale probe'),
 'Model recovery state changed','stale state accepted') FROM decision_probe;
-- The existing abandonment command cannot reach a historical run; that is why this command exists.
SELECT pg_temp.expect_error(format('SELECT public.abandon_model_run_execution(%L,%L,%L,%L,%L,%L,%L)',gen_random_uuid(),workspace,close_run,admin_id,
 public.model_recovery_expected_state(close_run)::text,'Abandon probe','{}'),'Historical model execution requires reconciliation','historical abandonment accepted') FROM decision_probe;
-- The private expected-state helper is read as the owner; only the command runs as service_role.
CREATE TEMP TABLE decision_states AS SELECT r AS run_id,public.model_recovery_expected_state(r) state
 FROM decision_probe,LATERAL unnest(ARRAY[keep_run,close_run]) r;
GRANT SELECT ON decision_states TO service_role;
SET LOCAL ROLE service_role;
SELECT set_config('decision_probe.kept',public.record_historical_model_run_decision(p.request_id,p.workspace,p.keep_run,p.owner_id,
 s.state,'kept_as_record','Reviewed saved outputs')::text,true) FROM decision_probe p JOIN decision_states s ON s.run_id=p.keep_run;
RESET ROLE;
DO $$ DECLARE p decision_probe%ROWTYPE; kept jsonb; retried jsonb; status jsonb; BEGIN
 SELECT * INTO p FROM decision_probe; kept:=current_setting('decision_probe.kept')::jsonb;
 IF kept->>'outcome' IS DISTINCT FROM 'kept_as_record' OR kept->>'actor_id' IS DISTINCT FROM p.owner_id::text
  OR kept->'request_payload'->>'reason' IS DISTINCT FROM 'Reviewed saved outputs' OR kept->>'run_status' IS DISTINCT FROM 'succeeded'
  OR (kept->>'run_record_changed')::boolean OR (kept->>'continuation_authorized')::boolean OR (kept->>'model_resumed')::boolean THEN
  RAISE EXCEPTION 'keep receipt wrong';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.model_run_recovery_receipts WHERE request_id=p.request_id AND actor_id=p.owner_id AND run_id=p.keep_run
   AND request_payload->>'reason'='Reviewed saved outputs') THEN RAISE EXCEPTION 'keep receipt not retained'; END IF;
 retried:=public.record_historical_model_run_decision(p.request_id,p.workspace,p.keep_run,p.owner_id,public.model_recovery_expected_state(p.keep_run),'kept_as_record','Reviewed saved outputs');
 IF retried IS DISTINCT FROM kept OR (SELECT count(*) FROM public.model_run_recovery_receipts WHERE run_id=p.keep_run)<>1 THEN RAISE EXCEPTION 'retry not idempotent'; END IF;
 status:=public.inspect_model_recovery_status(p.workspace,p.keep_run);
 IF status->>'provenance' IS DISTINCT FROM 'historical_unassessed' OR status->'historical_decision'->>'outcome' IS DISTINCT FROM 'kept_as_record'
  OR status->'historical_decision'->>'actor_id' IS DISTINCT FROM p.owner_id::text OR status->'historical_decision'->>'reason' IS DISTINCT FROM 'Reviewed saved outputs'
  OR status->'historical_decision'->>'request_id' IS DISTINCT FROM p.request_id::text THEN RAISE EXCEPTION 'status reader lost decision'; END IF;
 IF public.inspect_model_recovery_status(p.workspace,p.close_run)->'historical_decision' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'undecided run shows decision'; END IF;
END $$;
SELECT pg_temp.expect_error(pg_temp.decide(keep_run,owner_id,'kept_as_record','Changed reason',request_id),'Model recovery request identity reused with different payload','reused request accepted') FROM decision_probe;
SELECT pg_temp.expect_error(pg_temp.decide(keep_run,admin_id,'closed_for_fresh_run','Second decision'),'Historical model run decision already recorded','second decision accepted') FROM decision_probe;
SELECT pg_temp.expect_error(format('UPDATE public.model_run_recovery_receipts SET actor_id=%L WHERE request_id=%L',admin_id,request_id),'Model recovery receipt is immutable','receipt mutable') FROM decision_probe;
SELECT pg_temp.expect_error(format('UPDATE public.model_runs SET status=%L WHERE id=%L','cancelled',keep_run),'Historical model execution requires reconciliation','kept run writable') FROM decision_probe;
-- Close the stuck run, then start a fresh run on the same model as the launch route does.
SET LOCAL ROLE service_role;
SELECT public.record_historical_model_run_decision(gen_random_uuid(),p.workspace,p.close_run,p.admin_id,s.state,'closed_for_fresh_run','Closed after review')
 FROM decision_probe p JOIN decision_states s ON s.run_id=p.close_run;
RESET ROLE;
DO $$ DECLARE p decision_probe%ROWTYPE; BEGIN
 SELECT * INTO p FROM decision_probe;
 IF public.inspect_model_recovery_status(p.workspace,p.close_run)->'historical_decision'->>'outcome' IS DISTINCT FROM 'closed_for_fresh_run' THEN RAISE EXCEPTION 'close not recorded'; END IF;
 INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title) VALUES(p.fresh_run,p.workspace,p.model_id,'behavioral_demand','queued','Synthetic fresh run');
 INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES(p.fresh_stage,p.fresh_run,'Assignment','queued',1);
 IF (SELECT provenance FROM public.model_execution_custody_enrollment WHERE run_id=p.fresh_run) IS DISTINCT FROM 'new_run' THEN RAISE EXCEPTION 'fresh run not enrolled new'; END IF;
 IF (SELECT status FROM public.model_runs WHERE id=p.close_run) IS DISTINCT FROM 'running' THEN RAISE EXCEPTION 'closed run status changed'; END IF;
 IF public.inspect_model_recovery_status(p.workspace,p.fresh_run)->'historical_decision' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'fresh run inherited decision'; END IF;
END $$;
SELECT pg_temp.expect_error(pg_temp.decide(fresh_run,owner_id,'kept_as_record','New run probe'),'Historical model run decision requires historical enrollment','new run decision accepted') FROM decision_probe;
DO $$ DECLARE p decision_probe%ROWTYPE; b decision_before%ROWTYPE; BEGIN
 SELECT * INTO p FROM decision_probe; SELECT * INTO b FROM decision_before;
 IF (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.model_runs r WHERE r.model_id=p.model_id AND r.id<>p.fresh_run) IS DISTINCT FROM b.runs
  OR (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.model_run_stages s JOIN public.model_runs r ON r.id=s.run_id WHERE r.model_id=p.model_id AND r.id<>p.fresh_run) IS DISTINCT FROM b.stages
  OR (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.model_run_artifacts a WHERE a.run_id=p.keep_run) IS DISTINCT FROM b.artifacts THEN
  RAISE EXCEPTION 'historical records changed';
 END IF;
END $$;
SELECT set_config('request.jwt.claim.sub',(SELECT viewer_id::text FROM decision_probe),true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.model_runs WHERE id=(SELECT keep_run FROM decision_probe))<>1
  OR (SELECT count(*) FROM public.model_run_artifacts WHERE id=(SELECT keep_artifact FROM decision_probe))<>1 THEN RAISE EXCEPTION 'kept outputs unreadable'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub',(SELECT outsider_id::text FROM decision_probe),true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.model_run_artifacts WHERE id=(SELECT keep_artifact FROM decision_probe))<>0 THEN RAISE EXCEPTION 'outsider reads kept outputs'; END IF;
END $$;
RESET ROLE;
