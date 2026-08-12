-- WHAT THE AGENCY TOOK OFF THE TOP, ON THE RECORD — and the one statement that
-- replaces a period's allocation without a window in which it has none.
--
-- ============================================================================
-- TWO DEFECTS, ONE MIGRATION, BECAUSE THE FIX FOR EACH NEEDS THE OTHER
-- ============================================================================
--
-- DEFECT ONE — THE REPLACEMENT WAS NOT ATOMIC. `periods/[periodId]/allocate`
-- DELETEd a period's existing `measure_allocations` and then INSERTed the new
-- set through two separate supabase-js calls. supabase-js has no transaction,
-- so the two are two HTTP requests and two Postgres transactions. Any failure
-- of the second left the period with NOTHING — not the old figures, not the new
-- ones, no error visible on the fund page beyond a 500 the person may not
-- connect to the missing money.
--
-- It was not hypothetical. Two triggers were reachable from the product:
--
--   * A NEGATIVE CATEGORY SHARE. Half-up rounding can over-allocate a tiny
--     pool: four 25% categories over $0.02 each round to $0.01, so the residual
--     is −$0.02 and the residual category was handed −$0.01.
--     `measure_allocations_amount_check` rejects it — AFTER the delete had
--     committed. (The allocator now floors the residual so it cannot produce
--     one; the CHECK stays as the second lock, which is the point of a CHECK.)
--   * TWO MANUAL ENTRIES with the same category and no recipient violate
--     `ux_measure_allocations_pooled`, with the same outcome.
--
-- DEFECT TWO — THE ANNUAL CAP NEVER BOUND. An off-the-top capped on the fiscal
-- year is evaluated against what the fund has already taken that year. Nothing
-- persisted what was taken: only the CATEGORY rows were written, and the amount
-- that came off the top before them was recoverable from those rows only when
-- an ordinance declares no pool reserves, and never attributable to a
-- particular off-the-top clause. So `priorTaken` was 0 in every period, and a
-- 1%-of-receipt administration take capped at 200,000/year over four
-- 25,000,000 quarters produced four takes of 200,000 — 800,000 against a
-- 200,000 cap — each one labelled `capped`, which is worse than unlabelled.
--
-- The two fixes need each other. Recording the take is what makes the cap
-- evaluable; and the take and the category rows describe ONE division of ONE
-- receipt, so they must be replaced together or a recompute can leave a period
-- whose off-the-top belongs to the old rule and whose categories belong to the
-- new one. One table and one function, in one migration, for that reason.
--
-- ============================================================================
-- WHY A DATABASE FUNCTION, AND WHY SECURITY INVOKER
-- ============================================================================
--
-- The `promote_gtfs_feed_version` precedent (20260805000008): a transition no
-- ORDERING of separate statements can make safely belongs in one statement
-- batch. Here it is simpler than that — there is no ordering that helps at all,
-- because the failure is the second statement failing after the first
-- committed.
--
-- SECURITY INVOKER, NOT DEFINER. A definer function would have to re-implement
-- the tenant boundary in its own body, and the boundary it would be
-- re-implementing is already written as row policies on both tables. Invoker
-- keeps those policies as the access control: the caller's own JWT decides what
-- it may delete and insert, `workspace_member_can_write` still refuses a
-- viewer, and a bug in this function cannot become a cross-tenant write. The
-- route's `authorizeMeasureWrite` is the first gate; RLS is the one that holds
-- if the first is ever wrong.
--
-- The function additionally REFUSES any row whose `measure_fund_id` or
-- `period_id` disagrees with its arguments. Without that check a caller could
-- pass rows for a period the DELETE did not clear, which would be the
-- duplicate-figures outcome the wholesale replacement exists to prevent — and
-- RLS would happily allow it, because the rows are all in the caller's own
-- workspace.
--
-- ============================================================================
-- WHAT THIS TABLE IS NOT
-- ============================================================================
--
-- It is not a second `measure_allocations`. An off-the-top comes out of the
-- receipt BEFORE the ordinance's categories are cut, so it belongs to no
-- category, and giving it a reserved `category_id` would put a made-up heading
-- into the ordinance's own list on the public oversight page and into every
-- category total derived from those rows. It is a different fact with a
-- different shape: which clause of the ordinance, how much the clause called
-- for, how much was actually taken, and whether a cap bit.
--
-- `uncapped_amount` is stored beside `amount` on purpose. "The ordinance's 1%
-- came to 48,123.40 and the annual cap limited us to 30,000" is the sentence an
-- oversight committee needs; two columns are what lets any surface say it
-- without recomputing an old rule version against an old receipt.
--
-- ============================================================================
-- GUARD COUNTS THIS MIGRATION MOVES (the 20260811000007 convention)
-- ============================================================================
--
--   migrations/inventory.test.ts
--     policies            626 -> 629  (+3)
--     permissive          380 -> 383  (+3; every policy here is permissive)
--     restrictive         246 -> 246  (+0 — role-aware permissive writes, the
--                                      shape argued in 20260812000011's header)
--     permissiveWrites    247 -> 249  (+2 = INSERT + DELETE)
--     expanded            264 -> 264  (+0; every policy is literal SQL)
--     tablesWithPolicies  133 -> 134  (+1)
--     relations           154 -> 155  (+1)
--     tables              147 -> 148  (+1)
--     views                 7 ->   7  (+0)
--     rlsEnabledTables    147 -> 148  (+1)
--
--   viewer-write-denial-guard.test.ts
--     EXPECTED_PERMISSIVE_WRITE_POLICIES 247 -> 249  (+2)
--
--   rls-isolation.test.ts — one more `workspace_id` table on
--     PROBE_EXCUSED_TABLES, for the same honest reason as the other nine.
--
-- THREE policies rather than four: there is no UPDATE. A period's off-the-top
-- is replaced wholesale with its categories, never edited in place, and a table
-- with no UPDATE policy cannot be edited in place by a future route that forgot
-- why. The GRANT names exactly SELECT, INSERT, DELETE so
-- `a-policy-without-a-grant-is-a-locked-door.test.ts` holds without widening
-- the audited posture by a privilege nothing uses.
--
-- The numbers above were confirmed by RUNNING the suites, not derived.

BEGIN;

------------------------------------------------------------------------------
-- 1. WHAT CAME OFF THE TOP, PER PERIOD, PER ORDINANCE CLAUSE
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.measure_period_off_the_top (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  measure_fund_id    UUID NOT NULL,
  period_id          UUID NOT NULL,

  -- The clause's own id from the rule descriptor in force, for the same reason
  -- `measure_allocations.category_id` is text: the list is the ordinance's, it
  -- is declared once in src/lib/measures/allocation.ts, and a table of them
  -- would be a second place for it to live.
  off_the_top_id     TEXT NOT NULL CHECK (length(btrim(off_the_top_id)) > 0),
  -- The clause's label AS IT READ WHEN THE MONEY WAS TAKEN. Denormalized on
  -- purpose: a later rule version may rename or drop the clause, and a
  -- historical take must still be able to say what it was for.
  label              TEXT NOT NULL CHECK (length(btrim(label)) > 0),

  -- What was actually taken, and what the clause alone called for. They differ
  -- exactly when a cap bit, and both are needed to say so.
  amount             NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  uncapped_amount    NUMERIC(14,2) NOT NULL CHECK (uncapped_amount >= 0),

  cap_amount         NUMERIC(14,2) CHECK (cap_amount IS NULL OR cap_amount >= 0),
  cap_basis          TEXT CHECK (cap_basis IS NULL OR cap_basis IN ('per_period', 'fiscal_year')),
  cap_status         TEXT NOT NULL CHECK (cap_status IN ('no_cap', 'within_cap', 'capped', 'not_evaluable')),

  -- Which rule version produced this figure. RESTRICT, matching
  -- measure_allocations: deleting the ordinance reading a stored money figure
  -- was computed from would leave the figure with no provenance.
  allocation_rule_id UUID REFERENCES public.measure_allocation_rules(id) ON DELETE RESTRICT,

  stated_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  stated_on          DATE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- ONE ROW PER CLAUSE PER PERIOD. Two rows for the same clause would double
  -- the year-to-date total the cap is evaluated against, in the direction that
  -- stops the agency taking money it is entitled to — and, on a recompute that
  -- failed halfway, in the direction that lets it take money twice.
  CONSTRAINT measure_period_off_the_top_uniq UNIQUE (period_id, off_the_top_id),
  -- A cap amount and the window it covers travel together, mirroring the
  -- descriptor's own refusal (`capAmount and capBasis together — a cap with no
  -- window is a cap nobody can evaluate`).
  CONSTRAINT measure_period_off_the_top_cap_pair
    CHECK ((cap_amount IS NULL) = (cap_basis IS NULL)),
  -- `capped` means a cap bit, so there must be one; `no_cap` means there was
  -- none. Neither can be recorded against the wrong shape of clause.
  CONSTRAINT measure_period_off_the_top_cap_status_matches
    CHECK (
      (cap_status = 'no_cap' AND cap_amount IS NULL)
      OR (cap_status <> 'no_cap' AND cap_amount IS NOT NULL)
    ),
  CONSTRAINT measure_period_off_the_top_period_fk
    FOREIGN KEY (period_id, workspace_id)
    REFERENCES public.measure_fund_periods (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT measure_period_off_the_top_fund_fk
    FOREIGN KEY (measure_fund_id, workspace_id)
    REFERENCES public.measure_funds (id, workspace_id) ON DELETE CASCADE
);

-- The cap query: every take in one fund's fiscal year. The year lives on
-- `measure_fund_periods`, so the route reads the year's period ids first and
-- this index serves the `period_id IN (…)` that follows.
CREATE INDEX IF NOT EXISTS idx_measure_period_off_the_top_fund_period
  ON public.measure_period_off_the_top (measure_fund_id, period_id);

COMMENT ON TABLE public.measure_period_off_the_top IS
  'What one period''s receipt gave up before the ordinance''s categories were cut, per off-the-top clause. Exists because a fiscal-year cap can only be evaluated against what has already been taken, and nothing else records that. Replaced wholesale with the period''s measure_allocations, never edited.';
COMMENT ON COLUMN public.measure_period_off_the_top.uncapped_amount IS
  'What the ordinance clause alone called for, before any cap. Equal to amount unless a cap bit; stored so a surface can say "the 1% came to X and the annual cap limited us to Y" without recomputing an old rule against an old receipt.';
COMMENT ON COLUMN public.measure_period_off_the_top.cap_status IS
  'no_cap | within_cap | capped | not_evaluable. not_evaluable means the year-to-date takes could not be read, in which case the allocator limits the clause to the FULL annual cap for this one period rather than taking it uncapped.';

ALTER TABLE public.measure_period_off_the_top ENABLE ROW LEVEL SECURITY;

-- The same three shapes 20260812000011 uses on its six tables: membership to
-- read, `workspace_member_can_write` to write. Role-aware at the permissive
-- layer, so no restrictive `_writer_only_*` companion is needed to supply the
-- role, and the table never enters `viewer-write-denial-guard`'s
-- `tablesNeedingGate()`.
DROP POLICY IF EXISTS measure_period_off_the_top_read ON public.measure_period_off_the_top;
CREATE POLICY measure_period_off_the_top_read ON public.measure_period_off_the_top FOR SELECT USING (
  workspace_id IN (SELECT wm.workspace_id FROM public.workspace_members wm WHERE wm.user_id = auth.uid()));

DROP POLICY IF EXISTS measure_period_off_the_top_insert ON public.measure_period_off_the_top;
CREATE POLICY measure_period_off_the_top_insert ON public.measure_period_off_the_top FOR INSERT
  WITH CHECK (public.workspace_member_can_write(workspace_id));

DROP POLICY IF EXISTS measure_period_off_the_top_delete ON public.measure_period_off_the_top;
CREATE POLICY measure_period_off_the_top_delete ON public.measure_period_off_the_top FOR DELETE
  USING (public.workspace_member_can_write(workspace_id));

-- Revoked FIRST — Postgres drops column privileges along with table-level
-- ones, so a revoke placed after a grant destroys it. `anon` gets nothing: the
-- public oversight page is a service-role read behind a share token.
REVOKE ALL ON TABLE public.measure_period_off_the_top FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.measure_period_off_the_top TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.measure_period_off_the_top TO service_role;

------------------------------------------------------------------------------
-- 2. REPLACING A PERIOD'S DIVISION OF ITS RECEIPT, ALL OR NOTHING
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.replace_measure_period_allocation(
  p_measure_fund_id uuid,
  p_period_id       uuid,
  p_allocations     jsonb,
  p_off_the_top     jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_replaced_allocations integer;
  v_replaced_off_the_top integer;
  v_allocations          jsonb;
BEGIN
  IF jsonb_typeof(p_allocations) <> 'array' OR jsonb_typeof(p_off_the_top) <> 'array' THEN
    RAISE EXCEPTION 'replace_measure_period_allocation: both row sets must be JSON arrays'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- THE SCOPE CHECK. Every row must belong to the period being replaced.
  -- Without it a caller could smuggle rows for a period the DELETE below does
  -- not clear, and they would be added BESIDE that period's existing figures —
  -- the every-category-appears-twice outcome. RLS cannot see this: the rows are
  -- in the caller's own workspace either way.
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
  ) THEN
    RAISE EXCEPTION
      'replace_measure_period_allocation: every row must name period % of fund %',
      p_period_id, p_measure_fund_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- The count is returned for the reason the route's own comment gives: a
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

  RETURN jsonb_build_object(
    'replaced_allocation_count', v_replaced_allocations,
    'replaced_off_the_top_count', v_replaced_off_the_top,
    'allocations', v_allocations
  );
END;
$$;

COMMENT ON FUNCTION public.replace_measure_period_allocation(uuid, uuid, jsonb, jsonb) IS
  'Replace one period''s whole division of its receipt — the off-the-top takes and the category allocations — in a single transaction. SECURITY INVOKER, so the caller''s own row policies decide what may be deleted and inserted. Refuses any row that does not name the period and fund being replaced. Exists because supabase-js has no transaction and a failed INSERT after a committed DELETE left the period with nothing.';

-- Called from a signed-in browser session through the allocate route, so
-- `authenticated` needs EXECUTE. The tenant boundary is RLS on the two tables,
-- not this grant. `anon` is revoked explicitly: Supabase default privileges
-- grant EXECUTE on new public functions to both client roles, and REVOKE FROM
-- PUBLIC does not remove those direct grants (the lesson 20260722000005
-- records).
REVOKE ALL ON FUNCTION public.replace_measure_period_allocation(uuid, uuid, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_measure_period_allocation(uuid, uuid, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.replace_measure_period_allocation(uuid, uuid, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_measure_period_allocation(uuid, uuid, jsonb, jsonb) TO service_role;

COMMIT;
