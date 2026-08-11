-- WORK NOTIFICATIONS — the deadline reminder a planner actually receives.
--
-- WHY A TABLE AND NOT JUST AN EMAIL. /my-work reads the deadlines live from
-- each owning module (no mirror, by design). A REMINDER is a different fact: it
-- records that this person was told about this deadline, on this day. Without a
-- row there is no way to answer "was anyone warned?", no way to stop the sweep
-- telling the same person the same thing every run, and — because
-- OPENPLAN AT $0 HAS NO EMAIL TRANSPORT — no way for the reminder to arrive at
-- all. In-app always, email when a transport is configured (Nathaniel,
-- 2026-08-11).
--
-- IDEMPOTENCY IS THE UNIQUE INDEX, NOT A TIMESTAMP COMPARISON. One row per
-- (subject_table, subject_id, recipient_user_id, due_on): re-running the sweep
-- inserts nothing, so the digest email — which is sent only for rows the sweep
-- actually created — is sent once. `due_on` is NOT NULL for that reason and
-- not merely for tidiness: NULLs are DISTINCT in a unique index, so a nullable
-- due date would make the whole guarantee silently vacuous for any row that had
-- one. A deadline reminder with no deadline is not a thing this table holds.
--
-- IT IS A DATE even though two of the six sources carry `timestamptz`
-- (funding_opportunities.decision_due_at, funding_awards.obligation_due_at).
-- The idempotency question is "have we already told them about the day this is
-- due", and a timestamptz key would re-notify on a one-second edit.
--
-- RECIPIENT-SCOPED, NOT WORKSPACE-SCOPED. Unlike engagement_notifications
-- (an operator inbox the whole team shares), this is one person's list: the
-- SELECT policy requires `recipient_user_id = auth.uid()` AND membership. A
-- teammate's reminders are not workspace content.
--
-- WRITTEN BY THE SERVICE ROLE ONLY — there is no INSERT policy, following
-- engagement_notifications: rows are authored by /api/cron/sweep-deadlines,
-- which has no auth.uid(). Members may only flip read state.
--
-- ============================ GUARD COUNTS THIS MIGRATION MOVES ============
-- Stated here so the numbers in the test files are traceable to a migration
-- rather than to somebody's arithmetic:
--
--   viewer-write-denial-guard.test.ts
--     EXPECTED_GATED_TABLES          81  -> 82
--     EXPECTED_RESTRICTIVE_POLICIES 243  -> 246
--     EXPECTED_PERMISSIVE_WRITE_...  223 -> 224
--   migrations/inventory.test.ts
--     policies 585 -> 590, permissive 342 -> 344, restrictive 243 -> 246,
--     permissiveWrites 223 -> 224, tablesWithPolicies 119 -> 120,
--     relations 139 -> 140, tables 132 -> 133, rlsEnabledTables 132 -> 133.
--     `views` holds at 7 and `expanded` at 264 — every policy here is literal.
--   rls-isolation.test.ts — a WORKSPACE_RLS_PROBES fixture, 58 -> 59 probes.
--
-- The permissive UPDATE below is deliberately ROLE-BLIND (membership only), so
-- it needs the three RESTRICTIVE `workspace_member_can_write` gates that
-- 20260728000006 installs over every other role-blind workspace write. That is
-- the engagement_notifications shape, copied on purpose.
--
-- ONE CONSEQUENCE, RECORDED RATHER THAN DISCOVERED LATER: a VIEWER who was
-- assigned a record would receive reminders and could not mark them read — the
-- restrictive gate denies the update, which PostgREST reports as zero matched
-- rows. The mark-read route answers that honestly ("could not be marked read")
-- instead of reporting success. It is the same behaviour engagement_notifications
-- has had since 20260728000006, and the honest refusal is preferable to making
-- this table the one place a viewer may write.

