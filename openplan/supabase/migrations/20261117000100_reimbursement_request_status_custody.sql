-- Reimbursement request status moves, rejection and resubmission, and the
-- payment date (KI-2026-11-16-137, KI-2026-11-16-135, KI-2026-11-16-136).
--
-- THE DEFECTS. In lane 84's run-through (agent-run, local, November 16, 2026)
-- a request could be created already "paid" with no approval, a paid request
-- could be moved back to draft and forward again, nothing on screen could
-- reject a submitted request, a resubmission had no tie to the request it
-- replaced, and no request recorded when it was paid.
--
-- `billing_invoice_records` is this workspace asking its funder for money
-- (20260812000012 says so), so every row is a reimbursement request and the
-- rules below hold for every row and every writer: the routes, the Data API,
-- service_role and the database owner. The client invoice lifecycle guard
-- (20261017000005) is the precedent for one rule for every writer, and
-- measure claims (20260812000012) for a paid status that requires its date.
--
-- THE RULES
--   - A request is created as a draft.
--   - Status moves forward only: draft, internal review, submitted, approved
--     for payment, paid. A step may be skipped, except that paid comes only
--     from approved for payment.
--   - Rejected comes only from submitted or approved for payment, with a
--     written reason.
--   - Paid and rejected are final. A rejected request is answered by a new
--     request that names it in `resubmits_invoice_id` (LAPM 5.5.1(8): invoice
--     1 becomes 1A).
--   - The payment date is recorded when, and only when, the request moves to
--     paid, and is not later than tomorrow on the server's UTC calendar.
--   - A resubmission names a rejected request in the same workspace and on
--     the same award, at creation only. Each rejected request has at most one
--     resubmission. The two stay on that award.
--   - The money is fixed once a request leaves draft: amount,
--     retention_percent, retention_amount and net_amount change only while
--     the request is a draft (and in the update that moves it out of draft).
--     Review 92 (agent-run, local) changed a paid request on a closed award
--     to 50,000 through the Data API as an owner. No product route, screen,
--     Planner Agent action, seed or smoke script writes these columns after
--     the row is created. currency_code is not frozen here: binding a legacy
--     request to an award with conditions sets it, and the handoff guard
--     (20261018000003) holds it once bound.
--
-- Existing rows keep their status, even a paid row that was never approved:
-- the guard checks changes, not history. Rows already paid show "Not
-- recorded" for the payment date.
--
-- Additive: three nullable columns, three CHECKs that every existing row
-- passes (the new columns are NULL on every row), one partial unique index, a
-- trigger function and one trigger. No policy, grant or function is dropped or
-- replaced, and no row is rewritten.

ALTER TABLE public.billing_invoice_records
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS resubmits_invoice_id UUID REFERENCES public.billing_invoice_records(id),
  ADD COLUMN IF NOT EXISTS paid_date DATE;

COMMENT ON COLUMN public.billing_invoice_records.rejection_reason IS
  'Why the funder returned this request, recorded when it moved to rejected. NULL on every other request.';
COMMENT ON COLUMN public.billing_invoice_records.resubmits_invoice_id IS
  'The rejected request this one replaces, in the same workspace and on the same award. Set at creation only.';
COMMENT ON COLUMN public.billing_invoice_records.paid_date IS
  'The date the funder paid this request, recorded when it moved to paid. NULL means not recorded, never a payment on an unknown date.';

ALTER TABLE public.billing_invoice_records
  ADD CONSTRAINT billing_invoice_records_paid_date_only_when_paid CHECK (paid_date IS NULL OR status = 'paid'),
  ADD CONSTRAINT billing_invoice_records_rejection_reason_when_rejected CHECK (
    rejection_reason IS NULL OR (status = 'rejected' AND length(btrim(rejection_reason)) > 0)
  ),
  ADD CONSTRAINT billing_invoice_records_resubmits_another CHECK (resubmits_invoice_id IS DISTINCT FROM id);

CREATE UNIQUE INDEX billing_invoice_records_one_resubmission
  ON public.billing_invoice_records(resubmits_invoice_id)
  WHERE resubmits_invoice_id IS NOT NULL;

