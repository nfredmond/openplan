-- CLAIMS AGAINST A LOCAL MEASURE FUND — the reimbursement seam, running backwards.
--
-- ============================================================================
-- WHAT CHANGES WHEN THE DIRECTION REVERSES
-- ============================================================================
--
-- `billing_invoice_records` (20260321000033) is this workspace ASKING its funder
-- for money it has already spent. These tables are the mirror: a city, district
-- or transit operator asks THIS workspace for money out of a voter-approved
-- fund the workspace administers (20260812000011).
--
-- Almost everything about the shape carries over unchanged, and deliberately so
-- — `src/lib/measures/claims.ts` IMPORTS `parseCurrencyAmount`,
-- `roundCurrencyAmount`, `computeInvoiceRetentionWithheld` and
-- `computeNetInvoiceAmount` from the invoice register rather than restating
-- them, so a claim's net and an invoice's net can never be computed two ways.
-- The status partition is the same partition: CLAIMED is everything asked for
-- and not refused, and the excluded groups are reported as their own figures
-- rather than folded into a total.
--
-- THREE THINGS ARE GENUINELY DIFFERENT, because here the agency DECIDES rather
-- than requests. Each one is a column or a CHECK below, not a convention:
--
--   1. A DECISION HAS AN AUTHOR. Every state past `submitted` records
--      `decided_by` and `decided_at`, enforced by CHECK. On an invoice the
--      funder's decision arrives from outside and OpenPlan only records that it
--      happened; here the decision IS a workspace act, and public money leaves
--      on the strength of it. A decision nobody signed is not a decision an
--      oversight committee can audit.
--   2. A DENIAL MUST SAY WHY. `denial_reason` is CHECKed non-empty when the
--      status is `denied`. A refused claim with no reason is unappealable, and
--      the claimant is a separate public body with its own council to answer to.
--   3. `paid` REQUIRES `paid_on`. This is a DEFECT FIX, not an inheritance:
--      `billing_invoice_records` tolerates a paid row with no date, and
--      `buildAwardDrawdownLedger` pays for it with a `paidWithNoDateCount` it
--      has to carry on every read (drawdown-ledger.ts:144). The claim ledger
--      still reports that count — but on this table it can only ever be zero,
--      and a non-zero one means this CHECK was removed.
--
-- ============================================================================
-- WHAT A CLAIM MAY BE FOR IS THE ORDINANCE'S ANSWER, NOT A COLUMN'S
-- ============================================================================
--
-- `category_id` is TEXT with no vocabulary CHECK and no foreign key, for the
-- same reason `measure_allocations.category_id` is: the categories are an
-- ordinance's own list, declared in `measure_allocation_rules.rule`, and a
-- table of them would be a second place for that list to live. Eligibility is
-- enforced in `src/app/api/measures/[measureId]/claims/route.ts` against the
-- rule version in force at the claim's own period — a category the measure does
-- not declare is refused with the declared list named. There is no hardcoded
-- category anywhere in this lane, and `measure-claim-ledger.test.ts` runs two
-- differently-shaped measures through the same code to prove it.
--
-- `period_id` is NOT NULL for that reason. Without a period there is no date,
-- and without a date there is no rule version in force — so there would be
-- nothing to check the category against.
--
-- ============================================================================
-- BACKUP DOCUMENTS GO WHERE THE FILES ALREADY LIVE
-- ============================================================================
--
-- `measure_claim_documents` is a LINK table onto `kb_documents`. No second byte
-- store, no second storage bucket, and NO new Document Library source: the
-- library already indexes `kb_documents` (src/lib/document-library/sources.ts),
-- so adding a source here would list the same file twice under two headings.
--
-- `kb_document_id` is ON DELETE RESTRICT, following `rtp_extraction_runs`
-- (20260811000008): deleting the invoice that substantiated a paid claim out of
-- a public fund would strand the claim's evidence while leaving the payment on
-- the record. The refusal is the database's, so nobody has to remember it.
--
-- ============================================================================
-- MAINTENANCE OF EFFORT HAS NO VERDICT COLUMN
-- ============================================================================
--
-- Most self-help ordinances forbid a recipient from replacing its own local
-- spending with measure money. `measure_moe_records` stores the required figure
-- and the reported figure, BOTH NULLABLE, and stores no verdict.
--
-- That is deliberate and it is the `buildRtpFiscalConstraint` posture
-- (src/lib/rtp/fiscal-constraint.ts) where `not_determined` is first-class and
-- outranks: the difference is computed only where both sides are present, and
-- absence answers not_determined rather than "met". A stored compliance verdict
-- would also be exactly the tier-guard blind spot already recorded against the
-- RTP fiscal verdict — a computed judgement with no column for the guard to
-- see. Here there is no column at all, so there is nothing to promote.
--
-- ============================================================================
-- POLICY SHAPE, AND THE ONE POLICY THAT IS A MECHANISM
-- ============================================================================
--
-- Role-aware permissive, no restrictive gate — Lane 1's posture and the
-- argument recorded in 20260812000011's header. Every write policy calls
-- `public.workspace_member_can_write` (20260728000006), so a viewer is refused
-- by the policy itself and these tables never enter
-- `viewer-write-denial-guard.test.ts`'s `tablesNeedingGate()`.
--
-- `measure_claims_delete` narrows further, and this is the interesting one:
--
--     USING (workspace_member_can_write(workspace_id) AND status = 'draft')
--
-- A claim that has been submitted is a public body's request on the record, and
-- a paid one is a disbursement. Neither may be deleted — only withdrawn or
-- denied, both of which leave the row and its reason behind. Putting that in
-- the POLICY rather than in the route makes it a mechanism: a second route, a
-- script, or a future agent action inherits the refusal without knowing it
-- exists. `measure_claim_documents` has no UPDATE policy for a smaller version
-- of the same reason — an attachment asserts that this document substantiates
-- this claim, and an assertion is withdrawn by detaching, not edited.
--
-- ============================================================================
-- GUARD COUNTS THIS MIGRATION MOVES (the 20260811000007 convention)
-- ============================================================================
--
--   migrations/inventory.test.ts
--     policies            615 -> 626  (+11)
--     permissive          369 -> 380  (+11; every policy here is permissive)
--     restrictive         246 -> 246  (+0 — see the policy-shape note above)
--     permissiveWrites    239 -> 247  (+8 = 3+2+3)
--     expanded            264 -> 264  (+0; every policy is literal SQL)
--     tablesWithPolicies  130 -> 133  (+3)
--     relations           151 -> 154  (+3)
--     tables              144 -> 147  (+3)
--     views                 7 ->   7  (+0)
--     rlsEnabledTables    144 -> 147  (+3)
--
--   viewer-write-denial-guard.test.ts
--     EXPECTED_GATED_TABLES          82 ->  82  (+0)
--     EXPECTED_RESTRICTIVE_POLICIES 246 -> 246  (+0)
--     EXPECTED_PERMISSIVE_WRITE_... 239 -> 247  (+8)
--
--   rls-isolation.test.ts — three more `workspace_id` tables, excused on
--     PROBE_EXCUSED_TABLES with the same honest reason as Lane 1's six: the
--     boundary is written, the live cross-tenant proof is still owed.
--
-- The numbers above were confirmed by RUNNING the three suites, not derived.

