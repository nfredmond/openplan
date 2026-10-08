
-- Administrative fixture only: isolate the deletion guard from incidental FKs.
-- This state cannot be created through a normal client insert.
ALTER TABLE public.model_runs DISABLE TRIGGER guard_model_attempt_enrollment;
INSERT INTO model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by,attempt_managed)
 SELECT 'aebd87a9-a8ad-4c2e-b0c4-e04e8ab6e485',workspace_id,model_id,engine_key,'queued','Synthetic empty run',created_by,true
 FROM model_runs WHERE id='57afae71-f16e-4152-b7f3-f32670040de9';
ALTER TABLE public.model_runs ENABLE TRIGGER guard_model_attempt_enrollment;
INSERT INTO model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
 SELECT '0ed3d090-a7e6-40a5-bf58-52ae68c350fd',workspace_id,model_id,engine_key,'queued','Synthetic unmanaged run',created_by
 FROM model_runs WHERE id='57afae71-f16e-4152-b7f3-f32670040de9';
SET LOCAL ROLE service_role;
DO $test$
BEGIN
 DELETE FROM model_runs WHERE id='0ed3d090-a7e6-40a5-bf58-52ae68c350fd';
 IF NOT public.reap_model_run_if_stale('aebd87a9-a8ad-4c2e-b0c4-e04e8ab6e485',clock_timestamp(),'Synthetic empty run failure') THEN RAISE EXCEPTION 'empty run not reaped'; END IF;
 BEGIN
  DELETE FROM model_runs WHERE id='aebd87a9-a8ad-4c2e-b0c4-e04e8ab6e485';
  RAISE EXCEPTION 'managed run deletion accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Managed model run deletion requires an explicit retention command' THEN RAISE; END IF;
 END;
END;
$test$;
RESET ROLE;
DO $test$
BEGIN
 IF EXISTS(SELECT 1 FROM model_runs WHERE id='0ed3d090-a7e6-40a5-bf58-52ae68c350fd') THEN RAISE EXCEPTION 'unmanaged delete refused'; END IF;
 IF NOT EXISTS(SELECT 1 FROM model_runs WHERE id='aebd87a9-a8ad-4c2e-b0c4-e04e8ab6e485' AND status='failed' AND attempt_managed) THEN RAISE EXCEPTION 'managed run not retained'; END IF;
END;
$test$;
