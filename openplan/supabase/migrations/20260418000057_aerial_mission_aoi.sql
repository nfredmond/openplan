-- Aerial mission AOI authoring: add a nullable GeoJSON polygon column.
--
-- Phase G of the 2026-04-18 forward-motion plan. The existing
-- aerial_missions table has geography_label (TEXT) as the only
-- location hint. This column stores a hand-drawn polygon so missions
-- can be exported as DJI waypoint JSON and linked to corridor
-- geometry.
--
-- Stored as JSONB (not PostGIS geometry) because:
-- 1. The app layer already handles GeoJSON end-to-end.
-- 2. Downstream consumers (DJI export) want GeoJSON, not WKT.
-- 3. Nullable keeps existing rows valid without backfill.
--
-- If/when spatial queries become needed (e.g., "which missions
-- cover this corridor?"), a follow-up migration can add a computed
-- geometry column backed by ST_GeomFromGeoJSON(aoi_geojson).

ALTER TABLE aerial_missions
  ADD COLUMN IF NOT EXISTS aoi_geojson JSONB;

COMMENT ON COLUMN aerial_missions.aoi_geojson IS
  'Hand-drawn AOI polygon as GeoJSON Geometry. Expected shape: {"type":"Polygon","coordinates":[[[lng,lat],...]]}. NULL when the mission has no authored geometry yet.';
