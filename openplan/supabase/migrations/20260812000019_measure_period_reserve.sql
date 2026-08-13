-- WHAT THE ORDINANCE KEPT BACK — the last gap in a public fund's arithmetic.
--
-- ============================================================================
-- THE DEFECT
-- ============================================================================
--
-- An allocation rule can declare RESERVES: a percentage held back out of the
-- whole receipt ('gross'), out of what is left after the amounts that come off
-- the top ('after_off_the_top'), or out of ONE of the ordinance's own purposes
-- ('category:<id>'). `allocateMeasureReceipt` computes every one of them and
-- reports them in its result — and then the allocate route wrote only the
-- CATEGORY rows and the OFF-THE-TOP rows. What a period held back was
-- recoverable from nothing.
--
-- The cost landed on the surface with the least equipped reader. The public
-- oversight page and the annual statement print
--
--     received  −  taken out first  =  left for the purposes below
--
-- and then compare the right-hand side against what the ordinance's purposes
-- were actually given. For a fund that holds a reserve those two disagree by
-- exactly the reserve, every period, forever — and the settlement sentence had
-- to name a held-back reserve as a POSSIBLE cause, because the amount was
-- genuinely unrecoverable from the record. Honest, and weaker than closing it:
-- a citizens' oversight committee was shown a difference the product could
-- neither explain nor rule out.
--
-- Persisting the reserve closes the chain:
--
--     received  −  taken out first  −  held back in reserve
--       =  Σ what the purposes were given, exactly
--
-- because Σ `measure_allocations.amount` for a period is Σ of each category's
-- PROGRAMMABLE amount, which is `allocable − Σ category reserves`, and
-- `allocable` is `receipt − Σ off-the-top − Σ pool reserves`. The three
-- subtractions above are those three sums.
--
-- ============================================================================
-- WHY IT IS A SECOND TABLE AND NOT MORE ROWS IN measure_period_off_the_top
-- ============================================================================
--
-- The 20260812000014 header argues that an off-the-top is not a category row
-- because it belongs to no category. A reserve is not an off-the-top for the
-- mirror-image reason: it is not taken OUT of the fund at all. The money stays
-- in the measure and is spent later, which is the whole point of a reserve, and
-- a resident reading "taken out first" about it would be told something false.
-- A `kind` column on one table would have made the distinction a value that
-- every reader has to remember to filter on; two tables make it a shape.
--
-- The columns diverge as well. An off-the-top has a CAP and a cap status; a
-- reserve has no cap in the descriptor's vocabulary — its only limit is that it
-- cannot exceed what remains. A reserve has a BASIS (what the percentage was
-- taken of) which an off-the-top does not: an off-the-top is always a
-- percentage of the receipt or a flat amount.
--
-- ============================================================================
-- WHY THE BASIS IS THREE COLUMNS AND NOT THE DESCRIPTOR'S ONE STRING
-- ============================================================================
--
-- The rule spells a category reserve's basis as the single string
-- `category:transit`. Storing that verbatim would make every reader parse a
-- prefix to find out what kind of reserve it is, and one reader that forgot
-- would show a purpose-level reserve as if it came out of the whole payment.
--
--   basis_kind           'gross' | 'after_off_the_top' | 'category'  — closed
--   basis_category_id    the purpose's own id, only for 'category'
--   basis_category_label the purpose's label AS IT READ WHEN THE MONEY WAS
--                        HELD BACK
--
-- The label is denormalized for the reason `measure_period_off_the_top.label`
-- is: a later rule version may rename or drop the purpose, and a historical
-- reserve must still be able to say what it was held out of. It also keeps the
-- public surfaces from having to resolve a category id against a rule version
-- they did not read — a join that would silently print an id when it missed.
--
-- `basis_amount` is the figure the percentage was actually taken of, stored so
-- a committee member can check the arithmetic without recomputing an old rule
-- version against an old receipt. `computed_amount` beside `amount` is the same
-- pairing `uncapped_amount`/`amount` makes next door: they differ exactly when
-- the reserve was limited to what remained, and both are needed to say so.
--
-- ============================================================================
-- THE FUNCTION IS REPLACED, NOT OVERLOADED
-- ============================================================================
--
-- `replace_measure_period_allocation` gains `p_reserves`. A `CREATE OR REPLACE`
-- with a new argument list creates an OVERLOAD rather than replacing anything,
-- and the four-argument version would have stayed callable — a route that
-- reached it would clear a period's categories and its takes and leave the
-- previous period's reserve rows in place, which is worse than never having
-- stored them. So the old signature is DROPped and the new one created.
--
-- `p_reserves` CARRIES A DEFAULT of '[]'. Not laziness: it is what makes the
-- migrate-before-deploy window safe. A running instance on the previous build
-- calls the function with four named arguments; with the default it resolves to
-- this function, the period's reserve rows are CLEARED with everything else,
-- and none are written — which is exactly right for a build that computes none.
-- Without the default that call fails and a planner cannot allocate a period
-- until the deploy lands. The reverse window (deploy first, migrate later)
-- fails loudly either way, and that is correct: the route's write is refused
-- whole and the route's own message says the previous allocation is untouched.
--
-- ============================================================================
-- GUARD COUNTS THIS MIGRATION MOVES (the 20260811000007 convention)
-- ============================================================================
--
--   migrations/inventory.test.ts
--     policies            643 -> 646  (+3)
--     permissive          397 -> 400  (+3; every policy here is permissive)
--     restrictive         246 -> 246  (+0 — role-aware permissive writes, the
--                                      shape argued in 20260812000011's header)
--     permissiveWrites    259 -> 261  (+2 = INSERT + DELETE)
--     expanded            264 -> 264  (+0; every policy is literal SQL)
--     tablesWithPolicies  138 -> 139  (+1)
--     relations           159 -> 160  (+1)
--     tables              152 -> 153  (+1)
--     views                 7 ->   7  (+0)
--     rlsEnabledTables    152 -> 153  (+1)
--
--   viewer-write-denial-guard.test.ts
--     EXPECTED_PERMISSIVE_WRITE_POLICIES 259 -> 261  (+2)
--
--   rls-isolation.test.ts — one more `workspace_id` table on
--     PROBE_EXCUSED_TABLES, for the same honest reason as the others.
--
-- THREE policies, and the missing one is UPDATE, exactly as next door: a
-- period's reserve is replaced wholesale together with its categories and its
-- takes, never edited in place, and a table with no UPDATE policy cannot be
-- edited in place by a future route that forgot why. The GRANT names exactly
-- SELECT, INSERT, DELETE so `a-policy-without-a-grant-is-a-locked-door.test.ts`
-- holds without widening the audited posture by a privilege nothing uses.

BEGIN;

------------------------------------------------------------------------------
-- 1. WHAT THE ORDINANCE HELD BACK, PER PERIOD, PER RESERVE CLAUSE
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.measure_period_reserve (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  measure_fund_id      UUID NOT NULL,
  period_id            UUID NOT NULL,

  -- The clause's own id from the rule descriptor in force. TEXT for the same
  -- reason `measure_allocations.category_id` is: the list is the ordinance's,
  -- it is declared once in src/lib/measures/allocation.ts, and a table of them
  -- would be a second place for it to live.
  reserve_id           TEXT NOT NULL CHECK (length(btrim(reserve_id)) > 0),
  label                TEXT NOT NULL CHECK (length(btrim(label)) > 0),

  -- WHAT THE PERCENTAGE WAS TAKEN OF. Closed vocabulary, mirroring the
  -- descriptor's `reserveSchema.basis` with the `category:<id>` prefix split
  -- off into its own columns.
  basis_kind           TEXT NOT NULL CHECK (basis_kind IN ('gross', 'after_off_the_top', 'category')),
  basis_category_id    TEXT CHECK (basis_category_id IS NULL OR length(btrim(basis_category_id)) > 0),
  basis_category_label TEXT CHECK (basis_category_label IS NULL OR length(btrim(basis_category_label)) > 0),
  -- The figure the percentage was applied to, so the arithmetic is checkable
  -- without recomputing an old rule version against an old receipt.
  basis_amount         NUMERIC(14,2) NOT NULL CHECK (basis_amount >= 0),

  -- The ordinance's own rate. Four decimal places, matching `percentSchema`:
  -- ordinances really do apportion in thirds and a rounded percentage is a
  -- different ordinance.
  percent              NUMERIC(7,4) NOT NULL CHECK (percent >= 0 AND percent <= 100),

  -- What was actually held back, and what the clause alone came to. They differ
  -- exactly when the reserve was limited to what remained.
  amount               NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  computed_amount      NUMERIC(14,2) NOT NULL CHECK (computed_amount >= 0),

  -- Which rule version produced this figure. RESTRICT, matching
  -- measure_allocations and measure_period_off_the_top: deleting the ordinance
  -- reading a stored money figure was computed from would leave the figure with
  -- no provenance.
  allocation_rule_id   UUID REFERENCES public.measure_allocation_rules(id) ON DELETE RESTRICT,

  stated_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  stated_on            DATE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- ONE ROW PER CLAUSE PER PERIOD. Two rows for the same clause would double
  -- the amount the public surfaces subtract from what was received, which is
  -- the direction that understates what reached the ordinance's purposes.
  CONSTRAINT measure_period_reserve_uniq UNIQUE (period_id, reserve_id),
  -- A category reserve names its category; the other two kinds have none. The
  -- pair travels together for the same reason the cap and its window do next
  -- door: half of a fact is not a fact.
  CONSTRAINT measure_period_reserve_basis_pair
    CHECK ((basis_kind = 'category') = (basis_category_id IS NOT NULL)),
  -- And the id and the label it read under travel together: a label with no id
  -- cannot be matched to a purpose, and an id with no label prints as an id.
  CONSTRAINT measure_period_reserve_basis_label_pair
    CHECK ((basis_category_id IS NULL) = (basis_category_label IS NULL)),
  CONSTRAINT measure_period_reserve_period_fk
    FOREIGN KEY (period_id, workspace_id)
    REFERENCES public.measure_fund_periods (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT measure_period_reserve_fund_fk
    FOREIGN KEY (measure_fund_id, workspace_id)
    REFERENCES public.measure_funds (id, workspace_id) ON DELETE CASCADE
);

-- The oversight read: every reserve a fund held back over a set of periods.
-- Both public surfaces scope by the fund and then by the period ids they are
-- reporting on, which is exactly this index.
CREATE INDEX IF NOT EXISTS idx_measure_period_reserve_fund_period
  ON public.measure_period_reserve (measure_fund_id, period_id);

COMMENT ON TABLE public.measure_period_reserve IS
  'What one period''s receipt kept back in reserve rather than dividing, per reserve clause of the ordinance. Exists because received minus taken-out-first did not equal what reached the purposes for any fund that holds a reserve, and nothing recorded the difference. Replaced wholesale with the period''s measure_allocations and measure_period_off_the_top, never edited.';
COMMENT ON COLUMN public.measure_period_reserve.basis_kind IS
  'gross | after_off_the_top | category. What the percentage was taken of. A category reserve comes out of ONE of the ordinance''s purposes after the split; the other two reduce the pool before it.';
COMMENT ON COLUMN public.measure_period_reserve.basis_category_label IS
  'The purpose''s label AS IT READ WHEN THE MONEY WAS HELD BACK. Denormalized so a later rule version renaming or dropping the purpose cannot leave a historical reserve unable to say what it came out of.';
COMMENT ON COLUMN public.measure_period_reserve.computed_amount IS
  'What the ordinance''s percentage alone came to, before it was limited to what remained. Equal to amount unless the limit bit; stored so a surface can say so without recomputing an old rule against an old receipt.';

ALTER TABLE public.measure_period_reserve ENABLE ROW LEVEL SECURITY;

-- The same three shapes 20260812000011 and 20260812000014 use: membership to
-- read, `workspace_member_can_write` to write. Role-aware at the permissive
-- layer, so no restrictive `_writer_only_*` companion is needed to supply the
-- role, and the table never enters `viewer-write-denial-guard`'s
-- `tablesNeedingGate()`.
DROP POLICY IF EXISTS measure_period_reserve_read ON public.measure_period_reserve;
CREATE POLICY measure_period_reserve_read ON public.measure_period_reserve FOR SELECT USING (
  workspace_id IN (SELECT wm.workspace_id FROM public.workspace_members wm WHERE wm.user_id = auth.uid()));

DROP POLICY IF EXISTS measure_period_reserve_insert ON public.measure_period_reserve;
CREATE POLICY measure_period_reserve_insert ON public.measure_period_reserve FOR INSERT
  WITH CHECK (public.workspace_member_can_write(workspace_id));

DROP POLICY IF EXISTS measure_period_reserve_delete ON public.measure_period_reserve;
CREATE POLICY measure_period_reserve_delete ON public.measure_period_reserve FOR DELETE
  USING (public.workspace_member_can_write(workspace_id));

-- Revoked FIRST — Postgres drops column privileges along with table-level
-- ones, so a revoke placed after a grant destroys it. `anon` gets nothing: the
-- public oversight page is a service-role read behind a share token.
REVOKE ALL ON TABLE public.measure_period_reserve FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.measure_period_reserve TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.measure_period_reserve TO service_role;

------------------------------------------------------------------------------
-- 2. THE REPLACEMENT NOW COVERS ALL THREE ROW SETS, IN ONE STATEMENT BATCH
------------------------------------------------------------------------------
--
-- DROP rather than CREATE OR REPLACE: a new argument list would overload, and
-- the four-argument version would stay callable while silently leaving a
-- period's old reserve rows beside its new categories. The atomicity
-- 20260812000014 established is the property being preserved here — one
-- division of one receipt is replaced whole or not at all, and the reserve is
-- part of that division.
DROP FUNCTION IF EXISTS public.replace_measure_period_allocation(uuid, uuid, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.replace_measure_period_allocation(
  p_measure_fund_id uuid,
  p_period_id       uuid,
  p_allocations     jsonb,
  p_off_the_top     jsonb,
  p_reserves        jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_replaced_allocations integer;
  v_replaced_off_the_top integer;
  v_replaced_reserves    integer;
  v_allocations          jsonb;
BEGIN
  IF jsonb_typeof(p_allocations) <> 'array'
     OR jsonb_typeof(p_off_the_top) <> 'array'
     OR jsonb_typeof(p_reserves) <> 'array' THEN
    RAISE EXCEPTION 'replace_measure_period_allocation: every row set must be a JSON array'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- THE SCOPE CHECK, now over three arrays. Every row must belong to the period
  -- being replaced. Without it a caller could smuggle rows for a period the
  -- DELETEs below do not clear, and they would be added BESIDE that period's
  -- existing figures — the every-line-appears-twice outcome the wholesale
  -- replacement exists to prevent. RLS cannot see this: the rows are in the
  -- caller's own workspace either way.
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_allocations) AS entry
     WHERE (entry->>'period_id')::uuid IS DISTINCT FROM p_period_id
        OR (entry->>'measure_fund_id')::uuid IS DISTINCT FROM p_measure_fund_id
  ) OR EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_off_the_top) AS entry
     WHERE (entry->>'period_id')::uuid IS DISTINCT FROM p_period_id
        OR (entry->>'measure_fund_id')::uuid IS DISTINCT FROM p_measure_fund_id
  ) OR EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_reserves) AS entry
     WHERE (entry->>'period_id')::uuid IS DISTINCT FROM p_period_id
        OR (entry->>'measure_fund_id')::uuid IS DISTINCT FROM p_measure_fund_id
  ) THEN
    RAISE EXCEPTION
      'replace_measure_period_allocation: every row must name period % of fund %',
      p_period_id, p_measure_fund_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- The counts are returned for the reason the route's own comment gives: a
  -- recompute that replaced 12 lines and one that replaced 0 are different
  -- events, and only the first is a correction of something a person saw.
  WITH removed AS (
    DELETE FROM public.measure_allocations
     WHERE period_id = p_period_id
       AND measure_fund_id = p_measure_fund_id
    RETURNING id
  )
  SELECT count(*)::integer INTO v_replaced_allocations FROM removed;

  WITH removed AS (
    DELETE FROM public.measure_period_off_the_top
     WHERE period_id = p_period_id
       AND measure_fund_id = p_measure_fund_id
    RETURNING id
  )
  SELECT count(*)::integer INTO v_replaced_off_the_top FROM removed;

  WITH removed AS (
    DELETE FROM public.measure_period_reserve
     WHERE period_id = p_period_id
       AND measure_fund_id = p_measure_fund_id
    RETURNING id
  )
  SELECT count(*)::integer INTO v_replaced_reserves FROM removed;

  WITH added AS (
    INSERT INTO public.measure_allocations (
      workspace_id, measure_fund_id, period_id, category_id, recipient_id,
      allocation_rule_id, amount, computation_basis, rationale, stated_by, stated_on
    )
    SELECT
      (entry->>'workspace_id')::uuid,
      (entry->>'measure_fund_id')::uuid,
      (entry->>'period_id')::uuid,
      entry->>'category_id',
      (entry->>'recipient_id')::uuid,
      (entry->>'allocation_rule_id')::uuid,
      (entry->>'amount')::numeric,
      entry->>'computation_basis',
      entry->>'rationale',
      (entry->>'stated_by')::uuid,
      (entry->>'stated_on')::date
    FROM jsonb_array_elements(p_allocations) AS entry
    RETURNING id, measure_fund_id, period_id, category_id, recipient_id,
              allocation_rule_id, amount, computation_basis, rationale, stated_by, stated_on
  )
  SELECT coalesce(jsonb_agg(to_jsonb(added)), '[]'::jsonb) INTO v_allocations FROM added;

  INSERT INTO public.measure_period_off_the_top (
    workspace_id, measure_fund_id, period_id, off_the_top_id, label,
    amount, uncapped_amount, cap_amount, cap_basis, cap_status,
    allocation_rule_id, stated_by, stated_on
  )
  SELECT
    (entry->>'workspace_id')::uuid,
    (entry->>'measure_fund_id')::uuid,
    (entry->>'period_id')::uuid,
    entry->>'off_the_top_id',
    entry->>'label',
    (entry->>'amount')::numeric,
    (entry->>'uncapped_amount')::numeric,
    (entry->>'cap_amount')::numeric,
    entry->>'cap_basis',
    entry->>'cap_status',
    (entry->>'allocation_rule_id')::uuid,
    (entry->>'stated_by')::uuid,
    (entry->>'stated_on')::date
  FROM jsonb_array_elements(p_off_the_top) AS entry;

  INSERT INTO public.measure_period_reserve (
    workspace_id, measure_fund_id, period_id, reserve_id, label,
    basis_kind, basis_category_id, basis_category_label, basis_amount,
    percent, amount, computed_amount,
    allocation_rule_id, stated_by, stated_on
  )
  SELECT
    (entry->>'workspace_id')::uuid,
    (entry->>'measure_fund_id')::uuid,
    (entry->>'period_id')::uuid,
    entry->>'reserve_id',
    entry->>'label',
    entry->>'basis_kind',
    entry->>'basis_category_id',
    entry->>'basis_category_label',
    (entry->>'basis_amount')::numeric,
    (entry->>'percent')::numeric,
    (entry->>'amount')::numeric,
    (entry->>'computed_amount')::numeric,
    (entry->>'allocation_rule_id')::uuid,
    (entry->>'stated_by')::uuid,
    (entry->>'stated_on')::date
  FROM jsonb_array_elements(p_reserves) AS entry;

  RETURN jsonb_build_object(
    'replaced_allocation_count', v_replaced_allocations,
    'replaced_off_the_top_count', v_replaced_off_the_top,
    'replaced_reserve_count', v_replaced_reserves,
    'allocations', v_allocations
  );
