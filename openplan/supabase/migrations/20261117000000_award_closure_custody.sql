-- Award closure custody, the close-out rule and the reconciled close-out
-- (KI-2026-11-16-134, KI-2026-11-16-130, KL-2026-09-04-024).
--
-- THE DEFECTS. Lane 84's run-through (agent-run, local, November 16, 2026)
-- found three things about closing an award that has no handoff revision:
--
--   1. A member or owner could PATCH `spending_status = 'fully_spent'` and
--      `closure_basis = 'earned_coverage'` straight through the Data API. No
--      coverage was checked and no close-out milestone was filed. The guard in
--      20261018000003 (`guard_handoff_award`) covers only awards that carry a
--      handoff revision.
--   2. The close-out route closed a $10,000 award at 2,505 percent paid
--      coverage while one request was still submitted and four were drafts.
--   3. An award that finished under its ceiling, with every request paid or
--      rejected, could not be closed at all.
--
-- THE PATTERN, and why this one. 20261018000003 and 20261024200200 already
-- guard managed awards this way: a service-role-only function evaluates the
-- close-out in SQL, sets the transaction-local `openplan.award_closure_command`
-- to the award id, and a row trigger refuses a change to the closure columns
-- unless that setting is present and the session role is the server's. This
-- migration extends the same rule to every award, so there is one way an
-- award's closure changes, and the routes call one function for each act. A
-- second pattern (a SECURITY DEFINER function callable by members) was not
-- chosen: it would put the role check inside SQL for some awards and in the
-- route for others, and PostgREST would expose it to the Data API.
--
-- WHAT IS ADDED
--
--   closure_basis 'reconciled_with_balance'
--                   An award that finished under its ceiling. The unpaid part
--                   of the ceiling is recorded as released, in
--   closure_released_amount
--                   the ceiling minus paid requests, at the moment of closing.
--                   Required, and above zero, exactly when the basis is
--                   reconciled; NULL otherwise. A reconciled close also needs a
--                   written note, like an imported one.
--   funding_award_closeout_command(...)
--                   The one writer of closure columns for awards with no
--                   handoff revision: earned close-out, reconciled close-out,
--                   closure recorded on import, and reopen. Service role only.
--                   It writes no row to funding_award_closure_receipts: that
--                   table is immutable and its award and workspace keys have
--                   no ON DELETE action, so a receipt would stop a planner
--                   deleting a project or workspace that holds an ordinary
--                   closed award. The award row keeps who closed it, when, on
--                   what basis and what was released, and the route's audit
--                   log records the figures the command returns.
--   funding_award_closure_custody (trigger)
--                   Refuses any change to the closure columns, on any award,
--                   unless the command above (or the managed command) set the
--                   transaction-local setting for that award. It also refuses
--                   any close while a linked request is draft, in internal
--                   review, submitted or approved for payment, for managed and
--                   unmanaged awards alike.
--
-- Additive. One CHECK constraint is widened by dropping and adding it back
-- with one more allowed value; no row changes. No policy, grant or existing
-- function is dropped or replaced, and no row is rewritten. Existing closed
-- awards keep their basis; the trigger checks only changes.

ALTER TABLE public.funding_awards
  ADD COLUMN IF NOT EXISTS closure_released_amount NUMERIC(14,2);

COMMENT ON COLUMN public.funding_awards.closure_released_amount IS
  'On a reconciled close-out (closure_basis reconciled_with_balance): the part of the award ceiling left unclaimed and released, equal to the ceiling minus paid requests when the award closed. NULL on every other award.';

-- The vocabulary gains one value. The constraint is dropped and added back in
-- one statement, so no moment exists without it.
ALTER TABLE public.funding_awards
  DROP CONSTRAINT funding_awards_closure_basis_known,
  ADD CONSTRAINT funding_awards_closure_basis_known CHECK (
    closure_basis IS NULL
    OR closure_basis IN (
      'earned_coverage',
      'reconciled_with_balance',
      'recorded_on_import',
      'unrecorded_legacy'
    )
  );

COMMENT ON COLUMN public.funding_awards.closure_basis IS
  'How this award became fully spent: earned_coverage (paid requests covered the awarded amount, checked in SQL), reconciled_with_balance (the award finished under its ceiling with no request open and the rest released, see closure_released_amount), recorded_on_import (a workspace asserted an already-closed historical award, with no coverage checked), or unrecorded_legacy (closed before OpenPlan recorded the basis). NULL on every award that is not fully spent.';

ALTER TABLE public.funding_awards
  ADD CONSTRAINT funding_awards_released_amount_matches_basis CHECK (
    (closure_basis IS NOT DISTINCT FROM 'reconciled_with_balance') = (closure_released_amount IS NOT NULL)
    AND (closure_released_amount IS NULL OR closure_released_amount > 0)
  );

