-- GTFS service levels: the provenance spine for a transit feed, and the two
-- DERIVED tables a planner actually asks questions of.
--
-- WHAT THIS DELIBERATELY DOES NOT STORE. The nine GTFS tables from
-- 20260219000001 (`gtfs_feeds` plus agencies/routes/stops/trips/stop_times/
-- shapes/calendar/calendar_dates) are a raw-timetable shape: `stop_times` holds
-- one row per stop per trip, which is tens of millions of rows for a large
-- agency and which invites a product claim OpenPlan must never make. A planning
-- workbench answers "how often does the bus come here, and for how many hours a
-- day" — a service level. It is not a trip planner and must never appear to
-- answer "what time is the 4:15", because a stale or partially-ingested feed
-- would then be telling a member of the public to stand at a corner at a time
-- no bus is coming. Decided by Nathaniel 2026-08-05: store DERIVED SERVICE
-- LEVELS, never the raw timetable. The raw tables stay where they are; nothing
-- here writes them and nothing here reads them.
--
-- WHY EVERY NEW TABLE CARRIES `workspace_id` DIRECTLY, rather than reaching a
-- workspace transitively through `feed_id` the way the eight existing children
-- do. It is not style. `src/test/rls-isolation.test.ts` carries the repo's
-- strongest live tenant guard, and its probe-coverage half enumerates tables BY
-- THE PRESENCE OF A `workspace_id` COLUMN:
--
--     WHERE c.relkind = 'r' AND EXISTS (SELECT 1 FROM information_schema.columns
--       WHERE table_name = c.relname AND column_name = 'workspace_id')
--
-- A workspace-scoped table WITHOUT that column is neither probed nor excused —
-- it is invisible to the guard, and no failure anywhere says so. The eight
-- transitively-scoped GTFS children are exactly the tables that leaked for four
-- months (see 20260730000010): correct policies, never enforced, and nothing
-- watching. Carrying the column is what puts these three inside the guard.
--
-- The cost of the denormalisation is that `workspace_id` can now DISAGREE with
-- the parent's. That is paid structurally rather than by convention: the parent
-- gains `UNIQUE (id, workspace_id)` and each child carries a composite foreign
-- key on the PAIR, the shape 20260728000002 established for
-- `project_spend_entries`. A row whose workspace_id does not match its parent's
-- is unstorable — no trigger, no application check, nothing to forget.
--
--   THE ONE HOLE, NAMED SO IT IS NOT MISTAKEN FOR COVERAGE: a composite FK is
--   MATCH SIMPLE by default, and MATCH SIMPLE skips the check entirely when ANY
--   referencing column is NULL. `workspace_id IS NULL` means "public preloaded
--   feed", so for public feeds the pair FK enforces nothing and only the plain
--   single-column `feed_id` / `feed_version_id` FK applies. That is acceptable
--   because public feed rows are service-role-authored only (no client role
--   holds INSERT on any of these tables) and because MATCH FULL would forbid the
--   NULL that makes a feed public in the first place.
--
-- WHY `is_current` IS A FLAG ON THE VERSION AND ALSO A POINTER ON THE FEED.
-- Two representations of one fact, which is a real cost. The flag is what a
-- partial unique index can make singular; the pointer is what a `.select()` on
-- `gtfs_feeds` can follow without a second round trip. `gtfs_feeds.status` is a
-- third denormalisation of the same thing — the mirror is what the Data Hub
-- card renders. All three are reconciled by
-- `src/test/gtfs-feed-status-mirrors-its-current-version.test.ts`, which is the
-- price of the mirror paid as a test rather than trusted as a convention.

