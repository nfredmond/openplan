-- P2 synthetic native controls only. Compose after the existing fixtures inside
-- their isolated BEGIN/ROLLBACK trial. No producer, file or scientific proof.
DO $$ DECLARE profile jsonb; purpose text; expected bool; p22 jsonb; p23 jsonb; oid_profile oid; owner_profile oid; BEGIN
 p22:='{"adapter":"us_census_acs5_pums","acs_summary_endpoint":"https://api.census.gov/data/2022/acs/acs5","pums_endpoint":"https://api.census.gov/data/2022/acs/acs5/pums","sample_years":[2018,2022],"income_dollar_year":2022,"puma_fields":{"2020":"PUMA20","2010":"PUMA10"}}';
 p23:='{"adapter":"us_census_acs5_pums","acs_summary_endpoint":"https://api.census.gov/data/2023/acs/acs5","pums_endpoint":"https://api.census.gov/data/2023/acs/acs5/pums","sample_years":[2019,2023],"income_dollar_year":2023,"puma_fields":{"2020":"PUMA"}}';
 FOREACH purpose IN ARRAY ARRAY['new_guided_launch','retained_validation','aequilibrae_production','activitysim_consumption'] LOOP
  IF public.model_common_population_profile_allowed(p23,purpose) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Canonical 2023 profile parity failed'; END IF;
  expected:=purpose<>'new_guided_launch';
  IF public.model_common_population_profile_allowed(p22,purpose) IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Retained-only 2022 purpose parity failed'; END IF;
 END LOOP;
 FOREACH profile IN ARRAY ARRAY[NULL::jsonb,'null'::jsonb,'[]'::jsonb,'"profile"'::jsonb,'{}'::jsonb,
  p23||'{"extra":true}'::jsonb,p23||'{"adapter":"unknown"}'::jsonb,p23||'{"income_dollar_year":2024}'::jsonb,
  p23||'{"income_dollar_year":"2023"}'::jsonb,p23||'{"sample_years":[2018,2023]}'::jsonb,
  p23||'{"puma_fields":{"2020":"PUMA20","2010":"PUMA10"}}'::jsonb,
  p23||'{"pums_endpoint":"https://api.census.gov/data/2022/acs/acs5/pums"}'::jsonb,
  p23||'{"acs_summary_endpoint":"https://api.census.gov/data/2023/acs/acs5/"}'::jsonb,
  p23||'{"pums_endpoint":"https://api.census.gov/data/2023/acs/acs5/pums/"}'::jsonb] LOOP
  FOREACH purpose IN ARRAY ARRAY['new_guided_launch','retained_validation','aequilibrae_production','activitysim_consumption'] LOOP
   IF public.model_common_population_profile_allowed(profile,purpose) IS DISTINCT FROM false THEN RAISE EXCEPTION 'Unregistered profile accepted'; END IF;
  END LOOP;
 END LOOP;
 IF public.model_common_population_profile_allowed(p23,NULL) IS DISTINCT FROM false
  OR public.model_common_population_profile_allowed(p23,'future') IS DISTINCT FROM false THEN RAISE EXCEPTION 'Unknown profile purpose accepted'; END IF;
 oid_profile:='public.model_common_population_profile_allowed(jsonb,text)'::regprocedure;
 SELECT proowner INTO STRICT owner_profile FROM pg_proc WHERE oid=oid_profile AND prorettype='pg_catalog.bool'::regtype
   AND provolatile='i' AND NOT prosecdef AND proconfig=ARRAY['search_path=""'];
 IF owner_profile IS DISTINCT FROM (SELECT proowner FROM pg_proc WHERE oid='public.validate_common_population_comparison()'::regprocedure)
  OR owner_profile IS DISTINCT FROM (SELECT proowner FROM pg_proc WHERE oid='public.read_common_population_stage_custody_before_replacement(uuid,uuid,uuid,uuid)'::regprocedure)
  THEN RAISE EXCEPTION 'Profile helper owner differs from internal callers'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
   WHERE p.oid=oid_profile AND acl.grantee=0 AND acl.privilege_type='EXECUTE') THEN RAISE EXCEPTION 'PUBLIC can call profile helper'; END IF;
END $$;

