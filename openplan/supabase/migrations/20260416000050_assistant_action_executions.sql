-- T6 (2026-04-16 deep-dive): per-execution audit trail for planner-agent
-- actions dispatched through the canonical executeAction wrapper. Every run
-- writes one row so RTP/grants/evidence can answer "who fired what, when,
-- with what outcome" without reading app logs.

CREATE TABLE IF NOT EXISTS assistant_action_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action_kind TEXT NOT NULL,
  audit_event TEXT NOT NULL,
  approval TEXT NOT NULL CHECK (approval IN ('safe', 'review', 'approval_required')),
  regrounding TEXT NOT NULL CHECK (regrounding IN ('refresh_preview', 'none')),
  outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'failed')),
  error_message TEXT,
  input_summary JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assistant_action_executions_workspace_idx
  ON assistant_action_executions (workspace_id, completed_at DESC);

CREATE INDEX IF NOT EXISTS assistant_action_executions_kind_idx
  ON assistant_action_executions (action_kind, completed_at DESC);

ALTER TABLE assistant_action_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY assistant_action_executions_workspace_read ON assistant_action_executions
  FOR SELECT
  USING (
    workspace_id IS NULL
    OR EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = assistant_action_executions.workspace_id
        AND workspace_members.user_id = auth.uid()
    )
  );

CREATE POLICY assistant_action_executions_workspace_write ON assistant_action_executions
  FOR INSERT
  WITH CHECK (
    workspace_id IS NULL
    OR EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = assistant_action_executions.workspace_id
        AND workspace_members.user_id = auth.uid()
    )
  );