-- ---------------------------------------------------------------------------
-- 1. gtfs_feeds repairs — the cross-tenant collision, and the source identity
-- ---------------------------------------------------------------------------
--
-- `UNIQUE (city, agency_name)` HAS TO GO, and this is the single most important
-- line in this section. It carries no `workspace_id`, so it is GLOBAL across
-- every tenant in a deployment. The first workspace to ingest
-- ('Sacramento', 'Sacramento Regional Transit District') would permanently
-- prevent every OTHER workspace in the same database from ingesting the same
-- agency — a cross-tenant denial of service, in a product whose whole posture is
-- that any agency can sign up and use it unaided. It has never fired only
-- because nothing in `src/` reads or writes `gtfs_feeds` yet; it fires on the
-- first day two workspaces ingest the same regional feed, which is the NORMAL
-- case for an MPO and its member cities.
--
-- What replaces it is workspace-scoped and keyed on SOURCE IDENTITY rather than
-- on a display name. Two feeds are the same feed when they came from the same
-- catalog entry or the same URL — not when a planner typed the same city.
-- (city, agency_name) is human-entered text and should never have been a key.

ALTER TABLE public.gtfs_feeds
  DROP CONSTRAINT IF EXISTS gtfs_feeds_city_agency_name_key;

ALTER TABLE public.gtfs_feeds
  ADD COLUMN IF NOT EXISTS source_kind TEXT,
  ADD COLUMN IF NOT EXISTS catalog_provider TEXT,
  ADD COLUMN IF NOT EXISTS catalog_source_id TEXT,
  ADD COLUMN IF NOT EXISTS normalized_source_url TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Nullable, because every row that exists today predates the column and no
-- honest value can be invented for it. The vocabulary matches
-- gtfs_feed_versions.source_kind so a feed and its versions cannot disagree
-- about what kind of thing they are.
ALTER TABLE public.gtfs_feeds
  ADD CONSTRAINT gtfs_feeds_source_kind_vocabulary
  CHECK (source_kind IS NULL OR source_kind IN ('catalog', 'url', 'upload'));

-- The target of every child's composite foreign key. `id` alone is already the
-- primary key, so this adds no new uniqueness — it exists purely so that
-- (feed_id, workspace_id) can be referenced as a pair.
ALTER TABLE public.gtfs_feeds
  ADD CONSTRAINT gtfs_feeds_id_workspace_key UNIQUE (id, workspace_id);

-- Source identity, scoped. Four partial indexes rather than two, because
-- `workspace_id IS NULL` (a public preloaded feed) is a genuinely separate
-- namespace: the public mirror of a catalog entry and one workspace's private
-- copy of the same feed must be able to coexist, and NULL does not participate
-- in a multi-column unique index the way a real tenant id does.
CREATE UNIQUE INDEX IF NOT EXISTS gtfs_feeds_workspace_catalog_source_key
  ON public.gtfs_feeds (workspace_id, catalog_source_id)
  WHERE workspace_id IS NOT NULL AND catalog_source_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gtfs_feeds_public_catalog_source_key
  ON public.gtfs_feeds (catalog_source_id)
  WHERE workspace_id IS NULL AND catalog_source_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gtfs_feeds_workspace_source_url_key
  ON public.gtfs_feeds (workspace_id, normalized_source_url)
  WHERE workspace_id IS NOT NULL AND normalized_source_url IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gtfs_feeds_public_source_url_key
  ON public.gtfs_feeds (normalized_source_url)
  WHERE workspace_id IS NULL AND normalized_source_url IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. gtfs_feed_versions — the provenance spine AND the job row
-- ---------------------------------------------------------------------------
--
-- ONE TABLE, TWO JOBS, DELIBERATELY. The obvious design is `gtfs_ingest_jobs`
-- (status, failure, timings) plus `gtfs_feed_versions` (checksum, counts,
-- validity window). They would be one-to-one for the entire life of the
-- product, share a primary key, and every read would join them. Worse, the
-- split invites the exact dishonesty this module is built to prevent: a job row
-- that says `ready` while no version row exists is an ingest that reports
-- success and produced nothing. Keeping them one row makes that state
-- unrepresentable, and lets the `ready`-is-not-empty CHECK below be a database
-- constraint rather than an application invariant.

