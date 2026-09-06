-- Each acquisition retains its own observations. Existing rows stay unchanged;
-- overwritten historical membership cannot be reconstructed from newer pulls.
BEGIN;

ALTER TABLE public.safety_crashes
  DROP CONSTRAINT safety_crashes_source_external_uniq,
  ADD CONSTRAINT safety_crashes_source_external_uniq
    UNIQUE (workspace_id, ingest_id, source_id, external_id);
ALTER TABLE public.safety_crash_parties
  DROP CONSTRAINT safety_crash_parties_source_external_uniq,
  ADD CONSTRAINT safety_crash_parties_source_external_uniq
    UNIQUE (workspace_id, ingest_id, source_id, external_party_id);

-- Source totals are not necessarily stored totals when retrieval is truncated.
-- Null on legacy acquisitions means the exact stored total was not recorded.
ALTER TABLE public.safety_crash_ingests
  ADD COLUMN stored_count integer CHECK (stored_count >= 0);

-- Workspace map layers show one latest observation per source case, while
-- acquisition-specific readers continue to use the original table.
CREATE VIEW public.safety_crashes_latest WITH (security_invoker = true) AS
  SELECT DISTINCT ON (workspace_id, source_id, external_id) *
  FROM public.safety_crashes
  ORDER BY workspace_id, source_id, external_id, ingested_at DESC, id DESC;
GRANT SELECT ON public.safety_crashes_latest TO authenticated, service_role;

COMMIT;
