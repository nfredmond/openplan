-- Synthetic persistence shapes only. No model runs, custody receipts or scientific proof.
-- The live suite owns every UUID and wraps this entire fixture in BEGIN/ROLLBACK.
INSERT INTO auth.users(id,email) VALUES
  ('__MEMBER__','__MEMBER__@example.invalid'),('__OWNER__','__OWNER__@example.invalid'),
  ('__VIEWER__','__VIEWER__@example.invalid'),('__OUTSIDER__','__OUTSIDER__@example.invalid');
INSERT INTO public.workspaces(id,name,slug)
  VALUES('__WORKSPACE__','SYNTHETIC Reports retention','__WORKSPACE__');
INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES
  ('__WORKSPACE__','__OWNER__','owner'),('__WORKSPACE__','__MEMBER__','member'),
  ('__WORKSPACE__','__VIEWER__','viewer');
SELECT set_config('request.jwt.claim.sub','__MEMBER__',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claims','{"sub":"__MEMBER__","role":"authenticated"}',true);
INSERT INTO public.projects(id,workspace_id,name,created_by)
  VALUES('__PROJECT__','__WORKSPACE__','SYNTHETIC Reports SQL boundary','__MEMBER__');
-- A future synthetic revision makes OLD plus one microsecond deterministic,
-- rather than depending on how quickly this machine executes two statements.
INSERT INTO public.reports(id,workspace_id,project_id,title,report_type,created_by,updated_at) VALUES
  ('__REPORT__','__WORKSPACE__','__PROJECT__','SYNTHETIC selected report','analysis_summary','__MEMBER__',clock_timestamp()+interval '1 day'),
  ('__OTHER_REPORT__','__WORKSPACE__','__PROJECT__','SYNTHETIC ordinary report','project_status','__MEMBER__',now());

CREATE FUNCTION pg_temp.report_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%',label; END IF; END $$;
-- Check both state and guard message. Missing privileges or unrelated constraints
-- cannot stand in for reaching the intended trigger branch.
CREATE FUNCTION pg_temp.report_refuses(statement text,state text,message text,label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE=state AND position(message IN SQLERRM)>0 THEN RETURN; END IF;
    RAISE EXCEPTION '%: unexpected % %',label,SQLSTATE,SQLERRM;
  END;
  RAISE EXCEPTION '%: accepted',label;
END $$;
CREATE FUNCTION pg_temp.report_one(statement text,label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN EXECUTE statement; GET DIAGNOSTICS n=ROW_COUNT;
  PERFORM pg_temp.report_assert(n=1,label||': expected exactly one row');
END $$;
CREATE FUNCTION pg_temp.report_selection() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('version',1,'bindingSha256',repeat('a',64),'snapshotId','__SNAPSHOT__',
    'payload',jsonb_build_object('schema','openplan.guided-comparison-report.v1',
      'workspaceId','__WORKSPACE__','projectId','__PROJECT__','snapshotId','__SNAPSHOT__',
      'syntheticSqlFixture',true,'scientificStatus','inconclusive'));
$$;
CREATE FUNCTION pg_temp.report_metadata() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('guidedComparisonSelectionV1',pg_temp.report_selection(),
    'sourceContext',jsonb_build_object('guidedComparisonSelectionV1',pg_temp.report_selection()),
    'htmlContent','<p>SYNTHETIC SQL persistence shape. No model evidence.</p>',
    'generatedAt','2026-10-19T12:00:00Z','pdfEngine',NULL,'generationWriteback',NULL);
$$;
CREATE FUNCTION pg_temp.report_insert(meta jsonb,artifact uuid DEFAULT gen_random_uuid(),
  writer uuid DEFAULT '__MEMBER__',report uuid DEFAULT '__REPORT__',kind text DEFAULT 'html',
  path text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE result uuid;
BEGIN
  INSERT INTO public.report_artifacts(id,report_id,artifact_kind,storage_path,generated_by,generated_at,metadata_json)
    VALUES(artifact,report,kind,coalesce(path,'__WORKSPACE__/'||report::text||'/'||artifact::text||'.'||kind),
      writer,'2026-10-19T12:00:00Z',meta) RETURNING id INTO STRICT result;
  RETURN result;
END $$;
UPDATE public.reports SET metadata_json=jsonb_build_object('guidedComparisonSelectionV1',pg_temp.report_selection())
  WHERE id='__REPORT__';

-- No production grants, policies or triggers are changed to prepare or clean rows.
SELECT pg_temp.report_assert((SELECT relrowsecurity FROM pg_class WHERE oid='public.reports'::regclass),'Reports RLS required');
SELECT pg_temp.report_assert((SELECT relrowsecurity FROM pg_class WHERE oid='public.report_artifacts'::regclass),'Artifacts RLS required');
SELECT pg_temp.report_assert(NOT (SELECT prosecdef FROM pg_proc
  WHERE oid='public.guard_report_guided_comparison_artifact()'::regprocedure),'Guided guard must remain invoker');
SELECT pg_temp.report_assert(NOT has_function_privilege('authenticated',
  'public.guard_report_guided_comparison_artifact()','EXECUTE'),'Member has direct trigger EXECUTE');
SELECT pg_temp.report_assert(NOT has_function_privilege('authenticated',
  'public.read_guided_comparison_report_kpi_custody(uuid,uuid,uuid,uuid,uuid)','EXECUTE')
  AND has_function_privilege('service_role',
  'public.read_guided_comparison_report_kpi_custody(uuid,uuid,uuid,uuid,uuid)','EXECUTE'),'Custody RPC role grants');

SET LOCAL ROLE authenticated;
SELECT pg_temp.report_assert(current_user='authenticated' AND auth.uid()='__MEMBER__'::uuid,'Member role and JWT required');
SELECT pg_temp.report_assert((SELECT role='member' FROM public.workspace_members
  WHERE workspace_id='__WORKSPACE__' AND user_id=auth.uid()),'Writer must be ordinary member');
SELECT pg_temp.report_refuses('SELECT pg_temp.report_insert(pg_temp.report_metadata())','42501',
  'Guided artifacts require the authorized generation server','authenticated selected INSERT refused');
-- Legacy INSERT/UPDATE/DELETE must still reach real rows under this same role.
SELECT pg_temp.report_insert('{}','__LEGACY__');
SELECT pg_temp.report_one($q$UPDATE public.report_artifacts SET metadata_json='{"legacy":true}',storage_path=NULL
  WHERE id='__LEGACY__'$q$,'legacy member update');
SELECT pg_temp.report_refuses($q$UPDATE public.report_artifacts SET metadata_json=pg_temp.report_metadata()
  WHERE id='__LEGACY__'$q$,'23514','Guided artifact selections are immutable','legacy cannot acquire selection');
SELECT pg_temp.report_one($q$DELETE FROM public.report_artifacts WHERE id='__LEGACY__'$q$,'legacy member DELETE');
RESET ROLE;

-- A service request carries no member session. Attribution comes from generated_by.
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
SELECT pg_temp.report_assert(current_user='service_role' AND auth.uid() IS NULL,'Selected INSERT must use service role without member session');
SELECT pg_temp.report_refuses($q$SELECT pg_temp.report_insert(pg_temp.report_metadata(),gen_random_uuid(),'__VIEWER__')$q$,
  '42501','Guided artifact writer is unavailable','service viewer attribution refused');
SELECT pg_temp.report_refuses($q$SELECT pg_temp.report_insert(pg_temp.report_metadata(),gen_random_uuid(),'__OUTSIDER__')$q$,
  '42501','Guided artifact writer is unavailable','service outsider attribution refused');
SELECT pg_temp.report_refuses($q$SELECT pg_temp.report_insert(pg_temp.report_metadata(),gen_random_uuid(),NULL)$q$,
  '42501','Guided artifact writer is unavailable','service null attribution refused');
DO $$ DECLARE meta jsonb; BEGIN
  FOR meta IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
    pg_temp.report_metadata()-'guidedComparisonSelectionV1',
    jsonb_set(pg_temp.report_metadata(),'{guidedComparisonSelectionV1}','null'),
    jsonb_set(pg_temp.report_metadata(),'{guidedComparisonSelectionV1}','[]'),
    jsonb_set(pg_temp.report_metadata(),'{sourceContext,guidedComparisonSelectionV1}','false'),
    pg_temp.report_metadata()-'htmlContent',
    jsonb_set(pg_temp.report_metadata(),'{htmlContent}','null'),
    jsonb_set(pg_temp.report_metadata(),'{htmlContent}','7'),
    jsonb_set(pg_temp.report_metadata(),'{generationWriteback}','{}')
  )) LOOP
    PERFORM pg_temp.report_refuses(format('SELECT pg_temp.report_insert(%L)',meta),'23514',
      'Guided artifact does not match its retained selection and identity','selected INSERT shape refused');
  END LOOP;
END $$;
DO $$ DECLARE selection jsonb; meta jsonb; field text; BEGIN
  FOREACH field IN ARRAY ARRAY['workspaceId','projectId','snapshotId','schema'] LOOP
    selection:=jsonb_set(pg_temp.report_selection(),ARRAY['payload',field],'null');
    meta:=jsonb_set(jsonb_set(pg_temp.report_metadata(),'{guidedComparisonSelectionV1}',selection),
      '{sourceContext,guidedComparisonSelectionV1}',selection);
    PERFORM pg_temp.report_refuses(format('SELECT pg_temp.report_insert(%L)',meta),'23514',
      'Guided artifact does not match its retained selection and identity','selected INSERT null scope refused: '||field);
  END LOOP;
  FOREACH field IN ARRAY ARRAY['version','bindingSha256'] LOOP
    selection:=jsonb_set(pg_temp.report_selection(),ARRAY[field],'false');
    meta:=jsonb_set(jsonb_set(pg_temp.report_metadata(),'{guidedComparisonSelectionV1}',selection),
      '{sourceContext,guidedComparisonSelectionV1}',selection);
    PERFORM pg_temp.report_refuses(format('SELECT pg_temp.report_insert(%L)',meta),'23514',
      'Guided artifact does not match its retained selection and identity','selected INSERT type refused: '||field);
  END LOOP;
END $$;
SELECT pg_temp.report_refuses($q$SELECT pg_temp.report_insert(pg_temp.report_metadata(),gen_random_uuid(),'__MEMBER__','__OTHER_REPORT__')$q$,
  '23514','Guided artifact does not match its retained selection and identity','selected report type refused');
SELECT pg_temp.report_refuses($q$SELECT pg_temp.report_insert(pg_temp.report_metadata(),gen_random_uuid(),'__MEMBER__','__REPORT__','html','wrong/path.html')$q$,
  '23514','Guided artifact does not match its retained selection and identity','selected path refused');
SELECT pg_temp.report_insert(pg_temp.report_metadata(),'__ARTIFACT__');
-- HTML uses explicit null before writeback; PDF also covers an absent receipt.
SELECT pg_temp.report_insert(jsonb_set(pg_temp.report_metadata()-'generationWriteback','{pdfEngine}','"builtin"'),
  '__PDF_ARTIFACT__','__MEMBER__','__REPORT__','pdf');
SELECT pg_temp.report_assert((SELECT report_id='__REPORT__'::uuid AND artifact_kind='html'
  AND metadata_json=pg_temp.report_metadata() FROM public.report_artifacts WHERE id='__ARTIFACT__'),'Service selected INSERT persisted exact shape');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','__MEMBER__',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claims','{"sub":"__MEMBER__","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
-- Match finishReportGeneration's member CAS and same-artifact receipt UPDATE.
DO $$ DECLARE before_revision timestamptz; revision timestamptz; second_revision timestamptz;
  received uuid; bad jsonb; BEGIN
  SELECT updated_at INTO STRICT before_revision FROM public.reports WHERE id='__REPORT__';
  UPDATE public.reports SET status='generated',generated_at='2026-10-19T12:00:00Z',
    latest_artifact_kind='html',latest_artifact_url='/api/reports/__REPORT__/artifacts/__ARTIFACT__/download',
    updated_at='1900-01-01'
    WHERE id='__REPORT__' AND updated_at=before_revision RETURNING updated_at INTO STRICT revision;
  PERFORM pg_temp.report_assert(revision>before_revision,'Reports revision must advance');
  PERFORM pg_temp.report_assert(revision=before_revision+interval '1 microsecond','Reports future revision advances exactly one microsecond');
  -- A caller-supplied timestamp must not replace the database revision.
  PERFORM pg_temp.report_assert(revision<>'1900-01-01'::timestamptz,'Reports ignored caller timestamp');
  UPDATE public.reports SET summary='SYNTHETIC second update in same transaction'
    WHERE id='__REPORT__' AND updated_at=revision RETURNING updated_at INTO STRICT second_revision;
  PERFORM pg_temp.report_assert(second_revision=revision+interval '1 microsecond','Reports same-transaction microsecond revision');
  PERFORM pg_temp.report_one($q$UPDATE public.reports SET summary='SYNTHETIC ordinary report remains writable'
    WHERE id='__OTHER_REPORT__'$q$,'unselected report write');
  -- Zero rows on a stale CAS must remain observable to the route writer.
  UPDATE public.reports SET summary='STALE CAS MUST NOT WRITE' WHERE id='__REPORT__' AND updated_at=revision;
  PERFORM pg_temp.report_assert(NOT FOUND,'Stale Reports CAS matched a row');
  FOR bad IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
    jsonb_build_object('schema','openplan.report-generation-writeback.v1','reportUpdatedAt',revision),
    jsonb_build_object('schema','openplan.report-generation-writeback.v1'),
    jsonb_build_object('schema','wrong','reportUpdatedAt',second_revision),
    'false'::jsonb)) LOOP
    PERFORM pg_temp.report_refuses(format('UPDATE public.report_artifacts SET metadata_json=jsonb_set(metadata_json,''{generationWriteback}'',%L)
      WHERE id=''__ARTIFACT__'' AND report_id=''__REPORT__''',bad),'40001',
      'Guided generation receipt does not match report writeback','wrong first receipt refused');
  END LOOP;
  UPDATE public.report_artifacts SET metadata_json=jsonb_set(metadata_json,'{generationWriteback}',
    jsonb_build_object('schema','openplan.report-generation-writeback.v1','reportUpdatedAt',second_revision))
    WHERE id='__ARTIFACT__' AND report_id='__OTHER_REPORT__';
  PERFORM pg_temp.report_assert(NOT FOUND,'Wrong report filter matched artifact receipt');
  UPDATE public.report_artifacts SET metadata_json=jsonb_set(metadata_json,'{generationWriteback}',
    jsonb_build_object('schema','openplan.report-generation-writeback.v1','reportUpdatedAt',second_revision))
    WHERE id='__ARTIFACT__' AND report_id='__REPORT__' RETURNING id INTO STRICT received;
  PERFORM pg_temp.report_assert(received='__ARTIFACT__'::uuid AND (SELECT
    (metadata_json->'generationWriteback'->>'reportUpdatedAt')::timestamptz=second_revision
    FROM public.report_artifacts WHERE id=received),'Member first exact receipt persisted');
  UPDATE public.report_artifacts SET metadata_json=jsonb_set(metadata_json,'{generationWriteback}',
    jsonb_build_object('schema','openplan.report-generation-writeback.v1','reportUpdatedAt',second_revision))
    WHERE id='__PDF_ARTIFACT__' AND report_id='__REPORT__' RETURNING id INTO STRICT received;
  PERFORM pg_temp.report_assert((SELECT artifact_kind='pdf' AND
    (metadata_json->'generationWriteback'->>'reportUpdatedAt')::timestamptz=second_revision
    FROM public.report_artifacts WHERE id=received),'Member first exact PDF receipt from absent value');
END $$;
-- A valid unrelated metadata update is a positive control for every refusal.
SELECT pg_temp.report_one($q$UPDATE public.report_artifacts SET metadata_json=metadata_json||'{"fixtureNote":"allowed"}'::jsonb
  WHERE id='__ARTIFACT__'$q$,'selected unrelated metadata update');
DO $$ DECLARE expression text; BEGIN
  FOREACH expression IN ARRAY ARRAY[
    'metadata_json-''generationWriteback''',
    'jsonb_set(metadata_json,''{generationWriteback}'',''null'')',
    'jsonb_set(metadata_json,''{generationWriteback,reportUpdatedAt}'',''"1900-01-01T00:00:00Z"'')'
  ] LOOP
    PERFORM pg_temp.report_refuses('UPDATE public.report_artifacts SET metadata_json='||expression||' WHERE id=''__ARTIFACT__''',
      '23514','Guided generation receipt is immutable','recorded receipt mutation/removal refused');
  END LOOP;
  FOREACH expression IN ARRAY ARRAY[
    'metadata_json-''guidedComparisonSelectionV1''',
    'metadata_json#-''{sourceContext,guidedComparisonSelectionV1}''',
    'jsonb_set(metadata_json,''{guidedComparisonSelectionV1}'',''{}'')',
    'jsonb_set(metadata_json,''{sourceContext,guidedComparisonSelectionV1}'',''{}'')',
    '(metadata_json-''guidedComparisonSelectionV1'')#-''{sourceContext,guidedComparisonSelectionV1}''',
    'jsonb_set(jsonb_set(metadata_json,''{guidedComparisonSelectionV1,bindingSha256}'',to_jsonb(repeat(''b'',64))),''{sourceContext,guidedComparisonSelectionV1,bindingSha256}'',to_jsonb(repeat(''b'',64)))'
  ] LOOP
    PERFORM pg_temp.report_refuses('UPDATE public.report_artifacts SET metadata_json='||expression||' WHERE id=''__ARTIFACT__''',
      '23514','Guided artifact selections are immutable','selection copy replacement/removal refused');
  END LOOP;
  FOREACH expression IN ARRAY ARRAY[
    'jsonb_set(metadata_json,''{htmlContent}'',''"changed"'')',
    'jsonb_set(metadata_json,''{generatedAt}'',''null'')',
    'jsonb_set(metadata_json,''{pdfEngine}'',''"builtin"'')'
  ] LOOP
    PERFORM pg_temp.report_refuses('UPDATE public.report_artifacts SET metadata_json='||expression||' WHERE id=''__ARTIFACT__''',
      '23514','Guided artifact identity and rendered evidence are immutable','rendered metadata change refused');
  END LOOP;
  FOREACH expression IN ARRAY ARRAY[
    'id=gen_random_uuid()', 'report_id=''__OTHER_REPORT__''', 'created_at=created_at+interval ''1 second''',
    'generated_at=generated_at+interval ''1 second''', 'generated_by=''__OWNER__''',
    'artifact_kind=''pdf''', 'storage_path=''changed.pdf'''
  ] LOOP
    PERFORM pg_temp.report_refuses('UPDATE public.report_artifacts SET '||expression||' WHERE id=''__ARTIFACT__''',
      '23514','Guided artifact identity and rendered evidence are immutable','selected identity change refused');
  END LOOP;
END $$;
SELECT pg_temp.report_refuses($q$DELETE FROM public.report_artifacts WHERE id='__ARTIFACT__'$q$,
  '23514','Retained guided artifacts cannot be deleted or replaced','selected DELETE refused');
SELECT pg_temp.report_refuses($q$DELETE FROM public.reports WHERE id='__REPORT__'$q$,
  '23514','Retained guided artifacts cannot be deleted or replaced','selected report cascade refused');
RESET ROLE;
-- Use the table owner for parent cascades, so missing parent DELETE permission
-- cannot masquerade as the retained artifact guard. Every case rolls back.
SELECT pg_temp.report_refuses($q$DELETE FROM public.projects WHERE id='__PROJECT__'$q$,
  '23514','Retained guided artifacts cannot be deleted or replaced','selected project cascade refused');
SELECT pg_temp.report_refuses($q$DELETE FROM public.workspaces WHERE id='__WORKSPACE__'$q$,
  '23514','Retained guided artifacts cannot be deleted or replaced','selected workspace cascade refused');
SELECT pg_temp.report_assert((SELECT count(*)=1 FROM public.report_artifacts WHERE id='__ARTIFACT__'),
  'Selected history survives all refusals');
SET LOCAL ROLE authenticated;
SELECT pg_temp.report_insert('{}','__LEGACY__','__MEMBER__','__OTHER_REPORT__');
SELECT pg_temp.report_one($q$DELETE FROM public.reports WHERE id='__OTHER_REPORT__'$q$,'legacy report cascade');
SELECT pg_temp.report_assert(NOT EXISTS(SELECT FROM public.report_artifacts WHERE id='__LEGACY__'),'Legacy cascade removed artifact');
RESET ROLE;
SELECT 'GUIDED_REPORT_NATIVE_ASSERTIONS_REACHED';
