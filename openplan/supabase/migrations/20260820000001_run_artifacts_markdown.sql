-- Agreement reports are emitted as Markdown alongside their JSON and GeoJSON.
-- The private run-artifacts bucket originally omitted text/markdown, causing
-- the worker to register a local-only fallback that the authenticated run page
-- could not retrieve. Preserve the existing allowlist and add this one format.
UPDATE storage.buckets
SET allowed_mime_types = CASE
  WHEN allowed_mime_types IS NULL THEN NULL
  WHEN NOT ('text/markdown' = ANY(allowed_mime_types))
    THEN array_append(allowed_mime_types, 'text/markdown')
  ELSE allowed_mime_types
END
WHERE id = 'run-artifacts';
