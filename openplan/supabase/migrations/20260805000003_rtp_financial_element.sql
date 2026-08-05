-- The financial element of a Regional Transportation Plan: horizon bands,
-- revenue and cost assumptions, per-project programmed cost, and performance
-- measures.
--
-- WHAT WAS MISSING. OpenPlan could describe an RTP's priorities and could not
-- say whether the plan could be paid for. Grepping `revenue` across all 167
-- prior migrations returns two hits, both the same chapter-template guidance
-- string: "fiscal constraint" existed only as prose telling a planner to write
-- about something the product could not hold. There was no revenue table, no
-- cost column anywhere in the RTP lane, and no arithmetic. This migration is
-- the ledger.
--
-- WHY O&M IS A FIRST-CLASS COST LINE AND NOT AN AFTERTHOUGHT.
-- 23 CFR 450.324(f)(11)(i) requires the financial plan to carry "system-level
-- estimates of costs and revenue sources ... to adequately operate and maintain
-- the Federal-aid highways ... and public transportation". A constraint check
-- that summed only project capital costs would omit the cost of running the
-- system, so a plan could report itself fiscally constrained while ignoring the
-- larger half of what it must pay for — on the one number a funder verifies.
-- So revenue and O&M live in the SAME ledger table, differing by `entry_kind`,
-- and the check is (capital + O&M) against revenue.
--
-- WHY ONE LEDGER TABLE RATHER THAN `rtp_revenue_assumptions` +
-- `rtp_om_assumptions`. They have identical shape — a name, an amount, a basis
-- year, a band, a note — identical policies, identical grants, and the
-- constraint query wants them in one scan. Two tables would be the same six
-- columns and four policies twice over, and a third cost category (a debt
-- service line, a transit operating subsidy) would make it three. `entry_kind`
-- is the axis that actually varies.
--
-- WHY HORIZON BANDS ARE A TABLE AND NOT AN ENUM ON THE LINK ROW.
-- Decided by Nathaniel 2026-08-05, choosing the flexible option over a fixed
-- short/long pair. 23 CFR 450.324(f)(11)(v) permits aggregate cost bands only
-- "beyond the first 10 years", which gives US MPOs a natural two-band split —
-- but it is a US federal anchor, not a universal one, and freezing
-- 'short_term'|'long_term' into a CHECK would put a schema migration between
-- this product and any agency whose planning cycle bands differently. An agency
-- declares its own bands with its own labels and year ranges; the federal
-- two-band shape is then something an agency CAN express rather than something
-- the schema imposes.
--
-- WHY COSTS ARE STORED IN CONSTANT DOLLARS WITH AN INFLATION RATE, RATHER THAN
-- AS YEAR-OF-EXPENDITURE FIGURES. 23 CFR 450.324(f)(11)(iv) requires revenue
-- and cost estimates to "use an inflation rate(s) to reflect 'year of
-- expenditure dollars'". Two designs satisfy that. Storing the YOE figure
-- directly is simpler and unauditable: nothing can show how the number was
-- derived, and a changed assumption means re-entering every line by hand.
-- Storing constant dollars plus the basis year plus a per-cycle rate lets
-- OpenPlan compute YOE, show its work, and re-derive everything when the rate
-- changes. Chosen for that reason.
--
--   The rate is NULLABLE and has no default. A default of "3%" would be
--   OpenPlan inventing an agency's financial assumption and then presenting the
--   result as the agency's own year-of-expenditure figure. Null means the
--   surfaces report constant dollars AS constant dollars and say that YOE was
--   not computed — which is a smaller failure than a confidently wrong number
--   in an adopted plan.
--
-- WHY `estimated_cost` LIVES ON THE LINK ROW AND NOT ON `projects`.
-- `project_funding_profiles.funding_need_amount` already exists and is the
-- denominator of every funded/unfunded verdict in the funding module. It is NOT
-- the same quantity. Funding need is a property of the project: what it needs
-- raised, once. The cost programmed HERE is a property of the project's
-- placement in THIS cycle — the same project can sit in two cycles, in
-- different bands, at different costs, phased differently. Putting it on the
-- link row is what lets those differ; putting it on `projects` would force one
-- plan's programming onto another's.
--
--   Consequence stated rather than hidden: two money figures can appear on one
--   project row. The surfaces must label which is which, and an unset
--   `estimated_cost` means UNPRICED — never zero. `funding.ts`'s `toNumber`
--   coerces absent to 0, which is survivable for awards and fatal here: a cycle
--   with 12 of 40 projects unpriced would sum to a total that looks complete
--   and report "fiscally constrained". Callers use `parseOptionalAmount` and
--   surface unpriced projects as a named gap.
--
-- A DATA-LOSS SEAM THIS MIGRATION CREATES, RECORDED SO IT IS NOT DISCOVERED
-- LATER. `project_rtp_cycle_links` cascades on project delete, and
-- src/lib/projects/project-delete-preconditions.ts classifies that cascade as
-- `severity: "evidence"`. Once the link row carries the project's cost in a
-- fiscally constrained plan, deleting a project silently removes a line item
-- from a financial element a board may already have adopted. The cascade is
-- kept — an orphaned link row pointing at a deleted project is worse — but the
-- precondition's severity must be raised where it is declared, in the same
-- change that starts reading these columns.
--
-- GRANTS ARE EXPLICIT because 20260804000001 flipped default privileges to
-- deny. A new table that omits its GRANT block is born unreadable and
-- unwritable by `authenticated`, and the failure — `permission denied for
-- table X` — looks like an RLS bug, which invites loosening a policy that
-- cannot fix it. `anon` is granted NOTHING: the public plan page reads through
-- the service role behind a share token, and an anon grant would additionally
-- expose every workspace's unpublished financial assumptions through PostgREST
-- to anyone holding the project's public key.
--
-- WRITES ARE ROLE-AWARE at the permissive layer via
-- `public.workspace_member_can_write`, so these tables need no companion
-- RESTRICTIVE gate from 20260728000006. Copying the OLD RTP policies — bare
-- `workspace_id IN (SELECT ...)` — would have made every viewer a writer until
-- someone remembered to add the table to that migration's VALUES loop.

