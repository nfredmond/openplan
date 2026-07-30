-- A campaign can require that a dropped pin be inside the area it is about.
--
-- WHY THIS EXISTS
--   `/api/engage/[shareToken]/submit` validated a participant's coordinate
--   against the whole planet and nothing else: latitude -90..90, longitude
--   -180..180. A comment about a corridor study could be pinned in another
--   hemisphere — by a mis-tap, or by someone with a point to make — and it
--   entered the record as ordinary participation. It was counted in the
--   participation dashboard, clustered by the spatial hotspot screen, and
--   eligible to be quoted in a report an agency signs.
--
--   The area was already on record. 20260729000003 gave every campaign an
--   optional place of record (`place_*`), and the public portal has been
--   FRAMING its map on it since. Nothing ever checked a submission against it.
--   This column is the opt-in that turns the frame into a rule.
--
-- OPT-IN, AND THAT IS THE WHOLE POINT OF THE DEFAULT
--   `DEFAULT FALSE NOT NULL` is not a convenience. Turning this on for every
--   existing campaign would start silently refusing residents of campaigns whose
--   operators never asked for a location rule, on the strength of an area that
--   may have been set only to frame a map. FALSE means "not asked for", which is
--   exactly today's behaviour, so this migration changes the behaviour of no
--   campaign that exists when it runs.
--
-- A CHECK THAT CANNOT RUN MUST NOT BE STORABLE
--   `engagement_campaigns_geofence_needs_area` refuses the flag unless the
--   campaign has a complete bounding box. Without one there is nothing to
--   compare a coordinate to, and a stored "on" with nothing behind it is the
--   worst of the three states: the operator believes participation is being
--   filtered and it is not. The rule lives here, in the database, because the
--   two ways to reach the broken state are on OPPOSITE sides of the application
--   — enabling the flag, and CLEARING the area under an already-enabled flag —
--   and a rule enforced in one route is a rule the other route can forget.
--
--   Note what it does NOT require: a boundary polygon. A bbox-only geofence is
--   coarse but honest, and `src/lib/engagement/geofence.ts` labels a verdict with
--   the test that produced it (`basis: "bbox"` vs `"boundary"`) so a coarse
--   answer is never presented as a fine one.
--
-- WHAT IT IS NOT
--   It is not a security control. A participant can always send a comment with
--   NO pin, and should be able to: a comment with no location is not outside an
--   area, it has no location at all, and refusing those would silence everyone
--   who did not use the map. The geofence protects the RECORD from locations
--   that are not about this consultation; it does not decide who may speak.
--
-- JURISDICTION-NEUTRAL BY CONSTRUCTION. This column names no place, no country
-- and no vocabulary. It is a boolean over whatever area the campaign's own
-- resolver adapter recorded, so a campaign in Ohio, in Fiji, or across the
-- antimeridian is governed by the same statement — and the geofence code is
-- required to handle a bbox whose min_lon exceeds its max_lon, because
-- 20260729000003 deliberately permits one.
--
-- RLS IS EXTENDED, NOT WEAKENED. A column added to a table is covered by that
-- table's existing policies: `engagement_campaigns_read` for members, the
-- permissive update policy plus the RESTRICTIVE writer gate from 20260728000007
-- for writes. This migration creates, alters and drops NO policy and adds no
-- table, so the policy and table counts in src/test/migrations/inventory.test.ts
-- and src/test/viewer-write-denial-guard.test.ts are unchanged by it.
--
-- THE PUBLIC PORTAL sees the flag but never a coordinate of the boundary. The
-- portal is told, above the map, that a pin has to be inside the area — so it
-- does not invite a pin it will refuse — and a refused submission is told the
-- same fact in words. Neither ever describes the geometry: a refusal must not be
-- an oracle for probing an agency's boundary.

ALTER TABLE engagement_campaigns
  ADD COLUMN IF NOT EXISTS submission_geofence_enabled BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  -- The flag may only be true where a complete extent exists to test against.
  -- Every existing row has the column's FALSE default, so this validates
  -- immediately against the current table.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'engagement_campaigns_geofence_needs_area'
  ) THEN
    ALTER TABLE engagement_campaigns
      ADD CONSTRAINT engagement_campaigns_geofence_needs_area
      CHECK (
        submission_geofence_enabled IS NOT TRUE
        OR num_nulls(place_min_lon, place_min_lat, place_max_lon, place_max_lat) = 0
      );
  END IF;
END
$$;

COMMENT ON COLUMN engagement_campaigns.submission_geofence_enabled IS
  'Opt-in: when true, a public submission carrying a coordinate is refused unless that coordinate falls inside this campaign''s place of record (place_* / 20260729000003). FALSE by default and for every campaign that existed before this migration, because turning a location rule on for a consultation whose operator never asked for one silently refuses residents. A submission with NO coordinate is always accepted regardless — a comment with no pin has no location to be outside of, and refusing those would silence everyone who did not use the map. Enforced against the bounding box first and the boundary polygon second; the constraint engagement_campaigns_geofence_needs_area makes the flag unstorable without an extent, so a check that cannot run can never look like one that is running.';
