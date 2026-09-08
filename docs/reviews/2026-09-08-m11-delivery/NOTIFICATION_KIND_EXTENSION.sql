-- Pending authorization: this atomic validation change removes no data and preserves every existing kind.
-- Keep outside the migration directory until Nathaniel authorizes DROP CONSTRAINT.
BEGIN;
ALTER TABLE public.work_notifications
 ADD CONSTRAINT work_notifications_contract_kind_check CHECK (kind IN (
 'deliverable_due','milestone_due','submittal_due','invoice_due','grant_decision_due','award_obligation_due',
 'award_expenditure_due','measure_claim_review_due','contract_work_due','contract_work_review'
 ));
ALTER TABLE public.work_notifications DROP CONSTRAINT work_notifications_kind_check;
ALTER TABLE public.work_notifications RENAME CONSTRAINT work_notifications_contract_kind_check TO work_notifications_kind_check;
COMMIT;