-- ---------------------------------------------------------------------------
-- Horizon bands
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.rtp_horizon_bands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  rtp_cycle_id UUID NOT NULL REFERENCES public.rtp_cycles(id) ON DELETE CASCADE,

  -- The agency's own name for the period: "First ten years", "2035–2050",
  -- "Phase 2". Not constrained to a vocabulary, for the reason in the header.
  label TEXT NOT NULL CHECK (length(trim(label)) > 0),

  start_year INTEGER NOT NULL CHECK (start_year BETWEEN 1900 AND 2200),
  end_year INTEGER NOT NULL CHECK (end_year BETWEEN 1900 AND 2200),

  -- The year money in this band is treated as being spent, for escalation to
  -- year-of-expenditure dollars. NULL means the surfaces use the band midpoint
  -- and DISCLOSE that they did, rather than silently picking a year that
  -- changes every figure in the band.
  escalation_target_year INTEGER CHECK (escalation_target_year IS NULL OR escalation_target_year BETWEEN 1900 AND 2200),

  -- 23 CFR 450.324(f)(11)(v) permits aggregate cost ranges only beyond the
  -- first ten years. An agency records which treatment this band gets so an
  -- exported plan can say so, rather than a reader having to infer it from the
  -- years.
  cost_estimate_basis TEXT NOT NULL DEFAULT 'itemized'
    CHECK (cost_estimate_basis IN ('itemized', 'banded')),

  sort_order INTEGER NOT NULL DEFAULT 0,

  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT rtp_horizon_bands_year_order CHECK (end_year >= start_year),
  CONSTRAINT rtp_horizon_bands_escalation_within_band CHECK (
    escalation_target_year IS NULL
    OR (escalation_target_year >= start_year AND escalation_target_year <= end_year)
  ),
  -- Two bands with one label would make every list ambiguous and every
  -- attribution of a cost to a period arbitrary.
  CONSTRAINT rtp_horizon_bands_unique_label UNIQUE (rtp_cycle_id, label)
);

CREATE INDEX IF NOT EXISTS rtp_horizon_bands_cycle_idx
  ON public.rtp_horizon_bands(rtp_cycle_id, sort_order, start_year);

