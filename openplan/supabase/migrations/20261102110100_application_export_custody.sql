-- Application export custody: keep the PDF hash and the SS4A appendix
-- manifest on the export row (KI-2026-10-12-014 follow-up from PR 400).
--
-- The application export route already computes the SHA-256 of the stored PDF
-- and, for an SS4A application, a manifest of which evidence appendices were
-- included, missing, unreadable or not selected, with each source record's id
-- and stored hash. Until now both went only into the 201 response and the
-- audit log, so a planner reading the export register later could not check a
-- downloaded PDF against the record of what was exported.
--
-- Both columns are nullable. Exports made before this migration keep NULL,
-- which means "not recorded", never "no hash". Non-SS4A exports keep a NULL
-- manifest because they carry no evidence appendices.
--
-- sha256, when present, must be 64 lowercase hex characters (the route's
-- Node digest('hex') output and the format funding_award_handoff_sources
-- already uses). The manifest, when present, must be a JSON array.
--
-- Permissions are unchanged: members of the workspace read and insert
-- (append-only) under the existing policies and the existing table-level
-- SELECT, INSERT grant to authenticated, which covers new columns. No UPDATE
-- or DELETE is granted, and the handoff source guard still refuses changes to
-- an export row that supports award terms.
--
-- Additive: two nullable columns and two CHECK constraints. Every existing
-- row has NULL in both columns, so both constraints validate without a
-- rewrite.

ALTER TABLE public.funding_opportunity_application_exports
  ADD COLUMN IF NOT EXISTS sha256 text,
  ADD COLUMN IF NOT EXISTS appendix_manifest_json jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.funding_opportunity_application_exports'::regclass
      AND conname = 'fo_application_exports_sha256_format'
  ) THEN
    ALTER TABLE public.funding_opportunity_application_exports
      ADD CONSTRAINT fo_application_exports_sha256_format
      CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.funding_opportunity_application_exports'::regclass
      AND conname = 'fo_application_exports_appendix_manifest_array'
  ) THEN
    ALTER TABLE public.funding_opportunity_application_exports
      ADD CONSTRAINT fo_application_exports_appendix_manifest_array
      CHECK (appendix_manifest_json IS NULL OR jsonb_typeof(appendix_manifest_json) = 'array');
  END IF;
END
$$;

COMMENT ON COLUMN public.funding_opportunity_application_exports.sha256 IS
  'SHA-256 (lowercase hex) of the stored PDF bytes, written by the export route. NULL on exports made before 20261102110100: not recorded.';
COMMENT ON COLUMN public.funding_opportunity_application_exports.appendix_manifest_json IS
  'SS4A evidence appendix manifest (key, status, source id, source hash, map drawn) written by the export route. NULL for non-SS4A exports and exports made before 20261102110100.';
