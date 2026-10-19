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
-- Stage one preserves the four-column arbiter used by the running build.
-- This additional key remains before and after activation. The batch RPC
-- handles conflicts with either key without naming an arbiter.
-- Application reminders stay pending until a later release removes the old
-- index and activates them together, after every four-column writer retires.
CREATE UNIQUE INDEX ux_work_notifications_subject_recipient_kind
  ON public.work_notifications (subject_table, subject_id, recipient_user_id, due_on, kind);
CREATE UNIQUE INDEX ux_work_notifications_deadline_change_recipient
  ON public.work_notifications (deadline_change_id, recipient_user_id)
  WHERE deadline_change_id IS NOT NULL;
CREATE INDEX idx_work_notifications_recipient_newest_unread
  ON public.work_notifications (recipient_user_id, created_at DESC) WHERE is_read = false;

CREATE FUNCTION public.work_notification_kind_activation()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT false;
$$;
REVOKE ALL ON FUNCTION public.work_notification_kind_activation() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.work_notification_kind_activation() TO service_role;

-- One batch and one targetless insert work with either uniqueness stage.
-- VOLATILE gives the classification queries a fresh READ COMMITTED snapshot
-- after an insert waits for a concurrent conflicting writer. Missing evidence
-- raises and rolls the whole RPC back. Row locks retain classification evidence
-- until commit; the table lock prevents activation between insert and classify.
CREATE FUNCTION public.insert_work_notification_reminders(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  requested record;
  actual record;
  inserted_rows jsonb;
  requested_rows jsonb;
  identity_key text;
  legacy_key boolean;
  outcome text;
  blocker text;
  outcome_rows jsonb[] := ARRAY[]::jsonb[];
  inserted_count integer := 0;
  duplicate_count integer := 0;
  deferred_count integer := 0;
BEGIN
  IF p_rows IS NULL OR pg_catalog.jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'work_reminder_batch_invalid' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_rows) AS e(value)
    WHERE pg_catalog.jsonb_typeof(e.value) <> 'object'
      OR NOT (e.value ?& ARRAY['workspace_id','recipient_user_id','kind','subject_table','subject_id','project_id','due_on','title','body'])
      OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(e.value)) <> 9
      OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_each(e.value) AS f(key,value)
        WHERE (f.key <> 'project_id' AND pg_catalog.jsonb_typeof(f.value) <> 'string')
          OR (f.key = 'project_id' AND pg_catalog.jsonb_typeof(f.value) NOT IN ('string','null')))
      OR (e.value->>'due_on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') THEN
    RAISE EXCEPTION 'work_reminder_row_shape_invalid' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_to_recordset(p_rows) AS r(
    workspace_id uuid, recipient_user_id uuid, kind text, subject_table text,
    subject_id uuid, project_id uuid, due_on date, title text, body text)
    WHERE r.workspace_id IS NULL OR r.recipient_user_id IS NULL OR r.subject_id IS NULL
      OR r.due_on IS NULL OR r.title IS NULL OR r.body IS NULL OR r.subject_table = ''
      OR r.kind NOT IN ('deliverable_due','milestone_due','submittal_due','invoice_due',
        'grant_decision_due','grant_application_due','award_obligation_due',
        'award_expenditure_due','measure_claim_review_due'))
    OR (SELECT count(DISTINCT (r.workspace_id,r.subject_table,r.subject_id,r.recipient_user_id,r.due_on,r.kind))
      FROM pg_catalog.jsonb_to_recordset(p_rows) AS r(
        workspace_id uuid, recipient_user_id uuid, kind text, subject_table text,
        subject_id uuid, project_id uuid, due_on date, title text, body text)) <> pg_catalog.jsonb_array_length(p_rows) THEN
    RAISE EXCEPTION 'work_reminder_values_or_identity_invalid' USING ERRCODE = '23514';
  END IF;
  SELECT COALESCE(pg_catalog.jsonb_object_agg(
    pg_catalog.jsonb_build_array(r.workspace_id,r.subject_table,r.subject_id,r.recipient_user_id,r.due_on,r.kind)::text,
    pg_catalog.to_jsonb(r)), '{}'::jsonb) INTO requested_rows
  FROM pg_catalog.jsonb_to_recordset(p_rows) AS r(
    workspace_id uuid, recipient_user_id uuid, kind text, subject_table text,
    subject_id uuid, project_id uuid, due_on date, title text, body text);

  LOCK TABLE public.work_notifications IN ROW EXCLUSIVE MODE;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_index i
    WHERE i.indexrelid = pg_catalog.to_regclass('public.ux_work_notifications_subject_recipient_kind')
      AND i.indrelid = 'public.work_notifications'::regclass
      AND i.indisunique AND i.indisvalid AND i.indisready AND i.indimmediate
      AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indnkeyatts = 5
      AND ARRAY(SELECT pg_catalog.pg_get_indexdef(i.indexrelid,n,true)
        FROM pg_catalog.generate_series(1,5) AS n)
        = ARRAY['subject_table','subject_id','recipient_user_id','due_on','kind']) THEN
    RAISE EXCEPTION 'work_reminder_kind_key_missing' USING ERRCODE = '23514';
  END IF;
  SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_index i
    WHERE i.indexrelid = pg_catalog.to_regclass('public.ux_work_notifications_subject_recipient')
      AND i.indrelid = 'public.work_notifications'::regclass
      AND i.indisunique AND i.indisvalid AND i.indisready AND i.indimmediate
      AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indnkeyatts = 4
      AND ARRAY(SELECT pg_catalog.pg_get_indexdef(i.indexrelid,n,true)
        FROM pg_catalog.generate_series(1,4) AS n)
        = ARRAY['subject_table','subject_id','recipient_user_id','due_on']) INTO legacy_key;

  WITH inserted AS (
    INSERT INTO public.work_notifications AS n
      (workspace_id,recipient_user_id,kind,subject_table,subject_id,project_id,due_on,title,body)
    SELECT r.workspace_id,r.recipient_user_id,r.kind,r.subject_table,r.subject_id,r.project_id,r.due_on,r.title,r.body
    FROM pg_catalog.jsonb_to_recordset(p_rows) AS r(
      workspace_id uuid, recipient_user_id uuid, kind text, subject_table text,
      subject_id uuid, project_id uuid, due_on date, title text, body text)
    ON CONFLICT DO NOTHING
    RETURNING n.workspace_id,n.recipient_user_id,n.kind,n.subject_table,n.subject_id,n.project_id,n.due_on,n.title,n.body
  ) SELECT COALESCE(pg_catalog.jsonb_object_agg(
    pg_catalog.jsonb_build_array(inserted.workspace_id,inserted.subject_table,inserted.subject_id,inserted.recipient_user_id,inserted.due_on,inserted.kind)::text,
    pg_catalog.to_jsonb(inserted)), '{}'::jsonb) INTO inserted_rows FROM inserted;

  IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_each(inserted_rows) AS a(key,value)
    WHERE (requested_rows->a.key) IS DISTINCT FROM a.value) THEN
    RAISE EXCEPTION 'work_reminder_inserted_facts_changed' USING ERRCODE = '23514';
  END IF;

  FOR requested IN SELECT * FROM pg_catalog.jsonb_to_recordset(p_rows) AS r(
    workspace_id uuid, recipient_user_id uuid, kind text, subject_table text,
    subject_id uuid, project_id uuid, due_on date, title text, body text)
  LOOP
    identity_key := pg_catalog.jsonb_build_array(requested.workspace_id,requested.subject_table,
      requested.subject_id,requested.recipient_user_id,requested.due_on,requested.kind)::text;
    IF inserted_rows ? identity_key THEN
      SELECT x.* INTO actual FROM pg_catalog.jsonb_to_record(inserted_rows->identity_key) AS x(
        workspace_id uuid, recipient_user_id uuid, kind text, subject_table text,
        subject_id uuid, project_id uuid, due_on date, title text, body text);
      outcome_rows := pg_catalog.array_append(outcome_rows, pg_catalog.to_jsonb(actual) ||
        pg_catalog.jsonb_build_object('classification','inserted','blocking_kind',NULL));
      inserted_count := inserted_count + 1;
      CONTINUE;
    END IF;

    outcome := NULL;
    blocker := NULL;
    SELECT n.kind INTO blocker FROM public.work_notifications n
      WHERE n.workspace_id=requested.workspace_id AND n.subject_table=requested.subject_table
        AND n.subject_id=requested.subject_id AND n.recipient_user_id=requested.recipient_user_id
        AND n.due_on=requested.due_on AND n.kind=requested.kind FOR SHARE;
    IF FOUND THEN
      outcome := 'duplicate';
      blocker := NULL;
    ELSIF legacy_key THEN
      SELECT n.kind INTO blocker FROM public.work_notifications n
        WHERE n.workspace_id=requested.workspace_id AND n.subject_table=requested.subject_table
          AND n.subject_id=requested.subject_id AND n.recipient_user_id=requested.recipient_user_id
          AND n.due_on=requested.due_on AND n.kind<>requested.kind FOR SHARE;
      IF FOUND THEN outcome := 'deferred_old_key'; END IF;
    END IF;
    IF outcome IS NULL THEN
      RAISE EXCEPTION 'work_reminder_classification_missing' USING ERRCODE = '23514';
    END IF;
    outcome_rows := pg_catalog.array_append(outcome_rows, pg_catalog.to_jsonb(requested) ||
      pg_catalog.jsonb_build_object('classification',outcome,'blocking_kind',blocker));
    IF outcome = 'duplicate' THEN duplicate_count := duplicate_count + 1;
    ELSE deferred_count := deferred_count + 1; END IF;
  END LOOP;
  IF pg_catalog.cardinality(outcome_rows) <> pg_catalog.jsonb_array_length(p_rows)
    OR inserted_count + duplicate_count + deferred_count <> pg_catalog.jsonb_array_length(p_rows) THEN
    RAISE EXCEPTION 'work_reminder_envelope_counts_invalid' USING ERRCODE = '23514';
  END IF;
  -- A scalar envelope is one API value. max_rows does not page its nested array.
  RETURN pg_catalog.jsonb_build_object('protocol','work_reminder_batch_v1',
    'requested_count',pg_catalog.jsonb_array_length(p_rows),'inserted_count',inserted_count,
    'duplicate_count',duplicate_count,'deferred_count',deferred_count,
    'outcomes',pg_catalog.to_jsonb(outcome_rows));
END;
$$;
REVOKE ALL ON FUNCTION public.insert_work_notification_reminders(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.insert_work_notification_reminders(jsonb) TO service_role;

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