CREATE INDEX IF NOT EXISTS rtp_horizon_bands_workspace_idx
  ON public.rtp_horizon_bands(workspace_id, updated_at DESC);

-- ---------------------------------------------------------------------------
-- The financial ledger: revenue and system-level costs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.rtp_financial_assumptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  rtp_cycle_id UUID NOT NULL REFERENCES public.rtp_cycles(id) ON DELETE CASCADE,

  -- ON DELETE RESTRICT, deliberately. A band is a period of an adopted
  -- financial plan; deleting one that still carries revenue or O&M lines would
  -- silently remove money from the constraint check. The agency moves the lines
  -- first, and the UI says so.
  horizon_band_id UUID NOT NULL REFERENCES public.rtp_horizon_bands(id) ON DELETE RESTRICT,

  -- Which side of the ledger, and which kind of cost. Revenue and O&M are the
  -- two the federal financial plan requires; `other_cost` exists so an agency
  -- with a debt-service or reserve line is not forced to mislabel it as O&M.
  entry_kind TEXT NOT NULL CHECK (entry_kind IN ('revenue', 'operations_maintenance', 'other_cost')),

  -- The agency's own name for the source or the cost: "STBG", "Local sales tax
  -- measure", "Transit operations". Free text for the same reason band labels
  -- are: a funding-source vocabulary is jurisdiction-specific and belongs in a
  -- registry, not a CHECK constraint.
  source_name TEXT NOT NULL CHECK (length(trim(source_name)) > 0),

  -- Constant dollars. NOT NULL because a ledger line with no amount is not a
  -- line; a planner who does not know the figure omits the row.
  amount NUMERIC(16, 2) NOT NULL CHECK (amount >= 0),

  -- The year `amount` is expressed in. NULL means the surfaces fall back to the
  -- cycle's `financial_basis_year` and disclose the fallback.
  amount_basis_year INTEGER CHECK (amount_basis_year IS NULL OR amount_basis_year BETWEEN 1900 AND 2200),

  notes TEXT,

  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rtp_financial_assumptions_cycle_idx
  ON public.rtp_financial_assumptions(rtp_cycle_id, entry_kind);

CREATE INDEX IF NOT EXISTS rtp_financial_assumptions_band_idx
  ON public.rtp_financial_assumptions(horizon_band_id);

CREATE INDEX IF NOT EXISTS rtp_financial_assumptions_workspace_idx
  ON public.rtp_financial_assumptions(workspace_id, updated_at DESC);

-- ---------------------------------------------------------------------------
-- Performance measures
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.rtp_performance_measures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  rtp_cycle_id UUID NOT NULL REFERENCES public.rtp_cycles(id) ON DELETE CASCADE,

  -- A stable key the agency (or a future registry of federal PM1/PM2/PM3
  -- measures) can address the row by. Deliberately NOT constrained to a
  -- vocabulary: the federal performance-measure set is US-specific and its
  -- membership has changed by rulemaking more than once. A registry in
  -- TypeScript can offer known measures; the schema does not freeze them.
  measure_key TEXT NOT NULL CHECK (length(trim(measure_key)) > 0),

  label TEXT NOT NULL CHECK (length(trim(label)) > 0),

  -- What the numbers mean — "fatalities per 100M VMT", "% pavement in good
  -- condition". Without it a baseline and a target are two bare numbers.
  unit TEXT,

  baseline_value NUMERIC(18, 4),
  baseline_year INTEGER CHECK (baseline_year IS NULL OR baseline_year BETWEEN 1900 AND 2200),
  target_value NUMERIC(18, 4),
  target_year INTEGER CHECK (target_year IS NULL OR target_year BETWEEN 1900 AND 2200),

  -- Where the baseline came from. A performance measure with no stated source
  -- is an assertion; this is the column that makes it evidence.
  data_source TEXT,

  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,

  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT rtp_performance_measures_unique_key UNIQUE (rtp_cycle_id, measure_key)
);

CREATE INDEX IF NOT EXISTS rtp_performance_measures_cycle_idx
  ON public.rtp_performance_measures(rtp_cycle_id, sort_order);

CREATE INDEX IF NOT EXISTS rtp_performance_measures_workspace_idx
  ON public.rtp_performance_measures(workspace_id, updated_at DESC);

