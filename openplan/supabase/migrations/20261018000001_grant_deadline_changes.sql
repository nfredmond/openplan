BEGIN;

-- Recorded dates, not an assertion that an official funder amended its notice.
-- Capture every writer in the opportunity transaction. A failed journal or
-- in-app notice insert must abort the opportunity write, with no swallowed error.
CREATE TABLE public.funding_opportunity_deadline_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- Retain the exact subject after its deletion, as work_notifications does.
  opportunity_id uuid NOT NULL,
  deadline_field text NOT NULL CHECK (deadline_field IN ('closes_at', 'decision_due_at')),
  old_at timestamptz,
  new_at timestamptz,
  opportunity_title text NOT NULL,
  -- Identity snapshots have no user FK: account deletion must not rewrite facts.
  actor_user_id uuid,
  creator_user_id uuid,
  recipient_status text NOT NULL CHECK (recipient_status IN ('current_member', 'creator_not_member', 'creator_unknown')),
  origin text NOT NULL DEFAULT 'recorded_opportunity' CHECK (origin = 'recorded_opportunity'),
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (old_at IS DISTINCT FROM new_at),
  UNIQUE (id, workspace_id, opportunity_id)
);
CREATE INDEX funding_opportunity_deadline_changes_subject
  ON public.funding_opportunity_deadline_changes(workspace_id, opportunity_id, changed_at);
ALTER TABLE public.funding_opportunity_deadline_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY funding_opportunity_deadline_changes_read
  ON public.funding_opportunity_deadline_changes FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = funding_opportunity_deadline_changes.workspace_id
      AND wm.user_id = (SELECT auth.uid())));
REVOKE ALL ON public.funding_opportunity_deadline_changes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.funding_opportunity_deadline_changes TO authenticated, service_role;

ALTER TABLE public.work_notifications
  ADD COLUMN deadline_change_id uuid,
  ALTER COLUMN due_on DROP NOT NULL;
ALTER TABLE public.work_notifications
  ADD CONSTRAINT work_notifications_deadline_change_scope_fkey
  FOREIGN KEY (deadline_change_id, workspace_id, subject_id)
  REFERENCES public.funding_opportunity_deadline_changes(id, workspace_id, opportunity_id),
  ADD CONSTRAINT work_notifications_deadline_shape CHECK (
    (kind = 'grant_deadline_changed' AND deadline_change_id IS NOT NULL AND due_on IS NULL
      AND subject_table = 'funding_opportunities')
    OR (kind <> 'grant_deadline_changed' AND deadline_change_id IS NULL AND due_on IS NOT NULL)
  );
ALTER TABLE public.work_notifications DROP CONSTRAINT work_notifications_kind_check;
ALTER TABLE public.work_notifications ADD CONSTRAINT work_notifications_kind_check CHECK (kind IN (
  'deliverable_due', 'milestone_due', 'submittal_due', 'invoice_due',
  'grant_decision_due', 'grant_application_due', 'grant_deadline_changed',
  'award_obligation_due', 'award_expenditure_due', 'measure_claim_review_due'
));
-- A decision and application can be due on the same day for the same subject.
DROP INDEX public.ux_work_notifications_subject_recipient;
CREATE UNIQUE INDEX ux_work_notifications_subject_recipient
  ON public.work_notifications (subject_table, subject_id, recipient_user_id, due_on, kind);
CREATE UNIQUE INDEX ux_work_notifications_deadline_change_recipient
  ON public.work_notifications (deadline_change_id, recipient_user_id)
  WHERE deadline_change_id IS NOT NULL;
CREATE INDEX idx_work_notifications_recipient_newest_unread
  ON public.work_notifications (recipient_user_id, created_at DESC) WHERE is_read = false;

-- No direct journal writes, even with the service role. The trigger needs
-- definer privileges solely to append journal/notice rows and check membership.
CREATE FUNCTION public.record_funding_opportunity_deadline_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  field_name text;
  previous_at timestamptz;
  next_at timestamptz;
  change_id uuid;
  recipient_state text;
  label text;
  notice_body text;
