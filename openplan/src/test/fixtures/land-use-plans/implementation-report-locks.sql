-- The wrapper removes only these randomly identified, synthetic peer fixtures.
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;
SELECT extensions.dblink_connect('report_peer','host=/var/run/postgresql user=postgres dbname=postgres');
SELECT extensions.dblink_exec('report_peer',$seed$
  INSERT INTO auth.users(id,email) VALUES('__ACTOR__','__ACTOR__@synthetic.invalid');
  INSERT INTO public.workspaces(id,name,slug) VALUES('__WORKSPACE__','SYNTHETIC implementation report lock fixture','__WORKSPACE__');
  INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES('__WORKSPACE__','__ACTOR__','owner');
  INSERT INTO public.land_use_plans(id,workspace_id,title,descriptor_id,plan_kind_key,authority_label,geography_label)
    VALUES('__PLAN__','__WORKSPACE__','SYNTHETIC plan','local-unconfigured','community','SYNTHETIC authority','SYNTHETIC area');
  INSERT INTO public.land_use_plan_versions(id,workspace_id,plan_id,version_number,version_kind)
    VALUES('__VERSION__','__WORKSPACE__','__PLAN__',1,'original');
  INSERT INTO public.land_use_plan_implementation_actions(id,workspace_id,version_id,title,status)
    VALUES('__ACTION__','__WORKSPACE__','__VERSION__','SYNTHETIC action','not_started');
  DO $freeze$
  DECLARE source text:='{"designations":[],"implementationActions":[],"nodes":[],"plan":{"authorityLabel":"SYNTHETIC authority","descriptorId":"local-unconfigured","geographyLabel":"SYNTHETIC area","id":"__PLAN__","planKindKey":"community","title":"SYNTHETIC plan"},"relationships":[],"version":{"id":"__VERSION__","versionNumber":1}}';
  BEGIN
    UPDATE public.land_use_plan_versions SET state='adopted',frozen_snapshot=source::jsonb,
      content_hash=encode(extensions.digest(source,'sha256'),'hex'),frozen_at=now(),frozen_by='__ACTOR__' WHERE id='__VERSION__';
    UPDATE public.land_use_plans SET current_adopted_version_id='__VERSION__' WHERE id='__PLAN__';
  END $freeze$;
$seed$);
DO $test$
DECLARE
  source text:='{"designations":[],"implementationActions":[],"nodes":[],"plan":{"authorityLabel":"SYNTHETIC authority","descriptorId":"local-unconfigured","geographyLabel":"SYNTHETIC area","id":"__PLAN__","planKindKey":"community","title":"SYNTHETIC plan"},"relationships":[],"version":{"id":"__VERSION__","versionNumber":1}}';
  command jsonb; statement text; locking text; result jsonb; saved jsonb;
BEGIN
  command:=jsonb_build_object('operation','generate','commandId','__COMMAND__','versionId','__VERSION__',
    'expectedVersionHash',encode(extensions.digest(source,'sha256'),'hex'),'reportingPeriodStart','2026-01-01',
    'reportingPeriodEnd','2026-10-07','title','SYNTHETIC report','summary',NULL);
  statement:=format('SELECT public.create_land_use_plan_implementation_report(%L,%L,%L,%L,%L,%L)',
    '__PLAN__','__WORKSPACE__','__ACTOR__','__COMMAND__',command::text,source);
  -- NO KEY UPDATE distinguishes explicit locks from foreign-key KEY SHARE locks.
  FOREACH locking IN ARRAY ARRAY[
    'SELECT id FROM public.land_use_plans WHERE id=''__PLAN__'' FOR NO KEY UPDATE',
    'SELECT user_id FROM public.workspace_members WHERE workspace_id=''__WORKSPACE__'' AND user_id=''__ACTOR__'' FOR NO KEY UPDATE',
    'SELECT id FROM public.land_use_plan_versions WHERE id=''__VERSION__'' FOR NO KEY UPDATE'
  ] LOOP
    PERFORM extensions.dblink_exec('report_peer','BEGIN');
    PERFORM * FROM extensions.dblink('report_peer',locking) AS held(id uuid);
    BEGIN
      SET LOCAL ROLE service_role;
      EXECUTE statement;
      RAISE EXCEPTION 'Report accepted while peer held %',locking;
    EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
    END;
    SET LOCAL ROLE supabase_admin;
    PERFORM extensions.dblink_exec('report_peer','ROLLBACK');
  END LOOP;
  -- A real status update, not merely a manually acquired version lock, goes first.
  PERFORM extensions.dblink_exec('report_peer','BEGIN');
  PERFORM extensions.dblink_exec('report_peer','UPDATE public.land_use_plan_implementation_actions SET status=''in_progress'' WHERE id=''__ACTION__''');
  BEGIN
    SET LOCAL ROLE service_role;
    EXECUTE statement;
    RAISE EXCEPTION 'Report accepted while a status edit was uncommitted';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  SET LOCAL ROLE supabase_admin;
  PERFORM extensions.dblink_exec('report_peer','COMMIT');
  SET LOCAL ROLE service_role;
  EXECUTE statement INTO result;
  SELECT action_status_snapshot INTO saved FROM public.land_use_plan_implementation_reports WHERE id=(result->>'implementationReportId')::uuid;
  IF result->>'replayed'<>'false' OR saved#>>'{0,status}'<>'in_progress' THEN RAISE EXCEPTION 'Committed status was not captured'; END IF;
  SET LOCAL ROLE supabase_admin;
  -- The report goes first. Its explicit locks remain held until transaction end.
  FOREACH locking IN ARRAY ARRAY[
    'PERFORM id FROM public.land_use_plans WHERE id=''__PLAN__'' FOR NO KEY UPDATE NOWAIT',
    'PERFORM user_id FROM public.workspace_members WHERE workspace_id=''__WORKSPACE__'' AND user_id=''__ACTOR__'' FOR NO KEY UPDATE NOWAIT',
    'PERFORM id FROM public.land_use_plan_versions WHERE id=''__VERSION__'' FOR NO KEY UPDATE NOWAIT'
  ] LOOP
    PERFORM extensions.dblink_exec('report_peer','DO $peer$ BEGIN BEGIN '||locking||'; RAISE EXCEPTION ''Peer obtained a protected row''; EXCEPTION WHEN lock_not_available THEN NULL; END; END $peer$;');
  END LOOP;
  PERFORM extensions.dblink_exec('report_peer',$peer$
    DO $edit$ BEGIN
      BEGIN
        UPDATE public.land_use_plan_implementation_actions SET status='completed' WHERE id='__ACTION__';
        RAISE EXCEPTION 'Status edit accepted while report transaction held its version';
      EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
      END;
    END $edit$;
  $peer$);
  IF (SELECT action_status_snapshot IS DISTINCT FROM saved FROM public.land_use_plan_implementation_reports WHERE id=(result->>'implementationReportId')::uuid) THEN
    RAISE EXCEPTION 'Competing edit changed saved status';
  END IF;
END $test$;
SELECT extensions.dblink_disconnect('report_peer');
SELECT 'implementation report locks verified';
