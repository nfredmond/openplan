-- ============================================================================
-- Title VI service equity — the adopted policy, and the tract-level service
-- join it is measured against.
-- ============================================================================
--
-- THE QUESTION THIS ANSWERS: does transit service in this agency's minority and
-- low-income census tracts differ from service in the rest of its service area?
-- That is the service-equity half of an FTA Title VI program, and it is the one
-- an agency can answer from a GTFS feed plus census demographics.
--
-- ============================================ WHY THERE IS A POLICY TABLE
--
-- FTA C 4702.1B thresholds are POLICY AN AGENCY ADOPTS, not constants OpenPlan
-- picks. Two agencies in the same state legitimately adopt different minority
-- thresholds and different disparate-impact thresholds, publish them, and are
-- held to their own. A hardcoded 50% or 10-percentage-point rule would produce
-- a finding no agency could defend and no OpenPlan deployment could vary —
-- which is non-negotiable #0 in the one module where getting it wrong has legal
-- consequences.
--
-- So the thresholds live in `title_vi_policies`, per workspace, WITH THE
-- ADOPTION RECORD ATTACHED. A finding cites the policy it was measured against,
-- the body that adopted it, and the date — never an unattributed number.
--
-- ================================== THE NEUTRAL CORE / US-SPECIFIC SPLIT
--
-- `gtfs_tract_service` is JURISDICTION-NEUTRAL: it counts service at small-area
-- geographies and knows nothing about Title VI, the United States, or race. It
-- would serve a European equity duty or an Australian one unchanged. Only
-- `title_vi_policies` names a US statute. Keeping the split means a future
-- country adapter adds a policy table, not a second service join.
--
-- ============================== WHAT THIS DELIBERATELY DOES NOT DO
--
-- It does not decide whether a disparity IS a disparate impact. That
-- determination is a governing body's, made on a record that includes public
-- participation and a least-discriminatory-alternative analysis. OpenPlan
-- measures the difference and compares it to the adopted threshold; the words
-- "disparate impact" are reserved for what an agency itself concludes.

-- ---------------------------------------------------------------------------
-- 1. title_vi_policies — the adopted program record
-- ---------------------------------------------------------------------------
--
-- HISTORY IS KEPT, because a Title VI program is re-adopted (typically every
-- three years) and a finding must be reproducible against the policy that was
-- current when it was made. `superseded_at IS NULL` is the current one, enforced
-- by a partial unique index so a workspace can never have two.

