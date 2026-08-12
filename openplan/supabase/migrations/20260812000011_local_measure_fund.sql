-- THE SELF-HELP LOCAL MEASURE FUND — the funder side of the reimbursement seam.
--
-- ============================================================================
-- WHAT THIS IS
-- ============================================================================
--
-- Voters in a county, city or district pass a local tax — a transportation
-- sales-tax measure, an infrastructure levy — and an agency administers the
-- fund it creates. Money arrives periodically. An ordinance says how it splits.
-- Cities and districts claim against it. A citizens' oversight committee audits
-- the whole thing.
--
-- THE ARCHITECTURAL FACT THAT SHAPES EVERY TABLE BELOW: this is the same
-- reimbursement seam OpenPlan already has, running backwards. Today an agency
-- invoices its FUNDER (`billing_invoice_records`, the reimbursement profiles,
-- and `buildAwardDrawdownLedger`). Here the agency IS the funder and its
-- sub-recipients claim against it. The shapes and the vocabulary are reused;
-- the tables are not, because the direction of money is opposite and a row that
-- means both at once is a row nobody can read.
--
-- WHY A COMPANION TABLE AND NOT COLUMNS ON `programs`. `programs.program_type`
-- has carried 'local_measure' since 20260315000022, so the measure ALREADY
-- exists as a program record and gets `program_links`, the readiness plumbing
-- and the /programs front door for free. What it lacks is an ordinance adoption
-- date, a sunset, a rate label, a receipt cadence, a currency and an allocation
-- rule — none of which an RTIP or STIP row has any use for. Seven columns that
-- are NULL for five of six program types, on a table shared by `program_links`,
-- `buildProgramReadiness` and `project-delete-preconditions.ts`, is the wrong
-- trade. A free-standing module was rejected outright under product
-- non-negotiable #2 (deepen the existing modules; do not add new ones).
--
-- WHY NOT `funding_awards`. That table is money the workspace RECEIVES for ONE
-- project (`project_id UUID NOT NULL`, 20260410000043). A measure is a standing
-- revenue stream the workspace ADMINISTERS, tied to no project. Same seam,
-- opposite direction — reuse the shapes, not the table.
--
-- ============================================================================
-- NOTHING IN HERE NAMES A PLACE
-- ============================================================================
--
-- Every ordinance slices differently, so the split is DATA:
-- `measure_allocation_rules.rule` is a JSONB descriptor, zod-parsed in
-- `src/lib/measures/allocation.ts`, and two differently-shaped fixture measures
-- run through the same allocator in `measure-allocation-arithmetic.test.ts`.
-- No percentage, no category list, no jurisdiction and no currency is a literal
-- anywhere below. `currency_code` is deliberately NOT NULL with NO DEFAULT: a
-- DEFAULT 'USD' would be exactly the country assumption non-negotiable #0
-- forbids, and it costs one form field to ask.
--
-- ============================================================================
-- AN UNREPORTED AMOUNT IS NOT ZERO — the rule the money columns encode
-- ============================================================================
--
-- `measure_fund_periods` has THREE states and the difference between them is
-- the whole point of the table:
--
--   * no row                      -- the period was never opened
--   * received_amount IS NULL     -- the period exists and no receipt has been
--                                    reported (usually because a forecast was
--                                    adopted first)
--   * received_amount = 0.00      -- the fund received nothing, and a person
--                                    recorded that
--
-- The first two are MISSING, never zero. This is a deliberate contrast with
-- `funding_awards.awarded_amount`, which is `NOT NULL DEFAULT 0` and forces
-- `drawdown-ledger.ts:230` to treat a stored 0 as "nobody entered it" — a
-- correction the ledger has to make on every read because the column cannot
-- hold the distinction. So: nullable, no default, and `parseOptionalAmount`
-- (src/lib/money/optional-amount.ts) propagates the absence into every total.
--
-- Any total across a span containing an unreported period is a FLOOR, and
-- `buildMeasureReceiptLedger` returns the missing periods alongside it so no
-- surface can print the number without its coverage.
--
-- ============================================================================
-- WHAT OPENPLAN REFUSES TO COMPUTE
-- ============================================================================
--
-- There is no expected-receipt column and no projection anywhere in this lane.
-- A sales-tax projection is an economic forecast over taxable-sales growth that
-- this product has no input data for, and a projected figure on a fund page
-- will be programmed against. What is stored is the AGENCY'S OWN adopted
-- forecast, per period, typed by a person, with `forecast_basis_note`. Variance
-- is computed only where both figures are present.
--
-- Same rule for apportionment inputs. `measure_recipient_basis_values` is where
-- a population, road mileage or parcel count comes from: the ordinance names
-- its own source, a person states the figure, and `basis_source_note` says
-- where it came from. OpenPlan never fetches a Census figure and uses it as an
-- apportionment basis. If any active recipient lacks a basis value for the
-- vintage in force, the allocator reports that category as
-- allocated-but-UNDISTRIBUTED rather than splitting it among the recipients
-- that do have figures — a missing denominator term inflates every other share,
-- which is "an unreported amount is not zero" applied to a divisor.
--
-- ============================================================================
-- WORKSPACE CONSISTENCY IS A FOREIGN KEY, NOT A CONVENTION
-- ============================================================================
--
-- Every table here denormalizes `workspace_id` so its RLS policy is a direct
-- test rather than a join (the `safety_crash_parties` posture). Denormalization
-- invites the child whose `workspace_id` disagrees with its parent's — a row
-- readable by the wrong tenant — so each child carries a COMPOSITE foreign key
-- into `(id, workspace_id)` of its parent. Postgres then refuses the mismatch
-- outright; nobody has to remember.
--
-- ============================================================================
-- POLICY SHAPE: ROLE-AWARE PERMISSIVE, NO RESTRICTIVE GATE
-- ============================================================================
--
-- Every write policy below calls `public.workspace_member_can_write(...)`
-- (20260728000006), so it is role-aware at the PERMISSIVE layer and a viewer is
-- refused by the policy itself. That is the intended shape for a new table —
-- see the argument recorded against `rtp_horizon_bands` and
-- `engagement_context_layers` in viewer-write-denial-guard.test.ts. It also
-- means these tables must NOT carry the three restrictive `_writer_only_*`
-- gates: that guard's "keeps the gate list honest" assertion fails a table that
-- is gated without having a role-blind policy for the gate to narrow.
--
-- Three tables are deliberately narrower than the usual four-policy set:
--
--   * `measure_recipients` has no DELETE policy — the `invoicing_clients`
--     posture. A recipient that has been paid public money must not vanish;
--     `is_active` retires it and every historic allocation keeps its payee.
--   * `measure_allocation_rules` has no UPDATE policy. A rule version is what
--     an ordinance said on a date; amending an ordinance inserts a new
--     effective-dated row. A rule that produced allocations cannot be deleted
--     either — `measure_allocations.allocation_rule_id` is ON DELETE RESTRICT,
--     so the provenance of a computed figure cannot be removed out from under
--     it.
--   * `measure_recipient_basis_values` has no UPDATE policy. A stated figure
--     with a named source and a stater is a record; restating it means a new
--     vintage, or deleting the wrong row and inserting the right one, both of
--     which leave `stated_by`/`stated_on` truthful.
--
-- ============================================================================
-- GUARD COUNTS THIS MIGRATION MOVES (the 20260811000007 convention)
-- ============================================================================
--
--   migrations/inventory.test.ts
--     policies            594 -> 615  (+21)
--     permissive          348 -> 369  (+21; every policy here is permissive)
--     restrictive         246 -> 246  (+0 — see the policy-shape note above)
--     permissiveWrites    224 -> 239  (+15 = 3+3+2+2+2+3)
--     expanded            264 -> 264  (+0; every policy is literal SQL)
--     tablesWithPolicies  124 -> 130  (+6)
--     relations           145 -> 151  (+6)
--     tables              138 -> 144  (+6)
--     views                 7 ->   7  (+0)
--     rlsEnabledTables    138 -> 144  (+6)
--
--   viewer-write-denial-guard.test.ts
--     EXPECTED_GATED_TABLES          82 ->  82  (+0)
--     EXPECTED_RESTRICTIVE_POLICIES 246 -> 246  (+0)
--     EXPECTED_PERMISSIVE_WRITE_... 224 -> 239  (+15)
--
--   rls-isolation.test.ts — six new `workspace_id` tables. They are excused on
--     PROBE_EXCUSED_TABLES rather than probed: that census is live-only and the
--     six are added in the same commit as the policies, so the honest entry is
--     the one that says the live cross-tenant proof is still owed.
--
-- The numbers above were confirmed by RUNNING the three suites, not derived.

