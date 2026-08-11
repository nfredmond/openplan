-- Aerial flight plans — the planner-authored parameters of a mission's
-- photogrammetry flight become a first-class, reviewable object.
--
-- WHY A TABLE. Until now the only flight parameters OpenPlan could hold were
-- the two defaults inside the DJI export builder, which meant the numbers that
-- decide whether a survey's imagery is usable — altitude, ground resolution,
-- overlap — existed nowhere a reviewer could see them, and every export was
-- generated from values nobody had authored. A flight plan is the record of
-- what the crew INTENDED to fly: one row per mission, written by a planner,
-- diffable against what was actually collected.
--
-- WHAT IS DELIBERATELY NOT IN THE SCHEMA, and why:
--
--   * NO camera spec columns. `camera_key` names an entry in the in-code
--     registry (src/lib/aerial/camera-registry.ts); the sensor geometry lives
--     there AS DATA so adding a camera is a descriptor, not a migration, and
--     no vendor is baked into SQL. The database cannot validate the key
--     against code, so the flight-plan route refuses unknown keys at write
--     time and names the ones it knows.
--   * NO altitude ceiling CHECK. Regulatory ceilings vary by jurisdiction
--     (and by waiver), so a hardcoded maximum would be a US-specific rule in a
--     core table — the UI discloses the assumption instead of the schema
--     asserting one. Overlap DOES get bounds (40–95%): those are the limits of
--     photogrammetric usefulness, not of anyone's law.
--   * NO free-typed GSD-and-altitude pair requirement. Either may be null —
--     one derives from the other given the camera — but a plan with NEITHER
--     has no vertical intent at all, and that dishonest state is unstorable
--     (aerial_flight_plans_vertical_intent below).

CREATE TABLE IF NOT EXISTS public.aerial_flight_plans (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          UUID        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- One plan per mission. A mission that needs two flight plans is two
  -- missions; UNIQUE is what lets the route PUT be a true upsert.
  mission_id            UUID        NOT NULL UNIQUE REFERENCES public.aerial_missions(id) ON DELETE CASCADE,

  -- Registry key, NOT a camera spec. See header.
  camera_key            TEXT        NOT NULL CHECK (char_length(camera_key) BETWEEN 1 AND 120),

  -- The vertical profile: target ground resolution and/or altitude. Both
  -- NUMERIC so a stored value is exactly what the planner typed, never a
  -- float re-rounding of it.
  target_gsd_cm_per_px  NUMERIC     CHECK (target_gsd_cm_per_px IS NULL OR target_gsd_cm_per_px > 0),
  altitude_agl_m        NUMERIC     CHECK (altitude_agl_m IS NULL OR altitude_agl_m > 0),

  -- Overlap bounds are photogrammetric, not regulatory: below ~40% adjacent
  -- images stop matching and structure-from-motion fails; above 95% the flight
  -- collects near-duplicate frames. A value outside that band is a data-entry
  -- error, so it is unstorable rather than silently accepted.
  front_overlap_pct     NUMERIC     NOT NULL CHECK (front_overlap_pct >= 40 AND front_overlap_pct <= 95),
  side_overlap_pct      NUMERIC     NOT NULL CHECK (side_overlap_pct >= 40 AND side_overlap_pct <= 95),

  speed_m_s             NUMERIC     CHECK (speed_m_s IS NULL OR speed_m_s > 0),
  -- Survey-geometry bound, not a vendor gimbal range: -90 is nadir (straight
  -- down), 0 is the horizon. A survey plan pointing the camera above the
  -- horizon is not a survey plan.
  gimbal_pitch_deg      NUMERIC     CHECK (gimbal_pitch_deg IS NULL OR (gimbal_pitch_deg >= -90 AND gimbal_pitch_deg <= 0)),
  -- Fly the grid twice at 90 degrees (better 3D reconstruction, twice the time).
  cross_grid            BOOLEAN     NOT NULL DEFAULT false,
  -- Extra capture distance beyond the AOI boundary, metres.
  boundary_margin_m     NUMERIC     CHECK (boundary_margin_m IS NULL OR boundary_margin_m >= 0),
  -- Corridor missions only: total capture width either side of the centreline.
  corridor_width_m      NUMERIC     CHECK (corridor_width_m IS NULL OR corridor_width_m > 0),

  crew_pilot_name       TEXT,
  -- Return-to-home altitude. Operational, not grid geometry; no ceiling for
  -- the same jurisdictional reason as altitude_agl_m.
  rth_altitude_m        NUMERIC     CHECK (rth_altitude_m IS NULL OR rth_altitude_m > 0),
  notes                 TEXT,

  -- The last computed grid snapshot (flight lines, photo points, stats), kept
  -- so a REVIEWED plan is diffable against a regenerated one. generated_with
  -- is the fingerprint of the parameters (and mission AOI) the snapshot was
  -- computed from — src/lib/aerial/camera-registry.ts#hashFlightPlanParams —
  -- so a snapshot that no longer matches the row's current parameters is
  -- DETECTABLY stale instead of quietly wrong.
  generated_plan        JSONB,
  generated_at          TIMESTAMPTZ,
  generated_with        TEXT,

  -- Who last saved the plan. Authorship on the domain row, per the standing
  -- rule that agent/route authorship gets recorded as each lane is touched.
  updated_by            UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A plan must state SOME vertical intent: a GSD target, an altitude, or both.
  CONSTRAINT aerial_flight_plans_vertical_intent CHECK (
    target_gsd_cm_per_px IS NOT NULL OR altitude_agl_m IS NOT NULL
  ),
  -- A snapshot without its timestamp and parameter fingerprint cannot be
  -- checked for staleness, and a fingerprint without a snapshot describes
  -- nothing. All three or none.
  CONSTRAINT aerial_flight_plans_snapshot_is_datable CHECK (
    (generated_plan IS NULL AND generated_at IS NULL AND generated_with IS NULL)
    OR (generated_plan IS NOT NULL AND generated_at IS NOT NULL AND generated_with IS NOT NULL)
  )
);

