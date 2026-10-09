DO $$
DECLARE old_run uuid:=current_setting('openplan.proof_fixture')::uuid; run uuid:=gen_random_uuid(); stage uuid:=gen_random_uuid(); ws uuid; state jsonb;
BEGIN
 SELECT workspace_id INTO ws FROM public.model_runs WHERE id=old_run;
 IF ws IS NULL THEN RAISE EXCEPTION 'Missing historical fixture'; END IF;
 IF (SELECT provenance FROM public.model_execution_custody_enrollment WHERE run_id=old_run) IS DISTINCT FROM 'historical_unassessed' THEN
  RAISE EXCEPTION 'Historical fixture was not preserved as unassessed';
 END IF;
 state:=public.inspect_model_relaunch_custody(ws,old_run);
 IF state->>'state' NOT IN('retained','unassessed') THEN RAISE EXCEPTION 'Historical run permitted replay'; END IF;
 BEGIN
  UPDATE public.model_runs SET status='running' WHERE id=old_run;
  RAISE EXCEPTION 'Installed historical fence allowed update' USING ERRCODE='ZX002';
 EXCEPTION WHEN SQLSTATE '55000' THEN
  IF SQLERRM<>'Historical model execution requires reconciliation' THEN RAISE; END IF;
 END;
 INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
 SELECT run,workspace_id,model_id,'aequilibrae','queued','Synthetic installed retention',created_by FROM public.model_runs WHERE id=old_run;
 IF public.inspect_model_relaunch_custody(ws,run)->>'state'<>'unstarted' THEN RAISE EXCEPTION 'New run enrollment failed'; END IF;
 INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES(stage,run,'Synthetic installed retention','queued',1);
 UPDATE public.model_run_stages SET status='running' WHERE id=stage AND status='queued';
 IF public.inspect_model_relaunch_custody(ws,run)->>'state'<>'retained' THEN RAISE EXCEPTION 'Installed claim start missing'; END IF;
 BEGIN
  UPDATE public.model_runs SET status='queued' WHERE id=run;
  RAISE EXCEPTION 'Installed queued parent permitted reset' USING ERRCODE='ZX002';
 EXCEPTION WHEN SQLSTATE '55000' THEN
  IF SQLERRM<>'Retained model outputs require continuation reconciliation' THEN RAISE; END IF;
 END;
 UPDATE public.model_runs SET status='running' WHERE id=run;
 UPDATE public.model_run_stages SET status='succeeded' WHERE id=stage;
 UPDATE public.model_runs SET status='succeeded' WHERE id=run;
 IF (SELECT status FROM public.model_runs WHERE id=run)<>'succeeded' THEN RAISE EXCEPTION 'Installed normal completion failed'; END IF;
END $$;
