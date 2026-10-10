DO $proof$
DECLARE workspace uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); delegate uuid:=gen_random_uuid();
 version uuid; feed uuid; worker_token uuid; command uuid; tract_command uuid; receipt jsonb; tract_result jsonb;
 source jsonb; archive jsonb; plan jsonb; rows jsonb; stop_rows jsonb; manifest jsonb; metadata jsonb; bad jsonb;
 tract_geoid text:='synthetic-'||gen_random_uuid(); original_tract text;
BEGIN
 INSERT INTO auth.users(id,email) VALUES(actor,actor||'@example.invalid'),(delegate,delegate||'@example.invalid');
 INSERT INTO public.workspaces(id,name,slug) VALUES(workspace,'Synthetic GTFS completion','gtfs-complete-'||workspace);
 INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(workspace,actor,'owner'),(workspace,delegate,'owner');
 source:=jsonb_build_object('kind','upload','provisionalName','Synthetic completion source','uploadSha256',repeat('f',64),'uploadBytes',321);
 plan:=jsonb_build_object('sha256',repeat('a',64),'bytes',100,'routeRows',2,'stopRows',1,'routeBatches',2,'stopBatches',1);
 metadata:='{"agency_count":1,"route_count":2,"stop_count":1,"trip_count":2,"stop_time_row_count":2,"calendar_service_count":1,"frequency_trip_count":0,"scheduled_trip_count":2,"parse_warnings":[]}'::jsonb;
 FOR mode IN 1..3 LOOP
  worker_token:=gen_random_uuid(); command:=gen_random_uuid(); tract_command:=gen_random_uuid();
  IF mode=2 THEN
   INSERT INTO public.census_tracts(geoid,state_fips,county_fips,name,geometry)
   VALUES(tract_geoid,'99','999','Synthetic polar tract',public.ST_Multi(public.ST_MakeEnvelope(169,84,171,86,4326)));
  END IF;
  IF mode=3 THEN
   EXECUTE $replace$CREATE OR REPLACE FUNCTION public.compute_gtfs_tract_service(p_feed_version_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_catalog AS $failure$
    BEGIN RAISE EXCEPTION 'synthetic tract outage' USING ERRCODE='08006'; END $failure$$replace$;
  END IF;
  SET LOCAL ROLE service_role;
  receipt:=public.admit_gtfs_ingest(gen_random_uuid(),workspace,actor,NULL,source);
  version:=(receipt->>'versionId')::uuid; feed:=(receipt->>'feedId')::uuid;
  archive:=jsonb_build_object('path',workspace||'/'||feed||'/'||version||'.zip','sha256',repeat('f',64),'bytes',321);
  PERFORM public.confirm_gtfs_archive(version,NULL,archive);
  PERFORM public.claim_gtfs_ingest(version,worker_token);
  PERFORM public.stage_gtfs_ingest(version,worker_token,'parsing');
  PERFORM public.prepare_gtfs_derived(version,worker_token,plan);
  rows:=jsonb_build_array(jsonb_build_object('workspace_id',workspace,'feed_version_id',version,
   'route_id','R','route_type',3,'service_day','monday','trips_per_day',1,'stops_served',1,
   'derivation_method','scheduled','scheduled_trips',1,'frequency_trips',0,
   'peak_headway_is_lower_bound',true,'median_headway_basis','not_determined_too_few_departures','departures_beyond_bin_range',0));
  stop_rows:=jsonb_build_array((rows->0)-'route_id'-'route_type'-'stops_served'||jsonb_build_object(
   'stop_id','S','stop_name','Synthetic stop','latitude',85,'longitude',170,'routes_serving',1,'route_ids',jsonb_build_array('R')));
  receipt:=public.write_gtfs_ingest_batch(version,worker_token,gen_random_uuid(),'route',0,rows);
  manifest:=jsonb_build_array(jsonb_build_object('kind','route','ordinal',0,'hash',receipt->>'hash','rows',1));
  receipt:=public.write_gtfs_ingest_batch(version,worker_token,gen_random_uuid(),'stop',0,stop_rows);
  manifest:=manifest||jsonb_build_array(jsonb_build_object('kind','stop','ordinal',0,'hash',receipt->>'hash','rows',1));
  BEGIN
   PERFORM public.compute_managed_gtfs_tracts(version,worker_token,tract_command,plan,manifest);
   RAISE EXCEPTION 'truncated declared output accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
   IF SQLERRM<>'GTFS derived output is incomplete' THEN RAISE; END IF;
  END;
  receipt:=public.write_gtfs_ingest_batch(version,worker_token,gen_random_uuid(),'route',1,jsonb_set(rows,'{0,route_id}','"R2"'));
  manifest:=jsonb_build_array(manifest->0,jsonb_build_object('kind','route','ordinal',1,'hash',receipt->>'hash','rows',1),manifest->1);
  BEGIN
   PERFORM public.compute_managed_gtfs_tracts(version,worker_token,tract_command,plan,manifest-1);
   RAISE EXCEPTION 'incomplete manifest accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
   IF SQLERRM<>'GTFS derived batch manifest differs' THEN RAISE; END IF;
  END;
  BEGIN
   PERFORM public.compute_managed_gtfs_tracts(version,worker_token,tract_command,plan||'{"bytes":101}'::jsonb,manifest);
   RAISE EXCEPTION 'different completion plan accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
   IF SQLERRM<>'GTFS derived output plan differs' THEN RAISE; END IF;
  END;
  BEGIN
   PERFORM public.compute_managed_gtfs_tracts(version,gen_random_uuid(),tract_command,plan,manifest);
   RAISE EXCEPTION 'unowned derived completion accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  RESET ROLE;
  -- Simulate administrative corruption in a subtransaction; neither damaged
  -- receipt nor synthetic extra output survives its expected refusal.
  BEGIN
   UPDATE openplan_gtfs.batch_receipts SET row_count=2 WHERE version_id=version AND kind='stop';
   SELECT jsonb_agg(jsonb_build_object('kind',kind,'ordinal',ordinal,'hash',payload_hash,'rows',row_count) ORDER BY kind,ordinal)
   INTO bad FROM openplan_gtfs.batch_receipts WHERE version_id=version AND token=worker_token;
   PERFORM public.compute_managed_gtfs_tracts(version,worker_token,gen_random_uuid(),plan,bad);
   RAISE EXCEPTION 'stored counts differing from receipts accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
   IF SQLERRM<>'GTFS derived stored counts differ from receipts' THEN RAISE; END IF;
  END;
  SET LOCAL ROLE service_role;
  IF mode=1 THEN
   RESET ROLE;
   SELECT pg_get_functiondef('public.compute_gtfs_tract_service(uuid)'::regprocedure) INTO original_tract;
   EXECUTE $replace$CREATE OR REPLACE FUNCTION public.compute_gtfs_tract_service(p_feed_version_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_catalog AS $expiry$
    BEGIN UPDATE openplan_gtfs.executions SET lease_until=clock_timestamp()-interval '1 second' WHERE version_id=p_feed_version_id;
    RETURN 0; END $expiry$$replace$;
   SET LOCAL ROLE service_role;
   BEGIN
    PERFORM public.compute_managed_gtfs_tracts(version,worker_token,tract_command,plan,manifest);
    RAISE EXCEPTION 'tract computation accepted expired ownership';
   EXCEPTION WHEN SQLSTATE '55000' THEN
    IF SQLERRM<>'GTFS attempt lost ownership during tract computation' THEN RAISE; END IF;
   END;
   RESET ROLE;
   EXECUTE original_tract;
   SET LOCAL ROLE service_role;
  END IF;
  tract_result:=public.compute_managed_gtfs_tracts(version,worker_token,tract_command,plan,manifest);
  IF public.compute_managed_gtfs_tracts(version,worker_token,tract_command,plan,manifest) IS DISTINCT FROM tract_result THEN RAISE EXCEPTION 'tract replay changed outcome'; END IF;
  IF mode=1 AND (tract_result->>'computed' IS DISTINCT FROM 'true' OR tract_result->>'rows' IS DISTINCT FROM '0' OR tract_result->>'computedAt' IS NULL) THEN
   RAISE EXCEPTION 'zero-row tract success misclassified'; END IF;
  IF mode=2 AND (tract_result->>'computed' IS DISTINCT FROM 'true' OR tract_result->>'rows' IS DISTINCT FROM '1') THEN
   RAISE EXCEPTION 'nonempty tract success incorrect'; END IF;
  IF mode=3 AND (tract_result->>'computed' IS DISTINCT FROM 'false' OR tract_result->>'rows' IS NOT NULL
    OR tract_result->>'computedAt' IS NOT NULL OR tract_result->>'errorCode' IS DISTINCT FROM '08006') THEN
   RAISE EXCEPTION 'tract failure became computed zero'; END IF;
  BEGIN
   PERFORM public.compute_managed_gtfs_tracts(version,worker_token,tract_command,plan,manifest-1);
   RAISE EXCEPTION 'changed tract replay accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
   IF SQLERRM<>'GTFS tract command payload changed' THEN RAISE; END IF;
  END;
  BEGIN
   PERFORM public.compute_managed_gtfs_tracts(version,worker_token,gen_random_uuid(),plan,manifest);
   RAISE EXCEPTION 'tract computation repeated under new command';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  BEGIN
   PERFORM public.complete_gtfs_ingest(version,worker_token,command,archive||'{"bytes":999}'::jsonb,plan,manifest,metadata,tract_command);
   RAISE EXCEPTION 'changed completion archive accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
   IF SQLERRM<>'GTFS completion archive identity differs' THEN RAISE; END IF;
  END;
  BEGIN
   PERFORM public.complete_gtfs_ingest(version,worker_token,command,archive,plan,manifest,metadata,gen_random_uuid());
   RAISE EXCEPTION 'unrecorded tract outcome accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
   IF SQLERRM<>'GTFS completion tract outcome differs' THEN RAISE; END IF;
  END;
  FOR bad IN SELECT value FROM jsonb_array_elements('[{"trip_count":"2"},{"trip_count":-1},{"trip_count":2.5},{"is_current":true},{"parse_warnings":{}},{"parse_warnings":null},{"feed_info_publisher_name":7}]'::jsonb) LOOP
   BEGIN
    PERFORM public.complete_gtfs_ingest(version,worker_token,command,archive,plan,manifest,metadata||bad,tract_command);
    RAISE EXCEPTION 'invalid completion metadata accepted';
   EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  END LOOP;
  RESET ROLE;
  BEGIN
   INSERT INTO openplan_gtfs.write_context VALUES(txid_current(),version,'tract','INSERT',worker_token);
   INSERT INTO public.gtfs_tract_service(workspace_id,feed_version_id,tract_geoid,service_day,stops_in_tract,stop_events_per_day,routes_serving)
   VALUES(workspace,version,'extra-synthetic','monday',1,1,1);
   DELETE FROM openplan_gtfs.write_context WHERE version_id=version;
   PERFORM public.complete_gtfs_ingest(version,worker_token,command,archive,plan,manifest,metadata,tract_command);
   RAISE EXCEPTION 'changed stored tract count accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
   IF SQLERRM<>'GTFS completion tract rows differ' THEN RAISE; END IF;
  END;
  SET LOCAL ROLE service_role;
  receipt:=public.complete_gtfs_ingest(version,worker_token,command,archive,plan,manifest,metadata,tract_command);
  IF public.complete_gtfs_ingest(version,worker_token,command,archive,plan,manifest,metadata,tract_command) IS DISTINCT FROM receipt
   OR receipt->>'status' IS DISTINCT FROM 'ready' THEN RAISE EXCEPTION 'completion replay changed outcome'; END IF;
  BEGIN
   PERFORM public.complete_gtfs_ingest(version,worker_token,command,archive,plan,manifest,metadata||'{"trip_count":3}'::jsonb,tract_command);
   RAISE EXCEPTION 'changed completion replay accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
   IF SQLERRM<>'GTFS completion payload changed' THEN RAISE; END IF;
  END;
  BEGIN
   PERFORM public.complete_gtfs_ingest(version,worker_token,gen_random_uuid(),archive,plan,manifest,metadata,tract_command);
   RAISE EXCEPTION 'ready version completed again';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  IF public.renew_gtfs_ingest(version,worker_token) IS NOT FALSE THEN RAISE EXCEPTION 'completed worker renewed'; END IF;
  FOR i IN 1..2 LOOP
   PERFORM set_config('role',CASE i WHEN 1 THEN 'anon' ELSE 'authenticated' END,true);
   BEGIN
    PERFORM public.complete_gtfs_ingest(version,worker_token,command,archive,plan,manifest,metadata,tract_command);
    RAISE EXCEPTION 'client called completion';
   EXCEPTION WHEN insufficient_privilege THEN NULL; END;
   BEGIN
    PERFORM public.compute_managed_gtfs_tracts(version,worker_token,tract_command,plan,manifest);
    RAISE EXCEPTION 'client called tract computation';
   EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  RESET ROLE;
  UPDATE public.workspace_members SET role='viewer' WHERE workspace_id=workspace AND user_id=actor;
  SET LOCAL ROLE service_role;
  BEGIN
   PERFORM public.complete_gtfs_ingest(version,worker_token,command,archive,plan,manifest,metadata,tract_command);
   RAISE EXCEPTION 'revoked actor recovered completion';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
   PERFORM public.compute_managed_gtfs_tracts(version,worker_token,tract_command,plan,manifest);
   RAISE EXCEPTION 'revoked actor recovered tract outcome';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  UPDATE public.workspace_members SET role='owner' WHERE workspace_id=workspace AND user_id=actor;
  IF (SELECT status FROM public.gtfs_feed_versions WHERE id=version) IS DISTINCT FROM 'ready'
   OR (SELECT is_current FROM public.gtfs_feed_versions WHERE id=version) IS DISTINCT FROM false
   OR EXISTS(SELECT 1 FROM public.gtfs_feeds WHERE current_version_id=version)
   OR NOT EXISTS(SELECT 1 FROM openplan_gtfs.executions WHERE version_id=version AND state='ready' AND token IS NULL AND lease_until IS NULL)
   OR (SELECT count(*) FROM openplan_gtfs.completion_receipts WHERE version_id=version)<>1
   OR EXISTS(SELECT 1 FROM openplan_gtfs.write_context) THEN RAISE EXCEPTION 'completion state or adoption incorrect'; END IF;
  IF mode=3 AND EXISTS(SELECT 1 FROM public.gtfs_feed_versions WHERE id=version AND (tract_service_rows IS NOT NULL OR tract_service_computed_at IS NOT NULL)) THEN
   RAISE EXCEPTION 'failed tract analysis published numeric result'; END IF;
 END LOOP;
 DELETE FROM public.workspaces WHERE id=workspace;
 DELETE FROM public.census_tracts WHERE geoid=tract_geoid;
END $proof$;
