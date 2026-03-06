-- OP-003 v0.2 closure control:
-- Persist PASS/HOLD stage-gate decisions (including rationale + missing artifact metadata)
-- and expose authenticated queryability via workspace membership.

CREATE TABLE IF NOT EXISTS stage_gate_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  run_id UUID REFERENCES runs(id) ON DELETE SET NULL,
  gate_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('PASS', 'HOLD')),
  rationale TEXT NOT NULL,
  missing_artifacts JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  decided_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stage_gate_decisions_workspace_time
  ON stage_gate_decisions(workspace_id, decided_at DESC);

CREATE INDEX IF NOT EXISTS idx_stage_gate_decisions_run_time
  ON stage_gate_decisions(run_id, decided_at DESC);

ALTER TABLE stage_gate_decisions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'stage_gate_decisions'
      AND policyname = 'stage_gate_decisions_read'
  ) THEN
    CREATE POLICY stage_gate_decisions_read ON stage_gate_decisions
      FOR SELECT USING (
        workspace_id IN (
          SELECT workspace_id
          FROM workspace_members
          WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'stage_gate_decisions'
      AND policyname = 'stage_gate_decisions_insert'
  ) THEN
    CREATE POLICY stage_gate_decisions_insert ON stage_gate_decisions
      FOR INSERT WITH CHECK (
        decided_by = auth.uid()
        AND workspace_id IN (
          SELECT workspace_id
          FROM workspace_members
          WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;