CREATE TABLE IF NOT EXISTS public.gtfs_feed_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Nullable for the same reason gtfs_feeds.workspace_id is: NULL = a version
  -- of a public preloaded feed. See the MATCH SIMPLE note in the header.
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,

  feed_id UUID NOT NULL REFERENCES public.gtfs_feeds(id) ON DELETE CASCADE,

  -- Where this version came from. 'catalog' = a registry entry (Mobility
  -- Database and the like), 'url' = an operator-supplied direct link,
  -- 'upload' = a zip a planner put in the gtfs-uploads bucket.
  source_kind TEXT NOT NULL CHECK (source_kind IN ('catalog', 'url', 'upload')),
  source_url TEXT,

  -- Catalog provenance, kept as free text and NOT as an enum. Which catalogs
  -- exist is jurisdiction- and era-specific (the Transitland/TransitFeeds/
  -- Mobility Database lineage has already changed hands twice), and freezing a
  -- provider list into a CHECK would put a schema migration between this
  -- product and any national feed registry outside the US.
  catalog_provider TEXT,
  catalog_source_id TEXT,
  -- What the catalog said about this entry when it was fetched — 'active',
  -- 'deprecated', whatever that provider's vocabulary is. Recorded verbatim so
  -- a surface can disclose "this feed is marked deprecated upstream" instead of
  -- silently serving it.
  catalog_row_status TEXT,

  -- The zip in the private gtfs-uploads bucket, when there is one.
  storage_path TEXT,
  checksum_sha256 TEXT,
  byte_size BIGINT,

  requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  fetched_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,

  -- feed_info.txt as the AGENCY published it. Kept distinct from the
  -- service_* window below, which is derived from calendar.txt /
  -- calendar_dates.txt. They disagree in real feeds more often than not, and
  -- collapsing them would destroy the evidence that they did.
  feed_info_version TEXT,
  feed_info_publisher_name TEXT,
  feed_info_start_date DATE,
  feed_info_end_date DATE,

  -- The window the SERVICE data actually covers. This is what a staleness
  -- warning must be computed from.
  service_start_date DATE,
  service_end_date DATE,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'fetching', 'parsing', 'ready', 'failed', 'refused')),
  -- 'refused' is not 'failed'. A feed OpenPlan declines to ingest — too large,
  -- a licence that forbids redistribution, a source outside a deployment's
  -- policy — is a decision, not a breakage, and a surface must be able to say
  -- which one happened.
  failure_code TEXT,
  failure_detail TEXT,
  parse_warnings JSONB NOT NULL DEFAULT '[]'::jsonb,

  agency_count INTEGER NOT NULL DEFAULT 0,
  route_count INTEGER NOT NULL DEFAULT 0,
  stop_count INTEGER NOT NULL DEFAULT 0,
  trip_count INTEGER NOT NULL DEFAULT 0,
  shape_count INTEGER NOT NULL DEFAULT 0,
  calendar_service_count INTEGER NOT NULL DEFAULT 0,
  stop_time_row_count INTEGER NOT NULL DEFAULT 0,
  route_service_level_rows INTEGER NOT NULL DEFAULT 0,
  stop_service_level_rows INTEGER NOT NULL DEFAULT 0,
  -- How the trips were expressed in the source. A feed that is entirely
  -- frequencies.txt has no per-trip departure times at all, so a headway
  -- derived from it is a published BAND rather than a measured gap; a surface
  -- that cannot tell the difference will present them identically.
  frequency_trip_count INTEGER NOT NULL DEFAULT 0,
  scheduled_trip_count INTEGER NOT NULL DEFAULT 0,

  -- shapes.txt is the single largest file in most feeds and the only one whose
  -- absence is purely cosmetic. Recording WHY it is missing keeps "this agency
  -- publishes no shapes" distinguishable from "we declined to store 400 MB of
  -- them", which are different answers to a planner asking why the map has no
  -- route lines.
  shapes_status TEXT NOT NULL DEFAULT 'absent'
    CHECK (shapes_status IN ('written', 'skipped_too_large', 'absent')),

  is_current BOOLEAN NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- THE TWO CHECKS THAT CARRY THE HONESTY. Everything else in this file is
  -- bookkeeping; these are the product commitment.
  --
  -- An "ingested but empty" feed is UNSTORABLE. A version may only call itself
  -- `ready` if it has routes, stops, and BOTH derived service-level tables
  -- populated. Without this, the failure mode is not an error — it is a feed
  -- that appears in the UI, reports success, and answers every question with
  -- "no service", which is indistinguishable from a real answer and is exactly
  -- what a half-parsed zip produces. A constraint is stronger than any test
  -- here because it binds the service role too, and every write to this table
  -- is service-role.
  CONSTRAINT gtfs_feed_versions_ready_is_not_empty CHECK (
    status <> 'ready'
    OR (
      route_count > 0
      AND stop_count > 0
      AND route_service_level_rows > 0
      AND stop_service_level_rows > 0
    )
  ),

  -- A failure that cannot name itself is a failure nobody can act on, and the
  -- operator-facing surface has nothing to render but "something went wrong".
  CONSTRAINT gtfs_feed_versions_failure_names_itself CHECK (
    status <> 'failed' OR failure_code IS NOT NULL
  ),

  -- The pair FK described in the header: a version's workspace must be its
  -- feed's workspace. MATCH SIMPLE, so not enforced for public feeds.
  CONSTRAINT gtfs_feed_versions_feed_same_workspace
    FOREIGN KEY (feed_id, workspace_id)
    REFERENCES public.gtfs_feeds (id, workspace_id) ON DELETE CASCADE,

  -- The target of the two service-level tables' own composite FK.
  CONSTRAINT gtfs_feed_versions_id_workspace_key UNIQUE (id, workspace_id)
);

