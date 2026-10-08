SET LOCAL ROLE service_role;
DO $test$
DECLARE
 managed uuid := gen_random_uuid(); unmanaged uuid := gen_random_uuid(); stage uuid := gen_random_uuid();
 kpi uuid := gen_random_uuid(); artifact uuid := gen_random_uuid();
 spec record; operation text; expected text;
BEGIN
 INSERT INTO model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
 SELECT managed,workspace_id,model_id,engine_key,'queued','Synthetic historical outputs',created_by
 FROM model_runs WHERE id='57afae71-f16e-4152-b7f3-f32670040de9';
 INSERT INTO model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
 SELECT unmanaged,workspace_id,model_id,engine_key,'queued','Synthetic unmanaged destination',created_by
 FROM model_runs WHERE id=managed;
 INSERT INTO model_run_stages(id,run_id,stage_name,status,sort_order) VALUES(stage,managed,'Synthetic historical outputs','queued',1);
 INSERT INTO model_run_kpis(id,run_id,kpi_name,kpi_label,value) VALUES(kpi,managed,'historical','Historical',NULL);
 INSERT INTO model_run_artifacts(id,run_id,artifact_type,file_url) VALUES(artifact,managed,'historical','local://historical');
 PERFORM public.claim_model_stage_attempt(gen_random_uuid(),stage,'historical-worker');
 FOR spec IN SELECT * FROM (VALUES ('model_run_kpis',kpi,'KPI'),('model_run_artifacts',artifact,'artifact')) AS s(tab,id,label) LOOP
  expected := 'Attempt '||spec.label||' records are immutable';
  FOREACH operation IN ARRAY ARRAY['delete','move'] LOOP
   BEGIN
    IF operation='delete' THEN
     EXECUTE format('DELETE FROM %I WHERE id=$1',spec.tab) USING spec.id;
    ELSE
     EXECUTE format('UPDATE %I SET run_id=$1 WHERE id=$2',spec.tab) USING unmanaged,spec.id;
    END IF;
    RAISE EXCEPTION 'historical % % accepted',spec.label,operation;
   EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> expected THEN RAISE; END IF;
   END;
  END LOOP;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM model_run_kpis WHERE id=kpi AND run_id=managed AND attempt_id IS NULL AND value IS NULL)
 OR NOT EXISTS(SELECT 1 FROM model_run_artifacts WHERE id=artifact AND run_id=managed AND attempt_id IS NULL AND file_url='local://historical') THEN
  RAISE EXCEPTION 'historical output identity changed';
 END IF;
 -- Unmanaged output editing remains available until its parent adopts attempts.
 INSERT INTO model_run_kpis(run_id,kpi_name,kpi_label,value) VALUES(unmanaged,'editable','Editable',1);
 UPDATE model_run_kpis SET value=2 WHERE run_id=unmanaged;
 DELETE FROM model_run_kpis WHERE run_id=unmanaged;
 IF EXISTS(SELECT 1 FROM model_run_kpis WHERE run_id=unmanaged) THEN RAISE EXCEPTION 'unmanaged output deletion refused'; END IF;
END;
$test$;
RESET ROLE;