BEGIN
  -- Keep retained subjects in their original tenant. Normal deadline edits do
  -- not move opportunity identity; reject a combined move rather than relink history.
  IF TG_OP = 'UPDATE' AND (NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.id IS DISTINCT FROM OLD.id) THEN
    RAISE EXCEPTION 'funding_opportunity_identity_immutable' USING ERRCODE = '23514';
  END IF;
  FOREACH field_name IN ARRAY ARRAY['closes_at', 'decision_due_at'] LOOP
    previous_at := NULL;
    IF TG_OP = 'UPDATE' THEN
      previous_at := (pg_catalog.to_jsonb(OLD)->>field_name)::timestamptz;
    END IF;
    next_at := (pg_catalog.to_jsonb(NEW)->>field_name)::timestamptz;
    IF previous_at IS NOT DISTINCT FROM next_at THEN CONTINUE; END IF;

    -- Same membership test as loadWorkspaceRoster's caller gate. No assignee
    -- is inferred from owner_label, project staff, the actor, or a role name.
    recipient_state := CASE
      WHEN NEW.created_by IS NULL THEN 'creator_unknown'
      WHEN EXISTS (SELECT 1 FROM public.workspace_members wm
        WHERE wm.workspace_id = NEW.workspace_id AND wm.user_id = NEW.created_by)
        THEN 'current_member'
      ELSE 'creator_not_member' END;
    INSERT INTO public.funding_opportunity_deadline_changes
      (workspace_id, opportunity_id, deadline_field, old_at, new_at,
       opportunity_title, actor_user_id, creator_user_id, recipient_status)
    VALUES (NEW.workspace_id, NEW.id, field_name, previous_at, next_at,
      NEW.title, auth.uid(), NEW.created_by, recipient_state)
    RETURNING id INTO change_id;

    IF recipient_state = 'current_member' THEN
      label := CASE field_name WHEN 'closes_at' THEN 'Application closing' ELSE 'Pursue-or-skip decision' END;
      notice_body := label || ' deadline recorded in OpenPlan. Previous: ' ||
        COALESCE(pg_catalog.to_char(previous_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'not recorded') ||
        '. New: ' || COALESCE(pg_catalog.to_char(next_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'not recorded (cleared)') ||
        '. This records an OpenPlan edit; check the official notice before relying on it. ' ||
        CASE WHEN auth.uid() IS NULL THEN 'Actor unknown. ' ELSE 'Recorded actor: ' || auth.uid()::text || '. ' END ||
        'You recorded this opportunity; grant deadlines carry no assignee.';
      INSERT INTO public.work_notifications
        (workspace_id, recipient_user_id, kind, subject_table, subject_id,
         deadline_change_id, project_id, due_on, title, body, created_at)
      VALUES (NEW.workspace_id, NEW.created_by, 'grant_deadline_changed',
        'funding_opportunities', NEW.id, change_id, NULL, NULL, NEW.title, notice_body, clock_timestamp());
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.record_funding_opportunity_deadline_changes() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER funding_opportunity_deadline_changes_capture
  AFTER INSERT OR UPDATE ON public.funding_opportunities
  FOR EACH ROW EXECUTE FUNCTION public.record_funding_opportunity_deadline_changes();

CREATE FUNCTION public.keep_funding_deadline_facts_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME = 'funding_opportunity_deadline_changes' THEN
    RAISE EXCEPTION 'funding_deadline_change_immutable' USING ERRCODE = '23514';
  END IF;
  IF (OLD.deadline_change_id IS NOT NULL OR NEW.deadline_change_id IS NOT NULL)
    AND (pg_catalog.to_jsonb(NEW) - ARRAY['is_read', 'read_at']) IS DISTINCT FROM
        (pg_catalog.to_jsonb(OLD) - ARRAY['is_read', 'read_at']) THEN
    RAISE EXCEPTION 'funding_deadline_notice_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.keep_funding_deadline_facts_immutable() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER funding_deadline_change_immutable BEFORE UPDATE
  ON public.funding_opportunity_deadline_changes FOR EACH ROW
  EXECUTE FUNCTION public.keep_funding_deadline_facts_immutable();
CREATE TRIGGER funding_deadline_notice_immutable BEFORE UPDATE
  ON public.work_notifications FOR EACH ROW
  EXECUTE FUNCTION public.keep_funding_deadline_facts_immutable();

COMMENT ON TABLE public.funding_opportunity_deadline_changes IS
  'Append-only recorded deadline facts. No backfill or official-source change claim. Workspace deletion removes its records; opportunity/account deletion does not rewrite snapshots. Null actor means unknown. Notice and opportunity write commit together.';

COMMIT;
