-- Test-only peer connection. The wrapper removes this run's exact fixture IDs
-- after the main transaction rolls back, including when an assertion fails.
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;
SELECT extensions.dblink_connect('reconciliation_peer','host=/var/run/postgresql user=postgres dbname=postgres');
SELECT extensions.dblink_exec('reconciliation_peer',$seed$
  INSERT INTO auth.users(id,email) VALUES('__ACTOR__','__ACTOR__@synthetic.invalid'),('__OTHER_OWNER__','__OTHER_OWNER__@synthetic.invalid');
  INSERT INTO public.workspaces(id,name,slug) VALUES('__WORKSPACE__','SYNTHETIC reconciliation lock fixture','__WORKSPACE__');
  INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES('__WORKSPACE__','__ACTOR__','owner'),('__WORKSPACE__','__OTHER_OWNER__','owner');
  INSERT INTO public.land_use_plans(id,workspace_id,title,descriptor_id,plan_kind_key,authority_label,geography_label)
    VALUES('__PLAN__','__WORKSPACE__','SYNTHETIC locking','synthetic-lock-rules','area','SYNTHETIC','SYNTHETIC');
  INSERT INTO public.land_use_plan_versions(id,workspace_id,plan_id,version_number,version_kind)
    VALUES('__VERSION__','__WORKSPACE__','__PLAN__',1,'original');
  UPDATE public.land_use_plans SET current_working_version_id='__VERSION__' WHERE id='__PLAN__';
$seed$);
DO $test$
DECLARE
  descriptor text:='{"id":"synthetic-lock-rules","planKinds":[{"key":"area","label":"SYNTHETIC"}],"requirements":[]}';
  command jsonb; statement text; locking text; result jsonb;
BEGIN
  command:=jsonb_build_object('operation','reconcile','commandId','__COMMAND__','versionId','__VERSION__',
    'expectedDraftRevision',0,'expectedDescriptorHash',encode(extensions.digest(descriptor,'sha256'),'hex'));
  statement:=format('SELECT public.reconcile_land_use_plan_rules(%L,%L,%L,%L,%L,%L)','__PLAN__','__WORKSPACE__','__ACTOR__','__COMMAND__',command::text,descriptor);
  -- Empty rules require no child writes. A secondary insert/update lock cannot
  -- conceal a missing explicit version or membership lock.
  FOREACH locking IN ARRAY ARRAY[
    'SELECT id FROM public.land_use_plans WHERE id=''__PLAN__'' FOR NO KEY UPDATE',
    'SELECT user_id FROM public.workspace_members WHERE workspace_id=''__WORKSPACE__'' AND user_id=''__ACTOR__'' FOR NO KEY UPDATE',
    'SELECT id FROM public.land_use_plan_versions WHERE id=''__VERSION__'' FOR NO KEY UPDATE'
  ] LOOP
    PERFORM extensions.dblink_exec('reconciliation_peer','BEGIN');
    PERFORM * FROM extensions.dblink('reconciliation_peer',locking) AS held(id uuid);
    BEGIN
      SET LOCAL ROLE service_role;
      EXECUTE statement;
      RAISE EXCEPTION 'Reconciliation accepted while peer held %',locking;
    EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
    END;
    SET LOCAL ROLE supabase_admin;
    PERFORM extensions.dblink_exec('reconciliation_peer','ROLLBACK');
  END LOOP;
  SET LOCAL ROLE service_role;
  result:=public.reconcile_land_use_plan_rules('__PLAN__','__WORKSPACE__','__ACTOR__','__COMMAND__',command::text,descriptor);
  SET LOCAL ROLE supabase_admin;
  IF result->>'replayed'<>'false' OR result->'addedSections'<>'[]'::jsonb OR result->'draftRevision'<>'0'::jsonb THEN
    RAISE EXCEPTION 'Empty reconciliation receipt changed draft content';
  END IF;
  -- A completed statement still owns the transaction's locks until commit.
  FOREACH locking IN ARRAY ARRAY[
    'PERFORM id FROM public.land_use_plans WHERE id=''__PLAN__'' FOR UPDATE NOWAIT',
    'PERFORM user_id FROM public.workspace_members WHERE workspace_id=''__WORKSPACE__'' AND user_id=''__ACTOR__'' FOR UPDATE NOWAIT',
    'PERFORM id FROM public.land_use_plan_versions WHERE id=''__VERSION__'' FOR UPDATE NOWAIT'
  ] LOOP
    PERFORM extensions.dblink_exec('reconciliation_peer','DO $peer$ BEGIN BEGIN '||locking||'; RAISE EXCEPTION ''Peer obtained a protected row''; EXCEPTION WHEN lock_not_available THEN NULL; END; END $peer$;');
  END LOOP;
END $test$;
SELECT extensions.dblink_disconnect('reconciliation_peer');
SELECT 'plan rule reconciliation locks verified';