------------------------------------------------------------------------------
-- 1. THE CLAIM
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.measure_claims (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  measure_fund_id    UUID NOT NULL,

  -- WHO is asking. RESTRICT rather than CASCADE, matching the no-DELETE posture
  -- on `measure_recipients`: a body that has been paid public money keeps
  -- appearing on the record that paid it, so it cannot be erased out from under
  -- its own claims. `is_active` retires it instead.
  recipient_id       UUID NOT NULL,

  -- WHICH period the expenditure belongs to. NOT NULL because the rule version
  -- in force is resolved from the period's start date, and a claim with no
  -- period has no ordinance to be eligible under.
  period_id          UUID NOT NULL,

  -- The agency's own name for the fiscal year, denormalized from the period so
  -- the claim ledger can bucket by year without a join. OpenPlan never derives
  -- a fiscal year from a date: FY boundaries differ by jurisdiction and a wrong
  -- one silently regroups every annual figure.
  fiscal_year_label  TEXT NOT NULL CHECK (length(btrim(fiscal_year_label)) > 0),

  -- WHAT FOR, in the ordinance's own vocabulary. No CHECK and no FK: see the
  -- header. The route refuses a category the measure does not declare.
  category_id        TEXT NOT NULL CHECK (length(btrim(category_id)) > 0),

  -- The CLAIMANT'S own number for this claim, if it uses one. Unique per
  -- recipient (partial index below) so two submissions of the same claim
  -- number cannot both be paid.
  claim_reference    TEXT,
  description        TEXT,

  -- The money. Same shapes and the same arithmetic as the invoice register —
  -- `src/lib/measures/claims.ts` imports the four functions rather than
  -- restating them, so a claim's net and an invoice's net agree to the cent.
  amount             NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  -- Retention: the columns exist, default 0, and no new formula either way.
  -- An agency that withholds nothing is unaffected; one that does gets the
  -- register's rule, where an explicit amount outranks the percentage.
  retention_percent  NUMERIC(6,3) NOT NULL DEFAULT 0
                       CHECK (retention_percent >= 0 AND retention_percent <= 100),
  retention_amount   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (retention_amount >= 0),

  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'submitted', 'under_review', 'approved', 'paid', 'denied', 'withdrawn'
  )),
  submitted_on       DATE,

  -- THE DECISION, and its author. See the header: this is what makes the funder
  -- side different from the claimant side.
  decided_by         UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  decided_at         TIMESTAMPTZ,
  decision_note      TEXT,
  denial_reason      TEXT,

  paid_on            DATE,
  payment_reference  TEXT,

  created_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A claim that has left draft was submitted on some day, and a surface that
  -- has to say "submitted" with no date says it about nothing.
  CONSTRAINT measure_claims_left_draft_has_a_date
    CHECK (status = 'draft' OR submitted_on IS NOT NULL),

  -- Every state past submitted is a workspace decision, and a decision nobody
  -- signed cannot be audited a year later by the committee that has to.
  CONSTRAINT measure_claims_decision_has_an_author
    CHECK (
      status IN ('draft', 'submitted', 'withdrawn')
      OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)
    ),

  -- A refused claim with no reason is unappealable.
  CONSTRAINT measure_claims_denial_states_a_reason
    CHECK (status <> 'denied' OR length(btrim(coalesce(denial_reason, ''))) > 0),

  -- THE DEFECT FIX. `billing_invoice_records` permits a paid row with no date;
  -- this table does not. See the header.
  CONSTRAINT measure_claims_paid_has_a_date
    CHECK (status <> 'paid' OR paid_on IS NOT NULL),

  CONSTRAINT measure_claims_id_workspace_uniq UNIQUE (id, workspace_id),
  CONSTRAINT measure_claims_fund_fk
    FOREIGN KEY (measure_fund_id, workspace_id)
    REFERENCES public.measure_funds (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT measure_claims_recipient_fk
    FOREIGN KEY (recipient_id, workspace_id)
    REFERENCES public.measure_recipients (id, workspace_id) ON DELETE RESTRICT,
  CONSTRAINT measure_claims_period_fk
    FOREIGN KEY (period_id, workspace_id)
    REFERENCES public.measure_fund_periods (id, workspace_id) ON DELETE RESTRICT
);