ALTER TABLE public.funding_awards
  ADD CONSTRAINT funding_awards_reconciled_closure_states_its_basis CHECK (
    closure_basis IS DISTINCT FROM 'reconciled_with_balance'
    OR (closure_note IS NOT NULL AND length(btrim(closure_note)) > 0)
  );

-- What one request is worth to the award, in the same arithmetic as
-- computeNetInvoiceAmount (src/lib/invoicing/invoice-records.ts): an explicit
-- positive retention amount wins, the percentage otherwise, never below zero.
-- The stored net_amount column is not trusted here, for the reason that
-- module's comments give: it is a plain column with DEFAULT 0.
CREATE FUNCTION public.reimbursement_request_net(p_amount numeric, p_retention_amount numeric, p_retention_percent numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN coalesce(p_retention_amount, 0) > 0 THEN greatest(0, coalesce(p_amount, 0) - p_retention_amount)
    ELSE greatest(0, coalesce(p_amount, 0) - round(greatest(0, coalesce(p_amount, 0)) * greatest(0, coalesce(p_retention_percent, 0)) / 100, 2))
  END;
$$;
REVOKE ALL ON FUNCTION public.reimbursement_request_net(numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
-- Only the close-out command uses it, as the service role.
GRANT EXECUTE ON FUNCTION public.reimbursement_request_net(numeric, numeric, numeric) TO service_role;

-- The one writer of closure columns for awards with no handoff revision.
--
-- Events:
--   earned_coverage          paid requests cover the ceiling, no request open.
--                            Paid above the ceiling needs a written basis in
--                            the note (for example, an amendment).
--   reconciled_with_balance  paid requests are below the ceiling, no request
--                            open, a written note; the rest of the ceiling is
--                            recorded as released.
--   recorded_on_import       the award closed outside OpenPlan; a written note,
--                            no request open, no milestone.
--   reopen                   a closed award returns to an open status with a
--                            written reason.
--
-- p_calendar_date is the workspace's calendar day, computed by the route the
-- same way the earned close-out always dated its milestone. It must lie within
-- one day of the server's UTC date, so a caller cannot backdate a close-out.
-- SECURITY INVOKER and service role only, like managed_award_closeout: the
-- route checks the caller's session and role first, and this function checks
-- the actor's membership again inside the transaction.
CREATE FUNCTION public.funding_award_closeout_command(
  p_actor uuid,
  p_award uuid,
  p_event text,
  p_note text,
  p_calendar_date date,
  p_reopen_spending_status text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  a public.funding_awards;
  note text := nullif(btrim(coalesce(p_note, '')), '');
  paid numeric := 0;
  open_count integer := 0;
  open_statuses jsonb;
  released numeric;
  basis jsonb;
  milestone_filed boolean := false;
  stamp timestamptz;
BEGIN
  IF current_user NOT IN ('service_role', 'postgres') OR p_actor IS NULL THEN
    RAISE EXCEPTION 'Server actor required' USING ERRCODE = '42501';
  END IF;
  IF p_event NOT IN ('earned_coverage', 'reconciled_with_balance', 'recorded_on_import', 'reopen') THEN
    RAISE EXCEPTION 'Unknown close-out event' USING ERRCODE = '22023';
  END IF;
  IF p_calendar_date IS NULL OR abs(p_calendar_date - (now() AT TIME ZONE 'UTC')::date) > 1 THEN
    RAISE EXCEPTION 'Close-out date must be the workspace''s current calendar day' USING ERRCODE = '22023';
  END IF;
  IF p_reopen_spending_status IS NOT NULL AND p_event <> 'reopen' THEN
    RAISE EXCEPTION 'Reopen destination belongs only to reopen' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(713, 1);
  SELECT * INTO a FROM public.funding_awards WHERE id = p_award;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Funding award not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM FROM public.workspace_members
   WHERE workspace_id = a.workspace_id AND user_id = p_actor AND role IN ('owner', 'admin', 'member')
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Current programs writer required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO STRICT a FROM public.funding_awards WHERE id = p_award FOR UPDATE;
  IF a.latest_handoff_revision_id IS NOT NULL THEN
    RAISE EXCEPTION 'This award has award conditions; close or reopen it through the version-bound close-out' USING ERRCODE = 'PT409';
  END IF;

  PERFORM FROM public.billing_invoice_records WHERE funding_award_id = a.id ORDER BY id FOR UPDATE;
  SELECT
    coalesce(sum(public.reimbursement_request_net(i.amount, i.retention_amount, i.retention_percent)) FILTER (WHERE i.status = 'paid'), 0),
    count(*) FILTER (WHERE i.status IN ('draft', 'internal_review', 'submitted', 'approved_for_payment'))
  INTO paid, open_count
  FROM public.billing_invoice_records i WHERE i.funding_award_id = a.id;
  SELECT coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb) INTO open_statuses
  FROM (SELECT i.status, count(*) AS n FROM public.billing_invoice_records i
         WHERE i.funding_award_id = a.id AND i.status IN ('draft', 'internal_review', 'submitted', 'approved_for_payment')
         GROUP BY i.status) s;

  basis := jsonb_build_object(
    'previousClosure', jsonb_build_object('basis', a.closure_basis, 'closedAt', a.closed_at, 'note', a.closure_note),
    'expectedCurrent', NULL,
    'note', note,
    'ceiling', a.awarded_amount::text,
    'paid', paid::text,
    'openRequests', open_count
  );

  IF p_event = 'reopen' THEN
    IF a.spending_status <> 'fully_spent' THEN
      RAISE EXCEPTION 'This award is not closed' USING ERRCODE = 'PT409';
    END IF;
    IF note IS NULL THEN
      RAISE EXCEPTION 'Reopening needs a written reason' USING ERRCODE = '22023';
    END IF;
    IF coalesce(p_reopen_spending_status, '') NOT IN ('not_started', 'active', 'delayed') THEN
      RAISE EXCEPTION 'Reopen destination must be not_started, active or delayed' USING ERRCODE = '22023';
    END IF;
    basis := basis || jsonb_build_object('reopenSpendingStatus', p_reopen_spending_status);
  ELSE
    IF a.spending_status = 'fully_spent' THEN
      RETURN jsonb_build_object('status', 'already_closed', 'awardId', a.id, 'closureBasis', a.closure_basis,
        'paid', paid::text, 'ceiling', a.awarded_amount::text);
    END IF;
    IF open_count > 0 THEN
      RAISE EXCEPTION 'Close-out needs every linked request paid or rejected; % still open', open_count
        USING ERRCODE = '22023', DETAIL = open_statuses::text;
    END IF;
    IF p_event = 'earned_coverage' THEN
      IF a.awarded_amount <= 0 THEN
        RAISE EXCEPTION 'Paid coverage is unassessed: record a positive award ceiling first' USING ERRCODE = '22023';
      END IF;
      IF paid < a.awarded_amount THEN
        RAISE EXCEPTION 'Paid requests are below the award ceiling' USING ERRCODE = '22023';
      END IF;
      IF paid > a.awarded_amount AND note IS NULL THEN
        RAISE EXCEPTION 'Paid requests exceed the award ceiling; state the basis (for example, an amendment) in the close-out note' USING ERRCODE = '22023';
      END IF;
    ELSIF p_event = 'reconciled_with_balance' THEN
      IF a.awarded_amount <= 0 THEN
        RAISE EXCEPTION 'A reconciled close-out needs a positive award ceiling' USING ERRCODE = '22023';
      END IF;
      IF paid >= a.awarded_amount THEN
        RAISE EXCEPTION 'Paid requests reach the ceiling; use the earned close-out' USING ERRCODE = '22023';
      END IF;
      IF note IS NULL THEN
        RAISE EXCEPTION 'A reconciled close-out needs a written note' USING ERRCODE = '22023';
      END IF;
      released := a.awarded_amount - paid;
      basis := basis || jsonb_build_object('released', released::text);
    ELSE
      IF note IS NULL THEN
        RAISE EXCEPTION 'A closure recorded on import needs a written basis' USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;

  PERFORM set_config('openplan.award_closure_command', a.id::text, true);
  stamp := clock_timestamp();

  IF p_event = 'reopen' THEN
    UPDATE public.funding_awards
       SET spending_status = p_reopen_spending_status, closure_basis = NULL, closed_at = NULL, closed_by = NULL,
           closure_note = NULL, closure_released_amount = NULL,
           reopened_at = stamp, reopened_by = p_actor, reopen_reason = note
     WHERE id = a.id;
  ELSE
    UPDATE public.funding_awards
       SET spending_status = 'fully_spent', closure_basis = p_event, closed_at = stamp, closed_by = p_actor,
           closure_note = note, closure_released_amount = released
     WHERE id = a.id;
    -- An award closed, reopened and closed again keeps the milestone from its
    -- first close-out, as recordEarnedFundingAwardCloseout always did. An
    -- imported closure files none: nobody performed that sign-off here.
    IF p_event IN ('earned_coverage', 'reconciled_with_balance')
       AND NOT EXISTS (SELECT FROM public.project_milestones
                        WHERE project_id = a.project_id AND funding_award_id = a.id AND milestone_type = 'closeout') THEN
      INSERT INTO public.project_milestones(project_id, funding_award_id, title, summary, milestone_type, phase_code,
                                            status, target_date, actual_date, created_by)
      VALUES (a.project_id, a.id, 'Closeout: ' || a.title,
              coalesce(note, 'Close-out on paid requests covering the award ceiling.'),
              'closeout', 'closeout', 'complete', p_calendar_date, p_calendar_date, p_actor);
      milestone_filed := true;
    END IF;
  END IF;

  -- Invalidate the cached posture in the transaction; the route rebuilds it.
  UPDATE public.projects SET rtp_posture = NULL, rtp_posture_updated_at = NULL WHERE id = a.project_id;

  RETURN jsonb_build_object(
    'status', CASE WHEN p_event = 'reopen' THEN 'reopened' ELSE 'closed' END,
    'awardId', a.id,
    'closureBasis', CASE WHEN p_event = 'reopen' THEN NULL ELSE p_event END,
    'priorClosureBasis', a.closure_basis,
    'closedAt', CASE WHEN p_event = 'reopen' THEN NULL ELSE stamp END,
    'reopenedAt', CASE WHEN p_event = 'reopen' THEN stamp END,
    'spendingStatus', CASE WHEN p_event = 'reopen' THEN p_reopen_spending_status ELSE 'fully_spent' END,
    'ceiling', a.awarded_amount::text,
    'paid', paid::text,
    'released', released::text,
    'basis', basis,
    'milestoneFiled', milestone_filed
  );
END $$;
REVOKE ALL ON FUNCTION public.funding_award_closeout_command(uuid, uuid, text, text, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.funding_award_closeout_command(uuid, uuid, text, text, date, text) TO service_role;

-- The custody rule, for every award. Closure columns change only inside a
-- close-out command for that award, under the server's role. An author column
-- may go to NULL on its own only when that user no longer exists: the foreign
-- keys clear closed_by and reopened_by when an account is deleted, and that
-- cascade must not be refused.
CREATE FUNCTION public.guard_funding_award_closure() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  commanded boolean := coalesce(
    current_setting('role', true) IN ('service_role', 'postgres', 'none')
    AND current_setting('openplan.award_closure_command', true) = NEW.id::text,
    false);
  changed boolean;
  author_cleared_by_deletion boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    changed := NEW.spending_status = 'fully_spent'
      OR ROW(NEW.closure_basis, NEW.closed_at, NEW.closed_by, NEW.closure_note, NEW.closure_released_amount,
             NEW.reopened_at, NEW.reopened_by, NEW.reopen_reason) IS DISTINCT FROM
         ROW(NULL::text, NULL::timestamptz, NULL::uuid, NULL::text, NULL::numeric, NULL::timestamptz, NULL::uuid, NULL::text);
  ELSE
    changed := (NEW.spending_status = 'fully_spent') IS DISTINCT FROM (OLD.spending_status = 'fully_spent')
      OR ROW(NEW.closure_basis, NEW.closed_at, NEW.closure_note, NEW.closure_released_amount, NEW.reopened_at, NEW.reopen_reason)
         IS DISTINCT FROM ROW(OLD.closure_basis, OLD.closed_at, OLD.closure_note, OLD.closure_released_amount, OLD.reopened_at, OLD.reopen_reason);
    IF NOT changed AND ROW(NEW.closed_by, NEW.reopened_by) IS DISTINCT FROM ROW(OLD.closed_by, OLD.reopened_by) THEN
      author_cleared_by_deletion :=
        (NEW.closed_by IS NOT DISTINCT FROM OLD.closed_by
          OR (NEW.closed_by IS NULL AND NOT EXISTS (SELECT FROM auth.users u WHERE u.id = OLD.closed_by)))
        AND (NEW.reopened_by IS NOT DISTINCT FROM OLD.reopened_by
          OR (NEW.reopened_by IS NULL AND NOT EXISTS (SELECT FROM auth.users u WHERE u.id = OLD.reopened_by)));
      changed := NOT author_cleared_by_deletion;
    END IF;
  END IF;

  IF changed AND NOT commanded THEN
    RAISE EXCEPTION 'Award closure changes only through the close-out' USING ERRCODE = '23514',
      HINT = 'Use Close out, Close with balance released, Record as closed on import or Reopen.';
  END IF;

  -- The close-out rule, for managed and unmanaged awards alike.
  IF NEW.spending_status = 'fully_spent'
     AND (TG_OP = 'INSERT' OR OLD.spending_status IS DISTINCT FROM 'fully_spent')
     AND NEW.closure_basis IN ('earned_coverage', 'reconciled_with_balance', 'recorded_on_import')
     AND EXISTS (SELECT FROM public.billing_invoice_records i
                  WHERE i.funding_award_id = NEW.id
                    AND i.status IN ('draft', 'internal_review', 'submitted', 'approved_for_payment')) THEN
    RAISE EXCEPTION 'Close-out needs every linked request paid or rejected' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_funding_award_closure() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER funding_award_closure_custody
  BEFORE INSERT OR UPDATE ON public.funding_awards
  FOR EACH ROW EXECUTE FUNCTION public.guard_funding_award_closure();
