-- Run only in an isolated BEGIN/ROLLBACK after ROOT installs the proposed SQL.
-- Metadata-only native fixture. No file, roster, engine or scientific result is asserted.
\ir common-population-comparisons.sql
-- A second synthetic owner lets withdrawal reach the population guard without
-- violating the independent workspace owner-floor invariant.
DO $$ DECLARE backup_owner uuid:=gen_random_uuid(); BEGIN
 INSERT INTO auth.users(id,email) VALUES(backup_owner,backup_owner||'@example.test');
 INSERT INTO public.workspace_members(workspace_id,user_id,role)
  SELECT workspace_id,backup_owner,'owner' FROM cp_probe;
END $$;
CREATE TEMP TABLE replacement_probe(
 original uuid DEFAULT gen_random_uuid(), setup uuid DEFAULT gen_random_uuid(),
 checkpoint uuid DEFAULT gen_random_uuid(), request_id uuid DEFAULT gen_random_uuid(),
 facts jsonb, saved_state jsonb, registered jsonb, receipt jsonb, old_run jsonb, old_stages jsonb);
INSERT INTO replacement_probe DEFAULT VALUES;
GRANT SELECT ON replacement_probe TO authenticated;
DO $$ DECLARE p replacement_probe%ROWTYPE; g cp_groups%ROWTYPE; cp cp_probe%ROWTYPE; inventory jsonb; request jsonb; BEGIN
 SELECT * INTO p FROM replacement_probe; SELECT * INTO g FROM cp_groups WHERE name='main'; SELECT * INTO cp FROM cp_probe;
 request:=jsonb_build_object('schema','openplan.common-population-request.v1','custody','legacy_stage_snapshot',
  'mode','generate','comparisonPolicy','fixed_population_auto_trip_change','sourceProfile',cp.profile);
 INSERT INTO public.model_runs(id,workspace_id,project_id,model_id,scenario_set_id,scenario_entry_id,engine_key,status,run_title,corridor_geojson,input_snapshot_json,assumption_snapshot_json,created_by)
 VALUES(p.original,g.workspace_id,g.project_id,g.model_id,g.scenario_set_id,g.baseline_id,'aequilibrae','queued','Prospective replacement fixture',cp.geometry,
  jsonb_build_object('zoneGeography','tract','commonPopulation',request),'{}',cp.owner_id);
 INSERT INTO public.model_run_stages(id,run_id,stage_name,sort_order,status) VALUES(p.setup,p.original,'AequilibraE Setup',1,'queued');
 INSERT INTO public.model_run_stages(run_id,stage_name,sort_order,status) VALUES
  (p.original,'Network Assignment',2,'queued'),(p.original,'Artifact Extraction',3,'queued');
 UPDATE public.model_run_stages SET status='running' WHERE id=p.setup;
 UPDATE public.model_runs SET status='running' WHERE id=p.original;
 SELECT jsonb_object_agg(name,jsonb_build_object('path',name,'bytes',12,'sha256',repeat('a',64))) INTO inventory
 FROM unnest(ARRAY['manifest.json','zone_attributes.csv','od_trip_matrix.csv','common_population/common_population.json',
  'common_population/households.csv','common_population/persons.csv','common_population/selected_zones.json',
  'common_population/diagnostics.json','common_population/source_manifest.json','common_population/source_zone_attributes.csv']) name;
 -- Keep the exact existing synthetic seven-member descriptors and basis.
 SELECT inventory||jsonb_object_agg('common_population/'||path,
  jsonb_build_object('path','common_population/'||path,'bytes',bytes,'sha256',sha256)) INTO inventory FROM cp_source_files;
 p.facts:=jsonb_build_object('inputs',jsonb_build_object('run_id',p.original,'stage_id',p.setup,'workspace_id',g.workspace_id,
  'authority',jsonb_build_object('request',request),'source_record',jsonb_build_object('run_id',p.original,'workspace_id',g.workspace_id,'source_profile',cp.profile)),
  'inputs_sha256',repeat('f',64),'result_sha256',repeat('b',64),'inventory',inventory,'snapshot',jsonb_build_object('manifest_sha256',repeat('c',64),'manifest_size_bytes',321),
  'population_digest',cp.basis_digest,'settings',jsonb_build_object('schema','openplan.population-replacement-settings.v1'),
  'publication_sha256',repeat('e',64));
 p.registered:=public.register_model_population_checkpoint(p.checkpoint,g.workspace_id,p.original,p.setup,'native-replacement-fixture',p.facts);
 IF p.registered IS DISTINCT FROM public.register_model_population_checkpoint(p.checkpoint,g.workspace_id,p.original,p.setup,'native-replacement-fixture',p.facts)
  THEN RAISE EXCEPTION 'Registration retry changed identity'; END IF;
 UPDATE public.model_run_stages SET status='failed',error_message='Supplied later network failure' WHERE id=p.setup;
 UPDATE public.model_runs SET status='failed',error_message='Supplied later network failure' WHERE id=p.original;
 p.saved_state:=public.model_recovery_expected_state(p.original);
 SELECT to_jsonb(r) INTO p.old_run FROM public.model_runs r WHERE id=p.original;
 SELECT jsonb_agg(to_jsonb(s) ORDER BY id) INTO p.old_stages FROM public.model_run_stages s WHERE run_id=p.original;
 p.receipt:=public.create_model_population_replacement(p.request_id,g.workspace_id,p.original,cp.owner_id,p.saved_state,
  p.checkpoint,repeat('b',64),'Use this exact registered population',true);
 IF p.receipt IS DISTINCT FROM public.create_model_population_replacement(p.request_id,g.workspace_id,p.original,cp.owner_id,p.saved_state,
  p.checkpoint,repeat('b',64),'Use this exact registered population',true) THEN RAISE EXCEPTION 'Create retry minted another run'; END IF;
 IF (SELECT count(*) FROM public.model_run_stages WHERE run_id=(p.receipt->>'replacement_run_id')::uuid)<>3 THEN
  RAISE EXCEPTION 'Atomic complete stage set missing'; END IF;
 IF p.old_run IS DISTINCT FROM (SELECT to_jsonb(r) FROM public.model_runs r WHERE id=p.original)
  OR p.old_stages IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.model_run_stages s WHERE run_id=p.original)
  THEN RAISE EXCEPTION 'Replacement changed original failed history'; END IF;
 UPDATE replacement_probe SET facts=p.facts,saved_state=p.saved_state,registered=p.registered,receipt=p.receipt,old_run=p.old_run,old_stages=p.old_stages;
