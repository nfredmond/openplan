-- Synthetic native relationships only. Every caller wraps this in BEGIN/ROLLBACK.
-- No roster or scientific result is represented by these byte descriptors.
CREATE TEMP TABLE cp_probe(
 custody text NOT NULL DEFAULT 'managed_attempt',
 owner_id uuid DEFAULT gen_random_uuid(), viewer_id uuid DEFAULT gen_random_uuid(), outsider_id uuid DEFAULT gen_random_uuid(),
 workspace_id uuid DEFAULT gen_random_uuid(), other_workspace uuid DEFAULT gen_random_uuid(), asim_model uuid DEFAULT gen_random_uuid(),
 geometry jsonb DEFAULT '{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}',
 profile jsonb DEFAULT '{"adapter":"us_census_acs5_pums","acs_summary_endpoint":"https://api.census.gov/data/2023/acs/acs5","pums_endpoint":"https://api.census.gov/data/2023/acs/acs5/pums","sample_years":[2019,2023],"income_dollar_year":2023,"puma_fields":{"2020":"PUMA"}}',
 basis jsonb, basis_payload text, basis_digest text, network_metadata jsonb, source_metadata jsonb, source_ref jsonb, claim jsonb);
INSERT INTO cp_probe DEFAULT VALUES;
-- CUSTODY SEAM
CREATE TEMP TABLE cp_source_files(kind text, path text, sha256 text, bytes bigint, metadata_override jsonb);
INSERT INTO cp_source_files(kind,path,sha256,bytes) VALUES
 ('common_population','common_population.json',repeat('a',64),123),
 ('common_population_households','households.csv',repeat('d',64),19),
 ('common_population_persons','persons.csv',repeat('e',64),23),
 ('common_population_selected_zones','selected_zones.json',repeat('b',64),21),
 ('common_population_diagnostics','diagnostics.json',repeat('f',64),29),
 ('common_population_source_manifest','source_manifest.json',repeat('c',64),17),
 ('common_population_source_zone_attributes','source_zone_attributes.csv',repeat('0',64),31);
CREATE TEMP TABLE cp_groups(name text, workspace_id uuid, project_id uuid DEFAULT gen_random_uuid(), scenario_set_id uuid DEFAULT gen_random_uuid(),
 baseline_id uuid DEFAULT gen_random_uuid(), build_id uuid DEFAULT gen_random_uuid(), model_id uuid DEFAULT gen_random_uuid(),
 run_id uuid DEFAULT gen_random_uuid(), setup_id uuid DEFAULT gen_random_uuid(), artifact_id uuid DEFAULT gen_random_uuid(), attempt_id uuid);
INSERT INTO cp_groups(name,workspace_id) SELECT 'main',workspace_id FROM cp_probe UNION ALL
 SELECT 'same_workspace_other_project',workspace_id FROM cp_probe UNION ALL SELECT 'other_workspace',other_workspace FROM cp_probe;
CREATE TEMP TABLE cp_jobs(position integer, method text, role text, model_id uuid, entry_id uuid,
 run_id uuid DEFAULT gen_random_uuid(), stage_id uuid DEFAULT gen_random_uuid(), artifact_id uuid DEFAULT gen_random_uuid(), attempt_id uuid, metadata jsonb);
GRANT SELECT,UPDATE ON cp_probe,cp_groups,cp_jobs,cp_source_files TO service_role;
GRANT SELECT ON cp_probe,cp_groups,cp_jobs TO authenticated,anon;
INSERT INTO auth.users(id,email) SELECT u,u||'@example.test' FROM cp_probe,LATERAL unnest(ARRAY[owner_id,viewer_id,outsider_id]) u;
INSERT INTO public.workspaces(id,name,slug) SELECT workspace_id,'Synthetic common population A',workspace_id::text FROM cp_probe
 UNION ALL SELECT other_workspace,'Synthetic common population B',other_workspace::text FROM cp_probe;
INSERT INTO public.workspace_members(workspace_id,user_id,role) SELECT workspace_id,owner_id,'owner' FROM cp_probe
 UNION ALL SELECT workspace_id,viewer_id,'viewer' FROM cp_probe UNION ALL SELECT other_workspace,outsider_id,'owner' FROM cp_probe;
