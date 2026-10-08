
SET LOCAL ROLE service_role;
DO $test$
BEGIN
 BEGIN
  UPDATE public.model_runs SET status='succeeded' WHERE id='57afae71-f16e-4152-b7f3-f32670040de9';
  RAISE EXCEPTION 'legacy parent overwrite accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Managed model run requires an attempt command' THEN RAISE; END IF;
 END;
 BEGIN
  UPDATE public.model_runs SET attempt_managed=false WHERE id='57afae71-f16e-4152-b7f3-f32670040de9';
  RAISE EXCEPTION 'managed parent downgrade accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Managed model run requires an attempt command' THEN RAISE; END IF;
 END;
END;
$test$;
RESET ROLE;
DO $test$
BEGIN
 IF EXISTS(SELECT 1 FROM public.model_run_write_context) THEN RAISE EXCEPTION 'parent context leaked'; END IF;
 IF has_table_privilege('service_role','public.model_run_write_context','INSERT') THEN RAISE EXCEPTION 'direct parent context access'; END IF;
 IF NOT (SELECT attempt_managed FROM public.model_runs WHERE id='57afae71-f16e-4152-b7f3-f32670040de9') THEN RAISE EXCEPTION 'parent fence absent'; END IF;
END;
$test$;
