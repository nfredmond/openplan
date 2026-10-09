DO $proof$
DECLARE v uuid; t uuid; command uuid:=gen_random_uuid(); archive jsonb; manifest jsonb; metadata jsonb; receipt jsonb;
BEGIN
 SELECT version_id,token INTO STRICT v,t FROM ownership_probe.gtfs_execution_probe;
 SELECT jsonb_build_object('path',storage_path,'sha256',checksum_sha256,'bytes',byte_size) INTO archive FROM public.gtfs_feed_versions WHERE id=v;
 SELECT jsonb_agg(jsonb_build_object('kind',kind,'ordinal',ordinal,'hash',payload_hash,'rows',row_count) ORDER BY kind,ordinal)
 INTO manifest FROM ownership_probe.batch_receipt WHERE version_id=v AND token=t;
 metadata:='{"agency_count":1,"route_count":1,"stop_count":1,"trip_count":1,"stop_time_row_count":1,"calendar_service_count":1,"frequency_trip_count":0,"scheduled_trip_count":1,"parse_warnings":[]}'::jsonb;
 SET LOCAL ROLE service_role;
 BEGIN
  PERFORM ownership_probe.complete_probe(v,t,command,archive,manifest-1,metadata);
  RAISE EXCEPTION 'Incomplete manifest accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN
  IF SQLERRM<>'Completion batch manifest differs' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM ownership_probe.complete_probe(v,t,command,jsonb_set(archive,'{bytes}','2'),manifest,metadata);
  RAISE EXCEPTION 'Changed archive accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN
  IF SQLERRM<>'Completion archive identity differs' THEN RAISE; END IF;
 END;
 RESET ROLE;
 -- Simulate database damage inside a subtransaction and prove completion refuses
 -- declared counts that no longer match real rows. Restore it on expected error.
 BEGIN
  INSERT INTO ownership_probe.write_context(transaction_id,version_id,token,kind,operation) VALUES(txid_current(),v,t,'route','INSERT');
  INSERT INTO public.gtfs_route_service_levels(workspace_id,feed_version_id,route_id,service_day,trips_per_day,derivation_method)
  SELECT workspace_id,v,'unexpected','monday',1,'scheduled' FROM public.gtfs_feed_versions WHERE id=v;
  DELETE FROM ownership_probe.write_context WHERE version_id=v;
  PERFORM ownership_probe.complete_probe(v,t,command,archive,manifest,metadata);
  RAISE EXCEPTION 'Mismatched stored rows accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN
  IF SQLERRM<>'Completion stored counts differ' THEN RAISE; END IF;
 END;
 SET LOCAL ROLE service_role;
 receipt:=ownership_probe.complete_probe(v,t,command,archive,manifest,metadata);
 IF receipt->>'status' IS DISTINCT FROM 'ready' OR receipt->>'routeRows' IS DISTINCT FROM '1' OR receipt->>'stopRows' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'Completion receipt incorrect'; END IF;
 IF ownership_probe.complete_probe(v,t,command,archive,manifest,metadata) IS DISTINCT FROM receipt THEN RAISE EXCEPTION 'Terminal completion replay differs'; END IF;
 BEGIN
  PERFORM ownership_probe.complete_probe(v,t,command,archive,manifest,jsonb_set(metadata,'{trip_count}','2'));
  RAISE EXCEPTION 'Changed completion replay accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN
  IF SQLERRM<>'Completion payload changed' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM ownership_probe.complete_probe(v,t,gen_random_uuid(),archive,manifest,metadata);
  RAISE EXCEPTION 'Ready version completed again';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 SET LOCAL ROLE authenticated;
 BEGIN
  PERFORM ownership_probe.complete_probe(v,t,command,archive,manifest,metadata);
  RAISE EXCEPTION 'Authenticated completion accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 SET LOCAL ROLE anon;
 BEGIN
  PERFORM ownership_probe.complete_probe(v,t,command,archive,manifest,metadata);
  RAISE EXCEPTION 'Anonymous completion accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RESET ROLE;
 IF (SELECT status FROM public.gtfs_feed_versions WHERE id=v) IS DISTINCT FROM 'ready' OR
    (SELECT is_current FROM public.gtfs_feed_versions WHERE id=v) IS DISTINCT FROM false OR
    EXISTS(SELECT 1 FROM public.gtfs_feeds WHERE current_version_id=v) OR
    (SELECT count(*) FROM ownership_probe.completion_receipt)<>1 OR
    EXISTS(SELECT 1 FROM ownership_probe.completion_context) THEN RAISE EXCEPTION 'Completion state or adoption incorrect'; END IF;
END $proof$;
