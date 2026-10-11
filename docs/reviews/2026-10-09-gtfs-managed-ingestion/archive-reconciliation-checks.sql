DO $proof$
DECLARE workspace uuid:=gen_random_uuid(); feed uuid:=gen_random_uuid(); version uuid:=gen_random_uuid();
 path text; other uuid; bad integer; first_page uuid[]; second_page uuid[];
BEGIN
 IF has_function_privilege('anon','public.reconcile_gtfs_storage_cleanup(integer)','EXECUTE')
  OR has_function_privilege('authenticated','public.reconcile_gtfs_storage_cleanup(integer)','EXECUTE')
  OR has_table_privilege('service_role','openplan_gtfs.retired_archives','DELETE') THEN
  RAISE EXCEPTION 'retirement authority exposed';
 END IF;
 FOREACH bad IN ARRAY ARRAY[NULL,0,201] LOOP
  BEGIN
   PERFORM public.reconcile_gtfs_storage_cleanup(bad);
   RAISE EXCEPTION 'unbounded reconciliation accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 END LOOP;
 path:=workspace||'/'||feed||'/'||version||'.zip';
 BEGIN
  PERFORM openplan_gtfs.remember_retired_archive(version,'unknown/'||feed||'/'||version||'.zip');
  RAISE EXCEPTION 'invalid key retired';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 BEGIN
  PERFORM openplan_gtfs.remember_retired_archive(gen_random_uuid(),path);
  RAISE EXCEPTION 'different version key retired';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 INSERT INTO public.workspaces(id,name,slug) VALUES(workspace,'Synthetic retirement controls','retirement-'||workspace);
 INSERT INTO public.gtfs_feeds(id,workspace_id,agency_name) VALUES(feed,workspace,'Synthetic retirement controls');
 INSERT INTO public.gtfs_feed_versions(id,workspace_id,feed_id,source_kind,status)
 VALUES(version,workspace,feed,'upload','pending');
 BEGIN
  PERFORM openplan_gtfs.remember_retired_archive(version,gen_random_uuid()||'/'||feed||'/'||version||'.zip');
  RAISE EXCEPTION 'foreign scope retired';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 INSERT INTO public.gtfs_ingest_storage_cleanup(version_id,storage_path) VALUES(version,path);
 IF NOT EXISTS(SELECT 1 FROM openplan_gtfs.retired_archives a WHERE a.version_id=version) THEN
  RAISE EXCEPTION 'cleanup request not retained';
 END IF;
 IF EXISTS(SELECT 1 FROM public.reconcile_gtfs_storage_cleanup(200) r WHERE r.version_id=version) THEN
  RAISE EXCEPTION 'open archive selected';
 END IF;
 UPDATE public.gtfs_feed_versions SET status='failed',failure_code='synthetic_failure' WHERE id=version;
 IF EXISTS(SELECT 1 FROM public.reconcile_gtfs_storage_cleanup(200) r WHERE r.version_id=version) THEN
  RAISE EXCEPTION 'unclosed archive selected';
 END IF;
 UPDATE public.gtfs_feed_versions SET ingest_closed_at=clock_timestamp() WHERE id=version;
 IF NOT EXISTS(SELECT 1 FROM public.reconcile_gtfs_storage_cleanup(200) r WHERE r.version_id=version) THEN
  RAISE EXCEPTION 'closed archive omitted';
 END IF;
 DELETE FROM public.gtfs_ingest_storage_cleanup WHERE version_id=version;
 IF NOT EXISTS(SELECT 1 FROM openplan_gtfs.retired_archives a WHERE a.version_id=version) THEN
  RAISE EXCEPTION 'acknowledgment erased authority';
 END IF;
 IF EXISTS(SELECT 1 FROM public.reconcile_gtfs_storage_cleanup(200) r WHERE r.version_id=version) THEN
  RAISE EXCEPTION 'absent archive repeatedly queued';
 END IF;
 other:=gen_random_uuid();
 INSERT INTO public.gtfs_feed_versions(id,workspace_id,feed_id,source_kind,status)
 VALUES(other,workspace,feed,'upload','pending');
 UPDATE public.gtfs_feed_versions SET status='failed',failure_code='abandoned',ingest_abandoned_at=clock_timestamp() WHERE id=other;
 IF NOT EXISTS(SELECT 1 FROM openplan_gtfs.retired_archives a WHERE a.version_id=other) THEN
  RAISE EXCEPTION 'unconfirmed legacy archive lost';
 END IF;
 -- A second version proves deletion capture independently of a previous request.
 other:=gen_random_uuid();
 INSERT INTO public.gtfs_feed_versions(id,workspace_id,feed_id,source_kind,status)
 VALUES(other,workspace,feed,'upload','pending');
 DELETE FROM public.gtfs_feeds WHERE id=feed;
 DELETE FROM public.workspaces WHERE id=workspace;
 IF NOT EXISTS(SELECT 1 FROM openplan_gtfs.retired_archives a WHERE a.version_id=other)
  OR NOT EXISTS(SELECT 1 FROM public.reconcile_gtfs_storage_cleanup(200) r WHERE r.version_id=other) THEN
  RAISE EXCEPTION 'deleted parent archive lost';
 END IF;
 BEGIN
  PERFORM openplan_gtfs.remember_retired_archive(version,gen_random_uuid()||'/'||feed||'/'||version||'.zip');
  RAISE EXCEPTION 'retired identity changed';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 -- Rollback-only synthetic backlog. No Storage rows or bytes are fabricated.
 DELETE FROM public.gtfs_ingest_storage_cleanup;
 DELETE FROM openplan_gtfs.retired_archives;
 FOR i IN 1..205 LOOP
  other:=gen_random_uuid();
  INSERT INTO public.gtfs_ingest_storage_cleanup(version_id,storage_path)
  VALUES(other,workspace||'/'||feed||'/'||other||'.zip');
 END LOOP;
 SET LOCAL ROLE service_role;
 SELECT array_agg(r.version_id) INTO first_page FROM public.reconcile_gtfs_storage_cleanup(200) r;
 SELECT array_agg(r.version_id) INTO second_page FROM public.reconcile_gtfs_storage_cleanup(5) r;
 RESET ROLE;
 IF cardinality(first_page)<>200 OR cardinality(second_page)<>5 OR first_page && second_page THEN
  RAISE EXCEPTION 'reconciliation rotation starved later keys';
 END IF;
END $proof$;
