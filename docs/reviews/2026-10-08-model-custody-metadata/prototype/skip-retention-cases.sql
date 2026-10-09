DO $$
DECLARE run uuid; stage uuid; prior uuid; ws uuid; request uuid; blocker_status text; expected text;
BEGIN
 FOREACH blocker_status IN ARRAY ARRAY['failed','queued'] LOOP
  run:=gen_random_uuid(); stage:=gen_random_uuid(); prior:=gen_random_uuid(); request:=gen_random_uuid();
  INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
   SELECT run,workspace_id,model_id,engine_key,'queued','Synthetic skip retention',created_by
   FROM public.model_runs WHERE id='__FIXTURE_RUN__' RETURNING workspace_id INTO ws;
  IF ws IS NULL THEN RAISE EXCEPTION 'Retention fixture missing'; END IF;
  INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES
   (prior,run,'Synthetic prerequisite',blocker_status,1),(stage,run,'Synthetic dependent','queued',2);
  PERFORM public.skip_blocked_model_stage(request,ws,run,stage,prior,'failed');
  expected:=CASE WHEN blocker_status='failed' THEN 'retained' ELSE 'unstarted' END;
  IF public.inspect_model_relaunch_custody(ws,run)->>'state' IS DISTINCT FROM expected THEN
   RAISE EXCEPTION 'Skip retention state differs: expected %',expected;
  END IF;
  IF EXISTS(SELECT 1 FROM public.model_stage_execution_starts WHERE run_id=run) THEN
   RAISE EXCEPTION 'Skip retention invented start';
  END IF;
  BEGIN
   UPDATE public.model_stage_skip_receipts SET response_payload='{}'::jsonb WHERE request_id=request;
   RAISE EXCEPTION 'Skip receipt rewrite accepted' USING ERRCODE='ZX002';
  EXCEPTION WHEN SQLSTATE '55000' THEN
   IF SQLERRM<>'Model stage skip receipt is immutable' THEN RAISE; END IF;
  END;
  BEGIN
   DELETE FROM public.model_stage_skip_receipts WHERE request_id=request;
   RAISE EXCEPTION 'Skip receipt deletion accepted' USING ERRCODE='ZX002';
  EXCEPTION WHEN SQLSTATE '55000' THEN
   IF SQLERRM<>'Model stage skip receipt is immutable' THEN RAISE; END IF;
  END;
  IF expected='retained' THEN
   BEGIN
    UPDATE public.model_run_stages SET status='queued' WHERE id=stage;
    RAISE EXCEPTION 'Skipped history requeued' USING ERRCODE='ZX002';
   EXCEPTION WHEN SQLSTATE '55000' THEN
    IF SQLERRM<>'Retained model outputs require continuation reconciliation' THEN RAISE; END IF;
   END;
  ELSE
   IF public.claim_model_stage_attempt(gen_random_uuid(),prior,'synthetic-noop-followup')->>'outcome'<>'claimed' THEN
    RAISE EXCEPTION 'No-op receipt blocked legitimate first claim';
   END IF;
  END IF;
 END LOOP;
END $$;
