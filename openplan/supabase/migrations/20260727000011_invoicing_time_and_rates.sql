-- Time & rates for receivable invoicing (builds on 20260727000010): staff,
-- rate tables with per-category entries, and the time-entry ledger that draft
-- client-invoice line items are composed from.
--
-- DELETE posture, table by table:
--   invoicing_staff        — no delete policy (staff become inactive, history stays);
--   invoicing_rate_tables  — no delete policy;
--   invoicing_rate_entries — DELETE allowed (replacing a table's entry set is
--                            the normal editing gesture);
--   invoicing_time_entries — DELETE allowed: a time entry is a plain ledger
--                            row and mistakes get deleted. HOWEVER, an entry
--                            already pulled onto an invoice (billed_line_item_id
--                            IS NOT NULL) must NOT be deleted or edited; RLS
--                            cannot express that cleanly (the stamp itself is a
--                            legitimate update), so the API layer refuses
--                            mutations of billed entries. Anything bypassing
--                            the API takes on that responsibility itself.

CREATE TABLE IF NOT EXISTS invoicing_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  title TEXT,
  -- Optional link to a workspace member's auth account; staff need not be users.
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  default_labor_category TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoicing_rate_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- NULL engagement_id = a workspace default table; set = a per-engagement override.
  engagement_id UUID REFERENCES invoicing_engagements(id) ON DELETE SET NULL,
  effective_date DATE,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoicing_rate_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_table_id UUID NOT NULL REFERENCES invoicing_rate_tables(id) ON DELETE CASCADE,
  labor_category TEXT NOT NULL,
  hourly_rate NUMERIC(10, 2) NOT NULL CHECK (hourly_rate >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rate_table_id, labor_category)
);

