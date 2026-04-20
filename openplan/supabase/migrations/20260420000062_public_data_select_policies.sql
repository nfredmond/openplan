-- W1.2 — SELECT policies on public data tables.
--
-- Census ACS + LODES are public-domain and can be read directly. GTFS child
-- rows inherit visibility from gtfs_feeds: public feeds (workspace_id IS NULL)
-- are readable by anyone, while workspace-scoped feeds remain visible only to
-- members of that workspace. RLS has been enabled on each table since Supabase
-- default-on-creation, but no policies existed — so PostgREST blocks all direct
-- reads. The AI query pipeline works today only because execute_safe_query is
-- SECURITY DEFINER and bypasses RLS as table-owner.
--
-- These policies align the DB state with the documented intent ("Public GTFS
-- feeds ... readable by anyone") and unblock direct Supabase JS client access.
-- Reference: docs/ops/2026-04-20-security-advisor-backlog.md W1.2.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='agencies' AND policyname='public_read_agencies') THEN
    CREATE POLICY "public_read_agencies" ON public.agencies FOR SELECT USING (
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
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='routes' AND policyname='public_read_routes') THEN
    CREATE POLICY "public_read_routes" ON public.routes FOR SELECT USING (
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
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='stops' AND policyname='public_read_stops') THEN
    CREATE POLICY "public_read_stops" ON public.stops FOR SELECT USING (
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
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='trips' AND policyname='public_read_trips') THEN
    CREATE POLICY "public_read_trips" ON public.trips FOR SELECT USING (
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
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='stop_times' AND policyname='public_read_stop_times') THEN
    CREATE POLICY "public_read_stop_times" ON public.stop_times FOR SELECT USING (
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
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='calendar' AND policyname='public_read_calendar') THEN
    CREATE POLICY "public_read_calendar" ON public.calendar FOR SELECT USING (
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
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='calendar_dates' AND policyname='public_read_calendar_dates') THEN
    CREATE POLICY "public_read_calendar_dates" ON public.calendar_dates FOR SELECT USING (
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
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='shapes' AND policyname='public_read_shapes') THEN
    CREATE POLICY "public_read_shapes" ON public.shapes FOR SELECT USING (
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
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='census_tracts' AND policyname='public_read_census_tracts') THEN
    CREATE POLICY "public_read_census_tracts" ON public.census_tracts FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='lodes_od' AND policyname='public_read_lodes_od') THEN
    CREATE POLICY "public_read_lodes_od" ON public.lodes_od FOR SELECT USING (true);
  END IF;
END
$$;

COMMENT ON POLICY "public_read_agencies" ON public.agencies IS 'GTFS child rows inherit gtfs_feeds public/workspace visibility. See docs/ops/2026-04-20-security-advisor-backlog.md W1.2.';
COMMENT ON POLICY "public_read_routes" ON public.routes IS 'GTFS child rows inherit gtfs_feeds public/workspace visibility. See docs/ops/2026-04-20-security-advisor-backlog.md W1.2.';
COMMENT ON POLICY "public_read_stops" ON public.stops IS 'GTFS child rows inherit gtfs_feeds public/workspace visibility. See docs/ops/2026-04-20-security-advisor-backlog.md W1.2.';
COMMENT ON POLICY "public_read_trips" ON public.trips IS 'GTFS child rows inherit gtfs_feeds public/workspace visibility. See docs/ops/2026-04-20-security-advisor-backlog.md W1.2.';
COMMENT ON POLICY "public_read_stop_times" ON public.stop_times IS 'GTFS child rows inherit gtfs_feeds public/workspace visibility. See docs/ops/2026-04-20-security-advisor-backlog.md W1.2.';
COMMENT ON POLICY "public_read_calendar" ON public.calendar IS 'GTFS child rows inherit gtfs_feeds public/workspace visibility. See docs/ops/2026-04-20-security-advisor-backlog.md W1.2.';
COMMENT ON POLICY "public_read_calendar_dates" ON public.calendar_dates IS 'GTFS child rows inherit gtfs_feeds public/workspace visibility. See docs/ops/2026-04-20-security-advisor-backlog.md W1.2.';
COMMENT ON POLICY "public_read_shapes" ON public.shapes IS 'GTFS child rows inherit gtfs_feeds public/workspace visibility. See docs/ops/2026-04-20-security-advisor-backlog.md W1.2.';
COMMENT ON POLICY "public_read_census_tracts" ON public.census_tracts IS 'Public-domain Census ACS tract boundaries + attributes. See docs/ops/2026-04-20-security-advisor-backlog.md W1.2.';
COMMENT ON POLICY "public_read_lodes_od" ON public.lodes_od IS 'Public-domain LODES employment OD data. See docs/ops/2026-04-20-security-advisor-backlog.md W1.2.';