UPDATE cp_probe SET basis=jsonb_build_object('schema','openplan.common-population-identity.v1',
 'manifest',jsonb_build_object('path','common_population.json','sha256',repeat('a',64),'bytes',123),
 'source_profile',profile,'universe','household_residents',
 'exclusions',jsonb_build_object('group_quarters','excluded_unassessed','full_population_coverage','unassessed'),
 'selected_zone_map',jsonb_build_object('path','selected_zones.json','sha256',repeat('b',64),'bytes',21),
 'realized_zone_counts',jsonb_build_array(jsonb_build_object('zone_id',1,'households',2,'persons',4,'workers',1),
  jsonb_build_object('zone_id',2,'households',1,'persons',2,'workers',1)),
 'source_manifest',jsonb_build_object('path','source_manifest.json','sha256',repeat('c',64),'bytes',17));
UPDATE cp_probe SET basis_payload=public.model_truth_canonical_jsonb(basis),
 basis_digest=encode(extensions.digest(convert_to(public.model_truth_canonical_jsonb(basis),'UTF8'),'sha256'),'hex'),
 network_metadata=jsonb_build_object('assignment_profile','{"engine":"aequilibrae"}'::jsonb,
  'assignment_profile_payload_json','{"engine":"aequilibrae"}',
  'assignment_profile_digest',encode(extensions.digest('{"engine":"aequilibrae"}','sha256'),'hex'),
  'network_settings','{"capacity":"shared"}'::jsonb,'network_settings_payload_json','{"capacity":"shared"}',
  'network_settings_digest',encode(extensions.digest('{"capacity":"shared"}','sha256'),'hex'));
UPDATE cp_probe SET network_metadata=network_metadata||jsonb_build_object('network_state_record',jsonb_build_object(
 'network_settings_digest',network_metadata->>'network_settings_digest','osm_snapshot','synthetic-common-population'));
UPDATE cp_probe SET network_metadata=network_metadata||jsonb_build_object('network_state_digest',
 encode(extensions.digest(convert_to(public.model_truth_canonical_jsonb(network_metadata->'network_state_record'),'UTF8'),'sha256'),'hex')),
 source_metadata=jsonb_build_object('schema','openplan.common-population.v1','custody',custody,'origin',NULL,'scientific_acceptance','unassessed',
  'population_basis',basis,'population_basis_payload_json',basis_payload,'population_basis_digest',basis_digest);

