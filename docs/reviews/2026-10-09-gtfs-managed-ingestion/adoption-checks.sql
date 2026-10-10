-- Synthetic completed imports use the actual managed commands. This helper and
-- every fixture exist only inside the enclosing rollback transaction.
CREATE FUNCTION pg_temp.ready_gtfs(p_workspace uuid,p_actor uuid,p_feed uuid,p_routes integer,p_stops integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE admitted jsonb; receipt jsonb; version uuid; feed uuid; token uuid:=gen_random_uuid();
 tract_command uuid:=gen_random_uuid(); archive jsonb; plan jsonb; manifest jsonb; rows jsonb; metadata jsonb;
BEGIN
 admitted:=public.admit_gtfs_ingest(gen_random_uuid(),p_workspace,p_actor,p_feed,
  jsonb_build_object('kind','upload','provisionalName','Synthetic adoption','uploadSha256',repeat('f',64),'uploadBytes',321));
 version:=(admitted->>'versionId')::uuid; feed:=(admitted->>'feedId')::uuid;
 archive:=jsonb_build_object('path',p_workspace||'/'||feed||'/'||version||'.zip','sha256',repeat('f',64),'bytes',321);
 plan:=jsonb_build_object('sha256',repeat('a',64),'bytes',100,'routeRows',p_routes,'stopRows',p_stops,'routeBatches',1,'stopBatches',1);
 PERFORM public.confirm_gtfs_archive(version,NULL,archive);
 PERFORM public.claim_gtfs_ingest(version,token);
 PERFORM public.stage_gtfs_ingest(version,token,'parsing');
 PERFORM public.prepare_gtfs_derived(version,token,plan);
 SELECT jsonb_agg(jsonb_build_object('workspace_id',p_workspace,'feed_version_id',version,
  'route_id','R'||n,'route_type',3,'service_day','monday','trips_per_day',1,'stops_served',1,
  'derivation_method','scheduled','scheduled_trips',1,'frequency_trips',0,
  'peak_headway_is_lower_bound',true,'median_headway_basis','not_determined_too_few_departures','departures_beyond_bin_range',0))
 INTO rows FROM generate_series(1,p_routes) n;
 receipt:=public.write_gtfs_ingest_batch(version,token,gen_random_uuid(),'route',0,rows);
 manifest:=jsonb_build_array(jsonb_build_object('kind','route','ordinal',0,'hash',receipt->>'hash','rows',p_routes));
 SELECT jsonb_agg((rows->0)-'route_id'-'route_type'-'stops_served'||jsonb_build_object('stop_id','S'||n,
  'stop_name','Synthetic stop','latitude',85,'longitude',170,'routes_serving',1,'route_ids',jsonb_build_array('R1')))
 INTO rows FROM generate_series(1,p_stops) n;
 receipt:=public.write_gtfs_ingest_batch(version,token,gen_random_uuid(),'stop',0,rows);
 manifest:=manifest||jsonb_build_array(jsonb_build_object('kind','stop','ordinal',0,'hash',receipt->>'hash','rows',p_stops));
 PERFORM public.compute_managed_gtfs_tracts(version,token,tract_command,plan,manifest);
 metadata:=jsonb_build_object('agency_count',1,'route_count',p_routes,'stop_count',p_stops,'trip_count',p_routes,
  'stop_time_row_count',p_stops,'calendar_service_count',1,'frequency_trip_count',0,'scheduled_trip_count',p_routes,'parse_warnings','[]'::jsonb);
 PERFORM public.complete_gtfs_ingest(version,token,gen_random_uuid(),archive,plan,manifest,metadata,tract_command);
 RETURN admitted;
END $$;

DO $proof$
DECLARE workspace uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid();
 delegate uuid:=gen_random_uuid(); foreign_workspace uuid:=gen_random_uuid(); feed uuid; first_version uuid; boundary_version uuid; shrink_version uuid;
 stop_shrink uuid; unfinished uuid; legacy uuid:=gen_random_uuid(); command uuid:=gen_random_uuid(); review_command uuid:=gen_random_uuid();
 receipt jsonb; original jsonb; withheld jsonb; reviewed jsonb; review jsonb; bad jsonb; loaded timestamptz;
BEGIN
 INSERT INTO auth.users(id,email) VALUES(actor,actor||'@example.invalid'),(viewer,viewer||'@example.invalid'),(delegate,delegate||'@example.invalid');
 INSERT INTO public.workspaces(id,name,slug) VALUES(workspace,'Synthetic GTFS adoption','adoption-'||workspace),
  (foreign_workspace,'Synthetic foreign workspace','adoption-'||foreign_workspace);
 INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(workspace,actor,'owner'),(workspace,viewer,'viewer'),(workspace,delegate,'owner'),(foreign_workspace,actor,'owner');
 SET LOCAL ROLE service_role;
 receipt:=pg_temp.ready_gtfs(workspace,actor,NULL,10,10);
 feed:=(receipt->>'feedId')::uuid; first_version:=(receipt->>'versionId')::uuid;
 FOR i IN 1..4 LOOP
  BEGIN
   PERFORM public.adopt_gtfs_ingest(CASE WHEN i=1 THEN NULL ELSE workspace END,
    CASE WHEN i=2 THEN NULL ELSE first_version END,CASE WHEN i=3 THEN NULL ELSE gen_random_uuid() END,
    CASE WHEN i=4 THEN NULL ELSE actor END);
   RAISE EXCEPTION 'incomplete adoption identity accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
   IF SQLERRM<>'GTFS adoption requires its complete identity' THEN RAISE; END IF;
  END;
 END LOOP;
 BEGIN
  PERFORM public.adopt_gtfs_ingest(workspace,first_version,gen_random_uuid(),viewer);
  RAISE EXCEPTION 'viewer adopted feed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.adopt_gtfs_ingest(foreign_workspace,first_version,gen_random_uuid(),actor);
  RAISE EXCEPTION 'foreign workspace adopted feed';
 EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM<>'GTFS adoption version is unavailable' THEN RAISE; END IF;
 END;
 original:=public.adopt_gtfs_ingest(workspace,first_version,command,actor);
 IF original->>'adopted' IS DISTINCT FROM 'true' OR original->'basis'->>'previousVersionId' IS NOT NULL THEN
  RAISE EXCEPTION 'first adoption incorrect'; END IF;
 IF (SELECT current_version_id FROM public.gtfs_feeds WHERE id=feed) IS DISTINCT FROM first_version
  OR NOT EXISTS(SELECT 1 FROM public.gtfs_feed_versions WHERE id=first_version AND is_current) THEN
  RAISE EXCEPTION 'first adoption pointer missing'; END IF;
 RESET ROLE;
 IF EXISTS(SELECT 1 FROM openplan_gtfs.write_context) THEN RAISE EXCEPTION 'adoption context leaked'; END IF;
 SET LOCAL ROLE service_role;
 loaded:=(original->>'adoptedAt')::timestamptz;
 IF public.adopt_gtfs_ingest(workspace,first_version,command,actor) IS DISTINCT FROM original THEN
  RAISE EXCEPTION 'adoption replay changed receipt'; END IF;
 receipt:=public.adopt_gtfs_ingest(workspace,first_version,gen_random_uuid(),actor);
 IF receipt->>'alreadyCurrent' IS DISTINCT FROM 'true' OR (receipt->>'adoptedAt')::timestamptz IS DISTINCT FROM loaded THEN
  RAISE EXCEPTION 'current adoption changed timestamp'; END IF;
 BEGIN
  PERFORM public.adopt_gtfs_ingest(workspace,first_version,command,actor,'{}');
  RAISE EXCEPTION 'changed adoption command accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN
  IF SQLERRM<>'GTFS adoption command payload changed' THEN RAISE; END IF;
 END;
 receipt:=pg_temp.ready_gtfs(workspace,actor,feed,8,8); boundary_version:=(receipt->>'versionId')::uuid;
 receipt:=public.adopt_gtfs_ingest(workspace,boundary_version,gen_random_uuid(),actor);
 IF receipt->>'adopted' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'exact twenty percent shrink withheld'; END IF;
 receipt:=pg_temp.ready_gtfs(workspace,actor,feed,6,8); shrink_version:=(receipt->>'versionId')::uuid;
 withheld:=public.adopt_gtfs_ingest(workspace,shrink_version,review_command,actor);
 IF withheld->>'withheld' IS DISTINCT FROM 'true' OR withheld->>'adopted' IS DISTINCT FROM 'false'
  OR (SELECT current_version_id FROM public.gtfs_feeds WHERE id=feed) IS DISTINCT FROM boundary_version THEN
  RAISE EXCEPTION 'material route shrink adopted without review'; END IF;
 review:=jsonb_build_object('acceptMaterialShrinkage',true,'basis',withheld->'basis');
 FOR bad IN SELECT value FROM jsonb_array_elements(jsonb_build_array('{}'::jsonb,review||'{"acceptMaterialShrinkage":false}',
   review||'{"unknown":true}',jsonb_set(review,'{basis,previousRouteCount}','9'))) LOOP
  BEGIN
   PERFORM public.adopt_gtfs_ingest(workspace,shrink_version,gen_random_uuid(),actor,bad);
   RAISE EXCEPTION 'changed adoption review accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
   IF SQLERRM<>'GTFS adoption review no longer matches current evidence' THEN RAISE; END IF;
  END;
 END LOOP;
 reviewed:=public.adopt_gtfs_ingest(workspace,shrink_version,gen_random_uuid(),actor,review);
 IF reviewed->>'adopted' IS DISTINCT FROM 'true' OR reviewed->>'reviewAccepted' IS DISTINCT FROM 'true' THEN
  RAISE EXCEPTION 'exact adoption review failed'; END IF;
 IF public.adopt_gtfs_ingest(workspace,shrink_version,review_command,actor) IS DISTINCT FROM withheld THEN
  RAISE EXCEPTION 'withheld adoption replay changed outcome'; END IF;
 receipt:=pg_temp.ready_gtfs(workspace,actor,feed,6,6); stop_shrink:=(receipt->>'versionId')::uuid;
 receipt:=public.adopt_gtfs_ingest(workspace,stop_shrink,gen_random_uuid(),actor);
 IF receipt->>'withheld' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'material stop shrink adopted without review'; END IF;
 -- Restore the larger completed version, then reject review of the old predecessor.
 PERFORM public.adopt_gtfs_ingest(workspace,first_version,gen_random_uuid(),actor);
 BEGIN
  PERFORM public.adopt_gtfs_ingest(workspace,shrink_version,gen_random_uuid(),actor,review);
  RAISE EXCEPTION 'stale predecessor review accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 IF public.adopt_gtfs_ingest(workspace,shrink_version,review_command,actor) IS DISTINCT FROM withheld
  OR (SELECT current_version_id FROM public.gtfs_feeds WHERE id=feed) IS DISTINCT FROM first_version THEN
  RAISE EXCEPTION 'historical adoption replay reapplied decision'; END IF;
 receipt:=public.admit_gtfs_ingest(gen_random_uuid(),workspace,actor,feed,
  '{"kind":"url","provisionalName":"Unfinished synthetic feed","sourceUrl":"https://example.invalid/feed.zip","normalizedSourceUrl":"https://example.invalid/feed.zip"}');
 unfinished:=(receipt->>'versionId')::uuid;
 BEGIN
  PERFORM public.adopt_gtfs_ingest(workspace,unfinished,gen_random_uuid(),actor);
  RAISE EXCEPTION 'unfinished version adopted';
 EXCEPTION WHEN SQLSTATE '55000' THEN
  IF SQLERRM<>'GTFS adoption requires a ready version' THEN RAISE; END IF;
 END;
 RESET ROLE;
 BEGIN
  DELETE FROM openplan_gtfs.completion_receipts WHERE version_id=boundary_version;
  PERFORM public.adopt_gtfs_ingest(workspace,boundary_version,gen_random_uuid(),actor);
  RAISE EXCEPTION 'managed version without completion adopted';
 EXCEPTION WHEN SQLSTATE '55000' THEN
  IF SQLERRM<>'Managed GTFS adoption requires its completion receipt' THEN RAISE; END IF;
 END;
 BEGIN
  UPDATE public.gtfs_feeds SET status='failed' WHERE id=feed;
  PERFORM public.adopt_gtfs_ingest(workspace,boundary_version,gen_random_uuid(),actor);
  RAISE EXCEPTION 'inconsistent current feed accepted';
 EXCEPTION WHEN SQLSTATE '55000' THEN
  IF SQLERRM<>'GTFS current feed evidence is inconsistent' THEN RAISE; END IF;
 END;
 -- A retained legacy version is a valid rollback target; managed outgoing flags
 -- still need the owned command context.
 INSERT INTO public.gtfs_feed_versions(id,feed_id,workspace_id,source_kind,status,route_count,stop_count,route_service_level_rows,stop_service_level_rows)
 VALUES(legacy,feed,workspace,'upload','ready',10,10,10,10);
 SET LOCAL ROLE service_role;
 PERFORM public.adopt_gtfs_ingest(workspace,legacy,gen_random_uuid(),actor);
 IF (SELECT current_version_id FROM public.gtfs_feeds WHERE id=feed) IS DISTINCT FROM legacy
  OR (SELECT status FROM public.gtfs_feeds WHERE id=feed) IS DISTINCT FROM 'ready'
  OR (SELECT count(*) FROM public.gtfs_feed_versions WHERE feed_id=feed AND is_current)<>1
  OR NOT EXISTS(SELECT 1 FROM public.gtfs_feed_versions WHERE id=legacy AND is_current) THEN
  RAISE EXCEPTION 'adoption pointer mirrors differ'; END IF;
 IF public.adopt_gtfs_ingest(workspace,first_version,command,actor) IS DISTINCT FROM original
  OR (SELECT current_version_id FROM public.gtfs_feeds WHERE id=feed) IS DISTINCT FROM legacy THEN
  RAISE EXCEPTION 'historical successful adoption reapplied decision'; END IF;
 FOR i IN 1..2 LOOP
  PERFORM set_config('role',CASE i WHEN 1 THEN 'anon' ELSE 'authenticated' END,true);
  BEGIN
   PERFORM public.adopt_gtfs_ingest(workspace,first_version,command,actor);
   RAISE EXCEPTION 'client called adoption';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 END LOOP;
 RESET ROLE;
 UPDATE public.workspace_members SET role='viewer' WHERE workspace_id=workspace AND user_id=actor;
 SET LOCAL ROLE service_role;
 BEGIN
  PERFORM public.adopt_gtfs_ingest(workspace,first_version,command,actor);
  RAISE EXCEPTION 'revoked actor recovered adoption';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RESET ROLE;
 UPDATE public.workspace_members SET role='owner' WHERE workspace_id=workspace AND user_id=actor;
 IF EXISTS(SELECT 1 FROM openplan_gtfs.write_context) THEN RAISE EXCEPTION 'adoption context leaked'; END IF;
 DELETE FROM public.gtfs_feeds WHERE id=feed;
 SET LOCAL ROLE service_role;
 IF public.adopt_gtfs_ingest(workspace,first_version,command,actor) IS DISTINCT FROM original THEN
  RAISE EXCEPTION 'deleted feed adoption receipt lost'; END IF;
 BEGIN
  PERFORM public.adopt_gtfs_ingest(workspace,shrink_version,command,actor);
  RAISE EXCEPTION 'deleted feed adoption command reused';
 EXCEPTION WHEN SQLSTATE '22023' THEN
  IF SQLERRM<>'GTFS adoption command payload changed' THEN RAISE; END IF;
 END;
 RESET ROLE;
 DELETE FROM public.workspaces WHERE id IN (workspace,foreign_workspace);
END $proof$;
