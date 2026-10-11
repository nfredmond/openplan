DO $proof$
DECLARE workspace uuid:=gen_random_uuid(); other_workspace uuid:=gen_random_uuid();
  actor uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid(); request uuid:=gen_random_uuid();
  upload_request uuid:=gen_random_uuid(); token uuid:=gen_random_uuid(); next_token uuid:=gen_random_uuid();
  response jsonb; replay jsonb; claim jsonb; version uuid; upload_version uuid; feed uuid;
  other_feed uuid:=gen_random_uuid(); source jsonb; upload_source jsonb; archive jsonb; prepared jsonb; bad_bytes jsonb;
BEGIN
  INSERT INTO auth.users(id,email) VALUES(actor,actor||'@example.invalid'),(viewer,viewer||'@example.invalid');
  INSERT INTO public.workspaces(id,name,slug) VALUES(workspace,'Synthetic GTFS managed import','gtfs-'||workspace),
    (other_workspace,'Synthetic unrelated workspace','gtfs-'||other_workspace);
  INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(workspace,actor,'owner'),(workspace,viewer,'viewer');
  INSERT INTO public.gtfs_feeds(id,workspace_id,agency_name) VALUES(other_feed,other_workspace,'Other workspace feed');
  source:=jsonb_build_object('kind','url','provisionalName','Synthetic source',
    'sourceUrl','https://example.invalid/feed.zip','normalizedSourceUrl','https://example.invalid/feed.zip');
  upload_source:=jsonb_build_object('kind','upload','provisionalName','Synthetic upload','uploadSha256',repeat('a',64),'uploadBytes',123);

  FOR i IN 1..2 LOOP
    PERFORM set_config('role',CASE i WHEN 1 THEN 'anon' ELSE 'authenticated' END,true);
    BEGIN
      PERFORM public.admit_gtfs_ingest(request,workspace,actor,NULL,source);
      RAISE EXCEPTION 'client invoked admission';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    PERFORM set_config('role','none',true);
  END LOOP;
  PERFORM set_config('role','service_role',true);
  BEGIN
    PERFORM public.admit_gtfs_ingest(request,workspace,actor,NULL,source||'{"provisionalName":123}'::jsonb);
    RAISE EXCEPTION 'nontext source metadata accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  FOR bad_bytes IN SELECT value FROM jsonb_array_elements('["123",123.5,9007199254740992,-1,null]'::jsonb) LOOP
    BEGIN
      PERFORM public.admit_gtfs_ingest(request,workspace,actor,NULL,upload_source||jsonb_build_object('uploadBytes',bad_bytes));
      RAISE EXCEPTION 'invalid upload byte count accepted';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  END LOOP;
  BEGIN
    PERFORM public.admit_gtfs_ingest(request,workspace,viewer,NULL,source);
    RAISE EXCEPTION 'viewer admitted work';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.admit_gtfs_ingest(request,workspace,actor,other_feed,source);
    RAISE EXCEPTION 'foreign feed admitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  response:=public.admit_gtfs_ingest(request,workspace,actor,NULL,source);
  replay:=public.admit_gtfs_ingest(request,workspace,actor,NULL,source);
  IF replay IS DISTINCT FROM response THEN RAISE EXCEPTION 'admission retry changed identity'; END IF;
  version:=(response->>'versionId')::uuid; feed:=(response->>'feedId')::uuid;
  IF response->>'createdFeed' IS DISTINCT FROM 'true' OR version IS NULL OR feed IS NULL THEN
    RAISE EXCEPTION 'admission receipt missing identity'; END IF;
  BEGIN
    PERFORM public.admit_gtfs_ingest(request,workspace,actor,NULL,source||'{"provisionalName":"Changed"}'::jsonb);
    RAISE EXCEPTION 'changed request replay accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;

  claim:=public.claim_gtfs_ingest(version,token);
  IF claim->>'active' IS DISTINCT FROM 'true' OR claim->'claim'->>'attempt' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'initial claim unavailable'; END IF;
  IF public.claim_gtfs_ingest(version,token) IS DISTINCT FROM claim THEN RAISE EXCEPTION 'claim retry changed identity'; END IF;
  IF public.claim_gtfs_ingest(version,next_token) IS NOT NULL THEN RAISE EXCEPTION 'live owner replaced'; END IF;
  IF public.renew_gtfs_ingest(version,token) IS NOT TRUE THEN RAISE EXCEPTION 'active renewal refused'; END IF;

  upload_version:=(public.admit_gtfs_ingest(upload_request,workspace,actor,feed,upload_source)->>'versionId')::uuid;
  IF public.claim_gtfs_ingest(upload_version,gen_random_uuid()) IS NOT NULL THEN RAISE EXCEPTION 'unstored upload claimed'; END IF;
  BEGIN
    PERFORM public.claim_gtfs_ingest(upload_version,token);
    RAISE EXCEPTION 'token rebound to another version';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN
    PERFORM public.stage_gtfs_ingest(version,token,'parsing');
    RAISE EXCEPTION 'parsing began without retained archive';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  PERFORM public.stage_gtfs_ingest(version,token,'fetching');
  archive:=jsonb_build_object('path',workspace::text||'/'||feed::text||'/'||version::text||'.zip','sha256',repeat('b',64),'bytes',456);
  FOR bad_bytes IN SELECT value FROM jsonb_array_elements('["456",456.5,9007199254740992,-1,null]'::jsonb) LOOP
    BEGIN
      PERFORM public.prepare_gtfs_archive(version,token,archive||jsonb_build_object('bytes',bad_bytes));
      RAISE EXCEPTION 'invalid archive byte count accepted';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  END LOOP;
  BEGIN
    PERFORM public.prepare_gtfs_archive(version,token,archive||'{"path":"wrong/path.zip"}'::jsonb);
    RAISE EXCEPTION 'foreign archive path prepared';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  prepared:=public.prepare_gtfs_archive(version,token,archive);
  IF public.prepare_gtfs_archive(version,token,archive) IS DISTINCT FROM prepared THEN RAISE EXCEPTION 'archive preparation retry changed'; END IF;
  BEGIN
    PERFORM public.prepare_gtfs_archive(version,token,archive||jsonb_build_object('sha256',repeat('c',64)));
    RAISE EXCEPTION 'prepared archive replaced';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN
    PERFORM public.stage_gtfs_ingest(version,token,'fetching');
    RAISE EXCEPTION 'prepared archive allowed mutable refetch';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  BEGIN
    PERFORM public.confirm_gtfs_archive(version,next_token,archive);
    RAISE EXCEPTION 'unowned archive confirmation accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  replay:=public.confirm_gtfs_archive(version,token,archive);
  IF public.confirm_gtfs_archive(version,token,archive) IS DISTINCT FROM replay THEN RAISE EXCEPTION 'archive confirmation retry changed'; END IF;
  PERFORM public.stage_gtfs_ingest(version,token,'parsing');
  IF (SELECT checksum_sha256 FROM public.gtfs_feed_versions WHERE id=version)<>repeat('b',64) THEN
    RAISE EXCEPTION 'confirmed archive not retained on version'; END IF;
  archive:=jsonb_build_object('path',workspace::text||'/'||feed::text||'/'||upload_version::text||'.zip','sha256',repeat('a',64),'bytes',123);
  PERFORM public.confirm_gtfs_archive(upload_version,NULL,archive);
  IF public.claim_gtfs_ingest(upload_version,gen_random_uuid())->>'active' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'confirmed upload not claimable'; END IF;
  BEGIN
    UPDATE public.gtfs_feed_versions SET failure_code='partial_write',status='failed' WHERE id=version;
    RAISE EXCEPTION 'direct managed version write accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  BEGIN
    PERFORM public.close_failed_gtfs_version(version,'partial_write','synthetic',NULL);
    RAISE EXCEPTION 'legacy failure closed managed work';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  BEGIN
    PERFORM public.reap_gtfs_feed_version(version,clock_timestamp()+interval '1 day');
    RAISE EXCEPTION 'legacy reaper closed managed work';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  BEGIN
    INSERT INTO public.gtfs_route_service_levels(workspace_id,feed_version_id,route_id,route_type,service_day,trips_per_day,derivation_method)
    VALUES(workspace,version,'R',3,'monday',1,'scheduled');
    RAISE EXCEPTION 'direct managed batch accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  BEGIN
    UPDATE public.gtfs_feeds SET current_version_id=version WHERE id=feed;
    RAISE EXCEPTION 'direct managed pointer accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  BEGIN
    DELETE FROM public.gtfs_feed_versions WHERE id=version;
    RAISE EXCEPTION 'individual managed version deleted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;

  PERFORM set_config('role','none',true);
  IF (SELECT count(*) FROM openplan_gtfs.submissions WHERE workspace_id=workspace)<>2
    OR (SELECT count(*) FROM public.gtfs_feed_versions WHERE workspace_id=workspace)<>2 THEN
    RAISE EXCEPTION 'admission created unexpected versions'; END IF;
  UPDATE openplan_gtfs.executions SET lease_until=clock_timestamp()-interval '1 second' WHERE version_id=version;
  PERFORM set_config('role','service_role',true);
  replay:=public.claim_gtfs_ingest(version,token);
  IF replay->>'active' IS DISTINCT FROM 'false' OR replay->'claim' IS DISTINCT FROM claim->'claim' THEN
    RAISE EXCEPTION 'expired token revived'; END IF;
  claim:=public.claim_gtfs_ingest(version,next_token);
  IF claim->'claim'->>'attempt' IS DISTINCT FROM '2' OR claim->>'active' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'replacement claim missing'; END IF;
  IF public.renew_gtfs_ingest(version,token) IS NOT FALSE THEN RAISE EXCEPTION 'stale token renewed replacement'; END IF;
  BEGIN
    PERFORM public.stage_gtfs_ingest(version,token,'parsing');
    RAISE EXCEPTION 'stale token changed stage';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  PERFORM set_config('role','none',true);
  UPDATE public.workspace_members SET role='owner' WHERE workspace_id=workspace AND user_id=viewer;
  UPDATE public.workspace_members SET role='viewer' WHERE workspace_id=workspace AND user_id=actor;
  PERFORM set_config('role','service_role',true);
  IF public.renew_gtfs_ingest(version,next_token) IS NOT FALSE THEN RAISE EXCEPTION 'revoked actor renewed'; END IF;
  BEGIN
    PERFORM public.admit_gtfs_ingest(request,workspace,actor,NULL,source);
    RAISE EXCEPTION 'revoked actor read admission';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('role','none',true);
  UPDATE public.workspace_members SET role='owner' WHERE workspace_id=workspace AND user_id=actor;

  IF EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) r
    CROSS JOIN unnest(ARRAY['gtfs_feeds','gtfs_feed_versions','gtfs_route_service_levels','gtfs_stop_service_levels','gtfs_tract_service']) t
    WHERE has_table_privilege(r,'public.'||t,'TRUNCATE')) THEN RAISE EXCEPTION 'runtime truncate remains available'; END IF;
  IF has_schema_privilege('service_role','openplan_gtfs','USAGE') THEN RAISE EXCEPTION 'private journal exposed'; END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('admit_gtfs_ingest','claim_gtfs_ingest','renew_gtfs_ingest',
      'prepare_gtfs_archive','confirm_gtfs_archive','stage_gtfs_ingest')
    AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'))) THEN
    RAISE EXCEPTION 'managed worker command exposed to client'; END IF;

  -- Individual feed deletion keeps submission identity but fences all further work.
  DELETE FROM public.gtfs_feeds WHERE id=feed;
  PERFORM set_config('role','service_role',true);
  replay:=public.admit_gtfs_ingest(request,workspace,actor,NULL,source);
  IF replay IS DISTINCT FROM response THEN RAISE EXCEPTION 'deleted import recreated on retry'; END IF;
  IF public.claim_gtfs_ingest(version,next_token) IS NOT NULL THEN RAISE EXCEPTION 'deleted version claimed'; END IF;
  PERFORM set_config('role','none',true);
  IF EXISTS(SELECT 1 FROM public.gtfs_feeds WHERE id=feed) THEN RAISE EXCEPTION 'feed recreated'; END IF;
  DELETE FROM public.workspaces WHERE id IN(workspace,other_workspace);
  IF EXISTS(SELECT 1 FROM openplan_gtfs.submissions WHERE workspace_id=workspace) THEN RAISE EXCEPTION 'workspace custody did not cascade'; END IF;
END $proof$;