CREATE TABLE IF NOT EXISTS public.title_vi_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  -- ---- Who adopted it, and when. NOT NULL because an unattributed threshold
  -- ---- is the thing this table exists to prevent.
  adopted_on DATE NOT NULL,
  adopted_by TEXT NOT NULL CHECK (length(btrim(adopted_by)) > 0),
  board_action_reference TEXT,
  document_url TEXT,

  -- ---- How a tract is classified.
  --
  -- `service_area_average` is the FTA-typical construction: a tract counts as
  -- minority when its minority share exceeds the average for the service area
  -- as a whole, so the comparison population is the agency's own. A fixed
  -- threshold is the alternative some agencies adopt. The threshold column is
  -- required for `fixed_threshold` and meaningless for `service_area_average`,
  -- and the CHECK below makes the unusable combination unstorable rather than
  -- leaving a NULL to be interpreted at read time.
  minority_definition_method TEXT NOT NULL DEFAULT 'service_area_average'
    CHECK (minority_definition_method IN ('service_area_average', 'fixed_threshold')),
  minority_threshold_pct NUMERIC(5, 2)
    CHECK (minority_threshold_pct IS NULL OR (minority_threshold_pct >= 0 AND minority_threshold_pct <= 100)),

  low_income_definition_method TEXT NOT NULL DEFAULT 'service_area_average'
    CHECK (low_income_definition_method IN ('service_area_average', 'fixed_threshold')),
  low_income_threshold_pct NUMERIC(5, 2)
    CHECK (low_income_threshold_pct IS NULL OR (low_income_threshold_pct >= 0 AND low_income_threshold_pct <= 100)),

  -- ---- When a measured difference becomes a finding the agency must act on.
  --
  -- Stored as percentage points of relative difference. NULL means the agency
  -- has not adopted one, which is a real and common state — and the analysis
  -- must then report the measured difference WITHOUT calling it anything.
  disparate_impact_threshold_pct NUMERIC(5, 2)
    CHECK (disparate_impact_threshold_pct IS NULL OR disparate_impact_threshold_pct >= 0),
  disproportionate_burden_threshold_pct NUMERIC(5, 2)
    CHECK (disproportionate_burden_threshold_pct IS NULL OR disproportionate_burden_threshold_pct >= 0),

  -- ---- Adopted service standards.
  --
  -- The first three are measurable against a GTFS feed and the analysis uses
  -- them. The rest are recorded because the Title VI program requires them and
  -- an agency needs one place for the document — NOT because OpenPlan can
  -- measure them. Nothing derives a finding from a free-text note.
  standard_peak_headway_minutes INTEGER
    CHECK (standard_peak_headway_minutes IS NULL OR standard_peak_headway_minutes > 0),
  standard_offpeak_headway_minutes INTEGER
    CHECK (standard_offpeak_headway_minutes IS NULL OR standard_offpeak_headway_minutes > 0),
  standard_span_hours NUMERIC(4, 1)
    CHECK (standard_span_hours IS NULL OR (standard_span_hours > 0 AND standard_span_hours <= 24)),
  standard_on_time_performance_pct NUMERIC(5, 2)
    CHECK (standard_on_time_performance_pct IS NULL OR (standard_on_time_performance_pct >= 0 AND standard_on_time_performance_pct <= 100)),
  standard_vehicle_load_note TEXT,
  standard_service_availability_note TEXT,
  policy_amenity_distribution_note TEXT,
  policy_vehicle_assignment_note TEXT,

  superseded_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A fixed threshold with no number is a policy that cannot be applied; a
  -- service-area-average method with a number invites a reader to think the
  -- number was used. Both are refused at the column, not at the call site.
  CONSTRAINT title_vi_policies_minority_threshold_matches_method CHECK (
    (minority_definition_method = 'fixed_threshold' AND minority_threshold_pct IS NOT NULL)
    OR (minority_definition_method = 'service_area_average' AND minority_threshold_pct IS NULL)
  ),
  CONSTRAINT title_vi_policies_low_income_threshold_matches_method CHECK (
    (low_income_definition_method = 'fixed_threshold' AND low_income_threshold_pct IS NOT NULL)
    OR (low_income_definition_method = 'service_area_average' AND low_income_threshold_pct IS NULL)
  )
);

-- One CURRENT policy per workspace. Superseded ones are unlimited.
CREATE UNIQUE INDEX IF NOT EXISTS title_vi_policies_one_current_per_workspace
  ON public.title_vi_policies (workspace_id)
  WHERE superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS title_vi_policies_workspace_idx
  ON public.title_vi_policies (workspace_id, adopted_on DESC);

COMMENT ON TABLE public.title_vi_policies IS
  'A workspace''s adopted FTA Title VI program thresholds and service standards, with the adoption '
  'record. OpenPlan never supplies these values: they are policy an agency adopts and publishes, and '
  'a service-equity finding cites the row it was measured against.';

-- ---------------------------------------------------------------------------
-- 2. gtfs_tract_service — service at each tract, per service day, at ingest
-- ---------------------------------------------------------------------------
--
-- WHY AT INGEST AND NOT PER REQUEST. The join is thousands of stops against
-- thousands of tract polygons. Doing it when a planner opens a page would be
-- slow enough to time out on a large agency, and would silently return a
-- partial answer under any row cap — the failure mode that put a 1,000-row
-- PostgREST truncation into a corridor score. Computed once per feed version,
-- it is a small indexed table a page reads directly.
--
-- SERVICE DAYS ARE ROWS, NEVER A SUM. A system with no weekend service is the
-- most common Title VI service finding there is, and a weekly total erases it
-- completely. The grain is (feed version, tract, service day) and nothing in
-- this file adds them up.
--
-- A ZERO-SERVICE ROW IS A MEASUREMENT. Tracts inside the feed's own extent with
-- no stop at all get a row with zeroes, because "this tract has no service" is
-- the finding. Tracts outside the extent get NO ROW, because the feed says
-- nothing about them and an absent row must never be read as absent service.

