-- The date an award was obligated, and one request number per award
-- (KI-2026-11-16-139, KI-2026-11-16-138).
--
-- THE DEFECTS. OpenPlan records when an award's obligation is due, not when
-- the award was obligated, authorized or allocated, so it cannot warn about a
-- request for costs before that date. Lane 84's run-through (agent-run, local,
-- November 16, 2026) logged a request dated January 15, 2026 against an award
-- due to obligate on June 30, 2026, with no warning. SS4A pre-award costs are
-- ineligible without written DOT authorization (FY 2026 NOFO, section H item
-- 1); Caltrans federal-aid costs before the E-76 date are not eligible (LAPM
-- 5.2.3); ATP costs before allocation are not eligible (2027 ATP Guidelines,
-- section 8). The same run-through logged invoice number E-DUP twice on one
-- award, both accepted.
--
-- WHAT IS ADDED
--   funding_awards.obligated_on  the date the award was obligated: the
--                                executed agreement, the E-76 authorization or
--                                the allocation, whichever the program uses.
--                                NULL means not recorded.
--   billing_invoice_records_award_number_unique
--                                one request number per award, compared
--                                without regard to case. Requests with no
--                                award are not constrained.
--
-- PRE-CHECK. The unique index fails to build if two requests on one award
-- already share a number. The window notes carry the read-only query that
-- lists them (docs/ops/hosted-install-windows/20261117-award-custody/).
--
-- Additive: one nullable column and one unique index. No row changes.

ALTER TABLE public.funding_awards
  ADD COLUMN IF NOT EXISTS obligated_on DATE;

COMMENT ON COLUMN public.funding_awards.obligated_on IS
  'The date this award was obligated, authorized or allocated (an executed agreement, an E-76 authorization or an allocation, as the program uses). Costs before it are generally not reimbursable. NULL means not recorded.';

CREATE UNIQUE INDEX billing_invoice_records_award_number_unique
  ON public.billing_invoice_records (funding_award_id, lower(invoice_number))
  WHERE funding_award_id IS NOT NULL;
