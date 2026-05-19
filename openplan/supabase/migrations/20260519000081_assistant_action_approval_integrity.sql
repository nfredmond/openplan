ALTER TABLE public.assistant_action_executions
  ADD COLUMN IF NOT EXISTS approval_id UUID,
  ADD COLUMN IF NOT EXISTS input_hash TEXT,
  ADD COLUMN IF NOT EXISTS execution_source TEXT NOT NULL DEFAULT 'manual'
    CHECK (execution_source IN ('manual', 'planner_agent_quick_link'));

DROP POLICY IF EXISTS assistant_action_executions_workspace_write
  ON public.assistant_action_executions;

CREATE TABLE IF NOT EXISTS public.assistant_action_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_kind TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.assistant_action_approvals ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS assistant_action_approvals_user_idx
  ON public.assistant_action_approvals(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS assistant_action_approvals_unconsumed_idx
  ON public.assistant_action_approvals(id, expires_at)
  WHERE consumed_at IS NULL;
