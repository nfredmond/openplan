-- Jurisdiction-neutral reimbursement-profile columns on billing_invoice_records.
--
-- The table hardcoded California: caltrans_posture carried a Caltrans-specific
-- CHECK vocabulary on every invoice row, no matter where the workspace works.
-- The reimbursement-profile registry (src/lib/invoicing/reimbursement-profiles.ts)
-- makes that vocabulary a per-jurisdiction data artifact, so the row now stores:
--
--   reimbursement_profile_id        which profile's process the draw is logged under
--   reimbursement_posture           a posture id from THAT profile's vocabulary
--   reimbursement_profile_selection how the profile was chosen (provenance):
--                                   explicitly_requested | jurisdiction_matched |
--                                   interim_unconfigured_default
--
-- Deliberately NO jurisdiction-vocabulary CHECK on reimbursement_posture: the
-- valid posture set belongs to the profile, and profiles grow by registering a
-- descriptor, never by editing a constraint. The API validates a posture
-- against the resolved profile's own options before writing.
--
-- caltrans_posture STAYS, untouched and inert: migrations here never drop, and
-- its DEFAULT keeps inserts from not-yet-updated deployments valid. New code
-- reads it only as the legacy fallback for rows that predate the backfill.

ALTER TABLE billing_invoice_records
  ADD COLUMN IF NOT EXISTS reimbursement_profile_id TEXT;

ALTER TABLE billing_invoice_records
  ADD COLUMN IF NOT EXISTS reimbursement_posture TEXT;

ALTER TABLE billing_invoice_records
  ADD COLUMN IF NOT EXISTS reimbursement_profile_selection TEXT;

-- Selection provenance is a closed vocabulary (it is code-level semantics, not
-- jurisdiction data), so it does get a CHECK. NULL stays legal: rows written by
-- a deployment that predates the profile seam carry no provenance claim.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'billing_invoice_records_profile_selection_known'
      AND conrelid = 'public.billing_invoice_records'::regclass
  ) THEN
    ALTER TABLE billing_invoice_records
      ADD CONSTRAINT billing_invoice_records_profile_selection_known CHECK (
        reimbursement_profile_selection IS NULL
        OR reimbursement_profile_selection IN (
          'explicitly_requested',
          'jurisdiction_matched',
          'interim_unconfigured_default'
        )
      );
  END IF;
END $$;

-- Coherence: a posture is meaningless without the profile whose vocabulary it
-- belongs to. A profile with no posture recorded yet is fine; the reverse is
-- not. An entirely unset row satisfies the constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'billing_invoice_records_posture_requires_profile'
      AND conrelid = 'public.billing_invoice_records'::regclass
  ) THEN
    ALTER TABLE billing_invoice_records
      ADD CONSTRAINT billing_invoice_records_posture_requires_profile CHECK (
        reimbursement_posture IS NULL OR reimbursement_profile_id IS NOT NULL
      );
  END IF;
END $$;

-- Backfill. Every pre-profile row was written under the Caltrans LAPM posture
-- vocabulary — that is a fact about the rows, not a preference: caltrans_posture
-- was the only vocabulary the schema could store. Marking the selection
-- interim_unconfigured_default is the honest provenance for all of them: no
-- workspace ever chose that profile; the schema imposed it.
UPDATE billing_invoice_records
SET
  reimbursement_profile_id = 'us_ca_lapm_reimbursement_v1',
  reimbursement_posture = caltrans_posture,
  reimbursement_profile_selection = 'interim_unconfigured_default'
WHERE reimbursement_profile_id IS NULL;
