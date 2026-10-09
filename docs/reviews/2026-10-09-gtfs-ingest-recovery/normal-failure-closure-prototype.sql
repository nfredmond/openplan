-- Prototype only. Apply inside a rollback transaction in the owned proof DB.
-- Not a production migration or a resumable worker implementation.
ALTER TABLE public.gtfs_feed_versions ADD COLUMN ingest_closed_at timestamptz;
CREATE FUNCTION public.guard_gtfs_closed_version() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF OLD.ingest_closed_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
  RAISE EXCEPTION 'GTFS ingest is closed; start a new version' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER gtfs_closed_version_guard BEFORE UPDATE ON public.gtfs_feed_versions
FOR EACH ROW EXECUTE FUNCTION public.guard_gtfs_closed_version();
CREATE FUNCTION public.guard_gtfs_closed_derived() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE closed_at timestamptz;
BEGIN
 SELECT ingest_closed_at INTO closed_at FROM public.gtfs_feed_versions WHERE id=NEW.feed_version_id FOR UPDATE;
 IF closed_at IS NOT NULL THEN
  RAISE EXCEPTION 'GTFS ingest is closed; derived writes are refused' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER gtfs_route_closed_guard BEFORE INSERT OR UPDATE ON public.gtfs_route_service_levels
FOR EACH ROW EXECUTE FUNCTION public.guard_gtfs_closed_derived();
CREATE TRIGGER gtfs_stop_closed_guard BEFORE INSERT OR UPDATE ON public.gtfs_stop_service_levels
FOR EACH ROW EXECUTE FUNCTION public.guard_gtfs_closed_derived();
CREATE TRIGGER gtfs_tract_closed_guard BEFORE INSERT OR UPDATE ON public.gtfs_tract_service
FOR EACH ROW EXECUTE FUNCTION public.guard_gtfs_closed_derived();
CREATE FUNCTION public.close_failed_gtfs_version(p_version_id uuid,p_code text,p_detail text,p_storage_path text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE v public.gtfs_feed_versions%ROWTYPE; object_path text; changed integer;
BEGIN
 SELECT * INTO v FROM public.gtfs_feed_versions WHERE id=p_version_id FOR UPDATE;
 IF NOT FOUND OR p_code IS NULL OR p_detail IS NULL OR v.status NOT IN ('pending','fetching','parsing')
 OR v.is_current OR v.ingest_closed_at IS NOT NULL OR v.ingest_abandoned_at IS NOT NULL THEN
  RETURN jsonb_build_object('recorded',false,'feedStatusChanged',false);
 END IF;
 PERFORM 1 FROM public.gtfs_feeds WHERE id=v.feed_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.gtfs_feeds WHERE id=v.feed_id AND current_version_id=v.id) THEN
  RETURN jsonb_build_object('recorded',false,'feedStatusChanged',false);
 END IF;
 -- An object whose row update was refused can still be cleaned up, but only
 -- at this version's deterministic private key. Never accept another scope.
 IF p_storage_path IS NOT NULL AND p_storage_path IS DISTINCT FROM
  v.workspace_id::text||'/'||v.feed_id::text||'/'||v.id::text||'.zip' THEN
  RAISE EXCEPTION 'GTFS cleanup object does not belong to this version' USING ERRCODE='22023';
 END IF;
 IF v.storage_path IS NOT NULL AND p_storage_path IS NOT NULL AND v.storage_path<>p_storage_path THEN
  RAISE EXCEPTION 'GTFS cleanup object conflicts with recorded custody' USING ERRCODE='22023';
 END IF;
 object_path:=coalesce(v.storage_path,p_storage_path);
 IF object_path IS NOT NULL THEN
  INSERT INTO public.gtfs_ingest_storage_cleanup(version_id,storage_path) VALUES(v.id,object_path);
 END IF;
 DELETE FROM public.gtfs_route_service_levels WHERE feed_version_id=v.id;
 DELETE FROM public.gtfs_stop_service_levels WHERE feed_version_id=v.id;
 DELETE FROM public.gtfs_tract_service WHERE feed_version_id=v.id;
 UPDATE public.gtfs_feed_versions SET status='failed',failure_code=p_code,failure_detail=p_detail,
  route_service_level_rows=0,stop_service_level_rows=0,tract_service_rows=NULL,tract_service_computed_at=NULL,
  storage_path=object_path,ingest_closed_at=clock_timestamp(),last_checked_at=clock_timestamp() WHERE id=v.id;
 UPDATE public.gtfs_feeds SET status='failed' WHERE id=v.feed_id AND current_version_id IS NULL;
 GET DIAGNOSTICS changed=ROW_COUNT;
 RETURN jsonb_build_object('recorded',true,'feedStatusChanged',changed>0);
END $$;
REVOKE ALL ON FUNCTION public.close_failed_gtfs_version(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.close_failed_gtfs_version(uuid,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.guard_gtfs_closed_version() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guard_gtfs_closed_derived() FROM PUBLIC,anon,authenticated;