DO $$ DECLARE g cp_groups%ROWTYPE; p cp_probe%ROWTYPE; BEGIN
 SELECT * INTO p FROM cp_probe;
 FOR g IN SELECT * FROM cp_groups LOOP
  INSERT INTO public.projects(id,workspace_id,name) VALUES(g.project_id,g.workspace_id,'Synthetic population scope');
  INSERT INTO public.scenario_sets(id,workspace_id,project_id,title) VALUES(g.scenario_set_id,g.workspace_id,g.project_id,'Synthetic comparison');
  INSERT INTO public.scenario_entries(id,scenario_set_id,entry_type,label,slug,assumptions_json) VALUES
   (g.baseline_id,g.scenario_set_id,'baseline','Synthetic baseline',g.baseline_id::text,'{}'),
   (g.build_id,g.scenario_set_id,'alternative','Synthetic build',g.build_id::text,
    '{"guidedProjectChange":{"kind":"assigned_auto_trip_change_pct","autoTripChangePct":-8,"basis":"Synthetic native fixture"}}');
  UPDATE public.scenario_sets SET baseline_entry_id=g.baseline_id WHERE id=g.scenario_set_id;
  INSERT INTO public.models(id,workspace_id,project_id,scenario_set_id,title,model_family,config_json)
   VALUES(g.model_id,g.workspace_id,g.project_id,g.scenario_set_id,'Synthetic AequilibraE','travel_demand',
    '{"guidedProjectComparison":"openplan.project_comparison.v1","method":"aequilibrae","networkBasis":{"kind":"worker_osm_snapshot","source":"OpenStreetMap","identity":"network_state_digest","comparisonRule":"exact_digest_match"}}');
  INSERT INTO public.model_runs(id,workspace_id,project_id,model_id,scenario_set_id,scenario_entry_id,engine_key,status,run_title,corridor_geojson,input_snapshot_json,assumption_snapshot_json)
   VALUES(g.run_id,g.workspace_id,g.project_id,g.model_id,g.scenario_set_id,g.baseline_id,'aequilibrae','queued','Synthetic source baseline',p.geometry,
    jsonb_build_object('zoneGeography','tract','commonPopulation',jsonb_build_object('schema','openplan.common-population-request.v1','mode','generate',
      'custody',p.custody,'comparisonPolicy','fixed_population_auto_trip_change','sourceProfile',p.profile)),'{}');
  INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES(g.setup_id,g.run_id,'AequilibraE Setup','queued',0);
  IF g.name='main' THEN
   INSERT INTO cp_jobs(position,method,role,model_id,entry_id,run_id) VALUES(0,'aequilibrae','baseline',g.model_id,g.baseline_id,g.run_id);
   INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order)
    SELECT stage_id,run_id,'Artifact Extraction','queued',1 FROM cp_jobs WHERE position=0;
   -- Explicitly supplied synthetic decision exercises the existing requirement.
   -- This is not an observed-count assessment or a scientific acceptance result.
   INSERT INTO public.modeling_claim_decisions(workspace_id,model_run_id,track,claim_status,status_reason)
    VALUES(g.workspace_id,g.run_id,'assignment','prototype_only','Synthetic fixture, no scientific validation');
  END IF;
 END LOOP;
END $$;
-- SOURCE PUBLICATION SEAM
DO $$ DECLARE g cp_groups%ROWTYPE; p cp_probe%ROWTYPE; f cp_source_files%ROWTYPE; response jsonb; attempt uuid; n integer; published record; BEGIN
 SELECT * INTO p FROM cp_probe;
 SET LOCAL ROLE service_role;
 FOR g IN SELECT * FROM cp_groups LOOP
  IF p.custody='managed_attempt' THEN
  response:=public.claim_model_stage_attempt(gen_random_uuid(),g.setup_id,'synthetic-population-native-fixture');
  IF response->>'outcome'<>'claimed' THEN RAISE EXCEPTION 'Source setup was not claimed'; END IF;
  attempt:=(response->>'attempt_id')::uuid;
  FOR f IN SELECT * FROM cp_source_files LOOP
   PERFORM public.write_model_attempt_artifact(gen_random_uuid(),attempt,jsonb_build_object(
    'id',CASE WHEN f.kind='common_population' THEN g.artifact_id ELSE gen_random_uuid() END,'artifact_type',f.kind,
    'file_url','local://synthetic/'||g.run_id||'/'||f.path,'file_size_bytes',f.bytes,'content_hash',f.sha256,
    'metadata_json',COALESCE(f.metadata_override,p.source_metadata)));
  END LOOP;
  PERFORM public.write_model_stage_attempt(gen_random_uuid(),attempt,'succeeded','Synthetic setup only',NULL);
  UPDATE cp_groups SET attempt_id=attempt WHERE name=g.name;
  ELSE
   UPDATE public.model_run_stages SET status='running',started_at=clock_timestamp() WHERE id=g.setup_id AND run_id=g.run_id AND status='queued';
   GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'Ordinary source stage was not claimed'; END IF;
   UPDATE public.model_runs SET status='running' WHERE id=g.run_id AND status='queued';
   response:=public.read_common_population_stage_custody(g.workspace_id,g.run_id,g.setup_id,NULL);
   IF response IS DISTINCT FROM jsonb_build_object('schema','openplan.common-population-stage-custody.v1','custody','legacy_stage_snapshot',
    'workspace_id',g.workspace_id,'run_id',g.run_id,'stage_id',g.setup_id,'artifact_id',NULL,'eligible',true) THEN
    RAISE EXCEPTION 'Ordinary running source custody response differs'; END IF;
   FOR f IN SELECT * FROM cp_source_files LOOP
    PERFORM public.record_legacy_model_artifact(g.workspace_id,jsonb_build_object(
     'id',CASE WHEN f.kind='common_population' THEN g.artifact_id ELSE gen_random_uuid() END,'run_id',g.run_id,'stage_id',g.setup_id,
     'artifact_type',f.kind,'file_url','local://synthetic/'||g.run_id||'/'||f.path,'file_size_bytes',f.bytes,
     'content_hash',f.sha256,'metadata_json',COALESCE(f.metadata_override,p.source_metadata)));
   END LOOP;
   UPDATE public.model_run_stages SET status='succeeded',completed_at=clock_timestamp() WHERE id=g.setup_id;
   IF g.name<>'main' THEN UPDATE public.model_runs SET status='succeeded' WHERE id=g.run_id; END IF;
   -- The baseline's output is still queued: completed Setup is usable by Bundle
   -- while this parent runs, but the comparison later requires full success.
   FOR published IN SELECT id FROM public.model_run_artifacts WHERE run_id=g.run_id AND stage_id=g.setup_id LOOP
    response:=public.read_common_population_stage_custody(g.workspace_id,g.run_id,g.setup_id,published.id);
    IF response IS DISTINCT FROM jsonb_build_object('schema','openplan.common-population-stage-custody.v1','custody','legacy_stage_snapshot',
     'workspace_id',g.workspace_id,'run_id',g.run_id,'stage_id',g.setup_id,'artifact_id',published.id,'eligible',true) THEN
     RAISE EXCEPTION 'Ordinary companion custody response differs'; END IF;
   END LOOP;
  END IF;
 END LOOP;
 RESET ROLE;
