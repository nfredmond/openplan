-- Rollback-only boundaries. A future adoption command must authorize pointer changes.
CREATE FUNCTION ownership_probe.guard_feed_pointer_probe() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ownership_probe,public,pg_temp AS $$
DECLARE old_pointer uuid; new_pointer uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN old_pointer:=OLD.current_version_id; END IF;
 IF TG_OP<>'DELETE' THEN new_pointer:=NEW.current_version_id; END IF;
 IF old_pointer IS DISTINCT FROM new_pointer AND EXISTS(
  SELECT 1 FROM ownership_probe.gtfs_execution_probe WHERE version_id IN (old_pointer,new_pointer)
 ) THEN RAISE EXCEPTION 'Managed feed pointer requires adoption command' USING ERRCODE='55000'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION ownership_probe.guard_feed_pointer_probe() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ownership_probe_feed BEFORE INSERT OR UPDATE OR DELETE ON public.gtfs_feeds
 FOR EACH ROW EXECUTE FUNCTION ownership_probe.guard_feed_pointer_probe();
-- Row triggers do not cover TRUNCATE. Runtime API roles need row commands only.
REVOKE TRUNCATE ON public.gtfs_feeds,public.gtfs_feed_versions,
 public.gtfs_route_service_levels,public.gtfs_stop_service_levels,public.gtfs_tract_service
 FROM PUBLIC,anon,authenticated,service_role;
