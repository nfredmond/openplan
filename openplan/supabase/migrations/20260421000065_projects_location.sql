-- Phase 3 Slice D — project markers on the cartographic backdrop.
--
-- Adds simple nullable latitude/longitude columns to `projects` so the
-- backdrop can render project markers without needing a PostGIS geometry
-- column. Projects volume is small (≤ thousands per workspace) and the
-- map uses these columns for display only — never for spatial queries —
-- so numeric lat/lng is cheaper to populate and read than geography(Point).
--
-- Both columns are nullable so existing rows remain valid; the map-
-- features route filters out nulls before returning a FeatureCollection.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS latitude NUMERIC,
  ADD COLUMN IF NOT EXISTS longitude NUMERIC;

-- Cheap sanity bounds. NOT VALID would let the constraint skip legacy
-- rows, but there are no legacy populated rows yet so we can validate
-- up front.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'projects_latitude_range_chk'
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_latitude_range_chk
      CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'projects_longitude_range_chk'
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_longitude_range_chk
      CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180));
  END IF;
END
$$;

COMMENT ON COLUMN projects.latitude IS
  'Optional display latitude (WGS84). Used by /api/map-features/projects for backdrop markers; not a spatial-query index.';
COMMENT ON COLUMN projects.longitude IS
  'Optional display longitude (WGS84). Used by /api/map-features/projects for backdrop markers; not a spatial-query index.';
