
SET LOCAL ROLE service_role;
DO $test$
BEGIN
 BEGIN
  INSERT INTO model_run_stages(id,run_id,stage_name,status,sort_order) VALUES
   ('75a25882-a1b9-4565-af74-0595e36ad41c','57afae71-f16e-4152-b7f3-f32670040de9','Late stage','queued',3);
  RAISE EXCEPTION 'managed stage insertion accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Managed model stage set is fixed' THEN RAISE; END IF;
 END;
 BEGIN
  DELETE FROM model_run_stages WHERE id='14b7e2f8-6d51-4a35-991e-f4c362f80d8c';
  RAISE EXCEPTION 'required stage deletion accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Managed model stage set is fixed' THEN RAISE; END IF;
 END;
 BEGIN
  UPDATE model_run_stages SET sort_order=0 WHERE id='14b7e2f8-6d51-4a35-991e-f4c362f80d8c';
  RAISE EXCEPTION 'required stage reorder accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Managed model stage set is fixed' THEN RAISE; END IF;
 END;
 BEGIN
  UPDATE model_run_stages SET status='succeeded' WHERE id='14b7e2f8-6d51-4a35-991e-f4c362f80d8c';
  RAISE EXCEPTION 'unclaimed required stage bypass accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Managed model stage set requires an attempt command' THEN RAISE; END IF;
 END;
END;
$test$;
RESET ROLE;