-- Two current versions of one feed is not a bug to be detected, it is a state
-- that cannot exist. Every surface reads "the current version" as a singular
-- noun; a partial unique index is what makes that grammar true.
CREATE UNIQUE INDEX IF NOT EXISTS gtfs_feed_versions_one_current_per_feed
  ON public.gtfs_feed_versions (feed_id)
  WHERE is_current;

CREATE INDEX IF NOT EXISTS gtfs_feed_versions_feed_idx
  ON public.gtfs_feed_versions (feed_id, created_at DESC);

CREATE INDEX IF NOT EXISTS gtfs_feed_versions_workspace_idx
  ON public.gtfs_feed_versions (workspace_id, updated_at DESC);

-- The work queue: a version stuck in a non-terminal state is what an operator
-- surface has to be able to find.
CREATE INDEX IF NOT EXISTS gtfs_feed_versions_status_idx
  ON public.gtfs_feed_versions (status, updated_at DESC);

CREATE OR REPLACE FUNCTION public.set_gtfs_feed_versions_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gtfs_feed_versions_updated_at ON public.gtfs_feed_versions;
CREATE TRIGGER trg_gtfs_feed_versions_updated_at
  BEFORE UPDATE ON public.gtfs_feed_versions
  FOR EACH ROW EXECUTE FUNCTION public.set_gtfs_feed_versions_updated_at();

