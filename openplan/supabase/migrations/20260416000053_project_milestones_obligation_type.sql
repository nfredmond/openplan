-- Extend project_milestones.milestone_type to include 'obligation'
-- so funding award creation can emit an obligation-tracking milestone.

ALTER TABLE project_milestones
  DROP CONSTRAINT IF EXISTS project_milestones_milestone_type_check;

ALTER TABLE project_milestones
  ADD CONSTRAINT project_milestones_milestone_type_check
  CHECK (
    milestone_type IN (
      'authorization',
      'agreement',
      'schedule',
      'hearing',
      'invoice',
      'deliverable',
      'decision',
      'permit',
      'closeout',
      'obligation',
      'other'
    )
  );

-- Optional uniqueness: at most one 'obligation' milestone per funding award,
-- keyed via a new nullable funding_award_id reference (used only for the
-- award→milestone link, nothing pre-existing).
ALTER TABLE project_milestones
  ADD COLUMN IF NOT EXISTS funding_award_id UUID REFERENCES funding_awards(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS project_milestones_funding_award_obligation_idx
  ON project_milestones (funding_award_id)
  WHERE milestone_type = 'obligation' AND funding_award_id IS NOT NULL;
