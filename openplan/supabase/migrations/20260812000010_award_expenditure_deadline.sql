-- THE DEADLINE THAT ACTUALLY LOSES THE MONEY.
--
-- `funding_awards` could already record when funds must be OBLIGATED
-- (`obligation_due_at`, 20260410000043). It could not record when they must be
-- EXPENDED — the lapse date, after which an unspent balance goes back to the
-- funder and cannot be claimed again. Those are two different deadlines with
-- two different consequences, and an agency that misses the second one loses
-- real money: obligating is committing the award, expending is spending it.
--
-- WHY NOT REUSE obligation_due_at. Because telling a planner the wrong one of
-- the two is worse than telling them nothing. A workspace that records only an
-- obligation date and is reminded of a "lapse" would relax after obligating;
-- one that records only a lapse date and is reminded of an "obligation" would
-- chase a milestone it already met. They are stored apart and reminded apart.
--
-- NULLABLE, AND NO DEFAULT. Most awards in most agencies do not carry a lapse
-- date at all, and one this product invented from a program name or an award
-- year would be a date nobody agreed to. The reminder below fires only for a
-- date a person typed in.
--
-- ==================================================================
-- THE SEVENTH REMINDER KIND
--
-- `work_notifications.kind` is a CHECK constraint (20260811000007) and the
-- sweep holds a copy of the vocabulary in `WORK_NOTIFICATION_KINDS`. The two
-- are pinned together by `work-notification-sweep.test.ts`, which reads the
-- LATEST CHECK out of this migration corpus — so the swap below is what makes
-- the new kind legal, and deleting it fails that test rather than failing at
-- 13:00 UTC with nobody watching.
--
-- The constraint is dropped and re-added rather than widened in place: an
-- inline column CHECK has no name in the source, so `work_notifications_kind_check`
-- (Postgres's own `<table>_<column>_check`) is the only handle it has.
--
-- ==================================================================
-- GUARD COUNTS THIS MIGRATION MOVES: NONE.
--
-- No table, no view, no policy, and therefore no GRANT block — the tables
-- touched here already have theirs (`funding_awards` from 20260410000043,
-- `work_notifications` from 20260811000011, the grant that migration exists to
-- restore). `migrations/inventory.test.ts`, `viewer-write-denial-guard.test.ts`
-- and `a-policy-without-a-grant-is-a-locked-door.test.ts` are unchanged by it,
-- and were run to confirm that rather than reasoned about.

ALTER TABLE funding_awards
  ADD COLUMN IF NOT EXISTS expenditure_deadline_at TIMESTAMPTZ;

COMMENT ON COLUMN funding_awards.expenditure_deadline_at IS
  'When the awarded funds must be EXPENDED (the lapse date), as distinct from obligation_due_at. Entered by a person; OpenPlan never derives it.';

-- The daily sweep reads this column across every tenant, filtered to non-null
-- and within the horizon. Partial, because the overwhelming majority of awards
-- will never carry a lapse date.
CREATE INDEX IF NOT EXISTS idx_funding_awards_expenditure_deadline
  ON funding_awards (expenditure_deadline_at)
  WHERE expenditure_deadline_at IS NOT NULL;

ALTER TABLE work_notifications
  DROP CONSTRAINT IF EXISTS work_notifications_kind_check;

ALTER TABLE work_notifications
  ADD CONSTRAINT work_notifications_kind_check CHECK (kind IN (
    'deliverable_due','milestone_due','submittal_due',
    'invoice_due','grant_decision_due','award_obligation_due',
    'award_expenditure_due'
  ));
