-- Deliverable budgets and a project spend ledger.
--
-- project_deliverables gains an optional not-to-exceed budget_amount and an
-- optional percent_complete so a consultant or agency PM can judge burn
-- against recorded progress. projects gains a stated budget_amount so the
-- project page can show remaining-against-stated-budget. All three columns
-- are nullable by design: NULL means "not entered", never zero and never a
-- guess — the pace logic in src/lib/projects/budget.ts refuses a verdict
-- without a basis.
--
-- project_spend_entries is a plain ledger of money spent on a project
-- (subconsultant costs, direct expenses), optionally attributed to a
-- deliverable. It is deliberately simple: no approval workflow, no status
-- machine. DELETE is allowed — a ledger row is a bookkeeping entry, and
-- correcting a mistaken entry is legitimate (unlike invoices or submittals,
-- which carry compliance history and therefore have no DELETE policy).
--
-- Additive only: no drops, no backfill.

ALTER TABLE project_deliverables
  ADD COLUMN IF NOT EXISTS budget_amount NUMERIC(14, 2);

ALTER TABLE project_deliverables
  ADD COLUMN IF NOT EXISTS percent_complete NUMERIC(5, 2);

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS budget_amount NUMERIC(14, 2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_deliverables_budget_amount_nonnegative'
  ) THEN
    ALTER TABLE project_deliverables
      ADD CONSTRAINT project_deliverables_budget_amount_nonnegative
      CHECK (budget_amount IS NULL OR budget_amount >= 0);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_deliverables_percent_complete_range'
  ) THEN
    ALTER TABLE project_deliverables
      ADD CONSTRAINT project_deliverables_percent_complete_range
      CHECK (percent_complete IS NULL OR (percent_complete >= 0 AND percent_complete <= 100));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_budget_amount_nonnegative'
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_budget_amount_nonnegative
      CHECK (budget_amount IS NULL OR budget_amount >= 0);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS project_spend_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  deliverable_id UUID REFERENCES project_deliverables(id) ON DELETE SET NULL,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
  description TEXT NOT NULL,
  vendor_label TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_spend_entries_project_entry_date
  ON project_spend_entries(project_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_project_spend_entries_deliverable
  ON project_spend_entries(deliverable_id);

ALTER TABLE project_spend_entries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='project_spend_entries' AND policyname='project_spend_entries_read'
  ) THEN
    CREATE POLICY project_spend_entries_read ON project_spend_entries
      FOR SELECT USING (
        EXISTS (
          SELECT 1
          FROM projects p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = project_spend_entries.project_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='project_spend_entries' AND policyname='project_spend_entries_insert'
  ) THEN
    CREATE POLICY project_spend_entries_insert ON project_spend_entries
      FOR INSERT WITH CHECK (
        EXISTS (
          SELECT 1
          FROM projects p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = project_spend_entries.project_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='project_spend_entries' AND policyname='project_spend_entries_update'
  ) THEN
    CREATE POLICY project_spend_entries_update ON project_spend_entries
      FOR UPDATE USING (
        EXISTS (
          SELECT 1
          FROM projects p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = project_spend_entries.project_id
            AND wm.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM projects p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = project_spend_entries.project_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='project_spend_entries' AND policyname='project_spend_entries_delete'
  ) THEN
    CREATE POLICY project_spend_entries_delete ON project_spend_entries
      FOR DELETE USING (
        EXISTS (
          SELECT 1
          FROM projects p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = project_spend_entries.project_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DROP TRIGGER IF EXISTS trg_project_spend_entries_updated_at ON project_spend_entries;
CREATE TRIGGER trg_project_spend_entries_updated_at
BEFORE UPDATE ON project_spend_entries
FOR EACH ROW
EXECUTE FUNCTION set_project_subrecord_updated_at();