-- Added AFTER gtfs_feed_versions exists, because the reference runs the other
-- way from every other column on this table. ON DELETE SET NULL rather than
-- CASCADE: deleting a version must not delete the feed.
ALTER TABLE public.gtfs_feeds
  ADD COLUMN IF NOT EXISTS current_version_id UUID
    REFERENCES public.gtfs_feed_versions(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 3. gtfs_route_service_levels — how often a route runs, per weekday
-- ---------------------------------------------------------------------------
--
-- WHY THE GRAIN IS GTFS'S OWN PER-WEEKDAY VOCABULARY AND NOT
-- weekday/saturday/sunday. Two reasons, and the second is the one that would
-- have bitten quietly.
--
--   1. NON-NEGOTIABLE #0. A weekday/Saturday/Sunday rollup bakes an
--      Anglo-American week into the schema. The weekend is Friday-Saturday
--      across much of the world and Sunday-only in others; a schema that has
--      already collapsed the seven days cannot be un-collapsed by a later
--      registry entry. `calendar.txt` gives seven boolean columns, so the seven
--      days are what the SOURCE says, and any rollup is an interpretation.
--
--   2. It would average away Friday night. Friday evening service is
--      materially different from Tuesday evening service on most systems, and
--      "average weekday headway" hides exactly that. A planner asking whether
--      an evening-shift worker can get home is asking a per-day question.
--
-- The rollup happens in TypeScript, where a jurisdiction's own week can be a
-- parameter. The database keeps the seven days.

CREATE TABLE IF NOT EXISTS public.gtfs_route_service_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  feed_version_id UUID NOT NULL REFERENCES public.gtfs_feed_versions(id) ON DELETE CASCADE,

  route_id TEXT NOT NULL,
  -- Nullable because GTFS makes direction_id optional and a feed that omits it
  -- must not be given a fabricated 0. See the NULLS NOT DISTINCT note on the
  -- grain constraint below.
  direction_id INTEGER,
  route_short_name TEXT,
  route_long_name TEXT,
  route_type INTEGER NOT NULL,

  service_day TEXT NOT NULL CHECK (
    service_day IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')
  ),

  trips_per_day INTEGER NOT NULL,
  first_departure_seconds INTEGER,
  last_departure_seconds INTEGER,
  -- Seconds after midnight, so a 25:10:00 departure (GTFS's way of saying
  -- "after midnight, still the previous service day") stays on the day it
  -- belongs to and the span stays positive.
  span_seconds INTEGER GENERATED ALWAYS AS (last_departure_seconds - first_departure_seconds) STORED,

  peak_headway_seconds INTEGER,
  -- THE PEAK WINDOW IS DERIVED FROM THE DATA — the busiest clock hour actually
  -- observed in this route's departures on this day — and is NEVER an assumed
  -- 6-9 AM. Storing it is what makes the peak headway auditable: a planner can
  -- see that a route's "peak" is 14:00 because it is a school tripper, which an
  -- assumed morning window would have silently mis-measured. A hardcoded peak
  -- window would also be a jurisdiction assumption (non-negotiable #0) in a
  -- product that intends to work outside US commute patterns.
  peak_window_start_seconds INTEGER,
  median_headway_seconds INTEGER,

  stops_served INTEGER NOT NULL DEFAULT 0,

  -- Provenance of the numbers above. 'scheduled' = counted from stop_times,
  -- 'frequencies' = read off frequencies.txt headway bands, 'mixed' = both.
  -- A frequencies-derived headway is what the agency PUBLISHES as its headway;
  -- a scheduled one is what the timetable actually shows. Presenting them
  -- identically would be the same class of error as presenting a machine
  -- translation as an agency's own words.
  derivation_method TEXT NOT NULL CHECK (derivation_method IN ('scheduled', 'frequencies', 'mixed')),
  scheduled_trips INTEGER NOT NULL DEFAULT 0,
  frequency_trips INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- NULLS NOT DISTINCT is load-bearing, not decoration. `direction_id` is
  -- nullable, and under the default NULLS DISTINCT two rows for the same route
  -- and day with no direction would BOTH be accepted — so a re-ingest would
  -- double the trip counts of every feed that omits direction_id, silently, and
  -- the grain this table's whole meaning rests on would not exist for exactly
  -- the feeds least able to spare it.
  CONSTRAINT gtfs_route_service_levels_grain
    UNIQUE NULLS NOT DISTINCT (feed_version_id, route_id, direction_id, service_day),

  CONSTRAINT gtfs_route_service_levels_version_same_workspace
    FOREIGN KEY (feed_version_id, workspace_id)
    REFERENCES public.gtfs_feed_versions (id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS gtfs_route_service_levels_version_idx
  ON public.gtfs_route_service_levels (feed_version_id, service_day);

CREATE INDEX IF NOT EXISTS gtfs_route_service_levels_workspace_idx
  ON public.gtfs_route_service_levels (workspace_id);

-- ---------------------------------------------------------------------------
-- 4. gtfs_stop_service_levels — how often anything stops HERE, per weekday
-- ---------------------------------------------------------------------------
--
-- This is the table the map reads and the one an accessibility or equity
-- question is actually asked of: not "how often does route 5 run" but "how
-- often does anything come to this corner". It carries its own point geometry
-- for the same reason `safety_crashes` does — a generated column from the
-- latitude/longitude the parser wrote, so the geometry cannot drift from the
-- coordinates and neither can be edited independently of the other.

CREATE TABLE IF NOT EXISTS public.gtfs_stop_service_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  feed_version_id UUID NOT NULL REFERENCES public.gtfs_feed_versions(id) ON DELETE CASCADE,

  stop_id TEXT NOT NULL,
  stop_name TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  geom GEOMETRY(Point, 4326) GENERATED ALWAYS AS
    (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)) STORED,

  service_day TEXT NOT NULL CHECK (
    service_day IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')
  ),

  trips_per_day INTEGER NOT NULL,
  first_departure_seconds INTEGER,
  last_departure_seconds INTEGER,
  span_seconds INTEGER GENERATED ALWAYS AS (last_departure_seconds - first_departure_seconds) STORED,

  peak_headway_seconds INTEGER,
  -- Derived from the data, exactly as on the route table. See that comment.
  peak_window_start_seconds INTEGER,
  median_headway_seconds INTEGER,

  routes_serving INTEGER NOT NULL DEFAULT 0,
  -- The routes themselves, not just how many. A stop served by four routes at
  -- 30-minute headways is a different place from one served by one route at
  -- 7-minute headways, and a count alone cannot tell them apart. An array
  -- rather than a join table because it is read as a whole, never queried
  -- across, and never written independently of the row it belongs to.
  route_ids TEXT[] NOT NULL DEFAULT '{}',

  derivation_method TEXT NOT NULL CHECK (derivation_method IN ('scheduled', 'frequencies', 'mixed')),
  scheduled_trips INTEGER NOT NULL DEFAULT 0,
  frequency_trips INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT gtfs_stop_service_levels_grain
    UNIQUE (feed_version_id, stop_id, service_day),

  CONSTRAINT gtfs_stop_service_levels_version_same_workspace
    FOREIGN KEY (feed_version_id, workspace_id)
    REFERENCES public.gtfs_feed_versions (id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS gtfs_stop_service_levels_version_idx
  ON public.gtfs_stop_service_levels (feed_version_id, service_day);

CREATE INDEX IF NOT EXISTS gtfs_stop_service_levels_workspace_idx
  ON public.gtfs_stop_service_levels (workspace_id);

-- The spatial index the generated column exists for: bbox queries over a
-- region's stops, which is every map read.
CREATE INDEX IF NOT EXISTS gtfs_stop_service_levels_geom_idx
  ON public.gtfs_stop_service_levels USING GIST (geom);

-- ---------------------------------------------------------------------------
-- 5. gtfs_stops_map — the only way a browser can read that geometry
-- ---------------------------------------------------------------------------
--
-- THIS IS A HARD REQUIREMENT, NOT A CONVENIENCE. supabase-js CANNOT read a
-- PostGIS geometry: PostgREST serialises `geometry` as hex EWKB
-- ("0101000020E6100000…"), and nothing in this repository parses that. A
-- feature that selects `geom` directly gets a string no map can draw, with no
-- error anywhere — the shipped-invisible defect class in its purest form. The
-- view converts once, in the database, exactly as `census_tracts_map`
-- (20260422000068) does for tracts.
--
-- `security_invoker = true` because a view without it executes as its OWNER and
-- therefore bypasses RLS on the base table — which would make this view a way
-- around the tenant boundary the whole file is built on. Asserted by the
-- "requires every public view to run as its invoker" guard in
-- src/test/migrations/inventory.test.ts, which has zero exceptions on purpose.

CREATE OR REPLACE VIEW public.gtfs_stops_map
WITH (security_invoker = true) AS
SELECT
  s.id,
  s.workspace_id,
  s.feed_version_id,
  s.stop_id,
  s.stop_name,
  s.latitude,
  s.longitude,
  ST_AsGeoJSON(s.geom)::jsonb AS geometry_geojson,
  s.service_day,
  s.trips_per_day,
  s.first_departure_seconds,
  s.last_departure_seconds,
  s.span_seconds,
  s.peak_headway_seconds,
  s.peak_window_start_seconds,
  s.median_headway_seconds,
  s.routes_serving,
  s.route_ids,
  s.derivation_method
FROM public.gtfs_stop_service_levels s;

-- ---------------------------------------------------------------------------
-- 6. RLS, policies and grants
-- ---------------------------------------------------------------------------
--
-- One PERMISSIVE SELECT policy per table and NOTHING ELSE, which is the
-- Knowledge Base posture: every write goes through a service-role API route
-- that has already checked workspace membership itself. A GTFS ingest is a
-- long-running job that writes tens of thousands of derived rows; there is no
-- shape in which a browser session writes these tables, so granting a client
-- role INSERT would buy nothing and would leave one careless `USING (true)`
-- between a tenant and someone else's data.
--
-- The `workspace_id IS NULL` branch is the deliberate public-feed case,
-- inherited from `gtfs_feeds_read` — a preloaded feed is readable by every
-- signed-in user. `anon` is granted nothing at all: an unauthenticated caller
-- has no reason to enumerate a deployment's transit data, and the public
-- surfaces that might one day show it read through the service role.
--
-- Grants must be EXPLICIT since 20260804000001 flipped default privileges to
-- deny for new tables. Forgetting one fails loud (permission denied on first
-- use) rather than silently exposing anything, which is the point of that flip.

ALTER TABLE public.gtfs_feed_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gtfs_route_service_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gtfs_stop_service_levels ENABLE ROW LEVEL SECURITY;

CREATE POLICY gtfs_feed_versions_read ON public.gtfs_feed_versions
  FOR SELECT USING (
    workspace_id IS NULL
    OR workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())
  );

CREATE POLICY gtfs_route_service_levels_read ON public.gtfs_route_service_levels
  FOR SELECT USING (
    workspace_id IS NULL
    OR workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())
  );

CREATE POLICY gtfs_stop_service_levels_read ON public.gtfs_stop_service_levels
  FOR SELECT USING (
    workspace_id IS NULL
    OR workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())
  );

