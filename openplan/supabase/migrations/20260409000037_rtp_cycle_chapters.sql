CREATE TABLE IF NOT EXISTS rtp_cycle_chapters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  rtp_cycle_id UUID NOT NULL REFERENCES rtp_cycles(id) ON DELETE CASCADE,
  chapter_key TEXT NOT NULL,
  title TEXT NOT NULL,
  section_type TEXT NOT NULL DEFAULT 'other' CHECK (
    section_type IN ('policy', 'action', 'financial', 'engagement', 'performance', 'resilience', 'compliance', 'other')
  ),
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (
    status IN ('not_started', 'in_progress', 'ready_for_review', 'complete')
  ),
  sort_order INTEGER NOT NULL DEFAULT 0,
  required BOOLEAN NOT NULL DEFAULT true,
  guidance TEXT,
  summary TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(rtp_cycle_id, chapter_key)
);

CREATE INDEX IF NOT EXISTS idx_rtp_cycle_chapters_cycle_sort_order
  ON rtp_cycle_chapters(rtp_cycle_id, sort_order ASC, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_rtp_cycle_chapters_workspace_updated_at
  ON rtp_cycle_chapters(workspace_id, updated_at DESC);

ALTER TABLE rtp_cycle_chapters ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'rtp_cycle_chapters'
      AND policyname = 'rtp_cycle_chapters_read'
  ) THEN
    CREATE POLICY rtp_cycle_chapters_read ON rtp_cycle_chapters
      FOR SELECT USING (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'rtp_cycle_chapters'
      AND policyname = 'rtp_cycle_chapters_insert'
  ) THEN
    CREATE POLICY rtp_cycle_chapters_insert ON rtp_cycle_chapters
      FOR INSERT WITH CHECK (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'rtp_cycle_chapters'
      AND policyname = 'rtp_cycle_chapters_update'
  ) THEN
    CREATE POLICY rtp_cycle_chapters_update ON rtp_cycle_chapters
      FOR UPDATE USING (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
      )
      WITH CHECK (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'rtp_cycle_chapters'
      AND policyname = 'rtp_cycle_chapters_delete'
  ) THEN
    CREATE POLICY rtp_cycle_chapters_delete ON rtp_cycle_chapters
      FOR DELETE USING (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION set_rtp_cycle_chapters_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rtp_cycle_chapters_updated_at ON rtp_cycle_chapters;
CREATE TRIGGER trg_rtp_cycle_chapters_updated_at
BEFORE UPDATE ON rtp_cycle_chapters
FOR EACH ROW
EXECUTE FUNCTION set_rtp_cycle_chapters_updated_at();

CREATE OR REPLACE FUNCTION seed_default_rtp_cycle_chapters()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO rtp_cycle_chapters (
    workspace_id,
    rtp_cycle_id,
    chapter_key,
    title,
    section_type,
    status,
    sort_order,
    required,
    guidance,
    created_by
  )
  SELECT
    NEW.workspace_id,
    NEW.id,
    template.chapter_key,
    template.title,
    template.section_type,
    'not_started',
    template.sort_order,
    template.required,
    template.guidance,
    NEW.created_by
  FROM (
    VALUES
      ('vision_goals_policy', 'Vision, goals, and policy framework', 'policy', 10, true, 'Capture the policy element, goals, objectives, and performance direction that explain why the RTP exists.'),
      ('action_element', 'Action element and implementation approach', 'action', 20, true, 'Describe implementation actions, delivery posture, partners, and how the RTP translates into near- and mid-term work.'),
      ('financial_element', 'Financial element and fiscal constraint', 'financial', 30, true, 'Track revenue assumptions, year-of-expenditure logic, fiscal constraint, and the bridge between constrained and illustrative programs.'),
      ('project_portfolio', 'Project portfolio and prioritization', 'performance', 40, true, 'Summarize constrained, illustrative, and candidate projects with prioritization logic tied back to adopted goals.'),
      ('consultation_engagement', 'Consultation, tribal coordination, and public engagement', 'engagement', 50, true, 'Record public involvement, interagency consultation, and tribal coordination as a first-class RTP output.'),
      ('safety_resilience', 'Safety, resilience, and emergency preparedness', 'resilience', 60, true, 'Cover transportation safety, emergency preparedness, and rural resilience posture required for the RTP narrative.'),
      ('adoption_compliance_appendix', 'Adoption package and compliance appendix', 'compliance', 70, true, 'Assemble checklist, resolutions, comment-response materials, and board-ready compliance artifacts.')
  ) AS template(chapter_key, title, section_type, sort_order, required, guidance)
  ON CONFLICT (rtp_cycle_id, chapter_key) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_seed_default_rtp_cycle_chapters ON rtp_cycles;
CREATE TRIGGER trg_seed_default_rtp_cycle_chapters
AFTER INSERT ON rtp_cycles
FOR EACH ROW
EXECUTE FUNCTION seed_default_rtp_cycle_chapters();

INSERT INTO rtp_cycle_chapters (
  workspace_id,
  rtp_cycle_id,
  chapter_key,
  title,
  section_type,
  status,
  sort_order,
  required,
  guidance,
  created_by
)
SELECT
  cycles.workspace_id,
  cycles.id,
  template.chapter_key,
  template.title,
  template.section_type,
  'not_started',
  template.sort_order,
  template.required,
  template.guidance,
  cycles.created_by
FROM rtp_cycles AS cycles
CROSS JOIN (
  VALUES
    ('vision_goals_policy', 'Vision, goals, and policy framework', 'policy', 10, true, 'Capture the policy element, goals, objectives, and performance direction that explain why the RTP exists.'),
    ('action_element', 'Action element and implementation approach', 'action', 20, true, 'Describe implementation actions, delivery posture, partners, and how the RTP translates into near- and mid-term work.'),
    ('financial_element', 'Financial element and fiscal constraint', 'financial', 30, true, 'Track revenue assumptions, year-of-expenditure logic, fiscal constraint, and the bridge between constrained and illustrative programs.'),
    ('project_portfolio', 'Project portfolio and prioritization', 'performance', 40, true, 'Summarize constrained, illustrative, and candidate projects with prioritization logic tied back to adopted goals.'),
    ('consultation_engagement', 'Consultation, tribal coordination, and public engagement', 'engagement', 50, true, 'Record public involvement, interagency consultation, and tribal coordination as a first-class RTP output.'),
    ('safety_resilience', 'Safety, resilience, and emergency preparedness', 'resilience', 60, true, 'Cover transportation safety, emergency preparedness, and rural resilience posture required for the RTP narrative.'),
    ('adoption_compliance_appendix', 'Adoption package and compliance appendix', 'compliance', 70, true, 'Assemble checklist, resolutions, comment-response materials, and board-ready compliance artifacts.')
) AS template(chapter_key, title, section_type, sort_order, required, guidance)
ON CONFLICT (rtp_cycle_id, chapter_key) DO NOTHING;