CREATE FUNCTION public.guard_reimbursement_request_status() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  replaced public.billing_invoice_records;
  old_rank integer;
  new_rank integer;
  ranks constant jsonb := '{"draft":0,"internal_review":1,"submitted":2,"approved_for_payment":3,"paid":4}';
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'A reimbursement request is created as a draft' USING ERRCODE = '23514';
    END IF;
    IF NEW.resubmits_invoice_id IS NOT NULL THEN
      SELECT * INTO replaced FROM public.billing_invoice_records WHERE id = NEW.resubmits_invoice_id;
      IF replaced.id IS NULL OR replaced.workspace_id <> NEW.workspace_id
         OR replaced.funding_award_id IS NULL OR replaced.funding_award_id IS DISTINCT FROM NEW.funding_award_id THEN
        RAISE EXCEPTION 'A resubmission names a request on the same award in this workspace' USING ERRCODE = '23514';
      END IF;
      IF replaced.status <> 'rejected' THEN
        RAISE EXCEPTION 'Only a rejected request can be resubmitted' USING ERRCODE = '23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.resubmits_invoice_id IS DISTINCT FROM OLD.resubmits_invoice_id THEN
    RAISE EXCEPTION 'The request a resubmission replaces is set when it is created' USING ERRCODE = '23514';
  END IF;

  IF OLD.status <> 'draft'
     AND ROW(NEW.amount, NEW.retention_percent, NEW.retention_amount, NEW.net_amount)
         IS DISTINCT FROM ROW(OLD.amount, OLD.retention_percent, OLD.retention_amount, OLD.net_amount) THEN
    RAISE EXCEPTION 'A % request''s amount and retention are fixed once it leaves draft', OLD.status USING ERRCODE = '23514';
  END IF;

  -- A resubmission and the request it replaces stay on one award. The
  -- award's ON DELETE SET NULL may still clear the link when the award is
  -- deleted.
  IF NEW.funding_award_id IS DISTINCT FROM OLD.funding_award_id
     AND NOT (NEW.funding_award_id IS NULL AND NOT EXISTS (SELECT FROM public.funding_awards f WHERE f.id = OLD.funding_award_id))
     AND (OLD.resubmits_invoice_id IS NOT NULL
          OR EXISTS (SELECT FROM public.billing_invoice_records r WHERE r.resubmits_invoice_id = OLD.id)) THEN
    RAISE EXCEPTION 'A resubmission and the request it replaces stay on one award' USING ERRCODE = '23514';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status IN ('paid', 'rejected') THEN
      RAISE EXCEPTION 'A % request is final; it cannot move to %', OLD.status, NEW.status USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'rejected' THEN
      IF OLD.status NOT IN ('submitted', 'approved_for_payment') THEN
        RAISE EXCEPTION 'Only a submitted or approved request can be marked rejected' USING ERRCODE = '23514';
      END IF;
      IF NEW.rejection_reason IS NULL OR length(btrim(NEW.rejection_reason)) = 0 THEN
        RAISE EXCEPTION 'Marking a request rejected needs the reason' USING ERRCODE = '23514';
      END IF;
    ELSIF NEW.status = 'paid' THEN
      IF OLD.status <> 'approved_for_payment' THEN
        RAISE EXCEPTION 'A request is marked paid only after it is approved for payment' USING ERRCODE = '23514';
      END IF;
      IF NEW.paid_date IS NULL THEN
        RAISE EXCEPTION 'Marking a request paid needs the payment date' USING ERRCODE = '23514';
      END IF;
      IF NEW.paid_date > (now() AT TIME ZONE 'UTC')::date + 1 THEN
        RAISE EXCEPTION 'The payment date cannot be in the future' USING ERRCODE = '23514';
      END IF;
    ELSE
      old_rank := (ranks ->> OLD.status)::integer;
      new_rank := (ranks ->> NEW.status)::integer;
      IF old_rank IS NULL OR new_rank IS NULL OR new_rank <= old_rank THEN
        RAISE EXCEPTION 'A request moves forward only; it cannot move from % to %', OLD.status, NEW.status USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  IF NEW.paid_date IS DISTINCT FROM OLD.paid_date AND NOT (NEW.status = 'paid' AND OLD.status <> 'paid') THEN
    RAISE EXCEPTION 'The payment date is recorded only when a request is marked paid' USING ERRCODE = '23514';
  END IF;
  IF NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason AND NOT (NEW.status = 'rejected' AND OLD.status <> 'rejected') THEN
    RAISE EXCEPTION 'The rejection reason is recorded only when a request is marked rejected' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_reimbursement_request_status() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER reimbursement_request_status_custody
  BEFORE INSERT OR UPDATE ON public.billing_invoice_records
  FOR EACH ROW EXECUTE FUNCTION public.guard_reimbursement_request_status();
