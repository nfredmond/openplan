ALTER TABLE ownership_probe.gtfs_execution_probe ADD COLUMN prepared_token uuid;
CREATE TABLE ownership_probe.prepare_receipt (
 token uuid PRIMARY KEY,
 version_id uuid NOT NULL,
 response jsonb NOT NULL
);
ALTER TABLE ownership_probe.prepare_receipt ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ownership_probe.prepare_receipt FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION ownership_probe.prepare_probe(p_version uuid,p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ownership_probe,public,pg_temp AS $$
DECLARE saved ownership_probe.prepare_receipt%ROWTYPE; routes integer; stops integer; tracts integer; result jsonb;
BEGIN
 IF ownership_probe.own_gtfs_probe(p_version,p_token) IS NOT TRUE THEN
  RAISE EXCEPTION 'GTFS attempt no longer owns preparation' USING ERRCODE='55000';
 END IF;
 SELECT * INTO saved FROM ownership_probe.prepare_receipt WHERE token=p_token;
 IF FOUND THEN
  IF saved.version_id IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'Preparation identity differs'; END IF;
  RETURN saved.response;
 END IF;
 INSERT INTO ownership_probe.write_context(transaction_id,version_id,token,kind,operation)
 VALUES(txid_current(),p_version,p_token,'route','DELETE'),
       (txid_current(),p_version,p_token,'stop','DELETE'),
       (txid_current(),p_version,p_token,'tract','DELETE');
 DELETE FROM public.gtfs_route_service_levels WHERE feed_version_id=p_version;
 GET DIAGNOSTICS routes=ROW_COUNT;
 DELETE FROM public.gtfs_stop_service_levels WHERE feed_version_id=p_version;
 GET DIAGNOSTICS stops=ROW_COUNT;
 DELETE FROM public.gtfs_tract_service WHERE feed_version_id=p_version;
 GET DIAGNOSTICS tracts=ROW_COUNT;
 DELETE FROM ownership_probe.write_context WHERE transaction_id=txid_current() AND version_id=p_version;
 UPDATE ownership_probe.gtfs_execution_probe SET prepared_token=p_token WHERE version_id=p_version;
 result:=jsonb_build_object('version',p_version,'token',p_token,'removedRoutes',routes,'removedStops',stops,'removedTracts',tracts);
 INSERT INTO ownership_probe.prepare_receipt VALUES(p_token,p_version,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION ownership_probe.prepare_probe(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION ownership_probe.prepare_probe(uuid,uuid) TO service_role;