END $$;
CREATE FUNCTION pg_temp.replacement_expect_error(statement text, expected_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE=expected_state THEN RETURN; END IF; RAISE;
 END;
 RAISE EXCEPTION 'Replacement native refusal did not occur';
END $$;
SELECT pg_temp.replacement_expect_error(format('SELECT public.create_model_population_replacement(%L,%L,%L,%L,%L,%L,%L,%L,true)',
 request_id,g.workspace_id,original,cp.viewer_id,saved_state,checkpoint,repeat('b',64),'Denied source access'),'42501')
 FROM replacement_probe p,cp_groups g,cp_probe cp WHERE g.name='main';
SELECT pg_temp.replacement_expect_error(format('SELECT public.create_model_population_replacement(%L,%L,%L,%L,%L,%L,%L,%L,true)',
 request_id,g.workspace_id,original,cp.owner_id,saved_state,checkpoint,repeat('b',64),'Changed request reason'),'23514')
 FROM replacement_probe p,cp_groups g,cp_probe cp WHERE g.name='main';
DO $$ DECLARE p replacement_probe%ROWTYPE; g cp_groups%ROWTYPE; cp cp_probe%ROWTYPE; next_id uuid; next_setup uuid; body jsonb; chained jsonb;
 ordinary uuid:=gen_random_uuid(); ordinary_setup uuid:=gen_random_uuid(); ordinary_facts jsonb;
BEGIN
 SELECT * INTO p FROM replacement_probe; SELECT * INTO g FROM cp_groups WHERE name='main'; SELECT * INTO cp FROM cp_probe;
 next_id:=(p.receipt->>'replacement_run_id')::uuid;
 IF NOT public.inspect_model_population_redispatch(g.workspace_id,next_id,cp.owner_id) THEN RAISE EXCEPTION 'Intact new run cannot redispatch'; END IF;
 SELECT id INTO next_setup FROM public.model_run_stages WHERE run_id=next_id AND stage_name='AequilibraE Setup';
 UPDATE public.model_run_stages SET status='running' WHERE id=next_setup AND status='queued';
 UPDATE public.model_runs SET status='running' WHERE id=next_id;
 body:=public.read_model_population_origin(g.workspace_id,next_id);
 IF body->'lineage'->>'checkpoint_id' IS DISTINCT FROM p.checkpoint::text THEN RAISE EXCEPTION 'Original package lineage lost'; END IF;
 IF public.inspect_model_population_redispatch(g.workspace_id,next_id,cp.owner_id) THEN RAISE EXCEPTION 'Started run can redispatch'; END IF;
 -- A committed abandonment fences execution; a new reviewed request may still copy its root data.
 PERFORM public.abandon_model_run_execution(gen_random_uuid(),g.workspace_id,next_id,cp.owner_id,
  public.model_recovery_expected_state(next_id),'Dispose uncertain registered replacement','{}');
 IF (public.inspect_model_population_replacement(g.workspace_id,next_id,cp.owner_id))->>'state'<>'available' THEN
  RAISE EXCEPTION 'Confirmed legacy replacement abandonment strands its registered population'; END IF;
 chained:=public.create_model_population_replacement(gen_random_uuid(),g.workspace_id,next_id,cp.owner_id,
  public.model_recovery_expected_state(next_id),p.checkpoint,repeat('b',64),'New run after confirmed abandonment',true);
 next_id:=(chained->>'replacement_run_id')::uuid;
 UPDATE replacement_probe SET receipt=chained;
 SELECT id INTO next_setup FROM public.model_run_stages WHERE run_id=next_id AND stage_name='AequilibraE Setup';
 UPDATE public.model_run_stages SET status='running' WHERE id=next_setup;
 UPDATE public.model_runs SET status='running' WHERE id=next_id;
 -- Registration alone does not authorize recovery of an ordinary cancelled execution.
 INSERT INTO public.model_runs(id,workspace_id,project_id,model_id,scenario_set_id,scenario_entry_id,engine_key,status,run_title,corridor_geojson,input_snapshot_json,assumption_snapshot_json,created_by)
  SELECT ordinary,workspace_id,project_id,model_id,scenario_set_id,scenario_entry_id,engine_key,'running','Unrelated cancelled source',corridor_geojson,input_snapshot_json,assumption_snapshot_json,cp.owner_id
  FROM public.model_runs WHERE id=p.original;
 INSERT INTO public.model_run_stages(id,run_id,stage_name,sort_order,status) VALUES(ordinary_setup,ordinary,'AequilibraE Setup',1,'running');
 ordinary_facts:=jsonb_set(jsonb_set(jsonb_set(p.facts,'{inputs,run_id}',to_jsonb(ordinary::text)),
  '{inputs,stage_id}',to_jsonb(ordinary_setup::text)),'{inputs,source_record,run_id}',to_jsonb(ordinary::text));
 PERFORM public.register_model_population_checkpoint(gen_random_uuid(),g.workspace_id,ordinary,ordinary_setup,'native-replacement-fixture',ordinary_facts);
 PERFORM public.abandon_model_run_execution(gen_random_uuid(),g.workspace_id,ordinary,cp.owner_id,
  public.model_recovery_expected_state(ordinary),'Ordinary cancellation without replacement lineage','{}');
 IF (public.inspect_model_population_replacement(g.workspace_id,ordinary,cp.owner_id))->>'state'='available' THEN
  RAISE EXCEPTION 'Unrelated cancelled execution acquired replacement authority'; END IF;
END $$;
-- PUBLICATION AND FOUR-JOB SEAM
CREATE TEMP TABLE replacement_commands(run_id uuid,kind text,payload jsonb,response jsonb,PRIMARY KEY(run_id,kind));
GRANT SELECT,INSERT ON replacement_commands TO service_role;
CREATE FUNCTION pg_temp.replacement_member(p_run uuid,p_kind text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r public.model_runs%ROWTYPE; f cp_source_files%ROWTYPE; setup uuid; lineage jsonb; metadata jsonb;
BEGIN
 SELECT * INTO STRICT r FROM public.model_runs WHERE id=p_run;
 SELECT * INTO STRICT f FROM cp_source_files WHERE kind=p_kind;
 SELECT id INTO STRICT setup FROM public.model_run_stages WHERE run_id=p_run AND stage_name='AequilibraE Setup';
 lineage:=public.read_model_population_lineage(r.workspace_id,r.id);
 SELECT source_metadata||jsonb_build_object('custody','legacy_stage_snapshot',
  'origin',r.input_snapshot_json#>'{commonPopulation,source}','replacement',lineage) INTO metadata FROM cp_probe;
 RETURN jsonb_build_object('id',gen_random_uuid(),'run_id',r.id,'stage_id',setup,'artifact_type',f.kind,
  'file_url','local://synthetic/replacements/'||r.id||'/common_population/'||f.path,
  'file_size_bytes',f.bytes,'content_hash',f.sha256,'metadata_json',metadata);
END $$;
CREATE FUNCTION pg_temp.replacement_record(p_run uuid,p_kind text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE payload jsonb; reply jsonb; workspace uuid;
BEGIN
 payload:=pg_temp.replacement_member(p_run,p_kind);
 SELECT workspace_id INTO workspace FROM public.model_runs WHERE id=p_run;
 reply:=public.record_legacy_model_artifact(workspace,payload);
 IF reply IS DISTINCT FROM public.record_legacy_model_artifact(workspace,payload) THEN
  RAISE EXCEPTION 'Exact new publication retry changed its receipt'; END IF;
 INSERT INTO replacement_commands VALUES(p_run,p_kind,payload,reply);
END $$;
CREATE FUNCTION pg_temp.replacement_context_edit(p_run uuid,p_target text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r public.model_runs%ROWTYPE; payload jsonb;
BEGIN
 SELECT * INTO r FROM public.model_runs WHERE id=p_run;
 payload:=pg_temp.replacement_member(p_run,'common_population');
 BEGIN
  CASE p_target
   WHEN 'model' THEN UPDATE public.models SET config_json=config_json||'{"replacement_fixture_change":true}' WHERE id=r.model_id;
   WHEN 'scenario_set' THEN UPDATE public.scenario_sets SET baseline_entry_id=NULL WHERE id=r.scenario_set_id;
   WHEN 'entry' THEN UPDATE public.scenario_entries SET assumptions_json=assumptions_json||'{"replacement_fixture_change":true}' WHERE id=r.scenario_entry_id;
   ELSE RAISE EXCEPTION 'Unknown context edit probe';
  END CASE;
  PERFORM pg_temp.replacement_expect_error(format('SELECT public.record_legacy_model_artifact(%L,%L)',r.workspace_id,payload),'42501');
  RAISE EXCEPTION 'Fixture context restoration' USING ERRCODE='PZ002';
 EXCEPTION WHEN SQLSTATE 'PZ002' THEN NULL;
 END;
END $$;
CREATE FUNCTION pg_temp.replacement_withdrawal(p_run uuid,p_success boolean,p_revoke boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE cp cp_probe%ROWTYPE; payload jsonb; setup uuid; checkpoint uuid;
BEGIN
 SELECT * INTO cp FROM cp_probe;
 SELECT id INTO setup FROM public.model_run_stages WHERE run_id=p_run AND stage_name='AequilibraE Setup';
 IF NOT p_success THEN payload:=pg_temp.replacement_member(p_run,'common_population'); END IF;
 SELECT checkpoint_id INTO checkpoint FROM public.model_population_replacement_receipts WHERE replacement_run_id=p_run;
 BEGIN
  IF p_revoke THEN
   PERFORM public.revoke_model_population_checkpoint(cp.workspace_id,checkpoint,cp.owner_id,'Fixture withdrawal before publication');
  ELSE DELETE FROM public.workspace_members WHERE workspace_id=cp.workspace_id AND user_id=cp.owner_id;
  END IF;
  IF p_success THEN
   PERFORM pg_temp.replacement_expect_error(format('UPDATE public.model_run_stages SET status=''succeeded'' WHERE id=%L',setup),'42501');
  ELSE
   PERFORM pg_temp.replacement_expect_error(format('SELECT public.record_legacy_model_artifact(%L,%L)',cp.workspace_id,payload),'42501');
  END IF;
  -- Roll back the withdrawal itself, never delete or rewrite its immutable receipt.
  RAISE EXCEPTION 'Fixture withdrawal restoration' USING ERRCODE='PZ001';
 EXCEPTION WHEN SQLSTATE 'PZ001' THEN NULL;
 END;
END $$;
DO $$ DECLARE p replacement_probe%ROWTYPE; cp cp_probe%ROWTYPE; next_id uuid; setup uuid; payload jsonb; f record; n integer;
BEGIN
 SELECT * INTO p FROM replacement_probe; SELECT * INTO cp FROM cp_probe;
 next_id:=(p.receipt->>'replacement_run_id')::uuid;
 SELECT id INTO setup FROM public.model_run_stages WHERE run_id=next_id AND stage_name='AequilibraE Setup';
 -- Both membership and append-only checkpoint withdrawal fence the real insert.
 PERFORM pg_temp.replacement_withdrawal(next_id,false,false);
 PERFORM pg_temp.replacement_withdrawal(next_id,false,true);
 PERFORM pg_temp.replacement_context_edit(next_id,'model');
 PERFORM pg_temp.replacement_context_edit(next_id,'scenario_set');
 PERFORM pg_temp.replacement_context_edit(next_id,'entry');
 payload:=pg_temp.replacement_member(next_id,'common_population_households');
 payload:=jsonb_set(payload,'{content_hash}',to_jsonb((SELECT sha256 FROM cp_source_files WHERE kind='common_population_persons')));
 PERFORM pg_temp.replacement_expect_error(format('SELECT public.record_legacy_model_artifact(%L,%L)',cp.workspace_id,payload),'23514');
 IF EXISTS(SELECT 1 FROM public.model_legacy_artifact_receipts WHERE artifact_id=(payload->>'id')::uuid) THEN
  RAISE EXCEPTION 'Rejected swapped member left a command receipt'; END IF;
 SET LOCAL ROLE service_role;
 FOR f IN SELECT kind FROM cp_source_files WHERE kind<>'common_population_persons' ORDER BY kind LOOP
  PERFORM pg_temp.replacement_record(next_id,f.kind);
 END LOOP;
 RESET ROLE;
 PERFORM pg_temp.replacement_expect_error(format('UPDATE public.model_run_stages SET status=''succeeded'' WHERE id=%L',setup),'23514');
 payload:=pg_temp.replacement_member(next_id,'common_population_households');
 PERFORM pg_temp.replacement_expect_error(format('SELECT public.record_legacy_model_artifact(%L,%L)',cp.workspace_id,payload),'23514');
 IF EXISTS(SELECT 1 FROM public.model_legacy_artifact_receipts WHERE artifact_id=(payload->>'id')::uuid) THEN
  RAISE EXCEPTION 'Rejected duplicate member left a command receipt'; END IF;
 SET LOCAL ROLE service_role;
 PERFORM pg_temp.replacement_record(next_id,'common_population_persons');
 RESET ROLE;
 -- Both withdrawals must also fence success when all seven members exist.
 PERFORM pg_temp.replacement_withdrawal(next_id,true,false);
 PERFORM pg_temp.replacement_withdrawal(next_id,true,true);
 SET LOCAL ROLE service_role;
 UPDATE public.model_run_stages SET status='succeeded',completed_at=clock_timestamp() WHERE id=setup;
 RESET ROLE;
 SELECT count(*) INTO n FROM replacement_commands c JOIN public.model_legacy_artifact_receipts x
  ON x.artifact_id=(c.payload->>'id')::uuid AND x.run_id=c.run_id AND x.response_payload=c.response
  AND x.request_payload=jsonb_build_object('workspace_id',cp.workspace_id,'payload',c.payload)
  JOIN public.model_run_artifacts a ON a.id=x.artifact_id AND to_jsonb(a)=c.response WHERE c.run_id=next_id;
 IF n<>7 THEN RAISE EXCEPTION 'Seven fresh native commands/rows/exact receipts missing'; END IF;
 IF EXISTS(SELECT 1 FROM replacement_commands c WHERE c.run_id=next_id AND (c.payload->>'run_id')::uuid=p.original) THEN
  RAISE EXCEPTION 'Publication reused original failed identity'; END IF;
END $$;

-- Complete ordinary descendants and record actual output commands. These are
-- synthetic metadata and decisions, not Assignment or ActivitySim execution.
CREATE FUNCTION pg_temp.replacement_finish(p_run uuid,p_position integer,p_method text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE s public.model_run_stages%ROWTYPE; cp cp_probe%ROWTYPE; artifact uuid:=gen_random_uuid(); output_stage uuid; output_metadata jsonb;
BEGIN
 SELECT * INTO cp FROM cp_probe;
 output_metadata:=cp.network_metadata||cp.source_metadata||jsonb_build_object('custody','legacy_stage_snapshot','population_custody','legacy_stage_snapshot');
 FOR s IN SELECT * FROM public.model_run_stages WHERE run_id=p_run AND stage_name<>'AequilibraE Setup' ORDER BY sort_order LOOP
  UPDATE public.model_run_stages SET status='running',started_at=clock_timestamp() WHERE id=s.id AND status='queued';
  IF s.stage_name=(CASE p_method WHEN 'aequilibrae' THEN 'Artifact Extraction' ELSE 'ActivitySim Network Assignment' END) THEN
   output_stage:=s.id;
   PERFORM public.record_legacy_model_artifact(cp.workspace_id,jsonb_build_object('id',artifact,'run_id',p_run,'stage_id',s.id,
    'artifact_type',CASE p_method WHEN 'aequilibrae' THEN 'link_volumes' ELSE 'activitysim_link_volumes' END,
    'file_url','local://synthetic/replacements/'||p_run||'/output.csv','file_size_bytes',99,
    'content_hash',repeat((p_position+1)::text,64),'metadata_json',output_metadata));
  END IF;
  UPDATE public.model_run_stages SET status='succeeded',completed_at=clock_timestamp() WHERE id=s.id;
 END LOOP;
 IF output_stage IS NULL THEN RAISE EXCEPTION 'Replacement output stage missing'; END IF;
 UPDATE public.model_runs SET status='succeeded' WHERE id=p_run;
 INSERT INTO public.modeling_claim_decisions(workspace_id,model_run_id,track,claim_status,status_reason)
  VALUES(cp.workspace_id,p_run,CASE p_method WHEN 'aequilibrae' THEN 'assignment' ELSE 'behavioral_demand' END,
   'prototype_only','Synthetic replacement fixture, no scientific acceptance');
 UPDATE cp_jobs SET run_id=p_run,stage_id=output_stage,artifact_id=artifact,attempt_id=NULL,metadata=output_metadata WHERE position=p_position;
END $$;
DO $$ DECLARE p replacement_probe%ROWTYPE; cp cp_probe%ROWTYPE; g cp_groups%ROWTYPE; j cp_jobs%ROWTYPE;
 baseline uuid; source_artifact uuid; source_setup uuid; baseline_ref jsonb; r uuid; setup uuid; request jsonb; facts jsonb;
 registration uuid; reply jsonb; stage_names text[]; idx integer; f record;
BEGIN
 SELECT * INTO p FROM replacement_probe; SELECT * INTO cp FROM cp_probe; SELECT * INTO g FROM cp_groups WHERE name='main';
 baseline:=(p.receipt->>'replacement_run_id')::uuid;
 PERFORM pg_temp.replacement_finish(baseline,0,'aequilibrae');
 SELECT (payload->>'id')::uuid,(payload->>'stage_id')::uuid INTO source_artifact,source_setup
  FROM replacement_commands WHERE run_id=baseline AND kind='common_population';
 baseline_ref:=jsonb_build_object('modelRunId',baseline,'artifactId',source_artifact,'stageId',source_setup,
  'attemptId',NULL,'sha256',cp.basis#>>'{manifest,sha256}','sizeBytes',cp.basis#>'{manifest,bytes}');
 UPDATE cp_probe SET custody='legacy_stage_snapshot',source_ref=baseline_ref,
  claim=jsonb_build_object('schema','openplan.common-population-comparison.v1','custody','legacy_stage_snapshot',
   'comparisonPolicy','fixed_population_auto_trip_change','sourceRunId',baseline,'source',baseline_ref,
   'manifest',cp.basis->'manifest','populationBasis',cp.basis,'populationBasisDigest',cp.basis_digest);
 FOR j IN SELECT * FROM cp_jobs WHERE position>0 ORDER BY position LOOP
  r:=gen_random_uuid(); setup:=gen_random_uuid();
  request:=jsonb_build_object('schema','openplan.common-population-request.v1','custody','legacy_stage_snapshot','mode','reuse',
   'comparisonPolicy','fixed_population_auto_trip_change','source',baseline_ref);
  INSERT INTO public.model_runs(id,workspace_id,project_id,model_id,scenario_set_id,scenario_entry_id,engine_key,status,
   run_title,corridor_geojson,input_snapshot_json,assumption_snapshot_json,created_by)
   SELECT r,g.workspace_id,g.project_id,j.model_id,g.scenario_set_id,j.entry_id,
    CASE j.method WHEN 'aequilibrae' THEN 'aequilibrae' ELSE 'behavioral_demand' END,'queued','Ordinary reuse of completed replacement',cp.geometry,
    jsonb_build_object('zoneGeography','tract','commonPopulation',request),entry.assumptions_json,cp.owner_id
    FROM public.scenario_entries entry WHERE entry.id=j.entry_id;
  stage_names:=CASE j.method WHEN 'aequilibrae' THEN ARRAY['AequilibraE Setup','Network Assignment','Artifact Extraction']
   ELSE ARRAY['AequilibraE Setup','Network Assignment','Artifact Extraction','ActivitySim Bundle & Preflight','ActivitySim Network Assignment','Demand Model Agreement'] END;
  FOR idx IN 1..cardinality(stage_names) LOOP
   INSERT INTO public.model_run_stages(id,run_id,stage_name,sort_order,status)
    VALUES(CASE idx WHEN 1 THEN setup ELSE gen_random_uuid() END,r,stage_names[idx],idx,'queued');
  END LOOP;
  UPDATE public.model_run_stages SET status='running',started_at=clock_timestamp() WHERE id=setup;
  UPDATE public.model_runs SET status='running' WHERE id=r;
  IF j.position=2 THEN
   -- A behavioral failed Setup registers its exact reused package prospectively.
   facts:=jsonb_set(jsonb_set(jsonb_set(p.facts,'{inputs,run_id}',to_jsonb(r::text)),
    '{inputs,stage_id}',to_jsonb(setup::text)),'{inputs,authority,request}',request);
   registration:=gen_random_uuid();
   PERFORM public.register_model_population_checkpoint(registration,g.workspace_id,r,setup,'native-replacement-fixture',facts);
   UPDATE public.model_run_stages SET status='failed',error_message='Synthetic behavioral network failure' WHERE id=setup;
   UPDATE public.model_runs SET status='failed',error_message='Synthetic behavioral network failure' WHERE id=r;
   reply:=public.create_model_population_replacement(gen_random_uuid(),g.workspace_id,r,cp.owner_id,
    public.model_recovery_expected_state(r),registration,repeat('b',64),'Explicit behavioral replacement',true);
   r:=(reply->>'replacement_run_id')::uuid;
   IF reply->>'engine_key'<>'behavioral_demand' OR (SELECT count(*) FROM public.model_run_stages WHERE run_id=r)<>6 THEN
    RAISE EXCEPTION 'Behavioral replacement lacks its six ordinary stages'; END IF;
   SELECT id INTO setup FROM public.model_run_stages WHERE run_id=r AND stage_name='AequilibraE Setup';
   UPDATE public.model_run_stages SET status='running',started_at=clock_timestamp() WHERE id=setup;
   UPDATE public.model_runs SET status='running' WHERE id=r;
  END IF;
  FOR f IN SELECT kind FROM cp_source_files ORDER BY kind LOOP PERFORM pg_temp.replacement_record(r,f.kind); END LOOP;
  UPDATE public.model_run_stages SET status='succeeded',completed_at=clock_timestamp() WHERE id=setup;
  PERFORM pg_temp.replacement_finish(r,j.position,j.method);
 END LOOP;
 IF p.old_run IS DISTINCT FROM (SELECT to_jsonb(x) FROM public.model_runs x WHERE id=p.original)
  OR p.old_stages IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.model_run_stages x WHERE run_id=p.original) THEN
  RAISE EXCEPTION 'Publication or descendants changed original failure history'; END IF;
END $$;
-- Existing comparison helpers ingest four new rows under the actual owner role.
SET LOCAL ROLE authenticated;
DO $$ DECLARE snapshot uuid; BEGIN
 snapshot:=pg_temp.cp_snapshot();
 PERFORM pg_temp.cp_all_links(snapshot); PERFORM pg_temp.cp_ready(snapshot);
 IF (SELECT count(*) FROM public.scenario_comparison_model_run_links WHERE comparison_snapshot_id=snapshot)<>4
  OR (SELECT status FROM public.scenario_comparison_snapshots WHERE id=snapshot)<>'ready' THEN
  RAISE EXCEPTION 'Completed replacement/reuse four-job comparison not ready'; END IF;
 IF EXISTS(SELECT 1 FROM public.scenario_comparison_model_run_links WHERE comparison_snapshot_id=snapshot
   AND model_run_id=(SELECT original FROM replacement_probe)) THEN RAISE EXCEPTION 'Comparison adopted failed original'; END IF;
END $$;
RESET ROLE;
-- Later invalidation blocks new use without erasing the completed history.
SELECT public.revoke_model_population_checkpoint(g.workspace_id,p.checkpoint,cp.owner_id,'Synthetic source withdrawal')
 FROM replacement_probe p,cp_groups g,cp_probe cp WHERE g.name='main';
SELECT pg_temp.replacement_expect_error(format('SELECT public.read_model_population_origin(%L,%L)',g.workspace_id,receipt->>'replacement_run_id'),'42501')
 FROM replacement_probe p,cp_groups g WHERE g.name='main';
SELECT pg_temp.replacement_expect_error(format('UPDATE public.model_runs SET input_snapshot_json=%L WHERE id=%L','{}',receipt->>'replacement_run_id'),'23514') FROM replacement_probe;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF has_function_privilege(role_name,'public.create_model_population_replacement(uuid,uuid,uuid,uuid,jsonb,uuid,text,text,boolean)','EXECUTE')
   THEN RAISE EXCEPTION 'Replacement command exposed to %',role_name; END IF;
 END LOOP;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF has_function_privilege(role_name,'public.lock_model_population_context(uuid[])','EXECUTE')
   OR has_function_privilege(role_name,'public.model_population_input_context(uuid)','EXECUTE') THEN
   RAISE EXCEPTION 'Private scientific-context locking helper exposed to %',role_name; END IF;
 END LOOP;
END $$;
SELECT 'POPULATION_REPLACEMENT_NATIVE_ASSERTIONS_REACHED';
