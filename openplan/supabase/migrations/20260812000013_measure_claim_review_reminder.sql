-- THE EIGHTH REMINDER KIND — a measure claim nobody has answered.
--
-- ==================================================================
-- WHAT IT IS, AND THE ONE THING IT DELIBERATELY IS NOT
-- ==================================================================
--
-- A sub-recipient submits a claim against a local measure fund and it sits
-- there. Nothing else in OpenPlan says so: `/my-work` reads deadlines, and a
-- claim awaiting a decision has no deadline. It is the accountability failure
-- this whole lane exists to make visible — public money a city asked for and
-- the agency never answered — and the oversight committee finds it a year
-- later, from the outside.
--
-- SO THIS IS A WAITING NOTICE, NOT A LATENESS NOTICE. Nothing in
-- `measure_claims`, `measure_funds` or any ordinance OpenPlan holds says when a
-- decision is DUE. There is no review-window column, and one invented here — a
-- 30-day default, a same-day service level — would be OpenPlan telling an
-- agency it had missed a standard nobody adopted. `sweepWorkDeadlines` is
-- therefore given `submitted_on` as the reminder's `due_on` and the source sets
-- `isOverdue` to false unconditionally; the notification body says in words
-- that no review deadline is recorded. Adding a real, agency-stated review
-- window later is a column on `measure_funds` and a one-line change to the
-- source's `toCandidates` — not a reason to guess one now.
--
-- WHY `submitted_on` IS NEVERTHELESS THE RIGHT KEY. `work_notifications` is
-- idempotent on (subject_table, subject_id, recipient_user_id, due_on), and
-- `submitted_on` never changes once a claim leaves draft
-- (`measure_claims_left_draft_has_a_date`, 20260812000012). One reminder per
-- claim per person, ever — not a daily nag about a queue somebody is already
-- working through. A resubmission after withdrawal is a new claim row and gets
-- its own.
--
-- ==================================================================
-- WHY THIS MIGRATION EXISTS AT ALL
-- ==================================================================
--
-- `work_notifications.kind` is a CHECK constraint (20260811000007) and
-- `WORK_NOTIFICATION_KINDS` in `src/lib/notifications/work.ts` is a copy of it.
-- The two are pinned together by `work-notification-sweep.test.ts`, which reads
-- the LATEST CHECK out of this migration corpus and requires that every kind in
-- the vocabulary is emitted by a source. Without the swap below the sweep's
-- inserts would be rejected at 13:00 UTC with nobody watching; with it and no
-- source, the same test fails for the opposite reason.
--
-- The constraint is dropped and re-added rather than widened in place, for the
-- reason 20260812000010 records: an inline column CHECK has no name in the
-- source, so `work_notifications_kind_check` (Postgres's own
-- `<table>_<column>_check`) is the only handle it has. The re-added list is the
-- seven kinds that exist plus the new one — spelled out rather than appended,
-- because a CHECK cannot be extended and a partial list would silently revoke
-- the others.
--
-- ==================================================================
-- GUARD COUNTS THIS MIGRATION MOVES: NONE.
--
-- No table, no view, no policy, and therefore no GRANT block. `measure_claims`
-- has its own from 20260812000012 and `work_notifications` from 20260811000011.
-- `migrations/inventory.test.ts`, `viewer-write-denial-guard.test.ts`,
-- `rls-isolation.test.ts` and `a-policy-without-a-grant-is-a-locked-door.test.ts`
-- are unchanged by it, and were RUN to confirm that rather than reasoned about.
--
-- The sweep reads `measure_claims` with the SERVICE ROLE across every tenant,
-- through the index 20260812000012 created for exactly this
-- (`idx_measure_claims_awaiting_decision`, partial on the two awaiting-decision
-- statuses). No new index is needed and none is added: a second partial index
-- over the same predicate would be dead weight on every claim write.

ALTER TABLE work_notifications
  DROP CONSTRAINT IF EXISTS work_notifications_kind_check;

ALTER TABLE work_notifications
  ADD CONSTRAINT work_notifications_kind_check CHECK (kind IN (
    'deliverable_due','milestone_due','submittal_due',
    'invoice_due','grant_decision_due','award_obligation_due',
    'award_expenditure_due','measure_claim_review_due'
  ));
