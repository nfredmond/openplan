CREATE TABLE ownership_probe.completion_receipt (
 command_id uuid PRIMARY KEY, version_id uuid NOT NULL UNIQUE, token uuid NOT NULL,
 payload_hash text NOT NULL, response jsonb NOT NULL
);
CREATE TABLE ownership_probe.completion_context (
 transaction_id bigint NOT NULL, version_id uuid NOT NULL, token uuid NOT NULL,
 PRIMARY KEY(transaction_id,version_id)
);
ALTER TABLE ownership_probe.completion_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE ownership_probe.completion_context ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ownership_probe.completion_receipt,ownership_probe.completion_context FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION ownership_probe.guard_version_probe() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ownership_probe,public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM ownership_probe.gtfs_execution_probe WHERE version_id=OLD.id) THEN
  IF TG_OP<>'UPDATE' OR NOT EXISTS(SELECT 1 FROM ownership_probe.completion_context c
    JOIN ownership_probe.gtfs_execution_probe j ON j.version_id=c.version_id AND j.token=c.token
    WHERE c.transaction_id=txid_current() AND c.version_id=OLD.id AND j.lease_until>clock_timestamp()) THEN
   RAISE EXCEPTION 'Managed version requires lifecycle command' USING ERRCODE='55000';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION ownership_probe.complete_probe(p_version uuid,p_token uuid,p_command uuid,p_archive jsonb,p_manifest jsonb,p_metadata jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ownership_probe,public,extensions,pg_temp AS $$
DECLARE v public.gtfs_feed_versions%ROWTYPE; m public.gtfs_feed_versions%ROWTYPE;
 saved ownership_probe.completion_receipt%ROWTYPE; hash text; actual_manifest jsonb;
 routes integer; stops integer; result jsonb; field text;
BEGIN
 IF p_command IS NULL OR p_metadata IS NULL OR jsonb_typeof(p_metadata)<>'object' THEN RAISE EXCEPTION 'Completion arguments missing'; END IF;
 SELECT * INTO v FROM public.gtfs_feed_versions WHERE id=p_version FOR UPDATE;
 hash:=encode(extensions.digest(jsonb_build_object('version',p_version,'token',p_token,'archive',p_archive,
   'manifest',p_manifest,'metadata',p_metadata)::text,'sha256'),'hex');
 SELECT * INTO saved FROM ownership_probe.completion_receipt WHERE command_id=p_command;
 IF FOUND THEN
  IF saved.payload_hash IS DISTINCT FROM hash THEN RAISE EXCEPTION 'Completion payload changed' USING ERRCODE='22023'; END IF;
  RETURN saved.response;
 END IF;
 IF ownership_probe.own_gtfs_probe(p_version,p_token) IS NOT TRUE OR v.status<>'parsing' OR NOT EXISTS(
   SELECT 1 FROM ownership_probe.gtfs_execution_probe WHERE version_id=p_version AND prepared_token=p_token) THEN
  RAISE EXCEPTION 'Completion attempt is not active and prepared' USING ERRCODE='55000';
 END IF;
 IF v.storage_path IS NULL OR v.checksum_sha256 IS NULL OR v.checksum_sha256 !~ '^[0-9a-f]{64}$'
 OR v.byte_size IS NULL OR v.byte_size<=0 OR p_archive IS DISTINCT FROM jsonb_build_object(
   'path',v.storage_path,'sha256',v.checksum_sha256,'bytes',v.byte_size) THEN
  RAISE EXCEPTION 'Completion archive identity differs' USING ERRCODE='22023';
 END IF;
 SELECT jsonb_agg(jsonb_build_object('kind',kind,'ordinal',ordinal,'hash',payload_hash,'rows',row_count)
    ORDER BY kind,ordinal) INTO actual_manifest FROM ownership_probe.batch_receipt WHERE version_id=p_version AND token=p_token;
 IF p_manifest IS DISTINCT FROM actual_manifest OR actual_manifest IS NULL THEN
  RAISE EXCEPTION 'Completion batch manifest differs' USING ERRCODE='22023';
 END IF;
 SELECT count(*) INTO routes FROM public.gtfs_route_service_levels WHERE feed_version_id=p_version;
 SELECT count(*) INTO stops FROM public.gtfs_stop_service_levels WHERE feed_version_id=p_version;
 IF routes=0 OR stops=0 OR routes IS DISTINCT FROM (SELECT sum(row_count) FROM ownership_probe.batch_receipt WHERE version_id=p_version AND token=p_token AND kind='route')
 OR stops IS DISTINCT FROM (SELECT sum(row_count) FROM ownership_probe.batch_receipt WHERE version_id=p_version AND token=p_token AND kind='stop') THEN
  RAISE EXCEPTION 'Completion stored counts differ' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_metadata) key WHERE NOT key=ANY(ARRAY['agency_count','route_count','stop_count','trip_count','stop_time_row_count','calendar_service_count','frequency_trip_count','scheduled_trip_count','service_start_date','service_end_date','feed_info_version','feed_info_publisher_name','feed_info_start_date','feed_info_end_date','parse_warnings'])) THEN RAISE EXCEPTION 'Unexpected completion metadata'; END IF;
 FOREACH field IN ARRAY ARRAY['agency_count','route_count','stop_count','trip_count','stop_time_row_count','calendar_service_count','frequency_trip_count','scheduled_trip_count'] LOOP
  IF p_metadata->>field IS NULL OR (p_metadata->>field)::integer<0 THEN RAISE EXCEPTION 'Invalid parser count'; END IF;
 END LOOP;
 IF (p_metadata->>'route_count')::integer=0 OR (p_metadata->>'stop_count')::integer=0
 OR jsonb_typeof(p_metadata->'parse_warnings') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid parser metadata'; END IF;
 SELECT * INTO m FROM jsonb_populate_record(NULL::public.gtfs_feed_versions,p_metadata);
 INSERT INTO ownership_probe.completion_context VALUES(txid_current(),p_version,p_token);
 UPDATE public.gtfs_feed_versions SET status='ready',failure_code=NULL,failure_detail=NULL,
  route_service_level_rows=routes,stop_service_level_rows=stops,
  tract_service_rows=NULL,tract_service_computed_at=NULL,shape_count=0,shapes_status='not_ingested',
  agency_count=m.agency_count,
  route_count=m.route_count,
  stop_count=m.stop_count,
  trip_count=m.trip_count,
  stop_time_row_count=m.stop_time_row_count,
  calendar_service_count=m.calendar_service_count,
  frequency_trip_count=m.frequency_trip_count,
  scheduled_trip_count=m.scheduled_trip_count,
  service_start_date=m.service_start_date,
  service_end_date=m.service_end_date,
  feed_info_version=m.feed_info_version,
  feed_info_publisher_name=m.feed_info_publisher_name,
  feed_info_start_date=m.feed_info_start_date,
  feed_info_end_date=m.feed_info_end_date,
  parse_warnings=m.parse_warnings,
  last_checked_at=clock_timestamp() WHERE id=p_version;
 DELETE FROM ownership_probe.completion_context WHERE transaction_id=txid_current() AND version_id=p_version;
 result:=jsonb_build_object('version',p_version,'status','ready','routeRows',routes,'stopRows',stops);
 INSERT INTO ownership_probe.completion_receipt VALUES(p_command,p_version,p_token,hash,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION ownership_probe.complete_probe(uuid,uuid,uuid,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION ownership_probe.complete_probe(uuid,uuid,uuid,jsonb,jsonb,jsonb) TO service_role;