CREATE TABLE IF NOT EXISTS work_notifications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind IN (
    'deliverable_due','milestone_due','submittal_due',
    'invoice_due','grant_decision_due','award_obligation_due'
  )),
  -- The owning table and row, so a reminder can always be traced back to the
  -- record it is about. Not a foreign key: six different tables answer here,
  -- and Postgres has no polymorphic reference. A deleted subject leaves its
  -- reminder behind, which is correct — "you were told about this on the 4th"
  -- stays true after the deliverable is removed.
  subject_table     text NOT NULL,
  subject_id        uuid NOT NULL,
  project_id        uuid REFERENCES projects(id) ON DELETE CASCADE,
  due_on            date NOT NULL,
  title             text NOT NULL,
  body              text NOT NULL DEFAULT '',
  is_read           boolean NOT NULL DEFAULT false,
  read_at           timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- THE IDEMPOTENCY INDEX. Dropping it does not merely permit duplicates: the
-- sweep's insert names these columns as its ON CONFLICT target, so the daily
-- digest would go out again on every run. src/test/work-notification-sweep.test.ts
-- reads this index out of this file and builds its fake table's uniqueness from
-- it, so deleting the line here fails the double-run test rather than passing.
CREATE UNIQUE INDEX IF NOT EXISTS ux_work_notifications_subject_recipient
  ON work_notifications (subject_table, subject_id, recipient_user_id, due_on);

-- The inbox's only query: this person's unread reminders, soonest first.
CREATE INDEX IF NOT EXISTS idx_work_notifications_recipient_unread
  ON work_notifications (recipient_user_id, due_on) WHERE is_read = false;

ALTER TABLE work_notifications ENABLE ROW LEVEL SECURITY;

-- A reminder is one person's. Membership is asked as well as recipiency: a
-- person removed from a workspace stops seeing its reminders immediately,
-- without anything having to go back and delete them.
DROP POLICY IF EXISTS work_notifications_read ON work_notifications;
CREATE POLICY work_notifications_read ON work_notifications FOR SELECT USING (
  recipient_user_id = auth.uid()
  AND EXISTS (SELECT 1 FROM workspace_members wm
              WHERE wm.workspace_id = work_notifications.workspace_id
                AND wm.user_id = auth.uid()));

-- Mark-read, and nothing else the app offers. WITH CHECK repeats the USING
-- clause so a row cannot be updated INTO someone else's list.
DROP POLICY IF EXISTS work_notifications_update ON work_notifications;
CREATE POLICY work_notifications_update ON work_notifications FOR UPDATE
  USING (recipient_user_id = auth.uid()
         AND EXISTS (SELECT 1 FROM workspace_members wm
                     WHERE wm.workspace_id = work_notifications.workspace_id
                       AND wm.user_id = auth.uid()))
  WITH CHECK (recipient_user_id = auth.uid()
              AND EXISTS (SELECT 1 FROM workspace_members wm
                          WHERE wm.workspace_id = work_notifications.workspace_id
                            AND wm.user_id = auth.uid()));

-- The restrictive writer gates. INSERT and DELETE have no permissive partner,
-- so they are already refused; the gates are installed for all three commands
-- anyway, because the command a table does not use today is the one a future
-- route reaches for (viewer-write-denial-guard.test.ts asserts exactly that).
DROP POLICY IF EXISTS work_notifications_writer_only_insert ON work_notifications;
CREATE POLICY work_notifications_writer_only_insert ON work_notifications
  AS RESTRICTIVE FOR INSERT WITH CHECK (public.workspace_member_can_write(workspace_id));

DROP POLICY IF EXISTS work_notifications_writer_only_update ON work_notifications;
CREATE POLICY work_notifications_writer_only_update ON work_notifications
  AS RESTRICTIVE FOR UPDATE
  USING (public.workspace_member_can_write(workspace_id))
  WITH CHECK (public.workspace_member_can_write(workspace_id));

DROP POLICY IF EXISTS work_notifications_writer_only_delete ON work_notifications;
CREATE POLICY work_notifications_writer_only_delete ON work_notifications
  AS RESTRICTIVE FOR DELETE
  USING (public.workspace_member_can_write(workspace_id));

COMMENT ON TABLE work_notifications IS
  'One deadline reminder for one person: what was due, when, and whether they have read it. Authored by the daily deadline sweep with the service role; readable and mark-read-able only by its recipient.';