------------------------------------------------------------------------------
-- 1. THE MEASURE
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.measure_funds (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  -- ONE measure per program record, and the program record is the measure's
  -- front door. UNIQUE rather than a plain FK: two fund rows on one program
  -- would be two answers to "what did the ordinance say".
  program_id           UUID NOT NULL UNIQUE REFERENCES public.programs(id) ON DELETE CASCADE,

  -- How the ordinance is cited locally, verbatim. A citation, never parsed.
  ordinance_reference  TEXT,
  -- "half-cent", "1 mill", "0.5%" — a LABEL for people to read. Deliberately
  -- text: OpenPlan never multiplies by a tax rate. What the fund received is a
  -- recorded receipt, not a rate times a base this product does not have.
  rate_label           TEXT,
  adopted_on           DATE,
  effective_from       DATE,

  -- A sunset has THREE states for the same reason a receipt does. A NULL date
  -- alone cannot say whether the ordinance has no sunset or whether nobody has
  -- entered it, and "this measure never expires" is not a thing to infer from
  -- an empty field.
  sunset_posture       TEXT NOT NULL DEFAULT 'not_recorded'
                         CHECK (sunset_posture IN ('dated', 'none_in_ordinance', 'not_recorded')),
  sunset_on            DATE,

  -- The cadence of the ACCOUNTING PERIOD, not of the deposits. 'irregular'
  -- exists so an ordinance this vocabulary does not anticipate still fits
  -- rather than being forced into a shape it is not.
  receipt_cadence      TEXT NOT NULL
                         CHECK (receipt_cadence IN ('monthly', 'quarterly', 'semiannual', 'annual', 'irregular')),

  -- NOT NULL, no default. See the header: a DEFAULT 'USD' is a country
  -- assumption, and this architecture may not assume the US.
  currency_code        TEXT NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),

  -- How this agency names and bounds its fiscal year, in its own words.
  -- OpenPlan never derives a fiscal year from a date: FY boundaries differ by
  -- jurisdiction and a wrong one silently regroups every annual figure.
  fiscal_year_note     TEXT,

  -- THE PUBLIC OVERSIGHT SURFACE. Defined here so that the lane which owns the
  -- public page never has to ALTER this table; every line of code that reads or
  -- writes these two columns lives in that lane. Off by default, and the token
  -- IS the credential (the /plan share-token posture, 20260727 and
  -- src/app/(public)/plan/[shareToken]/page.tsx).
  public_share_enabled BOOLEAN NOT NULL DEFAULT false,
  public_share_token   TEXT UNIQUE,

  created_by           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT measure_funds_sunset_posture_agrees
    CHECK ((sunset_posture = 'dated') = (sunset_on IS NOT NULL)),
  CONSTRAINT measure_funds_sunset_after_effective
    CHECK (sunset_on IS NULL OR effective_from IS NULL OR sunset_on >= effective_from),

  -- The target of every child's composite foreign key. Redundant with the
  -- primary key by itself; load-bearing as an FK target.
  CONSTRAINT measure_funds_id_workspace_uniq UNIQUE (id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_measure_funds_workspace
  ON public.measure_funds (workspace_id);

COMMENT ON TABLE public.measure_funds IS
  'A voter-approved local measure the workspace ADMINISTERS: ordinance dates, rate label, receipt cadence, currency, and the public oversight share token. The funder side of the reimbursement seam — the mirror of funding_awards, which is money the workspace receives.';
COMMENT ON COLUMN public.measure_funds.rate_label IS
  'A human label for the rate ("half-cent"). Never parsed and never multiplied by anything: receipts are recorded, not computed.';
COMMENT ON COLUMN public.measure_funds.public_share_token IS
  'The credential for the public oversight page. Presence does not enable it; public_share_enabled does.';

------------------------------------------------------------------------------
-- 2. RECEIPTS AND THE AGENCY'S OWN FORECAST
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.measure_fund_periods (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  measure_fund_id     UUID NOT NULL,

  -- The agency's own name for the period ("FY26 Q1"), and its own name for the
  -- fiscal year the period belongs to. Both stated, neither derived — see the
  -- note on fiscal_year_note above.
  period_label        TEXT NOT NULL CHECK (length(btrim(period_label)) > 0),
  fiscal_year_label   TEXT NOT NULL CHECK (length(btrim(fiscal_year_label)) > 0),
  period_start        DATE NOT NULL,
  period_end          DATE NOT NULL,

  -- THE AGENCY'S ADOPTED FORECAST. Not OpenPlan's estimate — this product has
  -- no taxable-sales model and will not pretend to.
  forecast_amount     NUMERIC(14,2) CHECK (forecast_amount IS NULL OR forecast_amount >= 0),
  forecast_basis_note TEXT,

  -- NULLABLE, NO DEFAULT. This is the column the whole design turns on: NULL
  -- means nobody has reported a receipt for this period, and 0.00 means a
  -- person recorded that the fund received nothing. `funding_awards`'
  -- NOT NULL DEFAULT 0 cannot hold that difference, and this one must.
  received_amount     NUMERIC(14,2) CHECK (received_amount IS NULL OR received_amount >= 0),
  received_on         DATE,
  receipt_source_note TEXT,

  recorded_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  recorded_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT measure_fund_periods_span_ordered CHECK (period_end >= period_start),
  -- A receipt DATE with no receipt AMOUNT would let a surface say "received on
  -- the 14th" about an amount nobody reported.
  CONSTRAINT measure_fund_periods_receipt_date_needs_amount
    CHECK (received_on IS NULL OR received_amount IS NOT NULL),
  CONSTRAINT measure_fund_periods_start_uniq UNIQUE (measure_fund_id, period_start),
  CONSTRAINT measure_fund_periods_label_uniq UNIQUE (measure_fund_id, period_label),
  CONSTRAINT measure_fund_periods_id_workspace_uniq UNIQUE (id, workspace_id),
  CONSTRAINT measure_fund_periods_fund_fk
    FOREIGN KEY (measure_fund_id, workspace_id)
    REFERENCES public.measure_funds (id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_measure_fund_periods_fund_start
  ON public.measure_fund_periods (measure_fund_id, period_start);
CREATE INDEX IF NOT EXISTS idx_measure_fund_periods_fiscal_year
  ON public.measure_fund_periods (measure_fund_id, fiscal_year_label);

COMMENT ON TABLE public.measure_fund_periods IS
  'One accounting period of a measure fund. Three states, deliberately: no row (never opened), received_amount NULL (opened, nothing reported), 0.00 (a person recorded that nothing arrived). A total spanning a NULL is a floor.';
COMMENT ON COLUMN public.measure_fund_periods.received_amount IS
  'What the fund actually received, as reported by a person from a remittance outside OpenPlan. NULL is unreported, never zero.';
COMMENT ON COLUMN public.measure_fund_periods.forecast_amount IS
  'The AGENCY''S OWN adopted forecast for this period. OpenPlan never projects a receipt.';

------------------------------------------------------------------------------
-- 3. THE ORDINANCE'S SPLIT, AS DATA
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.measure_allocation_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  measure_fund_id UUID NOT NULL,

  -- The descriptor. Its vocabulary is closed and is declared once, in
  -- src/lib/measures/allocation.ts; an ordinance the descriptor cannot express
  -- is stored as {version:1, kind:"narrative", text} and its allocations are
  -- entered by hand with computation_basis='manual'. Refusing honestly and
  -- offering a hand path beats both blocking those agencies and presenting
  -- hand figures as computed.
  rule            JSONB NOT NULL,

  -- Ordinances get amended, so rule versions are effective-dated rather than
  -- edited. There is no UPDATE policy on this table for that reason.
  effective_from  DATE NOT NULL,
  adopted_note    TEXT NOT NULL CHECK (length(btrim(adopted_note)) > 0),

  -- Who entered this reading of the ordinance, and when. ON DELETE RESTRICT
  -- follows stage_gate_decisions.decided_by (20260306000010): the author of a
  -- record about what a law says cannot be erased out from under it.
  stated_by       UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  stated_on       DATE NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT measure_allocation_rules_effective_uniq UNIQUE (measure_fund_id, effective_from),
  CONSTRAINT measure_allocation_rules_id_workspace_uniq UNIQUE (id, workspace_id),
  CONSTRAINT measure_allocation_rules_fund_fk
    FOREIGN KEY (measure_fund_id, workspace_id)
    REFERENCES public.measure_funds (id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_measure_allocation_rules_fund_effective
  ON public.measure_allocation_rules (measure_fund_id, effective_from DESC);

COMMENT ON TABLE public.measure_allocation_rules IS
  'What the ordinance says the money splits into, as an effective-dated JSONB descriptor. Immutable per version: an amendment is a new row, never an edit.';

------------------------------------------------------------------------------
-- 4. THE SUB-RECIPIENTS
------------------------------------------------------------------------------
-- NOT `invoicing_clients`. That table means "who this workspace bills"
-- (20260727000010). A city that is both a client and a sub-recipient would
-- occupy one row carrying two opposite money directions. The kind-vocabulary
-- shape and the deliberate no-DELETE posture are copied; the table is not.
CREATE TABLE IF NOT EXISTS public.measure_recipients (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  measure_fund_id    UUID NOT NULL,

  name               TEXT NOT NULL CHECK (length(btrim(name)) > 0),
  -- A grouping label for people reading a list, never an eligibility rule:
  -- what a recipient may claim comes from the ordinance's own category list.
  recipient_kind     TEXT NOT NULL DEFAULT 'other' CHECK (recipient_kind IN (
    'municipality', 'county', 'special_district', 'transit_operator',
    'tribal_government', 'regional_agency', 'nonprofit', 'other'
  )),
  -- The agency's own identifier for this recipient in its ledger, if it has one.
  external_reference TEXT,

  -- Retired rather than deleted. A recipient that has been paid public money
  -- must keep appearing on the historic record that paid it.
  is_active          BOOLEAN NOT NULL DEFAULT true,
  inactive_note      TEXT,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT measure_recipients_name_uniq UNIQUE (measure_fund_id, name),
  CONSTRAINT measure_recipients_id_workspace_uniq UNIQUE (id, workspace_id),
  CONSTRAINT measure_recipients_fund_fk
    FOREIGN KEY (measure_fund_id, workspace_id)
    REFERENCES public.measure_funds (id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_measure_recipients_fund_active
  ON public.measure_recipients (measure_fund_id, is_active);

COMMENT ON TABLE public.measure_recipients IS
  'A city, district or operator that claims against a measure fund. Distinct from invoicing_clients, which is who the workspace BILLS — the opposite direction of money. Retired with is_active; never deleted.';

------------------------------------------------------------------------------
-- 5. THE APPORTIONMENT INPUT — stated by a person, sourced by name
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.measure_recipient_basis_values (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  recipient_id      UUID NOT NULL,

  -- Which basis in the descriptor this figure answers ("population",
  -- "maintained_lane_miles", "parcels"). Matched against the rule's own
  -- basisDefinitions; no vocabulary is fixed here, because the ordinance names
  -- its own bases.
  basis_id          TEXT NOT NULL CHECK (length(btrim(basis_id)) > 0),
  -- WHICH EDITION of the figure. Ordinances apportion on a dated estimate, and
  -- two vintages must be able to coexist so a straddling period can use the one
  -- in force at its start rather than whatever was entered most recently.
  vintage_label     TEXT NOT NULL CHECK (length(btrim(vintage_label)) > 0),

  -- Four decimals because a basis is not always a count: lane miles and area
  -- are real numbers, and rounding a divisor changes every share.
  basis_value       NUMERIC(18,4) NOT NULL CHECK (basis_value >= 0),
  -- REQUIRED, and the reason this table exists rather than an auto-fetch. The
  -- ordinance names its own source; a figure with no stated source is a number
  -- somebody typed.
  basis_source_note TEXT NOT NULL CHECK (length(btrim(basis_source_note)) > 0),

  stated_by         UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  stated_on         DATE NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT measure_recipient_basis_values_uniq UNIQUE (recipient_id, basis_id, vintage_label),
  CONSTRAINT measure_recipient_basis_values_recipient_fk
    FOREIGN KEY (recipient_id, workspace_id)
    REFERENCES public.measure_recipients (id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_measure_recipient_basis_values_lookup
  ON public.measure_recipient_basis_values (recipient_id, basis_id, vintage_label);

COMMENT ON TABLE public.measure_recipient_basis_values IS
  'The population, mileage or parcel count an ordinance apportions on — STATED by a person with a named source, never fetched by OpenPlan and used as a divisor. Missing for one active recipient means the whole category reports as undistributed.';

------------------------------------------------------------------------------
-- 6. WHAT THE PERIOD ACTUALLY ALLOCATED
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.measure_allocations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  measure_fund_id    UUID NOT NULL,
  period_id          UUID NOT NULL,

  -- The category id from the rule descriptor in force. Text rather than a
  -- foreign key: the categories are an ordinance's own list, declared in the
  -- rule, and a table of them would be a second place for that list to live.
  category_id        TEXT NOT NULL CHECK (length(btrim(category_id)) > 0),
  -- NULL for a pooled category the agency programs itself; set for a
  -- return-to-source share.
  recipient_id       UUID,

  -- Which rule version produced this figure. RESTRICT, not CASCADE: deleting
  -- the ordinance reading that a stored money figure was computed from would
  -- leave the figure with no provenance at all.
  allocation_rule_id UUID REFERENCES public.measure_allocation_rules(id) ON DELETE RESTRICT,

  amount             NUMERIC(14,2) NOT NULL CHECK (amount >= 0),

  -- 'descriptor' = this lane's allocator computed it from a rule and a recorded
  -- receipt. 'manual' = a person entered it because the ordinance does not fit
  -- the descriptor. The two are NEVER rendered side by side without the
  -- distinction, and a manual figure must carry its reasoning.
  computation_basis  TEXT NOT NULL CHECK (computation_basis IN ('descriptor', 'manual')),
  rationale          TEXT,

  stated_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  stated_on          DATE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT measure_allocations_manual_needs_rationale
    CHECK (computation_basis <> 'manual' OR length(btrim(coalesce(rationale, ''))) > 0),
  CONSTRAINT measure_allocations_computed_needs_rule
    CHECK (computation_basis <> 'descriptor' OR allocation_rule_id IS NOT NULL),
  CONSTRAINT measure_allocations_period_fk
    FOREIGN KEY (period_id, workspace_id)
    REFERENCES public.measure_fund_periods (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT measure_allocations_fund_fk
    FOREIGN KEY (measure_fund_id, workspace_id)
    REFERENCES public.measure_funds (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT measure_allocations_recipient_fk
    FOREIGN KEY (recipient_id, workspace_id)
    REFERENCES public.measure_recipients (id, workspace_id) ON DELETE RESTRICT
);

-- TWO PARTIAL UNIQUE INDEXES RATHER THAN ONE THREE-COLUMN CONSTRAINT. NULLs are
-- DISTINCT in a unique index, so `UNIQUE (period_id, category_id, recipient_id)`
-- would permit unlimited duplicate POOLED rows — the exact trap
-- 20260811000007's header records for a nullable key column, and here it would
-- double-count a category's money.
CREATE UNIQUE INDEX IF NOT EXISTS ux_measure_allocations_pooled
  ON public.measure_allocations (period_id, category_id)
  WHERE recipient_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_measure_allocations_recipient
  ON public.measure_allocations (period_id, category_id, recipient_id)
  WHERE recipient_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_measure_allocations_fund_period
  ON public.measure_allocations (measure_fund_id, period_id);
CREATE INDEX IF NOT EXISTS idx_measure_allocations_recipient
  ON public.measure_allocations (recipient_id) WHERE recipient_id IS NOT NULL;

COMMENT ON TABLE public.measure_allocations IS
  'What one period allocated to one category, and to one recipient where the ordinance returns money to source. computation_basis says whether the allocator derived it from a rule or a person entered it by hand; a manual figure is never shown as a computed one.';

------------------------------------------------------------------------------
-- 7. RLS
------------------------------------------------------------------------------
ALTER TABLE public.measure_funds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.measure_fund_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.measure_allocation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.measure_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.measure_recipient_basis_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.measure_allocations ENABLE ROW LEVEL SECURITY;

-- measure_funds
DROP POLICY IF EXISTS measure_funds_read ON public.measure_funds;
CREATE POLICY measure_funds_read ON public.measure_funds FOR SELECT USING (
  workspace_id IN (SELECT wm.workspace_id FROM public.workspace_members wm WHERE wm.user_id = auth.uid()));

DROP POLICY IF EXISTS measure_funds_insert ON public.measure_funds;
CREATE POLICY measure_funds_insert ON public.measure_funds FOR INSERT
  WITH CHECK (public.workspace_member_can_write(workspace_id));

DROP POLICY IF EXISTS measure_funds_update ON public.measure_funds;
CREATE POLICY measure_funds_update ON public.measure_funds FOR UPDATE
  USING (public.workspace_member_can_write(workspace_id))
  WITH CHECK (public.workspace_member_can_write(workspace_id));

DROP POLICY IF EXISTS measure_funds_delete ON public.measure_funds;
CREATE POLICY measure_funds_delete ON public.measure_funds FOR DELETE
  USING (public.workspace_member_can_write(workspace_id));

-- measure_fund_periods
DROP POLICY IF EXISTS measure_fund_periods_read ON public.measure_fund_periods;
CREATE POLICY measure_fund_periods_read ON public.measure_fund_periods FOR SELECT USING (
  workspace_id IN (SELECT wm.workspace_id FROM public.workspace_members wm WHERE wm.user_id = auth.uid()));

DROP POLICY IF EXISTS measure_fund_periods_insert ON public.measure_fund_periods;
CREATE POLICY measure_fund_periods_insert ON public.measure_fund_periods FOR INSERT
  WITH CHECK (public.workspace_member_can_write(workspace_id));

DROP POLICY IF EXISTS measure_fund_periods_update ON public.measure_fund_periods;
CREATE POLICY measure_fund_periods_update ON public.measure_fund_periods FOR UPDATE
  USING (public.workspace_member_can_write(workspace_id))
  WITH CHECK (public.workspace_member_can_write(workspace_id));

DROP POLICY IF EXISTS measure_fund_periods_delete ON public.measure_fund_periods;
CREATE POLICY measure_fund_periods_delete ON public.measure_fund_periods FOR DELETE
  USING (public.workspace_member_can_write(workspace_id));

-- measure_allocation_rules — no UPDATE, by design (see the header).
DROP POLICY IF EXISTS measure_allocation_rules_read ON public.measure_allocation_rules;
CREATE POLICY measure_allocation_rules_read ON public.measure_allocation_rules FOR SELECT USING (
  workspace_id IN (SELECT wm.workspace_id FROM public.workspace_members wm WHERE wm.user_id = auth.uid()));

DROP POLICY IF EXISTS measure_allocation_rules_insert ON public.measure_allocation_rules;
CREATE POLICY measure_allocation_rules_insert ON public.measure_allocation_rules FOR INSERT
  WITH CHECK (public.workspace_member_can_write(workspace_id));

DROP POLICY IF EXISTS measure_allocation_rules_delete ON public.measure_allocation_rules;
CREATE POLICY measure_allocation_rules_delete ON public.measure_allocation_rules FOR DELETE
  USING (public.workspace_member_can_write(workspace_id));

-- measure_recipients — no DELETE, by design (the invoicing_clients posture).
DROP POLICY IF EXISTS measure_recipients_read ON public.measure_recipients;
CREATE POLICY measure_recipients_read ON public.measure_recipients FOR SELECT USING (
  workspace_id IN (SELECT wm.workspace_id FROM public.workspace_members wm WHERE wm.user_id = auth.uid()));

DROP POLICY IF EXISTS measure_recipients_insert ON public.measure_recipients;
CREATE POLICY measure_recipients_insert ON public.measure_recipients FOR INSERT
  WITH CHECK (public.workspace_member_can_write(workspace_id));

DROP POLICY IF EXISTS measure_recipients_update ON public.measure_recipients;
CREATE POLICY measure_recipients_update ON public.measure_recipients FOR UPDATE
  USING (public.workspace_member_can_write(workspace_id))
  WITH CHECK (public.workspace_member_can_write(workspace_id));

-- measure_recipient_basis_values — no UPDATE, by design (the header).
DROP POLICY IF EXISTS measure_recipient_basis_values_read ON public.measure_recipient_basis_values;
CREATE POLICY measure_recipient_basis_values_read ON public.measure_recipient_basis_values FOR SELECT USING (
  workspace_id IN (SELECT wm.workspace_id FROM public.workspace_members wm WHERE wm.user_id = auth.uid()));

DROP POLICY IF EXISTS measure_recipient_basis_values_insert ON public.measure_recipient_basis_values;
CREATE POLICY measure_recipient_basis_values_insert ON public.measure_recipient_basis_values FOR INSERT
  WITH CHECK (public.workspace_member_can_write(workspace_id));

DROP POLICY IF EXISTS measure_recipient_basis_values_delete ON public.measure_recipient_basis_values;
CREATE POLICY measure_recipient_basis_values_delete ON public.measure_recipient_basis_values FOR DELETE
  USING (public.workspace_member_can_write(workspace_id));

-- measure_allocations
DROP POLICY IF EXISTS measure_allocations_read ON public.measure_allocations;
CREATE POLICY measure_allocations_read ON public.measure_allocations FOR SELECT USING (
  workspace_id IN (SELECT wm.workspace_id FROM public.workspace_members wm WHERE wm.user_id = auth.uid()));

DROP POLICY IF EXISTS measure_allocations_insert ON public.measure_allocations;
CREATE POLICY measure_allocations_insert ON public.measure_allocations FOR INSERT
  WITH CHECK (public.workspace_member_can_write(workspace_id));

DROP POLICY IF EXISTS measure_allocations_update ON public.measure_allocations;
CREATE POLICY measure_allocations_update ON public.measure_allocations FOR UPDATE
  USING (public.workspace_member_can_write(workspace_id))
  WITH CHECK (public.workspace_member_can_write(workspace_id));

DROP POLICY IF EXISTS measure_allocations_delete ON public.measure_allocations;
CREATE POLICY measure_allocations_delete ON public.measure_allocations FOR DELETE
  USING (public.workspace_member_can_write(workspace_id));

------------------------------------------------------------------------------
-- 8. GRANTS — required, and revoked FIRST.
------------------------------------------------------------------------------
-- These tables are created after 20260804000001 flipped default privileges to
-- deny, so they are born with nothing for the client roles. A permissive policy
-- with no matching GRANT is a door with no handle: PostgREST answers
-- `permission denied` before RLS is ever consulted, which is exactly how the
-- v0.14.0 notification inbox shipped unusable.
-- `a-policy-without-a-grant-is-a-locked-door.test.ts` fails the build for it.
--
-- The revoke runs FIRST and that is not cosmetic: Postgres drops column
-- privileges along with table-level ones, so a revoke placed after a grant
-- destroys it. It also records the denial in the migration corpus, where the
-- grant-composition guard can see a future blanket GRANT widening it.
--
-- Each GRANT names exactly the commands that table's permissive policies
-- promise — no DELETE on `measure_recipients`, no UPDATE on
-- `measure_allocation_rules` or `measure_recipient_basis_values`. A privilege
-- granted past a policy is a policy a future migration can quietly widen into.
--
-- `anon` gets NOTHING, on every one of the six. The public oversight page is a
-- service-role read behind a share token; it is not, and must never become, an
-- anonymous PostgREST read of a fund's ledger.

REVOKE ALL ON TABLE public.measure_funds FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.measure_fund_periods FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.measure_allocation_rules FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.measure_recipients FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.measure_recipient_basis_values FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.measure_allocations FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.measure_funds TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.measure_fund_periods TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.measure_allocation_rules TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.measure_recipients TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.measure_recipient_basis_values TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.measure_allocations TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.measure_funds TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.measure_fund_periods TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.measure_allocation_rules TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.measure_recipients TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.measure_recipient_basis_values TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.measure_allocations TO service_role;