END $$;
UPDATE cp_probe p SET source_ref=jsonb_build_object('modelRunId',g.run_id,'artifactId',g.artifact_id,'stageId',g.setup_id,
 'attemptId',g.attempt_id,'sha256',repeat('a',64),'sizeBytes',123) FROM cp_groups g WHERE g.name='main';
UPDATE cp_probe SET claim=jsonb_build_object('schema','openplan.common-population-comparison.v1','custody',custody,'comparisonPolicy','fixed_population_auto_trip_change',
 'sourceRunId',source_ref->'modelRunId','source',source_ref,'manifest',basis->'manifest','populationBasis',basis,'populationBasisDigest',basis_digest);
DO $$ DECLARE g cp_groups%ROWTYPE; p cp_probe%ROWTYPE; j cp_jobs%ROWTYPE; BEGIN
 SELECT * INTO p FROM cp_probe; SELECT * INTO g FROM cp_groups WHERE name='main';
 INSERT INTO public.models(id,workspace_id,project_id,scenario_set_id,title,model_family,config_json)
  VALUES(p.asim_model,g.workspace_id,g.project_id,g.scenario_set_id,'Synthetic ActivitySim','activity_based_model',
   '{"guidedProjectComparison":"openplan.project_comparison.v1","method":"activitysim","networkBasis":{"kind":"worker_osm_snapshot","source":"OpenStreetMap","identity":"network_state_digest","comparisonRule":"exact_digest_match"}}');
 INSERT INTO cp_jobs(position,method,role,model_id,entry_id) VALUES(1,'aequilibrae','build',g.model_id,g.build_id),
  (2,'activitysim','baseline',p.asim_model,g.baseline_id),(3,'activitysim','build',p.asim_model,g.build_id);
 FOR j IN SELECT * FROM cp_jobs WHERE position>0 ORDER BY position LOOP
  INSERT INTO public.model_runs(id,workspace_id,project_id,model_id,scenario_set_id,scenario_entry_id,engine_key,status,run_title,corridor_geojson,input_snapshot_json,assumption_snapshot_json)
   SELECT j.run_id,g.workspace_id,g.project_id,j.model_id,g.scenario_set_id,j.entry_id,
    CASE j.method WHEN 'aequilibrae' THEN 'aequilibrae' ELSE 'behavioral_demand' END,'queued','Synthetic population consumer',p.geometry,
    jsonb_build_object('zoneGeography','tract','commonPopulation',jsonb_build_object('schema','openplan.common-population-request.v1','mode','reuse',
     'custody',p.custody,'comparisonPolicy','fixed_population_auto_trip_change','source',p.source_ref)),entry.assumptions_json
    FROM public.scenario_entries entry WHERE entry.id=j.entry_id;
  INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES(j.stage_id,j.run_id,
   CASE j.method WHEN 'aequilibrae' THEN 'Artifact Extraction' ELSE 'ActivitySim Network Assignment' END,'queued',1);
  INSERT INTO public.modeling_claim_decisions(workspace_id,model_run_id,track,claim_status,status_reason)
   VALUES(g.workspace_id,j.run_id,CASE j.method WHEN 'aequilibrae' THEN 'assignment' ELSE 'behavioral_demand' END,
    'prototype_only','Synthetic fixture, no scientific validation');
 END LOOP;
