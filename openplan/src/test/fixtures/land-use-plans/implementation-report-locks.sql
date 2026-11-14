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
    UPDATE public.land_use_plan_versions SET state='public_review',frozen_snapshot=source::jsonb,
      content_hash=encode(extensions.digest(source,'sha256'),'hex'),frozen_at=now(),frozen_by='__ACTOR__' WHERE id='__VERSION__';
    INSERT INTO public.kb_documents(id,workspace_id,title,source_kind,status)
      VALUES('__COMMAND__','__WORKSPACE__','SYNTHETIC publication evidence','pasted_text','ready');
    INSERT INTO public.land_use_plan_review_releases(id,workspace_id,plan_id,version_id,version_content_hash,
      round_number,review_method,review_open_on,review_close_on,external_review_document_id)
      VALUES('__ACTION__','__WORKSPACE__','__PLAN__','__VERSION__',encode(extensions.digest(source,'sha256'),'hex'),
        1,'external_process','2026-10-01','2026-10-07','__COMMAND__');
    UPDATE public.land_use_plan_review_releases SET status='closed',outcome_snapshot='{}',closed_at=now(),closed_by='__ACTOR__' WHERE id='__ACTION__';
    INSERT INTO public.land_use_plan_decisions(workspace_id,plan_id,version_id,version_content_hash,review_release_id,
      adoption_manifest,decision_kind,decision_body,instrument_type,instrument_identifier,decided_on,supporting_document_id,created_by)
      SELECT '__WORKSPACE__','__PLAN__','__VERSION__',r.version_content_hash,r.id,
        jsonb_build_object('planId','__PLAN__','versionId','__VERSION__','versionContentHash',r.version_content_hash,
          'reviewReleaseId',r.id,'reviewOutcomeHash',r.outcome_hash,'decision',jsonb_build_object('kind','adoption',
            'body','SYNTHETIC body','instrumentType','Resolution','instrumentIdentifier','TEST-1','vote',NULL,'decidedOn','2026-10-07','effectiveOn',NULL)),
        'adoption','SYNTHETIC body','Resolution','TEST-1','2026-10-07','__COMMAND__','__ACTOR__'
      FROM public.land_use_plan_review_releases r WHERE r.id='__ACTION__';
    UPDATE public.land_use_plan_versions SET state='adopted' WHERE id='__VERSION__';
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
  -- Release this exercise's plan/version locks before the independent
  -- publication exercise uses a real peer decision insert on the same seed.
  RAISE EXCEPTION USING ERRCODE='PT498',MESSAGE='Restore implementation report lock exercise';
EXCEPTION WHEN SQLSTATE 'PT498' THEN NULL;
END $test$;

DO $publication_locks$
DECLARE
  source text:='{"designations":[],"implementationActions":[],"nodes":[],"plan":{"authorityLabel":"SYNTHETIC authority","descriptorId":"local-unconfigured","geographyLabel":"SYNTHETIC area","id":"__PLAN__","planKindKey":"community","title":"SYNTHETIC plan"},"relationships":[],"version":{"id":"__VERSION__","versionNumber":1}}';
  statement text; competitor text; receipt jsonb; saved_artifact jsonb;
