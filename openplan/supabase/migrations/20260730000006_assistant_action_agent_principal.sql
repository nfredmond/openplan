-- The Planner Agent becomes a DISTINCT PRINCIPAL in the action ledger.
--
-- WHAT WAS WRONG. `assistant_action_executions` recorded exactly one person per
-- row — `user_id` — and one weak hint about how the write was fired,
-- `execution_source` ('manual' | 'planner_agent_quick_link'). Read back, a row
-- said "nfredmond did this, via the agent". The thing that actually happened is
-- "the Planner Agent drafted this; nfredmond approved it at 14:02; it executed
-- under nfredmond's authority". Those are three different facts and the table
-- could state only one of them.
--
-- That distinction is not bookkeeping. When a grant narrative, a CEQA
-- determination, or a stage-gate verdict is challenged, "who wrote this" is a
-- question with legal weight, and an audit trail that answers it with a person's
-- name when a model composed the text is not merely incomplete — it is wrong in
-- the direction that matters. Authorization does not erase authorship.
--
-- WHAT THIS ADDS.
--   actor_kind          who AUTHORED the action's content.
--   actor_agent_id      which agent principal, when the author is not a person.
--                       A stable identifier rather than a display name, so a
--                       later principal (a Buzz-hosted agent with its own
--                       keypair) is a new value here and not a schema change.
--   approved_by_user_id the person who approved it, denormalised from the
--                       consumed `assistant_action_approvals` row so the ledger
--                       row is self-describing in an export.
--   approved_at         when they approved — NOT when it executed. The gap
--                       between the two is itself evidence.
--
-- `user_id` keeps its existing meaning and is deliberately NOT redefined: the
-- authenticated session the write executed under. Rewriting the meaning of a
-- populated column is how an audit trail becomes unreadable at the version
-- boundary.
--
-- NOTE ON HONESTY. `actor_kind` is derived server-side from the request's
-- execution source, exactly like `execution_source`. It is not a second,
-- independently-verified fact and must not be presented as one; what it adds is
-- a place for a real agent identity to land, and the coherence CHECK below that
-- makes an unattributed agent row unstorable.

ALTER TABLE public.assistant_action_executions
  ADD COLUMN IF NOT EXISTS actor_kind TEXT NOT NULL DEFAULT 'user'
    CHECK (actor_kind IN ('user', 'planner_agent')),
  ADD COLUMN IF NOT EXISTS actor_agent_id TEXT,
  ADD COLUMN IF NOT EXISTS approved_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- An agent-authored row must name its principal, and a person-authored row must
-- not claim one. Without this, "actor_kind = 'planner_agent', actor_agent_id =
-- NULL" would be storable — an agent-authored record that cannot say which agent,
-- which is the state this whole migration exists to end.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'assistant_action_executions_actor_identity'
  ) THEN
    ALTER TABLE public.assistant_action_executions
      ADD CONSTRAINT assistant_action_executions_actor_identity CHECK (
        (actor_kind = 'planner_agent' AND actor_agent_id IS NOT NULL)
        OR (actor_kind = 'user' AND actor_agent_id IS NULL)
      );
  END IF;
END
$$;

-- An approval timestamp with nobody attached, or an approver with no time, is a
-- half-recorded consent. Both or neither.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'assistant_action_executions_approval_pair'
  ) THEN
    ALTER TABLE public.assistant_action_executions
      ADD CONSTRAINT assistant_action_executions_approval_pair CHECK (
        (approved_by_user_id IS NULL) = (approved_at IS NULL)
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS assistant_action_executions_actor_idx
  ON public.assistant_action_executions (workspace_id, actor_kind, completed_at DESC);

COMMENT ON COLUMN public.assistant_action_executions.actor_kind IS
  'Who AUTHORED this action''s content: ''user'' when a person composed it, ''planner_agent'' when the Planner Agent proposed it and a person only approved it. Distinct from user_id, which is the authenticated session the write executed under. Derived server-side from the request execution source — never read from a client-supplied field.';

COMMENT ON COLUMN public.assistant_action_executions.actor_agent_id IS
  'Stable identifier of the agent principal that authored the action (for example ''openplan.planner_agent''). NULL exactly when actor_kind = ''user''. An identifier rather than a label so a future agent with its own credential is a new value, not a schema change.';

COMMENT ON COLUMN public.assistant_action_executions.approved_by_user_id IS
  'The person who approved this action, copied from the consumed assistant_action_approvals row. NULL when the action''s tier required no approval — which is itself the fact worth recording: nobody approved it, because nothing asked anyone to.';

COMMENT ON COLUMN public.assistant_action_executions.approved_at IS
  'When approval was granted — not when the action executed. The interval between approved_at and completed_at is evidence in its own right when an approval is later disputed.';
