-- Rollback-only: install alongside the ownership and batch prototypes.
CREATE TABLE ownership_probe.write_context (
 transaction_id bigint NOT NULL,
 version_id uuid NOT NULL,
 token uuid NOT NULL,
 kind text NOT NULL,
 PRIMARY KEY(transaction_id,version_id,kind)
);
ALTER TABLE ownership_probe.write_context ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ownership_probe.write_context FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION ownership_probe.guard_derived_probe() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, ownership_probe, public, pg_temp AS $$
DECLARE old_version uuid; new_version uuid; managed boolean; expected_kind text;
BEGIN
 IF TG_OP<>'INSERT' THEN old_version:=OLD.feed_version_id; END IF;
 IF TG_OP<>'DELETE' THEN new_version:=NEW.feed_version_id; END IF;
 PERFORM id FROM public.gtfs_feed_versions WHERE id IN (old_version,new_version) ORDER BY id FOR UPDATE;
 SELECT EXISTS(SELECT 1 FROM ownership_probe.gtfs_execution_probe WHERE version_id IN (old_version,new_version)) INTO managed;
 IF managed THEN
  expected_kind:=CASE TG_TABLE_NAME WHEN 'gtfs_route_service_levels' THEN 'route' WHEN 'gtfs_stop_service_levels' THEN 'stop' ELSE NULL END;
  IF TG_OP<>'INSERT' OR expected_kind IS NULL OR NOT EXISTS(
   SELECT 1 FROM ownership_probe.write_context c
   JOIN ownership_probe.gtfs_execution_probe j ON j.version_id=c.version_id AND j.token=c.token
   WHERE c.transaction_id=txid_current() AND c.version_id=new_version AND c.kind=expected_kind
    AND j.lease_until>clock_timestamp()
  ) THEN RAISE EXCEPTION 'Managed derived rows require owned batch command' USING ERRCODE='55000'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION ownership_probe.guard_derived_probe() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ownership_probe_route BEFORE INSERT OR UPDATE OR DELETE ON public.gtfs_route_service_levels
 FOR EACH ROW EXECUTE FUNCTION ownership_probe.guard_derived_probe();
CREATE TRIGGER ownership_probe_stop BEFORE INSERT OR UPDATE OR DELETE ON public.gtfs_stop_service_levels
 FOR EACH ROW EXECUTE FUNCTION ownership_probe.guard_derived_probe();

-- No lifecycle command exists yet. Block all enrolled version updates/deletes,
-- including legacy cleanup, until a scoped lifecycle command is implemented.
CREATE FUNCTION ownership_probe.guard_version_probe() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, ownership_probe, public, pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM ownership_probe.gtfs_execution_probe WHERE version_id=OLD.id) THEN
  RAISE EXCEPTION 'Managed version requires lifecycle command' USING ERRCODE='55000';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION ownership_probe.guard_version_probe() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ownership_probe_version BEFORE UPDATE OR DELETE ON public.gtfs_feed_versions
 FOR EACH ROW EXECUTE FUNCTION ownership_probe.guard_version_probe();