END;
$$;

COMMENT ON FUNCTION public.replace_measure_period_allocation(uuid, uuid, jsonb, jsonb, jsonb) IS
  'Replace one period''s whole division of its receipt — the off-the-top takes, the reserves held back, and the category allocations — in a single transaction. SECURITY INVOKER, so the caller''s own row policies decide what may be deleted and inserted. Refuses any row that does not name the period and fund being replaced. Exists because supabase-js has no transaction and a failed INSERT after a committed DELETE left the period with nothing.';

-- Called from a signed-in browser session through the allocate route, so
-- `authenticated` needs EXECUTE. The tenant boundary is RLS on the three
-- tables, not this grant. `anon` is revoked explicitly: Supabase default
-- privileges grant EXECUTE on new public functions to both client roles, and
-- REVOKE FROM PUBLIC does not remove those direct grants (the lesson
-- 20260722000005 records). The DROP above took the old signature's grants with
-- it, so these are the only ones that exist.
REVOKE ALL ON FUNCTION public.replace_measure_period_allocation(uuid, uuid, jsonb, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_measure_period_allocation(uuid, uuid, jsonb, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.replace_measure_period_allocation(uuid, uuid, jsonb, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_measure_period_allocation(uuid, uuid, jsonb, jsonb, jsonb) TO service_role;

COMMIT;