CREATE TABLE IF NOT EXISTS public.gtfs_tract_service (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  feed_version_id UUID NOT NULL REFERENCES public.gtfs_feed_versions(id) ON DELETE CASCADE,

  tract_geoid TEXT NOT NULL,

  service_day TEXT NOT NULL CHECK (
    service_day IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')
  ),

  stops_in_tract INTEGER NOT NULL DEFAULT 0,

  -- STOP EVENTS, NOT TRIPS, and the name is load-bearing. One bus running
  -- through a tract past six stops contributes six stop events. That is a
  -- standard measure of service intensity at a place, and it is NOT a count of
  -- vehicles — calling it `trips_per_day` would overstate service by the number
  -- of stops per tract, which is itself higher in dense (often minority) tracts.
  stop_events_per_day INTEGER NOT NULL DEFAULT 0,

  -- The BEST service anywhere in the tract, which is what a resident who can
  -- walk to any stop in it experiences. An average across stops would let a
  -- single well-served corner be diluted by park-and-ride stubs.
  best_peak_headway_seconds INTEGER,
  best_span_seconds INTEGER,

  routes_serving INTEGER NOT NULL DEFAULT 0,

  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT gtfs_tract_service_grain
    UNIQUE (feed_version_id, tract_geoid, service_day),

  CONSTRAINT gtfs_tract_service_version_same_workspace
    FOREIGN KEY (feed_version_id, workspace_id)
    REFERENCES public.gtfs_feed_versions (id, workspace_id) ON DELETE CASCADE,

  -- A tract with no stops cannot have service, and a tract with stops cannot
  -- have negative service. Both directions, because a broken join that wrote
  -- zeroes everywhere would otherwise look like a real finding of no service.
  CONSTRAINT gtfs_tract_service_zero_stops_means_zero_service CHECK (
    (stops_in_tract = 0 AND stop_events_per_day = 0 AND routes_serving = 0
      AND best_peak_headway_seconds IS NULL AND best_span_seconds IS NULL)
    OR stops_in_tract > 0
  ),
  CONSTRAINT gtfs_tract_service_counts_are_not_negative CHECK (
    stops_in_tract >= 0 AND stop_events_per_day >= 0 AND routes_serving >= 0
  )
);

CREATE INDEX IF NOT EXISTS gtfs_tract_service_version_idx
  ON public.gtfs_tract_service (feed_version_id, service_day);

CREATE INDEX IF NOT EXISTS gtfs_tract_service_workspace_idx
  ON public.gtfs_tract_service (workspace_id);

CREATE INDEX IF NOT EXISTS gtfs_tract_service_geoid_idx
  ON public.gtfs_tract_service (tract_geoid);

COMMENT ON TABLE public.gtfs_tract_service IS
  'Transit service at each census tract, per service day, derived once per feed version. '
  'Jurisdiction-neutral: it knows nothing about Title VI or demographics. A row with '
  'stops_in_tract = 0 is a measurement of no service; a MISSING row means the tract is outside '
  'the feed''s extent and the feed says nothing about it.';

-- ---------------------------------------------------------------------------
-- 3. compute_gtfs_tract_service — the spatial join, done once
-- ---------------------------------------------------------------------------
--
-- supabase-js cannot express a spatial join, and shipping one as raw SQL
-- through the client is not a thing this codebase does. This is the function
-- the ingest path calls after service levels are written.
--
-- THE EXTENT IS THE FEED'S OWN STOPS, and its honesty limit is stated here
-- because the analysis has to disclose it: the envelope of every stop in the
-- version, which is a BOUNDING BOX and therefore includes area the agency does
-- not serve. It is used because it is derivable from the feed alone. An adopted
-- service-area boundary is the better input and is not something OpenPlan holds
-- yet; when it does, this function takes it as an argument and the disclosure
-- changes. It must never be presented as the agency's service area.
--
-- Returns the number of tract rows written, so the caller can record what it
-- did rather than assume it worked.

