-- T9 (2026-04-16 deep-dive): persist aerial posture on projects so that
-- project/reports surfaces can read posture without N+1 mission/package
-- aggregations.  The evidence-package write path rebuilds this column via
-- buildAerialProjectPosture() so readers see an authoritative cached value.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS aerial_posture JSONB,
  ADD COLUMN IF NOT EXISTS aerial_posture_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS projects_aerial_posture_updated_at_idx
  ON projects (aerial_posture_updated_at DESC)
  WHERE aerial_posture IS NOT NULL;