-- ---------------------------------------------------------------------------
-- Cycle-level financial assumptions
-- ---------------------------------------------------------------------------

-- The year the cycle's money is expressed in by default, and the rate that
-- escalates it to year-of-expenditure dollars. Both nullable with no default:
-- see the header. A cycle with no rate reports constant dollars and says so.
ALTER TABLE public.rtp_cycles
  ADD COLUMN IF NOT EXISTS financial_basis_year INTEGER
    CHECK (financial_basis_year IS NULL OR financial_basis_year BETWEEN 1900 AND 2200);

ALTER TABLE public.rtp_cycles
  ADD COLUMN IF NOT EXISTS annual_inflation_rate NUMERIC(6, 5)
    CHECK (annual_inflation_rate IS NULL OR (annual_inflation_rate >= 0 AND annual_inflation_rate <= 1));

-- ---------------------------------------------------------------------------
-- Per-project programmed cost on the link row
-- ---------------------------------------------------------------------------

ALTER TABLE public.project_rtp_cycle_links
  ADD COLUMN IF NOT EXISTS horizon_band_id UUID REFERENCES public.rtp_horizon_bands(id) ON DELETE SET NULL;

-- NULL means UNPRICED, which is a distinct answer from zero and must stay one
-- all the way to the constraint check.
ALTER TABLE public.project_rtp_cycle_links
  ADD COLUMN IF NOT EXISTS estimated_cost NUMERIC(16, 2)
    CHECK (estimated_cost IS NULL OR estimated_cost >= 0);

ALTER TABLE public.project_rtp_cycle_links
  ADD COLUMN IF NOT EXISTS cost_basis_year INTEGER
    CHECK (cost_basis_year IS NULL OR cost_basis_year BETWEEN 1900 AND 2200);

-- The table was built as write-once linkage metadata (20260409000036: created_by
-- and created_at only, all three indexes ordering by created_at). It is about to
-- hold money a board adopts, so "when was this cost last revised?" has to be
-- answerable — a public draft review and a comment-response record both need it,
-- and funding.ts's staleness chain reads `updated_at ?? created_at`.
ALTER TABLE public.project_rtp_cycle_links
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS project_rtp_cycle_links_band_idx
  ON public.project_rtp_cycle_links(horizon_band_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers (per-table functions, matching the existing RTP tables)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_rtp_financial_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rtp_horizon_bands_updated_at ON public.rtp_horizon_bands;
CREATE TRIGGER trg_rtp_horizon_bands_updated_at
  BEFORE UPDATE ON public.rtp_horizon_bands
  FOR EACH ROW EXECUTE FUNCTION public.set_rtp_financial_updated_at();

DROP TRIGGER IF EXISTS trg_rtp_financial_assumptions_updated_at ON public.rtp_financial_assumptions;
CREATE TRIGGER trg_rtp_financial_assumptions_updated_at
  BEFORE UPDATE ON public.rtp_financial_assumptions
  FOR EACH ROW EXECUTE FUNCTION public.set_rtp_financial_updated_at();

DROP TRIGGER IF EXISTS trg_rtp_performance_measures_updated_at ON public.rtp_performance_measures;
CREATE TRIGGER trg_rtp_performance_measures_updated_at
  BEFORE UPDATE ON public.rtp_performance_measures
  FOR EACH ROW EXECUTE FUNCTION public.set_rtp_financial_updated_at();

DROP TRIGGER IF EXISTS trg_project_rtp_cycle_links_updated_at ON public.project_rtp_cycle_links;
CREATE TRIGGER trg_project_rtp_cycle_links_updated_at
  BEFORE UPDATE ON public.project_rtp_cycle_links
  FOR EACH ROW EXECUTE FUNCTION public.set_rtp_financial_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

ALTER TABLE public.rtp_horizon_bands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rtp_financial_assumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rtp_performance_measures ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  target TEXT;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'rtp_horizon_bands',
    'rtp_financial_assumptions',
    'rtp_performance_measures'
  ]
  LOOP
    -- Reads: every member of the owning workspace, viewers included. A viewer
    -- must be able to see what their agency's plan says it can afford.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = target AND policyname = target || '_member_read'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT USING (
           workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())
         )', target || '_member_read', target);
    END IF;

    -- Writes are ROLE-AWARE here rather than membership-only, so these tables
    -- need no companion RESTRICTIVE gate. Changing what a plan says it can
    -- afford is unambiguously a write.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = target AND policyname = target || '_writer_insert'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (public.workspace_member_can_write(workspace_id))',
        target || '_writer_insert', target);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = target AND policyname = target || '_writer_update'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR UPDATE USING (public.workspace_member_can_write(workspace_id))
         WITH CHECK (public.workspace_member_can_write(workspace_id))',
        target || '_writer_update', target);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = target AND policyname = target || '_writer_delete'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR DELETE USING (public.workspace_member_can_write(workspace_id))',
        target || '_writer_delete', target);
    END IF;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- Grants — REQUIRED since 20260804000001 flipped default privileges to deny.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rtp_horizon_bands TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rtp_financial_assumptions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rtp_performance_measures TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rtp_horizon_bands TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rtp_financial_assumptions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rtp_performance_measures TO service_role;

