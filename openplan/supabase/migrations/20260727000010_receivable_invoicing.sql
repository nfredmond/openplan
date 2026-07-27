-- Receivable invoicing: the consultant/agency workspace billing ITS OWN
-- clients and funders' primes (accounts receivable). This is the opposite
-- direction from billing_invoice_records (20260321000033), which records the
-- agency invoicing its funder for reimbursement. Both are product features of
-- a free product — OpenPlan never charges anyone; these tables let its users
-- bill THEIR clients.
--
-- Four tables:
--   invoicing_clients            — who gets billed (org kinds, not jurisdictions)
--   invoicing_engagements        — the contract/task-order/on-call vehicle
--   client_invoices              — the receivable document (draft → sent → paid | void)
--   client_invoice_line_items    — the lines on one invoice
--
-- Deliberate asymmetry in DELETE policies: the three parent tables get NO
-- delete policy — a wrong invoice is corrected by voiding it, and clients/
-- engagements are history once referenced. Line items DO get a delete policy
-- because composing an invoice replaces its line set wholesale.

CREATE TABLE IF NOT EXISTS invoicing_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  client_kind TEXT NOT NULL DEFAULT 'public_agency' CHECK (
    client_kind IN ('public_agency', 'tribal_government', 'prime_contractor', 'nonprofit', 'private', 'other')
  ),
  billing_address TEXT,
  contact_name TEXT,
  contact_email TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoicing_engagements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES invoicing_clients(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  parent_engagement_id UUID REFERENCES invoicing_engagements(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  reference_code TEXT,
  engagement_kind TEXT NOT NULL DEFAULT 'contract' CHECK (
    engagement_kind IN ('contract', 'task_order', 'on_call', 'other')
  ),
  -- Same basis vocabulary as billing_invoice_records (20260321000033): one
  -- billing-basis language across both invoicing directions.
  billing_basis TEXT CHECK (
    billing_basis IS NULL
    OR billing_basis IN ('lump_sum', 'time_and_materials', 'cost_plus', 'milestone', 'progress_payment')
  ),
  not_to_exceed_amount NUMERIC(14, 2) CHECK (not_to_exceed_amount IS NULL OR not_to_exceed_amount >= 0),
  start_date DATE,
  end_date DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('pending', 'active', 'closed')
  ),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS client_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES invoicing_clients(id) ON DELETE CASCADE,
  engagement_id UUID REFERENCES invoicing_engagements(id) ON DELETE SET NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  invoice_number TEXT NOT NULL,
  -- Correction path is 'void', never row deletion: the invoice number stays
  -- claimed and the audit trail stays whole.
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'sent', 'paid', 'void')
  ),
  sent_date DATE,
  paid_date DATE,
  period_start DATE,
  period_end DATE,
  invoice_date DATE,
  due_date DATE,
  subtotal_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (subtotal_amount >= 0),
  retention_percent NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (retention_percent >= 0 AND retention_percent <= 100),
  retention_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  payment_terms TEXT,
  currency_code TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS client_invoice_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES client_invoices(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  quantity NUMERIC(12, 2),
  unit_label TEXT,
  unit_amount NUMERIC(14, 2),
  amount NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
  deliverable_id UUID REFERENCES project_deliverables(id) ON DELETE SET NULL,
  milestone_id UUID REFERENCES project_milestones(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoicing_clients_workspace_updated
  ON invoicing_clients(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoicing_engagements_workspace_updated
  ON invoicing_engagements(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoicing_engagements_client
  ON invoicing_engagements(client_id);
CREATE INDEX IF NOT EXISTS idx_invoicing_engagements_project
  ON invoicing_engagements(project_id);
CREATE INDEX IF NOT EXISTS idx_client_invoices_workspace_updated
  ON client_invoices(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_invoices_client
  ON client_invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_client_invoices_engagement
  ON client_invoices(engagement_id);
CREATE INDEX IF NOT EXISTS idx_client_invoices_project
  ON client_invoices(project_id);
-- An invoice number is unique within a workspace (never globally — two
-- consultancies can both have an "INV-001").
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_invoices_workspace_invoice_number
  ON client_invoices(workspace_id, invoice_number);
CREATE INDEX IF NOT EXISTS idx_client_invoice_line_items_invoice_position
  ON client_invoice_line_items(invoice_id, position);
CREATE INDEX IF NOT EXISTS idx_client_invoice_line_items_deliverable
  ON client_invoice_line_items(deliverable_id);

ALTER TABLE invoicing_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoicing_engagements ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_invoice_line_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoicing_clients' AND policyname='invoicing_clients_read'
  ) THEN
    CREATE POLICY invoicing_clients_read ON invoicing_clients
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
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoicing_clients' AND policyname='invoicing_clients_insert'
  ) THEN
    CREATE POLICY invoicing_clients_insert ON invoicing_clients
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
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoicing_clients' AND policyname='invoicing_clients_update'
  ) THEN
    CREATE POLICY invoicing_clients_update ON invoicing_clients
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
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoicing_engagements' AND policyname='invoicing_engagements_read'
  ) THEN
    CREATE POLICY invoicing_engagements_read ON invoicing_engagements
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
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoicing_engagements' AND policyname='invoicing_engagements_insert'
  ) THEN
    CREATE POLICY invoicing_engagements_insert ON invoicing_engagements
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
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoicing_engagements' AND policyname='invoicing_engagements_update'
  ) THEN
    CREATE POLICY invoicing_engagements_update ON invoicing_engagements
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
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='client_invoices' AND policyname='client_invoices_read'
  ) THEN
    CREATE POLICY client_invoices_read ON client_invoices
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
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='client_invoices' AND policyname='client_invoices_insert'
  ) THEN
    CREATE POLICY client_invoices_insert ON client_invoices
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
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='client_invoices' AND policyname='client_invoices_update'
  ) THEN
    CREATE POLICY client_invoices_update ON client_invoices
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
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='client_invoice_line_items' AND policyname='client_invoice_line_items_read'
  ) THEN
    CREATE POLICY client_invoice_line_items_read ON client_invoice_line_items
      FOR SELECT USING (
        EXISTS (
          SELECT 1
          FROM client_invoices ci
          JOIN workspace_members wm ON wm.workspace_id = ci.workspace_id
          WHERE ci.id = client_invoice_line_items.invoice_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='client_invoice_line_items' AND policyname='client_invoice_line_items_insert'
  ) THEN
    CREATE POLICY client_invoice_line_items_insert ON client_invoice_line_items
      FOR INSERT WITH CHECK (
        EXISTS (
          SELECT 1
          FROM client_invoices ci
          JOIN workspace_members wm ON wm.workspace_id = ci.workspace_id
          WHERE ci.id = client_invoice_line_items.invoice_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='client_invoice_line_items' AND policyname='client_invoice_line_items_update'
  ) THEN
    CREATE POLICY client_invoice_line_items_update ON client_invoice_line_items
      FOR UPDATE USING (
        EXISTS (
          SELECT 1
          FROM client_invoices ci
          JOIN workspace_members wm ON wm.workspace_id = ci.workspace_id
          WHERE ci.id = client_invoice_line_items.invoice_id
            AND wm.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM client_invoices ci
          JOIN workspace_members wm ON wm.workspace_id = ci.workspace_id
          WHERE ci.id = client_invoice_line_items.invoice_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

-- Line items alone get a DELETE policy: replacing an invoice's line set is a
-- normal composition step. The three parent tables deliberately have none.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='client_invoice_line_items' AND policyname='client_invoice_line_items_delete'
  ) THEN
    CREATE POLICY client_invoice_line_items_delete ON client_invoice_line_items
      FOR DELETE USING (
        EXISTS (
          SELECT 1
          FROM client_invoices ci
          JOIN workspace_members wm ON wm.workspace_id = ci.workspace_id
          WHERE ci.id = client_invoice_line_items.invoice_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DROP TRIGGER IF EXISTS trg_invoicing_clients_updated_at ON invoicing_clients;
CREATE TRIGGER trg_invoicing_clients_updated_at
BEFORE UPDATE ON invoicing_clients
FOR EACH ROW
EXECUTE FUNCTION set_project_subrecord_updated_at();

DROP TRIGGER IF EXISTS trg_invoicing_engagements_updated_at ON invoicing_engagements;
CREATE TRIGGER trg_invoicing_engagements_updated_at
BEFORE UPDATE ON invoicing_engagements
FOR EACH ROW
EXECUTE FUNCTION set_project_subrecord_updated_at();

DROP TRIGGER IF EXISTS trg_client_invoices_updated_at ON client_invoices;
CREATE TRIGGER trg_client_invoices_updated_at
BEFORE UPDATE ON client_invoices
FOR EACH ROW
EXECUTE FUNCTION set_project_subrecord_updated_at();

DROP TRIGGER IF EXISTS trg_client_invoice_line_items_updated_at ON client_invoice_line_items;
CREATE TRIGGER trg_client_invoice_line_items_updated_at
BEFORE UPDATE ON client_invoice_line_items
FOR EACH ROW
EXECUTE FUNCTION set_project_subrecord_updated_at();
