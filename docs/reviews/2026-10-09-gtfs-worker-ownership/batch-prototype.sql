-- Experiment only: combine with ownership-prototype.sql inside a rollback transaction.
CREATE TABLE ownership_probe.batch_receipt (
 command_id uuid PRIMARY KEY,
 version_id uuid NOT NULL,
 token uuid NOT NULL,
 kind text NOT NULL,
 ordinal integer NOT NULL,
 payload_hash text NOT NULL,
 row_count integer NOT NULL,
 UNIQUE(version_id,token,kind,ordinal)
);
ALTER TABLE ownership_probe.batch_receipt ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ownership_probe.batch_receipt FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA ownership_probe TO anon,authenticated,service_role;
-- Schema access permits testing EXECUTE denial separately from name lookup.
REVOKE ALL ON ALL TABLES IN SCHEMA ownership_probe FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ownership_probe FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION ownership_probe.write_batch_probe(
 p_version uuid,p_token uuid,p_command uuid,p_kind text,p_ordinal integer,p_rows jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, ownership_probe, public, extensions, pg_temp AS $$
DECLARE saved ownership_probe.batch_receipt%ROWTYPE; v public.gtfs_feed_versions%ROWTYPE;
 hash text; written integer; allowed text[];
BEGIN
 IF p_command IS NULL OR p_kind IS NULL OR p_kind NOT IN ('route','stop') OR p_ordinal IS NULL OR p_ordinal<0
 OR p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' THEN
  RAISE EXCEPTION 'Invalid batch envelope' USING ERRCODE='22023';
 END IF;
 IF jsonb_array_length(p_rows)<1 OR jsonb_array_length(p_rows)>1000 THEN
  RAISE EXCEPTION 'Batch size outside bounds' USING ERRCODE='22023';
 END IF;
 IF ownership_probe.own_gtfs_probe(p_version,p_token) IS NOT TRUE THEN
  RAISE EXCEPTION 'GTFS attempt no longer owns batch' USING ERRCODE='55000';
 END IF;
 SELECT * INTO v FROM public.gtfs_feed_versions WHERE id=p_version;
 hash:=encode(extensions.digest(jsonb_build_object('version',p_version,'token',p_token,
  'kind',p_kind,'ordinal',p_ordinal,'rows',p_rows)::text,'sha256'),'hex');
 SELECT * INTO saved FROM ownership_probe.batch_receipt WHERE command_id=p_command;
 IF FOUND THEN
  IF saved.payload_hash IS DISTINCT FROM hash THEN
   RAISE EXCEPTION 'Batch command payload changed' USING ERRCODE='22023';
  END IF;
  RETURN jsonb_build_object('command',saved.command_id,'rows',saved.row_count,'hash',saved.payload_hash);
 END IF;
 IF p_kind='route' THEN
  allowed:=ARRAY['workspace_id','feed_version_id','route_id','direction_id','route_short_name','route_long_name','route_type','service_day','representative_date','trips_per_day','first_departure_seconds','last_departure_seconds','peak_headway_seconds','peak_headway_is_lower_bound','peak_window_start_seconds','median_headway_seconds','median_headway_basis','served_hours','span_hours','departures_beyond_bin_range','stops_served','derivation_method','scheduled_trips','frequency_trips'];
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) row
    WHERE jsonb_typeof(row)<>'object') THEN
   RAISE EXCEPTION 'Batch row must be an object' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) row
    CROSS JOIN LATERAL jsonb_object_keys(row) key WHERE NOT key=ANY(allowed)) THEN
   RAISE EXCEPTION 'Unexpected batch field' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) row WHERE
    row->>'feed_version_id' IS DISTINCT FROM p_version::text OR
    row->>'workspace_id' IS DISTINCT FROM v.workspace_id::text) THEN
   RAISE EXCEPTION 'Batch row scope differs' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.gtfs_route_service_levels(workspace_id, feed_version_id, route_id, direction_id, route_short_name, route_long_name, route_type, service_day, representative_date, trips_per_day, first_departure_seconds, last_departure_seconds, peak_headway_seconds, peak_headway_is_lower_bound, peak_window_start_seconds, median_headway_seconds, median_headway_basis, served_hours, span_hours, departures_beyond_bin_range, stops_served, derivation_method, scheduled_trips, frequency_trips)
  SELECT r.workspace_id, r.feed_version_id, r.route_id, r.direction_id, r.route_short_name, r.route_long_name, r.route_type, r.service_day, r.representative_date, r.trips_per_day, r.first_departure_seconds, r.last_departure_seconds, r.peak_headway_seconds, r.peak_headway_is_lower_bound, r.peak_window_start_seconds, r.median_headway_seconds, r.median_headway_basis, r.served_hours, r.span_hours, r.departures_beyond_bin_range, r.stops_served, r.derivation_method, r.scheduled_trips, r.frequency_trips FROM jsonb_populate_recordset(NULL::public.gtfs_route_service_levels,p_rows) r;
 ELSIF p_kind='stop' THEN
  allowed:=ARRAY['workspace_id','feed_version_id','stop_id','stop_name','latitude','longitude','service_day','representative_date','trips_per_day','first_departure_seconds','last_departure_seconds','peak_headway_seconds','peak_headway_is_lower_bound','peak_window_start_seconds','median_headway_seconds','median_headway_basis','served_hours','span_hours','departures_beyond_bin_range','routes_serving','route_ids','derivation_method','scheduled_trips','frequency_trips'];
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) row
    WHERE jsonb_typeof(row)<>'object') THEN
   RAISE EXCEPTION 'Batch row must be an object' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) row
    CROSS JOIN LATERAL jsonb_object_keys(row) key WHERE NOT key=ANY(allowed)) THEN
   RAISE EXCEPTION 'Unexpected batch field' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) row WHERE
    row->>'feed_version_id' IS DISTINCT FROM p_version::text OR
    row->>'workspace_id' IS DISTINCT FROM v.workspace_id::text) THEN
   RAISE EXCEPTION 'Batch row scope differs' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.gtfs_stop_service_levels(workspace_id, feed_version_id, stop_id, stop_name, latitude, longitude, service_day, representative_date, trips_per_day, first_departure_seconds, last_departure_seconds, peak_headway_seconds, peak_headway_is_lower_bound, peak_window_start_seconds, median_headway_seconds, median_headway_basis, served_hours, span_hours, departures_beyond_bin_range, routes_serving, route_ids, derivation_method, scheduled_trips, frequency_trips)
  SELECT r.workspace_id, r.feed_version_id, r.stop_id, r.stop_name, r.latitude, r.longitude, r.service_day, r.representative_date, r.trips_per_day, r.first_departure_seconds, r.last_departure_seconds, r.peak_headway_seconds, r.peak_headway_is_lower_bound, r.peak_window_start_seconds, r.median_headway_seconds, r.median_headway_basis, r.served_hours, r.span_hours, r.departures_beyond_bin_range, r.routes_serving, r.route_ids, r.derivation_method, r.scheduled_trips, r.frequency_trips FROM jsonb_populate_recordset(NULL::public.gtfs_stop_service_levels,p_rows) r;
 END IF;
 GET DIAGNOSTICS written=ROW_COUNT;
 INSERT INTO ownership_probe.batch_receipt VALUES(p_command,p_version,p_token,p_kind,p_ordinal,hash,written);
 RETURN jsonb_build_object('command',p_command,'rows',written,'hash',hash);
END $$;
REVOKE ALL ON FUNCTION ownership_probe.write_batch_probe(uuid,uuid,uuid,text,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION ownership_probe.write_batch_probe(uuid,uuid,uuid,text,integer,jsonb) TO service_role;
