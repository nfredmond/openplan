SET LOCAL ROLE service_role;
DO $test$
DECLARE r uuid := gen_random_uuid();
BEGIN
 BEGIN
  INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by,attempt_managed)
  VALUES(gen_random_uuid(),'de125ce5-820f-4a6c-af47-3983311b5897','d735992f-c88f-4a47-8b9c-e7a5070de11c','aequilibrae','queued','Synthetic rejected enrollment','31c15ac9-9f41-4211-993f-dae10983265c',true);
  RAISE EXCEPTION 'run insertion enrolled attempt ownership';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'New model rows must start without attempt management' THEN RAISE; END IF;
 END;
 INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
 VALUES(r,'de125ce5-820f-4a6c-af47-3983311b5897','d735992f-c88f-4a47-8b9c-e7a5070de11c','aequilibrae','queued','Synthetic default enrollment','31c15ac9-9f41-4211-993f-dae10983265c');
 BEGIN
  INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order,attempt_managed)
  VALUES(gen_random_uuid(),r,'Rejected enrollment','queued',1,true);
  RAISE EXCEPTION 'stage insertion enrolled attempt ownership';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'New model rows must start without attempt management' THEN RAISE; END IF;
 END;
 INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order)
 VALUES(gen_random_uuid(),r,'Default unmanaged stage','queued',1);
 IF EXISTS(SELECT 1 FROM public.model_runs WHERE id=r AND attempt_managed)
     OR EXISTS(SELECT 1 FROM public.model_run_stages WHERE run_id=r AND attempt_managed) THEN
  RAISE EXCEPTION 'default insertion enrolled attempt ownership';
 END IF;
END;
$test$;
RESET ROLE;
