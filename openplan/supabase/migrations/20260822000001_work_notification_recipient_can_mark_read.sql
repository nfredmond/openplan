-- A REMINDER ADDRESSED TO YOU IS YOURS TO DISMISS — including when you are a
-- viewer.
--
-- WHAT SHIPPED, AND WHY NO LANE OWNED IT. Three correct decisions composed into
-- a dead end:
--
--   * assignee validation asks membership, not rank, so a writer can assign a
--     deliverable to a viewer-role teammate (deliberate — a viewer can be the
--     right reviewer);
--   * the nightly deadline sweep writes a reminder to whoever is assigned,
--     filtering on membership for the same reason;
--   * `work_notifications_writer_only_update` (20260811000007) requires
--     `workspace_member_can_write`, which is false for a viewer.
--
-- So the viewer's My Work inbox carries an unread badge that nothing in the
-- product can ever clear: single mark-read answers 404, mark-all answers
-- ok/marked:0, and only a role change or a service-role delete ends it.
--
-- This table's own comment already stated the intent — 'readable and
-- mark-read-able only by its recipient' — and the permissive policy beside the
-- gate is exactly recipient-scoped. The restrictive gate was simply wider than
-- the rule it was written to express: it was installed to stop a VIEWER writing
-- WORKSPACE CONTENT, and a reminder addressed to one person is not that.
-- Dismissing it changes nothing anyone else can see.
--
-- The gate stays for everything else. A viewer still cannot touch another
-- person's reminder (the permissive policy never allowed it), still cannot mint
-- one, and still cannot delete one — those rows are EVIDENCE that a person was
-- told something was due, authored by the service-role sweep, and the person
-- they are about must not be able to create or destroy one.

DROP POLICY IF EXISTS work_notifications_writer_only_update ON work_notifications;
CREATE POLICY work_notifications_writer_only_update ON work_notifications
  AS RESTRICTIVE FOR UPDATE
  USING (
    public.workspace_member_can_write(workspace_id)
    OR recipient_user_id = auth.uid()
  )
  WITH CHECK (
    public.workspace_member_can_write(workspace_id)
    OR recipient_user_id = auth.uid()
  );

-- AND NARROW THE GRANT WHILE WIDENING THE POLICY, so this is a net tightening
-- rather than a trade.
--
-- 20260811000011 granted table-wide UPDATE to `authenticated`, so the only
-- thing standing between a recipient and rewriting their own reminder's title,
-- body, due date or subject was the restrictive gate now being relaxed. RLS
-- cannot express "these columns only" — `WITH CHECK` cannot see the old row —
-- but a column grant can, and the app has only ever offered mark-read.
--
-- A reminder is a record of what a person was told. Leaving them able to edit
-- its text would make that record worth less than the badge it clears.
REVOKE UPDATE ON TABLE public.work_notifications FROM authenticated;
GRANT UPDATE (is_read, read_at) ON TABLE public.work_notifications TO authenticated;

COMMENT ON POLICY work_notifications_writer_only_update ON work_notifications IS
  'Restrictive UPDATE gate. Writers may update; so may the reminder''s own recipient, whatever their rank — a viewer who can be assigned work and reminded of it must be able to clear the reminder. Column grants limit every non-service caller to is_read and read_at.';
