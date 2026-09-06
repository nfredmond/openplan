-- File update evidence may be retained without a crash-coverage date.
-- Existing cutoff pairs and historical rows remain unchanged.
BEGIN;

ALTER TABLE public.safety_crash_ingests
  DROP CONSTRAINT safety_crash_ingests_cutoff_provenance_pair,
  ADD CONSTRAINT safety_crash_ingests_cutoff_provenance_pair CHECK (
    (published_through IS NULL AND published_through_provenance IS NULL)
    OR
    (published_through IS NOT NULL AND published_through_provenance IS NOT NULL
      AND published_through_provenance->>'basis' IS DISTINCT FROM 'resource_updates')
    OR
    COALESCE(
      published_through IS NULL
      AND jsonb_typeof(published_through_provenance) = 'object'
      AND published_through_provenance->>'basis' = 'resource_updates'
      AND jsonb_typeof(published_through_provenance->'resources') = 'array'
      AND jsonb_typeof(published_through_provenance->'sourceUrl') = 'string'
      AND nullif(btrim(published_through_provenance->>'sourceUrl'), '') IS NOT NULL
      AND jsonb_typeof(published_through_provenance->'label') = 'string'
      AND jsonb_typeof(published_through_provenance->'retrievedAt') = 'string',
      FALSE
    )
  );

COMMENT ON COLUMN public.safety_crash_ingests.published_through_provenance IS
  'Source publication evidence: a genuine coverage-date provenance pair, or resource_updates metadata with no coverage date. File modification timestamps are not crash coverage.';

COMMIT;