DO $$ DECLARE role_name text; signature text; definition text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF has_function_privilege(role_name,'public.model_common_population_profile_allowed(jsonb,text)','EXECUTE')
   OR has_function_privilege(role_name,'public.validate_common_population_comparison()','EXECUTE')
   OR has_function_privilege(role_name,'public.read_common_population_stage_custody_before_replacement(uuid,uuid,uuid,uuid)','EXECUTE')
   THEN RAISE EXCEPTION 'Private profile caller privilege became public'; END IF;
  IF has_function_privilege(role_name,'public.read_common_population_stage_custody(uuid,uuid,uuid,uuid)','EXECUTE') IS DISTINCT FROM (role_name='service_role')
   THEN RAISE EXCEPTION 'Restoration wrapper privilege changed'; END IF;
 END LOOP;
 FOREACH signature IN ARRAY ARRAY['public.validate_common_population_comparison()',
   'public.read_common_population_stage_custody_before_replacement(uuid,uuid,uuid,uuid)'] LOOP
  definition:=pg_get_functiondef(signature::regprocedure);
  IF position('model_common_population_profile_allowed(v_profile' IN definition)=0
   OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=signature::regprocedure AND prosecdef AND proconfig=ARRAY['search_path=""'])
   THEN RAISE EXCEPTION 'Latest installed profile caller missing'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_trigger WHERE tgname IN ('zz_validate_common_population_comparison_link','zz_validate_common_population_comparison_snapshot')
   AND tgfoid='public.validate_common_population_comparison()'::regprocedure AND NOT tgisinternal AND tgenabled='O')<>2
  THEN RAISE EXCEPTION 'Current population trigger bindings differ'; END IF;
 IF position('read_common_population_stage_custody_before_replacement' IN pg_get_functiondef('public.read_common_population_stage_custody(uuid,uuid,uuid,uuid)'::regprocedure))=0
  OR position('read_model_population_origin' IN pg_get_functiondef('public.read_common_population_stage_custody(uuid,uuid,uuid,uuid)'::regprocedure))=0
  THEN RAISE EXCEPTION 'Current restoration wrapper branches differ'; END IF;
END $$;

SET LOCAL ROLE anon;
DO $$ BEGIN BEGIN PERFORM public.model_common_population_profile_allowed('{}','retained_validation');
 RAISE EXCEPTION 'Anonymous profile call accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN BEGIN PERFORM public.model_common_population_profile_allowed('{}','retained_validation');
 RAISE EXCEPTION 'Authenticated profile call accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$ BEGIN BEGIN PERFORM public.model_common_population_profile_allowed('{}','retained_validation');
 RAISE EXCEPTION 'Service profile call accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
RESET ROLE;

-- Fresh ordinary generation reaches the current wrapper and renamed function.
-- Invalid object profiles isolate the helper from request-envelope shape checks.
CREATE FUNCTION pg_temp.cp_profile_ordinary_probe(p_profile jsonb,p_allowed bool) RETURNS void
LANGUAGE plpgsql AS $$ DECLARE p cp_probe%ROWTYPE; g cp_groups%ROWTYPE; r uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); reply jsonb; BEGIN
 SELECT * INTO STRICT p FROM cp_probe; SELECT * INTO STRICT g FROM cp_groups WHERE name='main';
 INSERT INTO public.model_runs(id,workspace_id,project_id,model_id,scenario_set_id,scenario_entry_id,engine_key,status,run_title,corridor_geojson,input_snapshot_json,assumption_snapshot_json)
 VALUES(r,g.workspace_id,g.project_id,g.model_id,g.scenario_set_id,g.baseline_id,'aequilibrae','queued','Synthetic P2 ordinary profile',p.geometry,
  jsonb_build_object('zoneGeography','tract','commonPopulation',jsonb_build_object('schema','openplan.common-population-request.v1','mode','generate',
   'custody','legacy_stage_snapshot','comparisonPolicy','fixed_population_auto_trip_change','sourceProfile',p_profile)),'{}');
 INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES(s,r,'AequilibraE Setup','queued',0);
 SET LOCAL ROLE service_role;
 UPDATE public.model_run_stages SET status='running',started_at=clock_timestamp() WHERE id=s AND run_id=r AND status='queued';
 UPDATE public.model_runs SET status='running' WHERE id=r AND status='queued';
 BEGIN
  reply:=public.read_common_population_stage_custody(p.workspace_id,r,s,NULL);
  IF NOT p_allowed THEN RAISE EXCEPTION 'Invalid registered profile stage custody accepted'; END IF;
  IF reply IS DISTINCT FROM jsonb_build_object('schema','openplan.common-population-stage-custody.v1','custody','legacy_stage_snapshot',
   'workspace_id',p.workspace_id,'run_id',r,'stage_id',s,'artifact_id',NULL,'eligible',true) THEN RAISE EXCEPTION 'Ordinary profile reply differs'; END IF;
 EXCEPTION WHEN check_violation THEN
  IF p_allowed OR SQLERRM<>'Common population stage custody is invalid' THEN RAISE; END IF;
 END;
 RESET ROLE;
END $$;
