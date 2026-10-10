SET LOCAL ROLE service_role;
DO $test$
DECLARE
 managed uuid := gen_random_uuid(); unmanaged uuid := gen_random_uuid(); stage uuid := gen_random_uuid();
 workspace uuid := 'de125ce5-820f-4a6c-af47-3983311b5897'; claim uuid := gen_random_uuid(); metric uuid := gen_random_uuid();
 spec record; operation text;
BEGIN
 INSERT INTO model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
 SELECT managed,workspace_id,model_id,engine_key,'queued','Synthetic projection guard',created_by FROM model_runs WHERE id='57afae71-f16e-4152-b7f3-f32670040de9';
 INSERT INTO model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
 SELECT unmanaged,workspace_id,model_id,engine_key,'queued','Synthetic projection destination',created_by FROM model_runs WHERE id=managed;
 INSERT INTO model_run_stages(id,run_id,stage_name,status,sort_order) VALUES(stage,managed,'Synthetic projection','queued',1);
 INSERT INTO modeling_claim_decisions(id,workspace_id,model_run_id,track,claim_status,status_reason)
 VALUES(claim,workspace,managed,'assignment','prototype_only','Synthetic retained claim');
 INSERT INTO modeling_validation_results(id,workspace_id,model_run_id,track,metric_key,metric_label,status,detail)
 VALUES(metric,workspace,managed,'assignment','synthetic','Synthetic','warn','Synthetic retained metric');
 PERFORM public.claim_model_stage_attempt(gen_random_uuid(),stage,'projection-fixture');
 FOR spec IN SELECT * FROM (VALUES ('modeling_claim_decisions',claim),('modeling_validation_results',metric)) AS s(tab,id) LOOP
  FOREACH operation IN ARRAY ARRAY['insert','delete','move','update'] LOOP
   BEGIN
    IF operation='insert' THEN
     IF spec.tab='modeling_claim_decisions' THEN
      INSERT INTO modeling_claim_decisions(workspace_id,model_run_id,track,claim_status,status_reason)
      VALUES(workspace,managed,'behavioral_demand','prototype_only','Synthetic new claim');
     ELSE
      INSERT INTO modeling_validation_results(workspace_id,model_run_id,track,metric_key,metric_label,status,detail)
      VALUES(workspace,managed,'behavioral_demand','synthetic_new','Synthetic','warn','Synthetic new metric');
     END IF;
    ELSIF operation='delete' THEN
     EXECUTE format('DELETE FROM %I WHERE id=$1',spec.tab) USING spec.id;
    ELSIF operation='move' THEN
     EXECUTE format('UPDATE %I SET model_run_id=$1 WHERE id=$2',spec.tab) USING unmanaged,spec.id;
    ELSE
     EXECUTE format('UPDATE %I SET track=$1 WHERE id=$2',spec.tab) USING 'behavioral_demand',spec.id;
    END IF;
    RAISE EXCEPTION 'legacy projection % accepted',operation;
   EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'Managed model scientific projection requires attempt-bound ingestion' THEN RAISE; END IF;
   END;
  END LOOP;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM modeling_claim_decisions WHERE id=claim AND model_run_id=managed AND track='assignment' AND claim_status='prototype_only')
 OR NOT EXISTS(SELECT 1 FROM modeling_validation_results WHERE id=metric AND model_run_id=managed AND track='assignment' AND status='warn') THEN RAISE EXCEPTION 'retained scientific projection changed'; END IF;
 INSERT INTO modeling_claim_decisions(workspace_id,model_run_id,track,claim_status,status_reason)
 VALUES(workspace,unmanaged,'assignment','prototype_only','Synthetic unmanaged claim');
 DELETE FROM modeling_claim_decisions WHERE model_run_id=unmanaged;
 IF EXISTS(SELECT 1 FROM modeling_claim_decisions WHERE model_run_id=unmanaged) THEN RAISE EXCEPTION 'unmanaged projection delete refused'; END IF;
END;
$test$;
RESET ROLE;