-- Partial, because NULLs are DISTINCT in a unique index: a plain
-- `UNIQUE (recipient_id, claim_reference)` would be satisfied by any number of
-- rows that leave the reference blank, which is the majority of them.
CREATE UNIQUE INDEX IF NOT EXISTS ux_measure_claims_recipient_reference
  ON public.measure_claims (recipient_id, claim_reference)
  WHERE claim_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_measure_claims_fund_status
  ON public.measure_claims (measure_fund_id, status);
CREATE INDEX IF NOT EXISTS idx_measure_claims_recipient_year
  ON public.measure_claims (recipient_id, fiscal_year_label);
CREATE INDEX IF NOT EXISTS idx_measure_claims_period
  ON public.measure_claims (period_id);
-- The review queue the reminder sweep reads: claims waiting on a decision.
CREATE INDEX IF NOT EXISTS idx_measure_claims_awaiting_decision
  ON public.measure_claims (measure_fund_id, submitted_on)
  WHERE status IN ('submitted', 'under_review');

COMMENT ON TABLE public.measure_claims IS
  'One sub-recipient''s request for money out of a local measure fund. The mirror of billing_invoice_records with the direction of money reversed: here the workspace is the funder and DECIDES, so every state past submitted records who decided and when, a denial must state a reason, and a paid claim must carry its payment date (which billing_invoice_records does not require).';
COMMENT ON COLUMN public.measure_claims.category_id IS
  'The ordinance''s own category id, from the allocation rule in force at this claim''s period. No CHECK here on purpose — the categories are data, and the route refuses one the measure does not declare.';
COMMENT ON COLUMN public.measure_claims.paid_on IS
  'Required whenever status is paid. billing_invoice_records tolerates a paid row with no date and the drawdown ledger carries a paidWithNoDateCount because of it; this table fixes the defect rather than inheriting it.';

