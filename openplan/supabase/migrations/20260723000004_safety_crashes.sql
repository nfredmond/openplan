-- Wave 8.1 — Safety module: persisted, observed crash records.
--
-- Provisions:
--   * safety_crash_ingests — one row per acquisition run + its honest status.
--   * safety_crashes       — the observed, geolocated crash points themselves.
--
-- Posture (matches the app's established seams — see ADR-003):
--
--   * OBSERVED ONLY. Every row here is a collision a source agency actually
--     reported and geolocated. There is no estimate tier: the source_id CHECK
--     below restricts writes to the registered observed adapters
--     (src/lib/safety/sources/registry.ts). The disclosed `fars-estimate`
--     fallback in src/lib/data-sources/crashes.ts powers the Explore scorecard
--     and is structurally unable to reach this table.
--
--   * COVERAGE IS RECORDED, NOT INFERRED. crash_count vs geocoded_count on the
--     ingest row is load-bearing: roughly 22% of CCRS records carry no
--     coordinates, so a map is always a subset of what was reported. Storing
--     both lets the UI say "1,180 reported / 1,089 mappable" rather than
--     quietly showing the smaller number. A `no_coverage` status is a first
--     class outcome, not a failure.
--
--   * GEOMETRY IS GENERATED, NOT WRITTEN. Numeric latitude/longitude is the
--     source of truth, matching the repo convention (projects_location.sql:7,
--     rtp_cycles_anchor.sql:7). The PostGIS point is a STORED generated column
--     with a GiST index, which is exactly the escape hatch
--     20260719000092_engagement_corridor_join.sql documents ("revisit with a
--     generated geometry column if a workspace ever accumulates tens of
--     thousands") — a county-decade crash extract is on the order of 10^5 rows.
--     It also sidesteps a hard constraint: supabase-js cannot send PostGIS
--     values, so the client writes plain numbers and Postgres derives the point.
--
--   * RLS grants workspace MEMBERS read (SELECT) only. Every write goes through
--     an authed API route using the service-role client after an explicit
--     workspace-membership check — same posture as the Knowledge Base and
--     engagement notifications.

CREATE EXTENSION IF NOT EXISTS postgis;

------------------------------------------------------------------------------
-- 1. INGESTS — one row per acquisition run against one study area.
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.safety_crash_ingests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id        uuid REFERENCES public.projects(id) ON DELETE SET NULL,

  -- Study area. The bbox is always present (it is what the adapter queries);
  -- geometry_geojson is optional and reserved for clipping a later slice may do.
  min_lon           double precision NOT NULL,
  min_lat           double precision NOT NULL,
  max_lon           double precision NOT NULL,
  max_lat           double precision NOT NULL,
  geometry_geojson  jsonb,
  -- CCRS "County Code" (CA alphabetical numbering; 29 = Nevada). When set, the
  -- adapter can count reported crashes losslessly — an ungeocoded crash has no
  -- coordinates and can therefore never satisfy a bbox predicate.
  county_code       integer,

  source_id         text NOT NULL,
  source_label      text NOT NULL,
  attribution       text NOT NULL,
  coverage_state    text NOT NULL CHECK (coverage_state IN (
    'ccrs_ca_statewide','fars_fatal_only','switrs_legacy_local',
    'out_of_coverage','source_unavailable'
  )),
  -- How completely the source expresses severity, so a "0 serious injuries"
  -- reading is never mistaken for "none occurred".
  severity_completeness text NOT NULL DEFAULT 'fatal_injury_only' CHECK (
    severity_completeness IN ('kabco_full','fatal_injury_only','fatal_only')
  ),

  years_requested   integer[] NOT NULL DEFAULT '{}',
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','fetching','ready','failed','no_coverage'
  )),
  -- Reported crashes matching the query (geocoded or not).
  crash_count       integer NOT NULL DEFAULT 0,
  -- Of those, how many carried usable coordinates and are stored below.
  geocoded_count    integer NOT NULL DEFAULT 0,
  -- True when a caller-supplied cap stopped paging before the source ran out.
  truncated         boolean NOT NULL DEFAULT false,
  -- Honest failure record, e.g. the source API was unreachable.
  fetch_error       text,

  requested_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_safety_crash_ingests_workspace
  ON public.safety_crash_ingests (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_safety_crash_ingests_project
  ON public.safety_crash_ingests (project_id) WHERE project_id IS NOT NULL;

------------------------------------------------------------------------------
-- 2. CRASHES — observed, geolocated collision points.
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.safety_crashes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  ingest_id             uuid NOT NULL REFERENCES public.safety_crash_ingests(id) ON DELETE CASCADE,

  -- Restricted to the registered OBSERVED adapters. This is the database-level
  -- guarantee that no estimate-grade figure can ever land here; extending
  -- coverage means extending this list alongside the TS registry.
  source_id             text NOT NULL CHECK (source_id IN ('ccrs-ca')),
  -- The source's own stable case identifier — the dedup key.
  external_id           text NOT NULL,

  collision_date        date,
  collision_year        integer,

  -- KABCO-aligned. 'severe_injury' is KABCO A; a source that cannot separate it
  -- (CCRS Crashes_* cannot) simply never writes it, which is why
  -- severity_completeness is recorded on the ingest row.
  severity              text NOT NULL CHECK (severity IN ('fatal','severe_injury','injury','pdo')),
  killed_count          integer NOT NULL DEFAULT 0,
  injured_count         integer NOT NULL DEFAULT 0,
  pedestrian_involved   boolean NOT NULL DEFAULT false,
  bicyclist_involved    boolean NOT NULL DEFAULT false,

  latitude              double precision NOT NULL,
  longitude             double precision NOT NULL,
  geom                  geometry(Point, 4326) GENERATED ALWAYS AS
                          (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)) STORED,

  ingested_at           timestamptz NOT NULL DEFAULT now(),

  -- Re-ingesting the same study area is idempotent rather than duplicative.
  CONSTRAINT safety_crashes_source_external_uniq UNIQUE (workspace_id, source_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_safety_crashes_workspace
  ON public.safety_crashes (workspace_id, collision_year DESC);
CREATE INDEX IF NOT EXISTS idx_safety_crashes_ingest
  ON public.safety_crashes (ingest_id);
CREATE INDEX IF NOT EXISTS idx_safety_crashes_severity
  ON public.safety_crashes (workspace_id, severity);
-- The spatial index the generated column exists for: bbox queries at 10^5 rows.
CREATE INDEX IF NOT EXISTS idx_safety_crashes_geom
  ON public.safety_crashes USING GIST (geom);

------------------------------------------------------------------------------
-- 3. RLS — members read; all writes go through service-role API routes.
------------------------------------------------------------------------------
ALTER TABLE public.safety_crash_ingests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safety_crashes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='safety_crash_ingests' AND policyname='safety_crash_ingests_read') THEN
    CREATE POLICY safety_crash_ingests_read ON public.safety_crash_ingests FOR SELECT USING (
      EXISTS (SELECT 1 FROM public.workspace_members wm
              WHERE wm.workspace_id = safety_crash_ingests.workspace_id AND wm.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='safety_crashes' AND policyname='safety_crashes_read') THEN
    CREATE POLICY safety_crashes_read ON public.safety_crashes FOR SELECT USING (
      EXISTS (SELECT 1 FROM public.workspace_members wm
              WHERE wm.workspace_id = safety_crashes.workspace_id AND wm.user_id = auth.uid()));
  END IF;
END $$;

------------------------------------------------------------------------------
-- 4. updated_at trigger (own per-module function; search_path pinned inline).
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_safety_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_safety_crash_ingests_updated_at ON public.safety_crash_ingests;
CREATE TRIGGER trg_safety_crash_ingests_updated_at BEFORE UPDATE ON public.safety_crash_ingests
  FOR EACH ROW EXECUTE FUNCTION public.set_safety_updated_at();

COMMENT ON TABLE public.safety_crashes IS
  'Observed, geolocated crash records retrieved from a registered crash-source adapter (Wave 8.1). Never estimates — source_id is CHECK-restricted to observed adapters. Geometry is a generated column over numeric lat/lng.';
COMMENT ON TABLE public.safety_crash_ingests IS
  'One row per crash acquisition run: study area, source, coverage state, and the reported-vs-mappable counts that let the UI disclose ungeocoded crashes (Wave 8.1).';
