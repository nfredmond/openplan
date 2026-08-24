-- Record whether the workspace's stage-gate template was selected by a person,
-- matched from its home jurisdiction, or applied as the interim default.
--
-- Existing rows stay NULL. Before this column existed, a stored template id
-- could have come from a database default or a deliberate operator choice. No
-- backfill can recover that intent, so NULL means "historical provenance
-- unknown" and the read side keeps its legacy reconciliation behavior.

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS stage_gate_template_selection TEXT;

ALTER TABLE workspaces
  ALTER COLUMN stage_gate_template_selection
  SET DEFAULT 'interim_unconfigured_default';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'workspaces_stage_gate_template_selection_check'
  ) THEN
    ALTER TABLE workspaces
      ADD CONSTRAINT workspaces_stage_gate_template_selection_check
      CHECK (
        stage_gate_template_selection IS NULL
        OR stage_gate_template_selection IN (
          'explicitly_requested',
          'jurisdiction_matched',
          'interim_unconfigured_default'
        )
      );
  END IF;
END
$$;

-- `workspaces` already has member-scoped RLS. This additive column inherits the
-- existing policies; this migration does not widen or replace them.