GRANT SELECT ON public.gtfs_feed_versions TO authenticated;
GRANT SELECT ON public.gtfs_route_service_levels TO authenticated;
GRANT SELECT ON public.gtfs_stop_service_levels TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gtfs_feed_versions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gtfs_route_service_levels TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gtfs_stop_service_levels TO service_role;

-- The view is default-deny too: ALTER DEFAULT PRIVILEGES … ON TABLES covers
-- views. It reads as the invoker, so its grant is exactly its base table's.
GRANT SELECT ON public.gtfs_stops_map TO authenticated;
GRANT SELECT ON public.gtfs_stops_map TO service_role;

-- ---------------------------------------------------------------------------
-- 7. gtfs_feeds — the missing permissive UPDATE and DELETE policies
-- ---------------------------------------------------------------------------
--
-- `gtfs_feeds` carries RESTRICTIVE `gtfs_feeds_writer_only_update` and
-- `_writer_only_delete` from 20260728000006 with NO PERMISSIVE PARTNER. That is
-- the `runs` defect verbatim (fixed for two tables in 20260728000010, and this
-- is a third instance of the same class): Postgres composes RLS as "at least
-- one PERMISSIVE policy must pass, then every RESTRICTIVE one must also pass",
-- so a restrictive-only table filters to zero rows before the gate is even
-- consulted. The table-level GRANT is present, so this is not a permission
-- error — it is an UPDATE matching zero rows, which Postgres reports as
-- SUCCESS, PostgREST returns as 204, and supabase-js hands back as
-- `error: null`. Every client edit to a feed would have been silently discarded
-- the day the ingest UI shipped.
--
-- MEMBERSHIP ONLY, deliberately, matching 20260728000010's reasoning exactly:
-- the RESTRICTIVE gate already supplies the writer-role check via
-- workspace_member_can_write, and duplicating it here would create a second
-- place for the writer rule to drift from the one `viewer-write-denial-guard`
-- reasons about.
--
-- AND THE `workspace_id IS NULL` BRANCH IS ABSENT FROM BOTH ON PURPOSE — this
-- asymmetry with `gtfs_feeds_read` is the thing someone will later "fix", so it
-- is written down here. A public preloaded feed is READABLE BY EVERYONE and
-- EDITABLE BY NOBODY through a client. Adding the NULL branch to UPDATE would
-- let any signed-in user of any workspace rename, deactivate or repoint a feed
-- that every other tenant in the deployment reads; adding it to DELETE would
-- let them destroy it, taking every version and every derived service-level row
-- with it by cascade. Public feeds are service-role-authored only.

