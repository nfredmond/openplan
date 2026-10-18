-- PROPOSAL ONLY. Outside supabase/migrations, never part of migration up.
-- Root must admit this in a later release, after the corrected 000001 and
-- bridge application have deployed and every four-column writer has drained.
-- Record web/cron/worker/in-flight/rollback inventory and recovery capture first.
-- 000003 belongs to the award-condition lane. Recheck 000004 before promotion.
-- Once active, the bridge is the application rollback floor. Do not restore
-- the four-column index or deploy a four-column writer over distinct-kind rows.
BEGIN;
LOCK TABLE public.work_notifications IN ACCESS EXCLUSIVE MODE;
-- Refuse the historical, already-installed OLD000001 shape as well as drift.
-- This validates schema prerequisites, not retirement of deployed writers.
DO $$ BEGIN
  IF public.work_notification_kind_activation() IS DISTINCT FROM false OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index i
    WHERE i.indexrelid = pg_catalog.to_regclass('public.ux_work_notifications_subject_recipient')
      AND i.indrelid = 'public.work_notifications'::regclass
      AND i.indisunique AND i.indisvalid AND i.indisready
      AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indnkeyatts = 4
      AND ARRAY(SELECT pg_catalog.pg_get_indexdef(i.indexrelid, n, true)
        FROM pg_catalog.generate_series(1, 4) AS n)
        = ARRAY['subject_table', 'subject_id', 'recipient_user_id', 'due_on']
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index i
    WHERE i.indexrelid = pg_catalog.to_regclass('public.ux_work_notifications_subject_recipient_kind')
      AND i.indrelid = 'public.work_notifications'::regclass
      AND i.indisunique AND i.indisvalid AND i.indisready
      AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indnkeyatts = 5
      AND ARRAY(SELECT pg_catalog.pg_get_indexdef(i.indexrelid, n, true)
        FROM pg_catalog.generate_series(1, 5) AS n)
        = ARRAY['subject_table', 'subject_id', 'recipient_user_id', 'due_on', 'kind']
  ) THEN
    RAISE EXCEPTION 'work_notification_activation_requires_corrected_stage_one' USING ERRCODE = '23514';
  END IF;
END $$;
DROP INDEX public.ux_work_notifications_subject_recipient;
CREATE OR REPLACE FUNCTION public.work_notification_kind_activation()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT true;
$$;
REVOKE ALL ON FUNCTION public.work_notification_kind_activation() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.work_notification_kind_activation() TO service_role;
COMMIT;