BEGIN
  statement:=format('SELECT public.publish_land_use_plan_version(%L,%L,%L,%L,%L,%L,%L)',
    '__WORKSPACE__','__PLAN__','__ACTOR__','__VERSION__',encode(extensions.digest(source,'sha256'),'hex'),'SYNTHETIC publication',source);
  competitor:=$insert$
    INSERT INTO public.land_use_plan_decisions(workspace_id,plan_id,version_id,version_content_hash,review_release_id,
      adoption_manifest,decision_kind,decision_body,instrument_type,instrument_identifier,decided_on,supporting_document_id,created_by)
      SELECT workspace_id,plan_id,version_id,version_content_hash,review_release_id,
        jsonb_set(jsonb_set(adoption_manifest,'{decision,kind}','"repeal"'),'{decision,decidedOn}','"2026-10-08"'),
        'repeal',decision_body,instrument_type,instrument_identifier,'2026-10-08',supporting_document_id,created_by
      FROM public.land_use_plan_decisions WHERE version_id='__VERSION__';
  $insert$;
  PERFORM extensions.dblink_exec('report_peer','BEGIN ISOLATION LEVEL REPEATABLE READ');
  PERFORM extensions.dblink_exec('report_peer','DO $peer$ BEGIN BEGIN PERFORM public.publish_land_use_plan_version('||
    quote_literal('__WORKSPACE__')||','||quote_literal('__PLAN__')||','||quote_literal('__ACTOR__')||','||quote_literal('__VERSION__')||','||
    quote_literal(encode(extensions.digest(source,'sha256'),'hex'))||','||quote_literal('SYNTHETIC publication')||','||quote_literal(source)||
    '); RAISE EXCEPTION ''Stale transaction isolation accepted''; EXCEPTION WHEN SQLSTATE ''PT409'' THEN IF SQLERRM<>''Publication requires a fresh read-committed source'' THEN RAISE; END IF; END; END $peer$;');
  PERFORM extensions.dblink_exec('report_peer','ROLLBACK');
  -- A real uncommitted decision insert precedes publication.
  PERFORM extensions.dblink_exec('report_peer','BEGIN');
  PERFORM extensions.dblink_exec('report_peer',competitor);
  IF jsonb_array_length(public.land_use_plan_publication_source_v1('__PLAN__')->'decisions') IS NOT NULL THEN
    RAISE EXCEPTION 'An unpublished version unexpectedly has a public source';
  END IF;
  BEGIN
    SET LOCAL ROLE service_role;
    EXECUTE statement;
    RAISE EXCEPTION 'Publication accepted an uncommitted decision mutation';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN
    IF SQLERRM<>'The plan is being changed. Retry this version to confirm its publication' THEN RAISE; END IF;
  END;
  SET LOCAL ROLE supabase_admin;
  PERFORM extensions.dblink_exec('report_peer','ROLLBACK');
  SET LOCAL ROLE service_role;
  EXECUTE statement INTO receipt;
  SELECT to_jsonb(a) INTO saved_artifact FROM public.report_artifacts a WHERE id=(receipt->>'artifactId')::uuid;
  SET LOCAL ROLE supabase_admin;
  -- Publication goes first. A peer insert must hit the actual decision lock,
  -- before a trigger or a foreign-key lock could supply an unrelated refusal.
  PERFORM extensions.dblink_exec('report_peer','DO $peer$ BEGIN BEGIN LOCK TABLE public.land_use_plan_decisions IN ROW EXCLUSIVE MODE NOWAIT; RAISE EXCEPTION ''Decision relation lock escaped publication''; EXCEPTION WHEN lock_not_available THEN NULL; END; END $peer$;');
  PERFORM extensions.dblink_exec('report_peer','SET lock_timeout=''500ms''');
  PERFORM extensions.dblink_exec('report_peer','DO $peer$ BEGIN BEGIN '||competitor||
    ' RAISE EXCEPTION ''Decision insert escaped publication lock''; EXCEPTION WHEN lock_not_available THEN NULL; END; END $peer$;');
  IF (SELECT to_jsonb(a) IS DISTINCT FROM saved_artifact FROM public.report_artifacts a WHERE id=(receipt->>'artifactId')::uuid) THEN
    RAISE EXCEPTION 'Concurrent mutation changed historical publication bytes';
  END IF;
  IF jsonb_array_length(public.land_use_plan_publication_source_v1('__PLAN__')->'decisions')<>1 THEN
    RAISE EXCEPTION 'Publication lost its single decision snapshot';
  END IF;
END $publication_locks$;
SELECT 'publication decision locks verified';
SELECT extensions.dblink_disconnect('report_peer');
SELECT 'implementation report locks verified';
