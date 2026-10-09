-- Serialize stale cleanup with completion and prevent abandoned attempts resuming.
BEGIN;
ALTER TABLE public.gtfs_feed_versions ADD COLUMN ingest_abandoned_at timestamptz;

CREATE FUNCTION public.guard_gtfs_abandoned_version() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.ingest_abandoned_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'GTFS ingest was abandoned; start a new version' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER gtfs_abandoned_version_guard BEFORE UPDATE ON public.gtfs_feed_versions
FOR EACH ROW EXECUTE FUNCTION public.guard_gtfs_abandoned_version();

CREATE FUNCTION public.guard_gtfs_abandoned_derived_write() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_abandoned timestamptz;
BEGIN
  -- Hold the same version lock as cleanup until this write commits.
  SELECT ingest_abandoned_at INTO v_abandoned FROM public.gtfs_feed_versions
  WHERE id = NEW.feed_version_id FOR UPDATE;
  IF v_abandoned IS NOT NULL THEN
    RAISE EXCEPTION 'GTFS ingest was abandoned; derived writes are closed' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER gtfs_route_abandoned_guard BEFORE INSERT OR UPDATE ON public.gtfs_route_service_levels
FOR EACH ROW EXECUTE FUNCTION public.guard_gtfs_abandoned_derived_write();
CREATE TRIGGER gtfs_stop_abandoned_guard BEFORE INSERT OR UPDATE ON public.gtfs_stop_service_levels
FOR EACH ROW EXECUTE FUNCTION public.guard_gtfs_abandoned_derived_write();
CREATE TRIGGER gtfs_tract_abandoned_guard BEFORE INSERT OR UPDATE ON public.gtfs_tract_service
FOR EACH ROW EXECUTE FUNCTION public.guard_gtfs_abandoned_derived_write();

CREATE FUNCTION public.reap_gtfs_feed_version(p_version_id uuid, p_cutoff timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE v public.gtfs_feed_versions%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.gtfs_feed_versions WHERE id=p_version_id FOR UPDATE;
  IF NOT FOUND OR p_cutoff IS NULL OR v.status NOT IN ('pending','fetching','parsing')
    OR v.updated_at >= p_cutoff OR v.is_current OR v.ingest_abandoned_at IS NOT NULL THEN
    RETURN false;
  END IF;
  -- Feed lock also serializes the status mirror with a different version's promotion.
  PERFORM 1 FROM public.gtfs_feeds WHERE id=v.feed_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.gtfs_feeds WHERE id=v.feed_id AND current_version_id=v.id) THEN
    RETURN false;
  END IF;
  DELETE FROM public.gtfs_route_service_levels WHERE feed_version_id=v.id;
  DELETE FROM public.gtfs_stop_service_levels WHERE feed_version_id=v.id;
  DELETE FROM public.gtfs_tract_service WHERE feed_version_id=v.id;
  UPDATE public.gtfs_feed_versions SET status='failed', failure_code='abandoned',
    failure_detail='This ingest stopped responding and was closed by the scheduled sweep. Start a new version to retry.',
    route_service_level_rows=0, stop_service_level_rows=0, tract_service_rows=NULL,
    tract_service_computed_at=NULL, last_checked_at=clock_timestamp(), ingest_abandoned_at=clock_timestamp()
  WHERE id=v.id;
  UPDATE public.gtfs_feeds SET status='failed' WHERE id=v.feed_id AND current_version_id IS NULL;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.reap_gtfs_feed_version(uuid,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reap_gtfs_feed_version(uuid,timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.guard_gtfs_abandoned_version() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_gtfs_abandoned_derived_write() FROM PUBLIC, anon, authenticated;
COMMIT;