COMMENT ON TABLE public.aerial_flight_plans IS
  'One planner-authored flight plan per aerial mission: vertical profile (GSD/altitude), overlaps, camera registry key, and the last generated grid snapshot with the parameter fingerprint it was computed from. camera_key is validated against src/lib/aerial/camera-registry.ts by the route, not by the database.';
COMMENT ON COLUMN public.aerial_flight_plans.generated_with IS
  'Fingerprint (hashFlightPlanParams) of the geometry-bearing parameters plus the mission AOI at the moment generated_plan was computed. Compare against the fingerprint of the CURRENT parameters to detect a stale snapshot.';

-- The UNIQUE(mission_id) constraint already indexes the per-mission lookup;
-- this serves workspace-wide sweeps.
CREATE INDEX IF NOT EXISTS aerial_flight_plans_workspace_idx
  ON public.aerial_flight_plans(workspace_id);

------------------------------------------------------------------------------
-- CROSS-WORKSPACE UNSTORABLE. The route verifies the mission it loads, but a
-- constraint outlives a route: a plan whose mission lives in a different
-- workspace than the row claims must be impossible to store, not merely
-- unlikely. SECURITY INVOKER on purpose: anyone allowed to write the plan can
-- read the mission row the check consults.
------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.validate_aerial_flight_plan_scope()
RETURNS TRIGGER
SET search_path = public, pg_temp
AS $$
DECLARE
  mission_workspace_id UUID;
BEGIN
  SELECT workspace_id INTO mission_workspace_id
  FROM aerial_missions WHERE id = NEW.mission_id;

  IF mission_workspace_id IS NULL OR mission_workspace_id <> NEW.workspace_id THEN
    RAISE EXCEPTION 'aerial flight plan must carry its mission''s workspace';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_aerial_flight_plans_scope ON public.aerial_flight_plans;
CREATE TRIGGER trg_aerial_flight_plans_scope
BEFORE INSERT OR UPDATE ON public.aerial_flight_plans
FOR EACH ROW
EXECUTE FUNCTION public.validate_aerial_flight_plan_scope();

------------------------------------------------------------------------------
-- RLS. Reads mirror aerial_missions (workspace membership). Writes are
-- ROLE-AWARE at the permissive layer via public.workspace_member_can_write —
-- the intended post-20260728000006 shape — so this table needs no companion
-- RESTRICTIVE gate and never depends on that migration's VALUES loop
-- remembering it exists. A viewer is denied at the database, not only at the
-- route.
------------------------------------------------------------------------------


ALTER TABLE public.aerial_flight_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY aerial_flight_plans_read ON public.aerial_flight_plans
  FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );

CREATE POLICY aerial_flight_plans_writer_insert ON public.aerial_flight_plans
  FOR INSERT WITH CHECK (public.workspace_member_can_write(workspace_id));

CREATE POLICY aerial_flight_plans_writer_update ON public.aerial_flight_plans
  FOR UPDATE USING (public.workspace_member_can_write(workspace_id))
  WITH CHECK (public.workspace_member_can_write(workspace_id));

CREATE POLICY aerial_flight_plans_writer_delete ON public.aerial_flight_plans
  FOR DELETE USING (public.workspace_member_can_write(workspace_id));

-- Grants are EXPLICIT since 20260804000001 flipped default privileges to deny.
REVOKE ALL ON TABLE public.aerial_flight_plans FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aerial_flight_plans TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aerial_flight_plans TO service_role;