------------------------------------------------------------------------------
-- 2. THE BACKUP DOCUMENTS — a link, not a second store
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.measure_claim_documents (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  claim_id       UUID NOT NULL,

  -- The Knowledge Base holds the bytes and the Document Library already indexes
  -- it. RESTRICT: the evidence for a paid public claim may not be deleted while
  -- the payment stands.
  kb_document_id UUID NOT NULL REFERENCES public.kb_documents(id) ON DELETE RESTRICT,

  -- What this file is FOR, so a reviewer can see at a glance whether the claim
  -- is substantiated. A grouping label, never an eligibility rule.
  document_role  TEXT NOT NULL DEFAULT 'other' CHECK (document_role IN (
    'invoice', 'proof_of_payment', 'progress_report', 'photo', 'other'
  )),
  note           TEXT,

  attached_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  attached_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT measure_claim_documents_uniq UNIQUE (claim_id, kb_document_id),
  CONSTRAINT measure_claim_documents_claim_fk
    FOREIGN KEY (claim_id, workspace_id)
    REFERENCES public.measure_claims (id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_measure_claim_documents_claim
  ON public.measure_claim_documents (claim_id);
CREATE INDEX IF NOT EXISTS idx_measure_claim_documents_document
  ON public.measure_claim_documents (kb_document_id);

COMMENT ON TABLE public.measure_claim_documents IS
  'Backup for a claim: a link onto kb_documents, which the Document Library already indexes. No second byte store and no new library source — adding one would list the same file twice.';

------------------------------------------------------------------------------
-- 3. MAINTENANCE OF EFFORT — two figures, no verdict
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.measure_moe_records (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  measure_fund_id   UUID NOT NULL,
  recipient_id      UUID NOT NULL,

  -- The agency's own name for the year, matching measure_fund_periods.
  fiscal_year_label TEXT NOT NULL CHECK (length(btrim(fiscal_year_label)) > 0),

  -- BOTH NULLABLE, and that is the design. The required figure comes from the
  -- ordinance and the reported figure from the recipient's own accounts; they
  -- arrive months apart, and a NOT NULL DEFAULT 0 on either would make an
  -- unanswered year read as a total failure to spend.
  required_amount   NUMERIC(14,2) CHECK (required_amount IS NULL OR required_amount >= 0),
  reported_amount   NUMERIC(14,2) CHECK (reported_amount IS NULL OR reported_amount >= 0),

  -- NO VERDICT COLUMN, deliberately. See the header.
  basis_note        TEXT NOT NULL CHECK (length(btrim(basis_note)) > 0),

  -- Rewritten on every update, so the record always names who last stated it.
  -- UPDATE is allowed here (unlike measure_recipient_basis_values) precisely
  -- because the two figures arrive at different times of the year, and forcing
  -- a delete-and-reinsert would lose the earlier statement's own history for no
  -- gain.
  stated_by         UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  stated_on         DATE NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT measure_moe_records_uniq UNIQUE (recipient_id, fiscal_year_label),
  CONSTRAINT measure_moe_records_fund_fk
    FOREIGN KEY (measure_fund_id, workspace_id)
    REFERENCES public.measure_funds (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT measure_moe_records_recipient_fk
    FOREIGN KEY (recipient_id, workspace_id)
    REFERENCES public.measure_recipients (id, workspace_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_measure_moe_records_fund_year
  ON public.measure_moe_records (measure_fund_id, fiscal_year_label);

COMMENT ON TABLE public.measure_moe_records IS
  'What an ordinance requires a recipient to keep spending from its own funds, and what it reported spending. Both nullable and NO verdict column: the difference is computed only where both are present, and absence answers not_determined — the buildRtpFiscalConstraint posture.';

------------------------------------------------------------------------------
-- 4. RLS
------------------------------------------------------------------------------
ALTER TABLE public.measure_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.measure_claim_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.measure_moe_records ENABLE ROW LEVEL SECURITY;

-- measure_claims
DROP POLICY IF EXISTS measure_claims_read ON public.measure_claims;
CREATE POLICY measure_claims_read ON public.measure_claims FOR SELECT USING (
  workspace_id IN (SELECT wm.workspace_id FROM public.workspace_members wm WHERE wm.user_id = auth.uid()));

DROP POLICY IF EXISTS measure_claims_insert ON public.measure_claims;
CREATE POLICY measure_claims_insert ON public.measure_claims FOR INSERT
  WITH CHECK (public.workspace_member_can_write(workspace_id));

DROP POLICY IF EXISTS measure_claims_update ON public.measure_claims;
CREATE POLICY measure_claims_update ON public.measure_claims FOR UPDATE
  USING (public.workspace_member_can_write(workspace_id))
  WITH CHECK (public.workspace_member_can_write(workspace_id));

-- A DRAFT MAY BE DISCARDED; A SUBMITTED CLAIM MAY NOT BE ERASED. Withdrawn and
-- denied both leave the row and its reason on the record. In the policy rather
-- than the route so a second writer inherits the refusal.
DROP POLICY IF EXISTS measure_claims_delete ON public.measure_claims;
CREATE POLICY measure_claims_delete ON public.measure_claims FOR DELETE
  USING (public.workspace_member_can_write(workspace_id) AND status = 'draft');

-- measure_claim_documents — no UPDATE, by design (see the header).
DROP POLICY IF EXISTS measure_claim_documents_read ON public.measure_claim_documents;
CREATE POLICY measure_claim_documents_read ON public.measure_claim_documents FOR SELECT USING (
  workspace_id IN (SELECT wm.workspace_id FROM public.workspace_members wm WHERE wm.user_id = auth.uid()));

DROP POLICY IF EXISTS measure_claim_documents_insert ON public.measure_claim_documents;
CREATE POLICY measure_claim_documents_insert ON public.measure_claim_documents FOR INSERT
  WITH CHECK (public.workspace_member_can_write(workspace_id));

DROP POLICY IF EXISTS measure_claim_documents_delete ON public.measure_claim_documents;
CREATE POLICY measure_claim_documents_delete ON public.measure_claim_documents FOR DELETE
  USING (public.workspace_member_can_write(workspace_id));

-- measure_moe_records
DROP POLICY IF EXISTS measure_moe_records_read ON public.measure_moe_records;
CREATE POLICY measure_moe_records_read ON public.measure_moe_records FOR SELECT USING (
  workspace_id IN (SELECT wm.workspace_id FROM public.workspace_members wm WHERE wm.user_id = auth.uid()));

DROP POLICY IF EXISTS measure_moe_records_insert ON public.measure_moe_records;
CREATE POLICY measure_moe_records_insert ON public.measure_moe_records FOR INSERT
  WITH CHECK (public.workspace_member_can_write(workspace_id));

DROP POLICY IF EXISTS measure_moe_records_update ON public.measure_moe_records;
CREATE POLICY measure_moe_records_update ON public.measure_moe_records FOR UPDATE
  USING (public.workspace_member_can_write(workspace_id))
  WITH CHECK (public.workspace_member_can_write(workspace_id));

DROP POLICY IF EXISTS measure_moe_records_delete ON public.measure_moe_records;
CREATE POLICY measure_moe_records_delete ON public.measure_moe_records FOR DELETE
  USING (public.workspace_member_can_write(workspace_id));

------------------------------------------------------------------------------
-- 5. GRANTS — required, and revoked FIRST.
------------------------------------------------------------------------------
-- Born after 20260804000001 flipped default privileges to deny, so these tables
-- start with nothing for the client roles. A permissive policy with no matching
-- GRANT is a door with no handle: PostgREST answers `permission denied` before
-- RLS is consulted, which is how the v0.14.0 notification inbox shipped
-- unusable. `a-policy-without-a-grant-is-a-locked-door.test.ts` fails the build
-- for it.
--
-- The revoke runs FIRST and that is not cosmetic: Postgres drops column
-- privileges along with table-level ones, so a revoke placed after a grant
-- destroys it.
--
-- Each GRANT names exactly the commands that table's policies promise — no
-- UPDATE on `measure_claim_documents`. The DELETE on `measure_claims` is
-- granted because the policy promises one; the policy itself is what narrows it
-- to drafts, and a privilege can never be narrower than a policy.
--
-- `anon` gets NOTHING on all three. A claim carries a public body's finances
-- and a named decision-maker; the public oversight page is a service-role read
-- behind a share token and must never become an anonymous PostgREST read of the
-- claim register.

REVOKE ALL ON TABLE public.measure_claims FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.measure_claim_documents FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.measure_moe_records FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.measure_claims TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.measure_claim_documents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.measure_moe_records TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.measure_claims TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.measure_claim_documents TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.measure_moe_records TO service_role;