CREATE OR REPLACE FUNCTION public.compute_gtfs_tract_service(p_feed_version_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_workspace_id UUID;
  v_extent GEOMETRY;
  v_written INTEGER := 0;
BEGIN
  SELECT workspace_id INTO v_workspace_id
  FROM public.gtfs_feed_versions
  WHERE id = p_feed_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'compute_gtfs_tract_service: no feed version %', p_feed_version_id;
  END IF;

  -- Recomputing must replace, never accumulate: a re-ingest of the same version
  -- would otherwise double every count through the unique grain or fail on it.
  DELETE FROM public.gtfs_tract_service WHERE feed_version_id = p_feed_version_id;

  -- The envelope of the version's stops. NULL when the version has no placed
  -- stops at all, in which case there is nothing to say and no rows are written.
  SELECT ST_Envelope(ST_Collect(geom)) INTO v_extent
  FROM public.gtfs_stop_service_levels
  WHERE feed_version_id = p_feed_version_id;

  IF v_extent IS NULL THEN
    RETURN 0;
  END IF;

  WITH tracts_in_extent AS (
    SELECT t.geoid, t.geometry
    FROM public.census_tracts t
    WHERE t.geometry && v_extent
  ),
  -- Every (tract, day) pair the feed could speak to. The cross join against the
  -- days actually present in this version is what lets a tract with no stops
  -- still get a zero row for each day the feed describes — without inventing a
  -- Sunday for a feed that has no Sunday service defined at all.
  days AS (
    SELECT DISTINCT service_day
    FROM public.gtfs_stop_service_levels
    WHERE feed_version_id = p_feed_version_id
  ),
  -- The stops themselves, one row per (stop, day), BEFORE any route expansion.
  --
  -- THE FAN-OUT THIS SHAPE EXISTS TO PREVENT, found by running the join against
  -- real Franklin County geometry: unnesting `route_ids` in the same query as
  -- the counts multiplies every stop row by the number of routes serving it, so
  -- one stop with 40 daily departures and two routes reported as two stops and
  -- 80 departures. It is not a uniform error — it scales with routes per stop,
  -- which is highest in dense central tracts, so it would have inflated service
  -- exactly where a Title VI comparison is most sensitive, in the direction that
  -- makes a disparity disappear.
  stops_in_tracts AS (
    SELECT te.geoid, s.*
    FROM tracts_in_extent te
    JOIN public.gtfs_stop_service_levels s
      ON s.feed_version_id = p_feed_version_id
     AND ST_Contains(te.geometry, s.geom)
  ),
  -- Routes are counted in their own aggregation, where the fan-out is correct.
  route_counts AS (
    SELECT sit.geoid, sit.service_day, COUNT(DISTINCT r.route_id)::INTEGER AS routes_serving
    FROM stops_in_tracts sit
    CROSS JOIN LATERAL unnest(sit.route_ids) AS r(route_id)
    GROUP BY sit.geoid, sit.service_day
  ),
  stop_join AS (
    SELECT
      sit.geoid,
      sit.service_day,
      COUNT(*)::INTEGER AS stops_in_tract,
      COALESCE(SUM(sit.trips_per_day), 0)::INTEGER AS stop_events_per_day,
      MIN(sit.peak_headway_seconds)::INTEGER AS best_peak_headway_seconds,
      MAX(sit.span_seconds)::INTEGER AS best_span_seconds,
      COALESCE(rc.routes_serving, 0) AS routes_serving
    FROM stops_in_tracts sit
    LEFT JOIN route_counts rc
      ON rc.geoid = sit.geoid AND rc.service_day = sit.service_day
    GROUP BY sit.geoid, sit.service_day, rc.routes_serving
  )
  INSERT INTO public.gtfs_tract_service (
    workspace_id, feed_version_id, tract_geoid, service_day,
    stops_in_tract, stop_events_per_day,
    best_peak_headway_seconds, best_span_seconds, routes_serving
  )
  SELECT
    v_workspace_id,
    p_feed_version_id,
    te.geoid,
    d.service_day,
    COALESCE(sj.stops_in_tract, 0),
    COALESCE(sj.stop_events_per_day, 0),
    -- Held NULL on a no-stop tract so the zero-service CHECK holds and so a
    -- missing headway is never read as a headway of zero.
    CASE WHEN COALESCE(sj.stops_in_tract, 0) > 0 THEN sj.best_peak_headway_seconds END,
    CASE WHEN COALESCE(sj.stops_in_tract, 0) > 0 THEN sj.best_span_seconds END,
    COALESCE(sj.routes_serving, 0)
  FROM tracts_in_extent te
  CROSS JOIN days d
  LEFT JOIN stop_join sj ON sj.geoid = te.geoid AND sj.service_day = d.service_day;

  GET DIAGNOSTICS v_written = ROW_COUNT;
  RETURN v_written;
END;
$$;

COMMENT ON FUNCTION public.compute_gtfs_tract_service(uuid) IS
  'Joins a feed version''s stop service levels to census tracts, once, at ingest. Writes a zero row '
  'for tracts inside the feed''s stop envelope with no service, and no row at all for tracts outside '
  'it. Returns rows written.';

-- ---------------------------------------------------------------------------
-- 3b. Did the join actually run? Three states, not two.
-- ---------------------------------------------------------------------------
--
-- An empty `gtfs_tract_service` for a feed version is ambiguous, and the
-- ambiguity is the dangerous kind: it means EITHER that no census tracts are
-- loaded for this agency's area, OR that the join never ran at all (a feed
-- version ingested before this migration, or an ingest whose join failed). Read
-- as "no tracts have service", both would publish a finding of total service
-- absence about a place that may be well served.
--
-- `tract_service_computed_at` is the discriminator. NULL means NOT COMPUTED and
-- the analysis must refuse; non-NULL with `tract_service_rows = 0` means the
-- join ran and found no loaded tract coverage, which the analysis reports as a
-- named, actionable gap ("load tract coverage for this county") rather than as
-- a measurement.

