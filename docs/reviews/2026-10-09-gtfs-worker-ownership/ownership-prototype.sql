-- Rollback-only experiment in a unique private schema. Records reference synthetic versions.
CREATE SCHEMA ownership_probe;
REVOKE ALL ON SCHEMA ownership_probe FROM PUBLIC;
SET LOCAL search_path TO ownership_probe, public;
-- No production migration, transport, role policy or actual ingest writer is added.
CREATE TABLE gtfs_execution_probe (
 version_id uuid PRIMARY KEY REFERENCES public.gtfs_feed_versions(id),
 attempt integer NOT NULL DEFAULT 0,
 token uuid,
 lease_until timestamptz
);
CREATE TABLE gtfs_claim_probe (
 token uuid PRIMARY KEY,
 version_id uuid NOT NULL REFERENCES public.gtfs_feed_versions(id),
 attempt integer NOT NULL,
 claimed_at timestamptz NOT NULL,
 initial_lease_until timestamptz NOT NULL,
 UNIQUE(version_id,attempt)
);
CREATE TABLE gtfs_write_probe (
 version_id uuid NOT NULL,
 token uuid NOT NULL,
 value text NOT NULL
);
CREATE FUNCTION ownership_probe.claim_gtfs_probe(p_version uuid,p_token uuid,p_seconds integer DEFAULT 120)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v public.gtfs_feed_versions%ROWTYPE; j gtfs_execution_probe%ROWTYPE; saved gtfs_claim_probe%ROWTYPE; at_time timestamptz;
BEGIN
 IF p_version IS NULL OR p_token IS NULL OR p_seconds IS NULL OR p_seconds<=0 THEN RAISE EXCEPTION 'claim identity and lease required'; END IF;
 SELECT * INTO v FROM public.gtfs_feed_versions WHERE id=p_version FOR UPDATE;
 SELECT * INTO j FROM gtfs_execution_probe WHERE version_id=p_version FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO saved FROM gtfs_claim_probe WHERE token=p_token;
 IF FOUND THEN
  IF saved.version_id<>p_version THEN RAISE EXCEPTION 'claim token already belongs to another version'; END IF;
  RETURN jsonb_build_object('claim',to_jsonb(saved),'active',
   j.token=p_token AND j.lease_until>clock_timestamp()
   AND v.status IN ('pending','fetching','parsing') AND v.ingest_closed_at IS NULL AND v.ingest_abandoned_at IS NULL);
 END IF;
 IF v.status NOT IN ('pending','fetching','parsing') OR v.ingest_closed_at IS NOT NULL OR v.ingest_abandoned_at IS NOT NULL
 OR j.lease_until>clock_timestamp() THEN RETURN NULL; END IF;
 at_time:=clock_timestamp();
 INSERT INTO gtfs_claim_probe(token,version_id,attempt,claimed_at,initial_lease_until)
 VALUES(p_token,p_version,j.attempt+1,at_time,at_time+make_interval(secs=>p_seconds)) RETURNING * INTO saved;
 UPDATE gtfs_execution_probe SET attempt=saved.attempt,token=p_token,lease_until=saved.initial_lease_until WHERE version_id=p_version;
 RETURN jsonb_build_object('claim',to_jsonb(saved),'active',true);
END $$;
CREATE FUNCTION ownership_probe.own_gtfs_probe(p_version uuid,p_token uuid) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v public.gtfs_feed_versions%ROWTYPE; j gtfs_execution_probe%ROWTYPE;
BEGIN
 SELECT * INTO v FROM public.gtfs_feed_versions WHERE id=p_version FOR UPDATE;
 SELECT * INTO j FROM gtfs_execution_probe WHERE version_id=p_version FOR UPDATE;
 RETURN FOUND AND p_token IS NOT NULL AND j.token=p_token AND j.lease_until>clock_timestamp()
  AND v.status IN ('pending','fetching','parsing') AND v.ingest_closed_at IS NULL AND v.ingest_abandoned_at IS NULL;
END $$;
CREATE FUNCTION ownership_probe.renew_gtfs_probe(p_version uuid,p_token uuid,p_seconds integer DEFAULT 120)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
 IF p_seconds IS NULL OR p_seconds<=0 THEN RAISE EXCEPTION 'lease duration required'; END IF;
 IF ownership_probe.own_gtfs_probe(p_version,p_token) IS NOT TRUE THEN RETURN false; END IF;
 UPDATE gtfs_execution_probe SET lease_until=clock_timestamp()+make_interval(secs=>p_seconds) WHERE version_id=p_version;
 RETURN true;
END $$;
CREATE FUNCTION ownership_probe.write_gtfs_probe(p_version uuid,p_token uuid,p_value text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF ownership_probe.own_gtfs_probe(p_version,p_token) IS NOT TRUE THEN RAISE EXCEPTION 'GTFS attempt no longer owns work' USING ERRCODE='55000'; END IF;
 INSERT INTO gtfs_write_probe(version_id,token,value) VALUES(p_version,p_token,p_value);
END $$;