END $$;
UPDATE cp_jobs SET metadata=(SELECT network_metadata||source_metadata||jsonb_build_object('population_custody',custody) FROM cp_probe);
-- OUTPUT PUBLICATION SEAM
DO $$ DECLARE j cp_jobs%ROWTYPE; p cp_probe%ROWTYPE; response jsonb; attempt uuid; n integer; BEGIN
 SELECT * INTO p FROM cp_probe;
 SET LOCAL ROLE service_role;
 FOR j IN SELECT * FROM cp_jobs ORDER BY position LOOP
  IF p.custody='managed_attempt' THEN
  response:=public.claim_model_stage_attempt(gen_random_uuid(),j.stage_id,'synthetic-population-native-fixture');
  IF response->>'outcome'<>'claimed' THEN RAISE EXCEPTION 'Output stage was not claimed'; END IF;
  attempt:=(response->>'attempt_id')::uuid;
  PERFORM public.write_model_attempt_artifact(gen_random_uuid(),attempt,jsonb_build_object('id',j.artifact_id,
   'artifact_type',CASE j.method WHEN 'aequilibrae' THEN 'link_volumes' ELSE 'activitysim_link_volumes' END,
   'file_url','local://synthetic/output.csv','file_size_bytes',99,'content_hash',repeat((j.position+1)::text,64),'metadata_json',j.metadata));
  PERFORM public.write_model_stage_attempt(gen_random_uuid(),attempt,'succeeded','Synthetic output only',NULL);
  UPDATE cp_jobs SET attempt_id=attempt WHERE position=j.position;
  ELSE
   UPDATE public.model_run_stages SET status='running',started_at=clock_timestamp() WHERE id=j.stage_id AND run_id=j.run_id AND status='queued';
   GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'Ordinary output stage was not claimed'; END IF;
   UPDATE public.model_runs SET status='running' WHERE id=j.run_id AND status='queued';
   PERFORM public.record_legacy_model_artifact(p.workspace_id,jsonb_build_object('id',j.artifact_id,'run_id',j.run_id,'stage_id',j.stage_id,
    'artifact_type',CASE j.method WHEN 'aequilibrae' THEN 'link_volumes' ELSE 'activitysim_link_volumes' END,
    'file_url','local://synthetic/output.csv','file_size_bytes',99,'content_hash',repeat((j.position+1)::text,64),'metadata_json',j.metadata));
   UPDATE public.model_run_stages SET status='succeeded',completed_at=clock_timestamp() WHERE id=j.stage_id;
   UPDATE public.model_runs SET status='succeeded' WHERE id=j.run_id;
   PERFORM public.read_common_population_stage_custody(p.workspace_id,j.run_id,j.stage_id,j.artifact_id);
  END IF;
 END LOOP;
 RESET ROLE;
END $$;
CREATE TEMP TABLE cp_before AS SELECT
 (SELECT jsonb_agg(to_jsonb(run) ORDER BY run.id) FROM public.model_runs run WHERE run.id IN(SELECT run_id FROM cp_groups UNION SELECT run_id FROM cp_jobs)) runs,
 (SELECT jsonb_agg(to_jsonb(artifact) ORDER BY artifact.id) FROM public.model_run_artifacts artifact WHERE artifact.run_id IN(SELECT run_id FROM cp_groups UNION SELECT run_id FROM cp_jobs)) artifacts;

