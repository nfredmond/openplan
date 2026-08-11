-- Aerial custody georeferencing — where on Earth a held orthomosaic sits.
--
-- WHAT THIS CLOSES. Custody (20260730000004) made the BYTES of a processed
-- flight survive the worker's expiring links, but recorded nothing about where
-- those bytes belong on a map. An orthomosaic OpenPlan holds could be
-- downloaded and opened in GIS, and could not be drawn on the mission's own
-- page — the one place a planner would look for it. The processing worker has
-- the file locally and can read its GeoTIFF tags; the v1.1 contract lets a
-- callback artifact carry `boundsWgs84` / `crs` / `pixelSizeM`, and these
-- columns are where that report lands.
--
-- ABSENT IS NULL IS A REFUSAL, BY DESIGN. The external worker (contract v1)
-- sends none of these fields, so the columns stay NULL, and the mission map
-- must then say "the orthomosaic is held, but its georeferencing was not
-- reported by the processing worker; the map cannot place it" — never infer a
-- position, never mount a broken layer. Nothing in this migration backfills.
--
-- `crs` IS PROVENANCE, NOT GEOMETRY. It records the NATIVE CRS of the GeoTIFF
-- (e.g. EPSG:32610) as the worker read it; the bounds columns are ALREADY
-- reprojected to WGS84 by the worker before they arrive. Free text, no
-- vocabulary CHECK: the EPSG registry is external reference data, and freezing
-- a subset of it into SQL would refuse a real CRS somewhere on Earth.

------------------------------------------------------------------------------
-- 1. Georeference columns on the custody ledger.
------------------------------------------------------------------------------
ALTER TABLE aerial_artifact_custody
  ADD COLUMN IF NOT EXISTS bounds_west  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS bounds_south DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS bounds_east  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS bounds_north DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS crs          TEXT,
  ADD COLUMN IF NOT EXISTS pixel_size_m NUMERIC;

-- All four bounds or none. A partial rectangle is not a smaller fact — it is
-- unplaceable, and a row carrying two of four corners would let a reader
-- believe georeferencing exists that the map can never use.
ALTER TABLE aerial_artifact_custody
  DROP CONSTRAINT IF EXISTS aerial_artifact_custody_bounds_all_or_none;
ALTER TABLE aerial_artifact_custody
  ADD CONSTRAINT aerial_artifact_custody_bounds_all_or_none CHECK (
    (bounds_west IS NULL AND bounds_south IS NULL AND bounds_east IS NULL AND bounds_north IS NULL)
    OR
    (bounds_west IS NOT NULL AND bounds_south IS NOT NULL AND bounds_east IS NOT NULL AND bounds_north IS NOT NULL)
  );

-- WGS84 sanity: bounds that are present must be coordinates that exist and a
-- rectangle that opens the right way. The app-side validator is stricter
-- (plausible span for a drone product); this is the floor below which a row is
-- not a georeference at all.
ALTER TABLE aerial_artifact_custody
  DROP CONSTRAINT IF EXISTS aerial_artifact_custody_bounds_are_wgs84;
ALTER TABLE aerial_artifact_custody
  ADD CONSTRAINT aerial_artifact_custody_bounds_are_wgs84 CHECK (
    bounds_west IS NULL OR (
      bounds_west  >= -180 AND bounds_west  <= 180
      AND bounds_east  >= -180 AND bounds_east  <= 180
      AND bounds_south >= -90  AND bounds_south <= 90
      AND bounds_north >= -90  AND bounds_north <= 90
      AND bounds_west < bounds_east
      AND bounds_south < bounds_north
    )
  );

ALTER TABLE aerial_artifact_custody
  DROP CONSTRAINT IF EXISTS aerial_artifact_custody_pixel_size_positive;
ALTER TABLE aerial_artifact_custody
  ADD CONSTRAINT aerial_artifact_custody_pixel_size_positive CHECK (
    pixel_size_m IS NULL OR pixel_size_m > 0
  );

------------------------------------------------------------------------------
-- 2. Admit the ortho_preview artifact kind.
------------------------------------------------------------------------------
-- Contract v1.1 adds `ortho_preview` — a worker-produced PNG rendering of the
-- orthomosaic that a browser can consume directly (a GeoTIFF cannot be shown
-- by Mapbox without a tiler, which is another always-on operator service and
-- was deliberately deferred). The preview goes through the SAME custody pass as
-- every other artifact: bytes into aerial-artifacts, a ledger row here.
-- Without this widening the callback's custody upsert would violate the kind
-- CHECK and the preview would be the one artifact custody silently cannot hold.
ALTER TABLE aerial_artifact_custody
  DROP CONSTRAINT IF EXISTS aerial_artifact_custody_kind_check;
ALTER TABLE aerial_artifact_custody
  ADD CONSTRAINT aerial_artifact_custody_kind_check CHECK (
    kind IN ('orthomosaic', 'dsm', 'dtm', 'point_cloud', 'mesh', 'ortho_preview')
  );

COMMENT ON COLUMN aerial_artifact_custody.bounds_west IS
  'WGS84 west edge of the artifact, as REPORTED by the processing worker from the file''s own GeoTIFF tags (contract v1.1). NULL means the worker did not report georeferencing — the map refuses to place the artifact rather than inferring; it never means 0.';
COMMENT ON COLUMN aerial_artifact_custody.crs IS
  'The NATIVE CRS of the stored file as the worker read it (e.g. EPSG:32610) — provenance for the bounds, which are already reprojected to WGS84. Free text on purpose: the EPSG registry is external reference data, not a vocabulary to freeze into SQL.';
COMMENT ON COLUMN aerial_artifact_custody.pixel_size_m IS
  'Ground pixel size in meters as reported by the processing worker. Display metadata, not a measurement instrument: measurement on the mission map is deliberately deferred.';
