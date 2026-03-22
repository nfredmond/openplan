CREATE TABLE IF NOT EXISTS project_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT,
  milestone_type TEXT NOT NULL DEFAULT 'schedule' CHECK (
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
      'other'
    )
  ),
  phase_code TEXT NOT NULL DEFAULT 'initiation' CHECK (
    phase_code IN (
      'initiation',
      'procurement',
      'environmental',
      'outreach',
      'programming',
      'ps_e',
      'row_utilities',
      'advertise_award',
      'construction',
      'closeout',
      'other'
    )
  ),
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (
    status IN ('not_started', 'scheduled', 'in_progress', 'blocked', 'complete')
  ),
  owner_label TEXT,
  target_date DATE,
  actual_date DATE,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_submittals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  submittal_type TEXT NOT NULL DEFAULT 'other' CHECK (
    submittal_type IN (
      'authorization_packet',
      'invoice_backup',
      'environmental_package',
      'hearing_record',
      'ps_e',
      'reimbursement',
      'progress_report',
      'other'
    )
  ),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'internal_review', 'submitted', 'accepted', 'revise_and_resubmit')
  ),
  agency_label TEXT,
  reference_number TEXT,
  due_date DATE,
  submitted_at TIMESTAMPTZ,
  review_cycle INTEGER NOT NULL DEFAULT 1 CHECK (review_cycle >= 1),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing_invoice_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  invoice_number TEXT NOT NULL,
  consultant_name TEXT,
  billing_basis TEXT NOT NULL DEFAULT 'time_and_materials' CHECK (
    billing_basis IN ('lump_sum', 'time_and_materials', 'cost_plus', 'milestone', 'progress_payment')
  ),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'internal_review', 'submitted', 'approved_for_payment', 'paid', 'rejected')
  ),
  period_start DATE,
  period_end DATE,
  invoice_date DATE,
  due_date DATE,
  amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  retention_percent NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (retention_percent >= 0 AND retention_percent <= 100),
  retention_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (retention_amount >= 0),
  net_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (net_amount >= 0),
  supporting_docs_status TEXT NOT NULL DEFAULT 'pending' CHECK (
    supporting_docs_status IN ('pending', 'partial', 'complete', 'accepted')
  ),
  submitted_to TEXT,
  caltrans_posture TEXT NOT NULL DEFAULT 'deferred_exact_forms' CHECK (
    caltrans_posture IN ('local_agency_consulting', 'federal_aid_candidate', 'deferred_exact_forms')
  ),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_milestones_project_updated
  ON project_milestones(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_submittals_project_updated
  ON project_submittals(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_invoice_records_workspace_updated
  ON billing_invoice_records(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_invoice_records_project_updated
  ON billing_invoice_records(project_id, updated_at DESC);

ALTER TABLE project_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_submittals ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_invoice_records ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='project_milestones' AND policyname='project_milestones_read'
  ) THEN
    CREATE POLICY project_milestones_read ON project_milestones
      FOR SELECT USING (
        EXISTS (
          SELECT 1
          FROM projects p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = project_milestones.project_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='project_milestones' AND policyname='project_milestones_insert'
  ) THEN
    CREATE POLICY project_milestones_insert ON project_milestones
      FOR INSERT WITH CHECK (
        EXISTS (
          SELECT 1
          FROM projects p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = project_milestones.project_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='project_milestones' AND policyname='project_milestones_update'
  ) THEN
    CREATE POLICY project_milestones_update ON project_milestones
      FOR UPDATE USING (
        EXISTS (
          SELECT 1
          FROM projects p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = project_milestones.project_id
            AND wm.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM projects p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = project_milestones.project_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='project_submittals' AND policyname='project_submittals_read'
  ) THEN
    CREATE POLICY project_submittals_read ON project_submittals
      FOR SELECT USING (
        EXISTS (
          SELECT 1
          FROM projects p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = project_submittals.project_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='project_submittals' AND policyname='project_submittals_insert'
  ) THEN
    CREATE POLICY project_submittals_insert ON project_submittals
      FOR INSERT WITH CHECK (
        EXISTS (
          SELECT 1
          FROM projects p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = project_submittals.project_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='project_submittals' AND policyname='project_submittals_update'
  ) THEN
    CREATE POLICY project_submittals_update ON project_submittals
      FOR UPDATE USING (
        EXISTS (
          SELECT 1
          FROM projects p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = project_submittals.project_id
            AND wm.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM projects p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = project_submittals.project_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='billing_invoice_records' AND policyname='billing_invoice_records_read'
  ) THEN
    CREATE POLICY billing_invoice_records_read ON billing_invoice_records
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
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='billing_invoice_records' AND policyname='billing_invoice_records_insert'
  ) THEN
    CREATE POLICY billing_invoice_records_insert ON billing_invoice_records
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
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='billing_invoice_records' AND policyname='billing_invoice_records_update'
  ) THEN
    CREATE POLICY billing_invoice_records_update ON billing_invoice_records
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

DROP TRIGGER IF EXISTS trg_project_milestones_updated_at ON project_milestones;
CREATE TRIGGER trg_project_milestones_updated_at
BEFORE UPDATE ON project_milestones
FOR EACH ROW
EXECUTE FUNCTION set_project_subrecord_updated_at();

DROP TRIGGER IF EXISTS trg_project_submittals_updated_at ON project_submittals;
CREATE TRIGGER trg_project_submittals_updated_at
BEFORE UPDATE ON project_submittals
FOR EACH ROW
EXECUTE FUNCTION set_project_subrecord_updated_at();

DROP TRIGGER IF EXISTS trg_billing_invoice_records_updated_at ON billing_invoice_records;
CREATE TRIGGER trg_billing_invoice_records_updated_at
BEFORE UPDATE ON billing_invoice_records
FOR EACH ROW
EXECUTE FUNCTION set_project_subrecord_updated_at();
