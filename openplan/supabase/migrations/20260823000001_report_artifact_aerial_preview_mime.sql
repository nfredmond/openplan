-- Report packets may freeze a planner-selected orthophoto preview alongside
-- their HTML/PDF artifact. Preserve every MIME type already admitted by an
-- installation and add PNG only when the bucket uses an explicit allowlist.
-- A NULL allowlist already permits every type and needs no change.
UPDATE storage.buckets
SET allowed_mime_types = array_append(allowed_mime_types, 'image/png')
WHERE id = 'report-artifacts'
  AND allowed_mime_types IS NOT NULL
  AND NOT ('image/png' = ANY(allowed_mime_types));