CREATE POLICY gtfs_feeds_update ON public.gtfs_feeds
  FOR UPDATE
  USING (
    workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())
  )
  WITH CHECK (
    workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())
  );

CREATE POLICY gtfs_feeds_delete ON public.gtfs_feeds
  FOR DELETE
  USING (
    workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())
  );

-- DEFENCE IN DEPTH, and the direct consequence of the two policies above.
-- `anon` holds INSERT/UPDATE/DELETE on gtfs_feeds from the pre-20260804000001
-- bootstrap defaults. Until now RLS denied every one of those commands outright
-- because no permissive write policy existed; this migration has just added
-- two, so the policy predicate is now the ONLY thing standing between an
-- anonymous caller and a feed row. `auth.uid()` is NULL for anon so the
-- predicate holds — but the two controls must fail independently, which is the
-- same argument 20260730000010 made when it revoked these grants on the eight
-- child tables. anon KEEPS SELECT: public preloaded feeds are meant to be
-- world-readable and `gtfs_feeds_read` is what scopes that.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.gtfs_feeds FROM anon;

-- ---------------------------------------------------------------------------
-- 8. The gtfs-uploads bucket ceiling
-- ---------------------------------------------------------------------------
--
-- 50 MiB (20260219000006) already refuses two of the eleven largest US transit
-- agencies outright: Chicago's CTA feed is ~94 MiB and NJ Transit's ~52 MiB.
-- A product that claims to work for any agency in the United States and then
-- refuses Chicago is refusing its own claim, and the refusal would arrive as a
-- storage error at the end of an upload rather than as anything a planner could
-- understand. 200 MiB clears every current US feed with headroom.
--
-- Written as an upsert rather than an UPDATE because the desired end state is
-- "the bucket exists with a 200 MiB ceiling", which is the correct statement on
-- a fresh install and on an existing one alike. It destroys nothing — raising a
-- ceiling cannot lose data — and so does not belong on the reviewed destructive
-- allowlist in src/test/migrations/no-destructive-migration.test.ts.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'gtfs-uploads', 'gtfs-uploads', false, 209715200,
  ARRAY['application/zip', 'application/x-zip-compressed', 'application/octet-stream']
)
ON CONFLICT (id) DO UPDATE SET file_size_limit = EXCLUDED.file_size_limit;