CREATE TABLE IF NOT EXISTS invoicing_time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES invoicing_staff(id) ON DELETE CASCADE,
  engagement_id UUID NOT NULL REFERENCES invoicing_engagements(id) ON DELETE CASCADE,
  deliverable_id UUID REFERENCES project_deliverables(id) ON DELETE SET NULL,
  entry_date DATE NOT NULL,
  hours NUMERIC(6, 2) NOT NULL CHECK (hours > 0 AND hours <= 24),
  notes TEXT,
  billable BOOLEAN NOT NULL DEFAULT true,
  labor_category TEXT,
  -- Stamped when the entry is pulled onto an invoice; NULL = unbilled. If the
  -- line item is later deleted (line-set replacement), the stamp clears and
  -- the time returns to the unbilled pool.
  billed_line_item_id UUID REFERENCES client_invoice_line_items(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoicing_staff_workspace_updated
  ON invoicing_staff(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoicing_rate_tables_workspace_updated
  ON invoicing_rate_tables(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoicing_rate_entries_rate_table
  ON invoicing_rate_entries(rate_table_id);
CREATE INDEX IF NOT EXISTS idx_invoicing_time_entries_workspace_entry_date
  ON invoicing_time_entries(workspace_id, entry_date DESC);
-- The unbilled-time query: what is billable on this engagement and not yet on
-- an invoice. Partial index skips the billed majority as history accumulates.
CREATE INDEX IF NOT EXISTS idx_invoicing_time_entries_unbilled
  ON invoicing_time_entries(engagement_id, billable)
  WHERE billed_line_item_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_invoicing_time_entries_staff
  ON invoicing_time_entries(staff_id);

ALTER TABLE invoicing_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoicing_rate_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoicing_rate_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoicing_time_entries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoicing_staff' AND policyname='invoicing_staff_read'
  ) THEN
    CREATE POLICY invoicing_staff_read ON invoicing_staff
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
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoicing_staff' AND policyname='invoicing_staff_insert'
  ) THEN
    CREATE POLICY invoicing_staff_insert ON invoicing_staff
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
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoicing_staff' AND policyname='invoicing_staff_update'
  ) THEN
    CREATE POLICY invoicing_staff_update ON invoicing_staff
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
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoicing_rate_tables' AND policyname='invoicing_rate_tables_read'
  ) THEN
    CREATE POLICY invoicing_rate_tables_read ON invoicing_rate_tables
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
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoicing_rate_tables' AND policyname='invoicing_rate_tables_insert'
  ) THEN
    CREATE POLICY invoicing_rate_tables_insert ON invoicing_rate_tables
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
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoicing_rate_tables' AND policyname='invoicing_rate_tables_update'
  ) THEN
    CREATE POLICY invoicing_rate_tables_update ON invoicing_rate_tables
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
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoicing_rate_entries' AND policyname='invoicing_rate_entries_read'
  ) THEN
    CREATE POLICY invoicing_rate_entries_read ON invoicing_rate_entries
      FOR SELECT USING (
        EXISTS (
          SELECT 1
          FROM invoicing_rate_tables rt
          JOIN workspace_members wm ON wm.workspace_id = rt.workspace_id
          WHERE rt.id = invoicing_rate_entries.rate_table_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoicing_rate_entries' AND policyname='invoicing_rate_entries_insert'
  ) THEN
    CREATE POLICY invoicing_rate_entries_insert ON invoicing_rate_entries
      FOR INSERT WITH CHECK (
        EXISTS (
          SELECT 1
          FROM invoicing_rate_tables rt
          JOIN workspace_members wm ON wm.workspace_id = rt.workspace_id
          WHERE rt.id = invoicing_rate_entries.rate_table_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoicing_rate_entries' AND policyname='invoicing_rate_entries_update'
  ) THEN
    CREATE POLICY invoicing_rate_entries_update ON invoicing_rate_entries
      FOR UPDATE USING (
        EXISTS (
          SELECT 1
          FROM invoicing_rate_tables rt
          JOIN workspace_members wm ON wm.workspace_id = rt.workspace_id
          WHERE rt.id = invoicing_rate_entries.rate_table_id
            AND wm.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM invoicing_rate_tables rt
          JOIN workspace_members wm ON wm.workspace_id = rt.workspace_id
          WHERE rt.id = invoicing_rate_entries.rate_table_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

-- Rate entries may be deleted: replacing a table's entry set is how rates are edited.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoicing_rate_entries' AND policyname='invoicing_rate_entries_delete'
  ) THEN
    CREATE POLICY invoicing_rate_entries_delete ON invoicing_rate_entries
      FOR DELETE USING (
        EXISTS (
          SELECT 1
          FROM invoicing_rate_tables rt
          JOIN workspace_members wm ON wm.workspace_id = rt.workspace_id
          WHERE rt.id = invoicing_rate_entries.rate_table_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoicing_time_entries' AND policyname='invoicing_time_entries_read'
  ) THEN
    CREATE POLICY invoicing_time_entries_read ON invoicing_time_entries
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
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoicing_time_entries' AND policyname='invoicing_time_entries_insert'
  ) THEN
    CREATE POLICY invoicing_time_entries_insert ON invoicing_time_entries
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
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoicing_time_entries' AND policyname='invoicing_time_entries_update'
  ) THEN
    CREATE POLICY invoicing_time_entries_update ON invoicing_time_entries
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

-- Time entries may be deleted (a mistaken ledger row); the billed-entry
-- refusal lives in the API layer as documented in the header.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoicing_time_entries' AND policyname='invoicing_time_entries_delete'
  ) THEN
    CREATE POLICY invoicing_time_entries_delete ON invoicing_time_entries
      FOR DELETE USING (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DROP TRIGGER IF EXISTS trg_invoicing_staff_updated_at ON invoicing_staff;
CREATE TRIGGER trg_invoicing_staff_updated_at
BEFORE UPDATE ON invoicing_staff
FOR EACH ROW
EXECUTE FUNCTION set_project_subrecord_updated_at();

DROP TRIGGER IF EXISTS trg_invoicing_rate_tables_updated_at ON invoicing_rate_tables;
CREATE TRIGGER trg_invoicing_rate_tables_updated_at
BEFORE UPDATE ON invoicing_rate_tables
FOR EACH ROW
EXECUTE FUNCTION set_project_subrecord_updated_at();

DROP TRIGGER IF EXISTS trg_invoicing_rate_entries_updated_at ON invoicing_rate_entries;
CREATE TRIGGER trg_invoicing_rate_entries_updated_at
BEFORE UPDATE ON invoicing_rate_entries
FOR EACH ROW
EXECUTE FUNCTION set_project_subrecord_updated_at();

DROP TRIGGER IF EXISTS trg_invoicing_time_entries_updated_at ON invoicing_time_entries;
CREATE TRIGGER trg_invoicing_time_entries_updated_at
BEFORE UPDATE ON invoicing_time_entries
FOR EACH ROW
EXECUTE FUNCTION set_project_subrecord_updated_at();
