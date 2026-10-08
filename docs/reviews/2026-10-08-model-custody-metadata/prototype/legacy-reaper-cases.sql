-- Installing attempt support must not enroll old work merely by reaping it.
DO $test$
DECLARE r uuid := gen_random_uuid(); active uuid := gen_random_uuid(); done uuid := gen_random_uuid(); terminal_before jsonb;
BEGIN
 INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
 VALUES(r,'de125ce5-820f-4a6c-af47-3983311b5897','d735992f-c88f-4a47-8b9c-e7a5070de11c','aequilibrae','running','Synthetic unmanaged reaper','31c15ac9-9f41-4211-993f-dae10983265c');
 INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order,completed_at,updated_at)
 VALUES(done,r,'Synthetic completed legacy stage','succeeded',1,clock_timestamp(),now()-interval '1 minute'),(active,r,'Synthetic running legacy stage','running',2,NULL,now()-interval '1 minute');
 SELECT to_jsonb(s) INTO terminal_before FROM public.model_run_stages s WHERE id=done;
 IF NOT public.reap_model_run_if_stale(r,clock_timestamp(),'Synthetic legacy timeout') THEN
  RAISE EXCEPTION 'legacy run was not reaped';
 END IF;
 IF EXISTS(SELECT 1 FROM public.model_runs WHERE id=r AND attempt_managed)
     OR EXISTS(SELECT 1 FROM public.model_run_stages WHERE run_id=r AND attempt_managed) THEN
  RAISE EXCEPTION 'legacy reaper changed ownership mode';
 END IF;
 IF (SELECT to_jsonb(s) FROM public.model_run_stages s WHERE id=done) IS DISTINCT FROM terminal_before THEN
  RAISE EXCEPTION 'legacy reaper rewrote completed stage';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.model_runs WHERE id=r AND status='failed' AND error_message='Synthetic legacy timeout')
     OR NOT EXISTS(SELECT 1 FROM public.model_run_stages WHERE id=active AND status='failed' AND error_message='Synthetic legacy timeout') THEN
  RAISE EXCEPTION 'legacy reaper omitted failure state';
 END IF;
 IF EXISTS(SELECT 1 FROM public.model_stage_attempts WHERE run_id=r) THEN
  RAISE EXCEPTION 'legacy reaper fabricated attempt';
 END IF;
 -- The existing relaunch reset remains possible until an attempt-aware claim.
 UPDATE public.model_run_stages SET status='queued',error_message=NULL,completed_at=NULL WHERE run_id=r;
 UPDATE public.model_runs SET status='queued',error_message=NULL,completed_at=NULL WHERE id=r;
END;
$test$;
