-- Repair W1.2 GTFS child visibility after the initial public-data policy
-- migration. GTFS child rows must inherit gtfs_feeds visibility instead of
-- granting every workspace-scoped feed row to every caller.

DROP POLICY IF EXISTS "public_read_agencies" ON public.agencies;
CREATE POLICY "public_read_agencies" ON public.agencies
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.gtfs_feeds feed
      WHERE feed.id = agencies.feed_id
        AND (
          feed.workspace_id IS NULL
          OR feed.workspace_id IN (
            SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
          )
        )
    )
  );

DROP POLICY IF EXISTS "public_read_routes" ON public.routes;
CREATE POLICY "public_read_routes" ON public.routes
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.gtfs_feeds feed
      WHERE feed.id = routes.feed_id
        AND (
          feed.workspace_id IS NULL
          OR feed.workspace_id IN (
            SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
          )
        )
    )
  );

DROP POLICY IF EXISTS "public_read_stops" ON public.stops;
CREATE POLICY "public_read_stops" ON public.stops
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.gtfs_feeds feed
      WHERE feed.id = stops.feed_id
        AND (
          feed.workspace_id IS NULL
          OR feed.workspace_id IN (
            SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
          )
        )
    )
  );

DROP POLICY IF EXISTS "public_read_trips" ON public.trips;
CREATE POLICY "public_read_trips" ON public.trips
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.gtfs_feeds feed
      WHERE feed.id = trips.feed_id
        AND (
          feed.workspace_id IS NULL
          OR feed.workspace_id IN (
            SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
          )
        )
    )
  );

DROP POLICY IF EXISTS "public_read_stop_times" ON public.stop_times;
CREATE POLICY "public_read_stop_times" ON public.stop_times
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.gtfs_feeds feed
      WHERE feed.id = stop_times.feed_id
        AND (
          feed.workspace_id IS NULL
          OR feed.workspace_id IN (
            SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
          )
        )
    )
  );

DROP POLICY IF EXISTS "public_read_calendar" ON public.calendar;
CREATE POLICY "public_read_calendar" ON public.calendar
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.gtfs_feeds feed
      WHERE feed.id = calendar.feed_id
        AND (
          feed.workspace_id IS NULL
          OR feed.workspace_id IN (
            SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
          )
        )
    )
  );

DROP POLICY IF EXISTS "public_read_calendar_dates" ON public.calendar_dates;
CREATE POLICY "public_read_calendar_dates" ON public.calendar_dates
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.gtfs_feeds feed
      WHERE feed.id = calendar_dates.feed_id
        AND (
          feed.workspace_id IS NULL
          OR feed.workspace_id IN (
            SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
          )
        )
    )
  );

DROP POLICY IF EXISTS "public_read_shapes" ON public.shapes;
CREATE POLICY "public_read_shapes" ON public.shapes
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.gtfs_feeds feed
      WHERE feed.id = shapes.feed_id
        AND (
          feed.workspace_id IS NULL
          OR feed.workspace_id IN (
            SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
          )
        )
    )
  );

COMMENT ON POLICY "public_read_agencies" ON public.agencies IS 'GTFS child rows inherit gtfs_feeds public/workspace visibility. See docs/ops/2026-04-20-security-advisor-backlog.md W1.2.';
COMMENT ON POLICY "public_read_routes" ON public.routes IS 'GTFS child rows inherit gtfs_feeds public/workspace visibility. See docs/ops/2026-04-20-security-advisor-backlog.md W1.2.';
COMMENT ON POLICY "public_read_stops" ON public.stops IS 'GTFS child rows inherit gtfs_feeds public/workspace visibility. See docs/ops/2026-04-20-security-advisor-backlog.md W1.2.';
COMMENT ON POLICY "public_read_trips" ON public.trips IS 'GTFS child rows inherit gtfs_feeds public/workspace visibility. See docs/ops/2026-04-20-security-advisor-backlog.md W1.2.';
COMMENT ON POLICY "public_read_stop_times" ON public.stop_times IS 'GTFS child rows inherit gtfs_feeds public/workspace visibility. See docs/ops/2026-04-20-security-advisor-backlog.md W1.2.';
COMMENT ON POLICY "public_read_calendar" ON public.calendar IS 'GTFS child rows inherit gtfs_feeds public/workspace visibility. See docs/ops/2026-04-20-security-advisor-backlog.md W1.2.';
COMMENT ON POLICY "public_read_calendar_dates" ON public.calendar_dates IS 'GTFS child rows inherit gtfs_feeds public/workspace visibility. See docs/ops/2026-04-20-security-advisor-backlog.md W1.2.';
COMMENT ON POLICY "public_read_shapes" ON public.shapes IS 'GTFS child rows inherit gtfs_feeds public/workspace visibility. See docs/ops/2026-04-20-security-advisor-backlog.md W1.2.';
