-- Phase 3 Slice I — RTP cycle pins on the cartographic backdrop.
--
-- Adds nullable anchor_latitude / anchor_longitude columns to rtp_cycles so
-- the backdrop can render an RTP cycle as a single map pin located at the
-- planning area's geographic anchor (typically the county seat or planning
-- area centroid). Display-only — never a spatial-query subject — so numeric
-- lat/lng is cheaper than geography(Point), matching the pattern used for
-- `projects.latitude` / `.longitude` in migration 20260421000065.
--
-- Both columns are nullable so existing cycles remain valid; the map-
-- features route filters out nulls before returning a FeatureCollection.
-- A cycle without an anchor simply won't render a pin — its chapters and
-- metadata stay reachable via the normal /rtp/{rtpCycleId} routes.

ALTER TABLE rtp_cycles
  ADD COLUMN IF NOT EXISTS anchor_latitude NUMERIC,
  ADD COLUMN IF NOT EXISTS anchor_longitude NUMERIC;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rtp_cycles_anchor_latitude_range_chk'
  ) THEN
    ALTER TABLE rtp_cycles
      ADD CONSTRAINT rtp_cycles_anchor_latitude_range_chk
      CHECK (anchor_latitude IS NULL OR (anchor_latitude >= -90 AND anchor_latitude <= 90));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rtp_cycles_anchor_longitude_range_chk'
  ) THEN
    ALTER TABLE rtp_cycles
      ADD CONSTRAINT rtp_cycles_anchor_longitude_range_chk
      CHECK (anchor_longitude IS NULL OR (anchor_longitude >= -180 AND anchor_longitude <= 180));
  END IF;
END
$$;

COMMENT ON COLUMN rtp_cycles.anchor_latitude IS
  'Optional display latitude (WGS84). Used by /api/map-features/rtp-cycles for backdrop pins; not a spatial-query index.';
COMMENT ON COLUMN rtp_cycles.anchor_longitude IS
  'Optional display longitude (WGS84). Used by /api/map-features/rtp-cycles for backdrop pins; not a spatial-query index.';
