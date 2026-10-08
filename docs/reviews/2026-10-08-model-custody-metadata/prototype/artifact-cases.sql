INSERT INTO model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
SELECT '58bd1c78-9d68-40da-b849-fdb414950926',workspace_id,model_id,engine_key,'queued','Synthetic artifact attempt',created_by
FROM model_runs WHERE id='57afae71-f16e-4152-b7f3-f32670040de9';
INSERT INTO model_run_stages(id,run_id,stage_name,status,sort_order)
VALUES('ac0b4263-b619-4d52-8e16-c487f97ee897','58bd1c78-9d68-40da-b849-fdb414950926','Synthetic artifact stage','queued',1);
SET LOCAL ROLE service_role;
DO $test$
DECLARE attempt uuid; result jsonb; payload jsonb := jsonb_build_object('artifact_type','synthetic_metadata','file_url','local://synthetic.json','file_size_bytes',0,'content_hash',repeat('a',64));
BEGIN
 attempt := (public.claim_model_stage_attempt('4b6a4fcd-b335-44e8-8e78-b6713db70d16','ac0b4263-b619-4d52-8e16-c487f97ee897','relaunch-worker')->>'attempt_id')::uuid;
 BEGIN
  PERFORM public.write_model_attempt_artifact('e033a9a1-7134-4d32-a533-470e92654bb4',attempt,payload-'content_hash');
  RAISE EXCEPTION 'missing artifact hash accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Invalid attempt artifact payload' THEN RAISE; END IF;
 END;
 result := public.write_model_attempt_artifact('e033a9a1-7134-4d32-a533-470e92654bb4',attempt,payload);
 IF result->>'stage_id' IS DISTINCT FROM 'ac0b4263-b619-4d52-8e16-c487f97ee897' OR result->>'attempt_id' IS DISTINCT FROM attempt::text THEN RAISE EXCEPTION 'artifact stage or attempt lost'; END IF;
 IF public.write_model_attempt_artifact('e033a9a1-7134-4d32-a533-470e92654bb4',attempt,payload) IS DISTINCT FROM result THEN RAISE EXCEPTION 'artifact retry changed'; END IF;
 BEGIN
  PERFORM public.write_model_attempt_artifact('e033a9a1-7134-4d32-a533-470e92654bb4',attempt,payload||'{"file_size_bytes":1}');
  RAISE EXCEPTION 'changed artifact accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Model artifact request identity reused with different payload' THEN RAISE; END IF;
 END;
 BEGIN
  INSERT INTO model_run_artifacts(run_id,artifact_type,file_url) VALUES('58bd1c78-9d68-40da-b849-fdb414950926','legacy','local://legacy');
  RAISE EXCEPTION 'legacy artifact accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Managed model artifact requires an attempt command' THEN RAISE; END IF;
 END;
 BEGIN
  UPDATE model_run_artifacts SET file_url='local://changed' WHERE id=(result->>'id')::uuid;
  RAISE EXCEPTION 'retained artifact overwritten';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Attempt artifact records are immutable' THEN RAISE; END IF;
 END;
 BEGIN
  DELETE FROM model_run_artifacts WHERE id=(result->>'id')::uuid;
  RAISE EXCEPTION 'retained artifact deleted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Attempt artifact records are immutable' THEN RAISE; END IF;
 END;
 PERFORM public.reap_model_run_if_stale('58bd1c78-9d68-40da-b849-fdb414950926',clock_timestamp(),'Synthetic artifact revoke');
 BEGIN
  PERFORM public.write_model_attempt_artifact('00e1131a-a3b5-42fc-9c77-cb0b3428a641',attempt,payload);
  RAISE EXCEPTION 'revoked artifact accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Model artifact attempt no longer owns work' THEN RAISE; END IF;
 END;
END;
$test$;
RESET ROLE;
DO $test$
BEGIN
 IF (SELECT count(*) FROM model_run_artifacts WHERE run_id='58bd1c78-9d68-40da-b849-fdb414950926' AND attempt_id IS NOT NULL AND stage_id='ac0b4263-b619-4d52-8e16-c487f97ee897') <> 1 THEN RAISE EXCEPTION 'retained artifact count wrong'; END IF;
 IF EXISTS(SELECT 1 FROM model_artifact_write_context) THEN RAISE EXCEPTION 'artifact context leaked'; END IF;
 IF has_table_privilege('service_role','public.model_artifact_write_context','INSERT') THEN RAISE EXCEPTION 'direct artifact context access'; END IF;
END;
$test$;
