-- OP-003 interim control:
-- Bind California stage-gate template selection through workspace bootstrap until
-- canonical project creation APIs/UI are available.
-- TODO(op-003-v0.2): move binding ownership to project-level creation records.

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS stage_gate_template_id TEXT NOT NULL DEFAULT 'ca_stage_gates_v0_1',
  ADD COLUMN IF NOT EXISTS stage_gate_template_version TEXT NOT NULL DEFAULT '0.1.0',
  ADD COLUMN IF NOT EXISTS stage_gate_binding_source TEXT NOT NULL DEFAULT 'workspace_bootstrap_interim',
  ADD COLUMN IF NOT EXISTS stage_gate_bound_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'workspaces_stage_gate_binding_source_check'
  ) THEN
    ALTER TABLE workspaces
      ADD CONSTRAINT workspaces_stage_gate_binding_source_check
      CHECK (stage_gate_binding_source IN ('workspace_bootstrap_interim', 'project_create_v0_2'));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'workspaces_stage_gate_template_id_nonempty'
  ) THEN
    ALTER TABLE workspaces
      ADD CONSTRAINT workspaces_stage_gate_template_id_nonempty
      CHECK (length(trim(stage_gate_template_id)) > 0);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_workspaces_stage_gate_template
  ON workspaces(stage_gate_template_id);