ALTER TABLE public.gtfs_feed_versions
  ADD COLUMN IF NOT EXISTS tract_service_rows INTEGER,
  ADD COLUMN IF NOT EXISTS tract_service_computed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.gtfs_feed_versions.tract_service_computed_at IS
  'When the tract-service join last ran for this version. NULL means it never ran — which is NOT '
  'the same as running and finding nothing, and a service-equity analysis must refuse rather than '
  'report absence.';

-- ---------------------------------------------------------------------------
-- 4. RLS, policies and grants
-- ---------------------------------------------------------------------------
--
-- `title_vi_policies` is a document a planner authors, so it is client-writable
-- under the house pattern: PERMISSIVE membership policies for each verb, with
-- the RESTRICTIVE writer-role gate supplying the viewer denial. The gate is not
-- duplicated here — 20260728000010's reasoning applies unchanged, and a second
-- copy of the writer rule is a second place for it to drift.
--
-- `gtfs_tract_service` is DERIVED and service-role-authored, exactly like the
-- service-level tables it is computed from: one SELECT policy and nothing else.
-- There is no shape in which a browser session writes a spatial join.

ALTER TABLE public.title_vi_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gtfs_tract_service ENABLE ROW LEVEL SECURITY;

CREATE POLICY title_vi_policies_read ON public.title_vi_policies
  FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())
  );

CREATE POLICY title_vi_policies_insert ON public.title_vi_policies
  FOR INSERT WITH CHECK (
    workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())
  );

CREATE POLICY title_vi_policies_update ON public.title_vi_policies
  FOR UPDATE USING (
    workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())
  ) WITH CHECK (
    workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())
  );

CREATE POLICY title_vi_policies_delete ON public.title_vi_policies
  FOR DELETE USING (
    workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())
  );

-- The writer-role gate, matching every other client-writable workspace table.
CREATE POLICY title_vi_policies_writer_only_insert ON public.title_vi_policies
  AS RESTRICTIVE FOR INSERT
  WITH CHECK (public.workspace_member_can_write(workspace_id));

CREATE POLICY title_vi_policies_writer_only_update ON public.title_vi_policies
  AS RESTRICTIVE FOR UPDATE
  USING (public.workspace_member_can_write(workspace_id));

CREATE POLICY title_vi_policies_writer_only_delete ON public.title_vi_policies
  AS RESTRICTIVE FOR DELETE
  USING (public.workspace_member_can_write(workspace_id));

-- The public-feed (`workspace_id IS NULL`) branch is present on the read policy
-- for the same reason it is on `gtfs_stop_service_levels`: a preloaded feed is
-- readable by every signed-in user.
CREATE POLICY gtfs_tract_service_read ON public.gtfs_tract_service
  FOR SELECT USING (
    workspace_id IS NULL
    OR workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())
  );

-- Grants are EXPLICIT since 20260804000001 flipped default privileges to deny.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.title_vi_policies TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.title_vi_policies TO service_role;

GRANT SELECT ON public.gtfs_tract_service TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gtfs_tract_service TO service_role;

-- The join reads census_tracts (anon-readable public reference data) and the
-- workspace's own stop service levels, and writes the derived table. Only the
-- ingest path calls it.
GRANT EXECUTE ON FUNCTION public.compute_gtfs_tract_service(uuid) TO service_role;