-- `anon` is granted nothing on purpose. The public plan page reads through the
-- service role behind a share token; an anon grant would expose every
-- workspace's unpublished financial assumptions through PostgREST.

-- ---------------------------------------------------------------------------
-- Documentation
-- ---------------------------------------------------------------------------

COMMENT ON TABLE public.rtp_horizon_bands IS
  'Agency-defined time periods within an RTP cycle. Labels and year ranges are the agency''s own rather than a fixed short/long enum: 23 CFR 450.324(f)(11)(v) gives US MPOs a natural ten-year split, but that is a federal anchor and not a universal one. Costs and revenues attach to a band, and a band''s escalation_target_year is the year its money is treated as spent when converting to year-of-expenditure dollars.';

COMMENT ON COLUMN public.rtp_horizon_bands.escalation_target_year IS
  'The year money in this band is treated as being spent, for escalation to year-of-expenditure dollars. NULL means surfaces use the band midpoint AND disclose that they did — silently choosing a year would change every figure in the band without saying so.';

COMMENT ON TABLE public.rtp_financial_assumptions IS
  'The revenue and system-level cost lines of an RTP financial element. entry_kind separates revenue from operations_maintenance and other_cost in one ledger because they share a shape and the fiscal-constraint check wants them in one scan. O&M is here rather than omitted because 23 CFR 450.324(f)(11)(i) requires system-level operate-and-maintain estimates: a constraint check over project capital alone would report a plan affordable while ignoring the cost of running the system.';

COMMENT ON COLUMN public.rtp_financial_assumptions.amount IS
  'Constant dollars, in amount_basis_year (falling back to the cycle''s financial_basis_year, disclosed). Year-of-expenditure figures are COMPUTED from the cycle''s annual_inflation_rate rather than stored, so the derivation is auditable and a changed assumption re-derives every line instead of requiring re-entry.';

COMMENT ON COLUMN public.rtp_cycles.annual_inflation_rate IS
  'Annual inflation used to escalate constant dollars to year-of-expenditure dollars, per 23 CFR 450.324(f)(11)(iv). Expressed as a fraction (0.03 = 3%). NULL with no default deliberately: a default would be OpenPlan inventing an agency''s financial assumption and then presenting the result as the agency''s own YOE figure. NULL means surfaces report constant dollars as constant dollars and state that YOE was not computed.';

COMMENT ON COLUMN public.project_rtp_cycle_links.estimated_cost IS
  'The project''s cost as programmed in THIS cycle, in constant dollars of cost_basis_year. Distinct from project_funding_profiles.funding_need_amount, which is a property of the project (what it needs raised) rather than of its placement in a plan — the same project can sit in two cycles at different costs and phases. NULL means UNPRICED, which must never be coerced to zero: a cycle with unpriced projects would otherwise sum to a total that looks complete and report itself fiscally constrained.';

COMMENT ON TABLE public.rtp_performance_measures IS
  'Baseline-and-target performance measures for an RTP cycle. measure_key is deliberately unconstrained by the schema: the US federal PM1/PM2/PM3 set is jurisdiction-specific and its membership has changed by rulemaking, so a registry in TypeScript offers known measures while the database does not freeze them.';