CREATE FUNCTION pg_temp.cp_snapshot(metadata jsonb DEFAULT NULL, desired_status text DEFAULT 'draft') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE result uuid; BEGIN
 INSERT INTO public.scenario_comparison_snapshots(scenario_set_id,baseline_entry_id,candidate_entry_id,label,metadata_json,status,created_by)
  SELECT g.scenario_set_id,g.baseline_id,g.build_id,'Synthetic common population comparison',
   COALESCE(metadata,jsonb_build_object('commonPopulation',p.claim)),desired_status,p.owner_id FROM cp_probe p,cp_groups g WHERE g.name='main' RETURNING id INTO result;
 RETURN result;
END $$;
CREATE FUNCTION pg_temp.cp_link(snapshot uuid, job integer) RETURNS void LANGUAGE sql AS $$
 INSERT INTO public.scenario_comparison_model_run_links(workspace_id,comparison_snapshot_id,model_run_id,model_run_artifact_id,method,scenario_role,
  artifact_type,artifact_sha256,assignment_profile_sha256,network_settings_sha256,network_state_sha256,scenario_assumptions_json,created_by)
 SELECT g.workspace_id,snapshot,j.run_id,j.artifact_id,j.method,j.role,
  CASE j.method WHEN 'aequilibrae' THEN 'link_volumes' ELSE 'activitysim_link_volumes' END,repeat((j.position+1)::text,64),
  p.network_metadata->>'assignment_profile_digest',p.network_metadata->>'network_settings_digest',p.network_metadata->>'network_state_digest',
  entry.assumptions_json,p.owner_id FROM cp_jobs j JOIN public.scenario_entries entry ON entry.id=j.entry_id,cp_groups g,cp_probe p
  WHERE j.position=job AND g.name='main';
$$;
CREATE FUNCTION pg_temp.cp_all_links(snapshot uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN FOR i IN 0..3 LOOP PERFORM pg_temp.cp_link(snapshot,i); END LOOP; END $$;
CREATE FUNCTION pg_temp.cp_ready(snapshot uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE n integer; BEGIN UPDATE public.scenario_comparison_snapshots SET status='ready' WHERE id=snapshot;
 GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'Ready fixture matched no row'; END IF; END $$;
CREATE FUNCTION pg_temp.cp_expect_refusal(statement text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN BEGIN EXECUTE statement;
 EXCEPTION WHEN check_violation THEN
  IF SQLERRM='Common population comparison custody is invalid' THEN RETURN; END IF;
  RAISE;
 END;
 RAISE EXCEPTION 'Invalid population claim was accepted';
END $$;
CREATE FUNCTION pg_temp.cp_expect_stage_refusal(statement text, expected_message text DEFAULT 'Common population stage custody is invalid') RETURNS void LANGUAGE plpgsql AS $$
BEGIN BEGIN EXECUTE statement;
 EXCEPTION WHEN check_violation THEN
  IF SQLERRM=expected_message THEN RETURN; END IF;
  RAISE;
 END;
 RAISE EXCEPTION 'Invalid stage custody was accepted';
END $$;
CREATE FUNCTION pg_temp.cp_unchanged() RETURNS void LANGUAGE plpgsql AS $$
DECLARE r jsonb; a jsonb; BEGIN
 SELECT jsonb_agg(to_jsonb(run) ORDER BY run.id) INTO r FROM public.model_runs run WHERE run.id IN(SELECT run_id FROM cp_groups UNION SELECT run_id FROM cp_jobs);
 SELECT jsonb_agg(to_jsonb(artifact) ORDER BY artifact.id) INTO a FROM public.model_run_artifacts artifact WHERE artifact.run_id IN(SELECT run_id FROM cp_groups UNION SELECT run_id FROM cp_jobs);
 IF r IS DISTINCT FROM (SELECT runs FROM cp_before) OR a IS DISTINCT FROM (SELECT artifacts FROM cp_before) THEN RAISE EXCEPTION 'Comparison changed retained runs or artifacts'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub',owner_id::text,true) FROM cp_probe;
