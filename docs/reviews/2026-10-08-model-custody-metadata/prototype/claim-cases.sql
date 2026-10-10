
INSERT INTO auth.users(id,email) VALUES ('31c15ac9-9f41-4211-993f-dae10983265c','prototype-31c15ac9-9f41-4211-993f-dae10983265c@example.test');
INSERT INTO workspaces(id,name,slug) VALUES ('de125ce5-820f-4a6c-af47-3983311b5897','Synthetic attempt prototype','prototype-de125ce5-820f-4a6c-af47-3983311b5897');
INSERT INTO models(id,workspace_id,title,model_family,created_by) VALUES ('d735992f-c88f-4a47-8b9c-e7a5070de11c','de125ce5-820f-4a6c-af47-3983311b5897','Synthetic attempt prototype','travel_demand','31c15ac9-9f41-4211-993f-dae10983265c');
INSERT INTO model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by) VALUES ('57afae71-f16e-4152-b7f3-f32670040de9','de125ce5-820f-4a6c-af47-3983311b5897','d735992f-c88f-4a47-8b9c-e7a5070de11c','aequilibrae','queued','Synthetic attempt prototype','31c15ac9-9f41-4211-993f-dae10983265c');
INSERT INTO model_run_stages(id,run_id,stage_name,status,sort_order) VALUES ('9898f32b-23e4-4f0f-9a39-36ff4f1b2920','57afae71-f16e-4152-b7f3-f32670040de9','AequilibraE Setup','queued',1), ('14b7e2f8-6d51-4a35-991e-f4c362f80d8c','57afae71-f16e-4152-b7f3-f32670040de9','Network Assignment','queued',2);
SET LOCAL ROLE service_role;
DO $test$
DECLARE first_result jsonb; repeated jsonb; loser jsonb;
BEGIN
 first_result := public.claim_model_stage_attempt('63714167-0655-4890-ae46-39f36fe78e65','9898f32b-23e4-4f0f-9a39-36ff4f1b2920','worker-a');
 IF first_result->>'outcome' <> 'claimed' OR first_result->>'attempt_id' IS NULL THEN RAISE EXCEPTION 'claim absent'; END IF;
 repeated := public.claim_model_stage_attempt('63714167-0655-4890-ae46-39f36fe78e65','9898f32b-23e4-4f0f-9a39-36ff4f1b2920','worker-a');
 IF repeated IS DISTINCT FROM first_result THEN RAISE EXCEPTION 'exact retry changed result'; END IF;
 BEGIN
  PERFORM public.claim_model_stage_attempt('63714167-0655-4890-ae46-39f36fe78e65','9898f32b-23e4-4f0f-9a39-36ff4f1b2920','worker-b');
  RAISE EXCEPTION 'changed request accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Model stage claim request identity reused with different payload' THEN RAISE; END IF;
 END;
 loser := public.claim_model_stage_attempt('5cce398f-020a-48e3-bbe9-c631fd9262bd','9898f32b-23e4-4f0f-9a39-36ff4f1b2920','worker-b');
 IF loser->>'outcome' <> 'not_claimed' THEN RAISE EXCEPTION 'second claimant won'; END IF;
 IF public.claim_model_stage_attempt('5cce398f-020a-48e3-bbe9-c631fd9262bd','9898f32b-23e4-4f0f-9a39-36ff4f1b2920','worker-b') IS DISTINCT FROM loser THEN RAISE EXCEPTION 'lost retry changed'; END IF;
 IF public.claim_model_stage_attempt('f1c79adb-d95b-4fe9-9b04-db797b51c141','14b7e2f8-6d51-4a35-991e-f4c362f80d8c','worker-b')->>'outcome' <> 'not_claimed' THEN RAISE EXCEPTION 'prior stage bypassed'; END IF;
END;
$test$;
RESET ROLE;
DO $test$
BEGIN
 IF (SELECT count(*) FROM public.model_stage_attempts) <> 1 THEN RAISE EXCEPTION 'attempt count wrong'; END IF;
 IF (SELECT count(*) FROM public.model_stage_claim_receipts) <> 3 THEN RAISE EXCEPTION 'receipt count wrong'; END IF;
 IF (SELECT status FROM public.model_run_stages WHERE id='9898f32b-23e4-4f0f-9a39-36ff4f1b2920') <> 'running' THEN RAISE EXCEPTION 'stage not running'; END IF;
 IF has_function_privilege('authenticated','public.claim_model_stage_attempt(uuid,uuid,text)','EXECUTE') OR has_function_privilege('anon','public.claim_model_stage_attempt(uuid,uuid,text)','EXECUTE') THEN RAISE EXCEPTION 'public claim access'; END IF;
 IF has_table_privilege('service_role','public.model_stage_attempts','INSERT') THEN RAISE EXCEPTION 'direct ledger insert access'; END IF;
END;
$test$;