-- ---------------------------------------------------------------------------
-- 9. Comments the catalog carries for whoever reads the schema next
-- ---------------------------------------------------------------------------

COMMENT ON TABLE public.gtfs_feed_versions IS
  'One ingest attempt of one GTFS feed: where it came from, what it contained, and whether it may be trusted. Also the job row — deliberately not split, so a "ready" status that produced nothing is unstorable.';

COMMENT ON CONSTRAINT gtfs_feed_versions_ready_is_not_empty ON public.gtfs_feed_versions IS
  'An ingested-but-empty feed cannot be marked ready. Binds the service role too, which no application-level check does.';

COMMENT ON TABLE public.gtfs_route_service_levels IS
  'Derived service levels per route, direction and GTFS weekday. Never the raw timetable: OpenPlan answers how often the bus comes, not what time the 4:15 is.';

COMMENT ON TABLE public.gtfs_stop_service_levels IS
  'Derived service levels per stop and GTFS weekday, with a generated point geometry. The table an accessibility or equity question is asked of.';

COMMENT ON COLUMN public.gtfs_route_service_levels.peak_window_start_seconds IS
  'Start of the busiest observed clock hour, DERIVED FROM THIS ROUTE''S OWN DEPARTURES. Never an assumed 6-9 AM window.';

COMMENT ON COLUMN public.gtfs_stop_service_levels.peak_window_start_seconds IS
  'Start of the busiest observed clock hour, DERIVED FROM THIS STOP''S OWN DEPARTURES. Never an assumed 6-9 AM window.';

COMMENT ON VIEW public.gtfs_stops_map IS
  'GeoJSON-rendered stop service levels. Exists because supabase-js cannot read a PostGIS geometry — PostgREST returns hex EWKB and nothing in this repo parses it.';
