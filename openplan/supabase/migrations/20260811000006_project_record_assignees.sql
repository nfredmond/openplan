-- Work a person is accountable for: an assignee on the four dated project
-- record types.
--
-- project_deliverables, project_milestones, project_submittals and
-- project_issues gain a nullable assignee_user_id. Until now the only way to
-- say who owns a piece of project work was owner_label — free text, which is
-- the right lane for a consultant, a partner agency or a name with no account,
-- and the wrong lane for "this is on Priya's list", because free text cannot be
-- queried, cannot be counted, and cannot survive someone spelling it
-- differently.
--
-- OWNER_LABEL STAYS. This is additive and the two lanes are different facts:
-- assignee_user_id is an accountable teammate with an account in this
-- workspace, owner_label is whoever else is on the hook. Both render, side by
-- side, and neither is ever presented as the other.
--
-- WHY ON DELETE SET NULL, AND WHY THAT DIVERGES FROM THE PERSON-FK PRECEDENT.
-- stage_gate_decisions.decided_by is UUID NOT NULL REFERENCES auth.users
-- ON DELETE RESTRICT (20260306000010): a signed gate verdict is a record of who
-- decided, a funder relies on it, and it may not become anonymous — so the
-- database refuses to delete the person instead. An assignment is the opposite
-- kind of fact. It is a forward-looking statement about who is going to do
-- something, not a signed record of who did; blocking the deletion of a
-- departed user because a deliverable still points at them would make removing
-- a person from a workspace fail for a reason nobody could act on. So this
-- column SETs NULL, and the divergence is deliberate rather than an oversight.
--
-- What the application must therefore do, and does: a row whose assignee id no
-- longer resolves to a current member renders the explicit departed sentence
-- ("Unassigned — previously a member") and counts as unassigned in work queues.
-- Never a stale name, never a blank. See src/lib/workspaces/roster.ts.
--
-- NO MEMBERSHIP CHECK OR TRIGGER, ON PURPOSE. Postgres cannot express "is a
-- member of the workspace this project belongs to" as a CHECK (it is a
-- multi-table question), and a trigger would be a second, drifting copy of an
-- authorization rule the write path already owns. Membership is enforced where
-- the write happens — the records POST/PATCH routes validate the assignee
-- against loadWorkspaceRoster() before writing — and this column carries the
-- weaker guarantee it can actually keep: the id is a real auth user.
--
-- Additive only: no drops, no backfill, no defaults.

ALTER TABLE project_deliverables
  ADD COLUMN IF NOT EXISTS assignee_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE project_milestones
  ADD COLUMN IF NOT EXISTS assignee_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE project_submittals
  ADD COLUMN IF NOT EXISTS assignee_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE project_issues
  ADD COLUMN IF NOT EXISTS assignee_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Partial indexes on (assignee, date): the question a personal work queue asks
-- is "what is assigned to me, soonest first", and the rows with no assignee are
-- the overwhelming majority — so the index only covers assigned rows.
-- project_issues carries no date column of its own (it never had one), so its
-- index orders by creation instead; the work queue renders issues as an undated
-- block rather than sorting them into deadline order.
CREATE INDEX IF NOT EXISTS project_deliverables_assignee_due_idx
  ON project_deliverables(assignee_user_id, due_date)
  WHERE assignee_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS project_milestones_assignee_target_idx
  ON project_milestones(assignee_user_id, target_date)
  WHERE assignee_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS project_submittals_assignee_due_idx
  ON project_submittals(assignee_user_id, due_date)
  WHERE assignee_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS project_issues_assignee_created_idx
  ON project_issues(assignee_user_id, created_at)
  WHERE assignee_user_id IS NOT NULL;

COMMENT ON COLUMN project_deliverables.assignee_user_id IS
  'Accountable teammate (auth.users). NULL means unassigned; owner_label is the separate free-text lane for external parties. SET NULL on user delete: an assignment is forward-looking, unlike stage_gate_decisions.decided_by which RESTRICTs.';
COMMENT ON COLUMN project_milestones.assignee_user_id IS
  'Accountable teammate (auth.users). NULL means unassigned; owner_label is the separate free-text lane for external parties.';
COMMENT ON COLUMN project_submittals.assignee_user_id IS
  'Accountable teammate (auth.users). NULL means unassigned; agency_label names the reviewing agency, which is a different fact.';
COMMENT ON COLUMN project_issues.assignee_user_id IS
  'Accountable teammate (auth.users). NULL means unassigned; owner_label is the separate free-text lane for external parties.';
