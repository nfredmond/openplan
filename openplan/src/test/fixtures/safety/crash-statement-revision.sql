-- Synthetic SQL boundary fixture for the crash and person fences, not observed crash data.
-- Each case rolls back, except the lock case, which commits it and deletes it after.
INSERT INTO auth.users(id,email) VALUES
  ('__ACTOR__','__ACTOR__@example.test'),
  ('__OTHER__','__OTHER__@example.test');
CREATE FUNCTION pg_temp.ws(u uuid) RETURNS uuid LANGUAGE sql AS $f$
  SELECT workspace_id FROM public.workspace_members WHERE user_id=u AND role='owner' LIMIT 1;
$f$;
SELECT set_config('request.jwt.claim.sub','__ACTOR__',true);
INSERT INTO public.projects(id,workspace_id,name,created_by) VALUES
  ('__PROJECT__',pg_temp.ws('__ACTOR__'),'SYNTHETIC crash fence project','__ACTOR__'),
  ('__OTHER_PROJECT__',pg_temp.ws('__ACTOR__'),'SYNTHETIC second crash fence project','__ACTOR__');
INSERT INTO public.safety_crash_ingests(id,workspace_id,project_id,min_lon,min_lat,max_lon,max_lat,
  source_id,source_label,attribution,coverage_state,status)
  SELECT id,pg_temp.ws('__ACTOR__'),project,0,0,1,1,'ccrs-ca','Synthetic SQL fixture',
    'Not observed crash data','source_unavailable','ready'
  FROM (VALUES ('__INGEST__'::uuid,'__PROJECT__'::uuid),('__CAPTURED__','__PROJECT__'),
    ('__ELSEWHERE__','__OTHER_PROJECT__')) v(id,project);

CREATE FUNCTION pg_temp.assert_crash(ok boolean, reason text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%',reason; END IF; END;
$f$;
CREATE FUNCTION pg_temp.revision(a uuid) RETURNS bigint LANGUAGE sql AS $f$
  SELECT evidence_revision FROM public.safety_crash_ingests WHERE id=a;
$f$;
CREATE FUNCTION pg_temp.project_at(p uuid) RETURNS timestamptz LANGUAGE sql AS $f$
  SELECT updated_at FROM public.projects WHERE id=p;
$f$;
CREATE FUNCTION pg_temp.crashes(a uuid) RETURNS bigint LANGUAGE sql AS $f$
  SELECT count(*) FROM public.safety_crashes WHERE ingest_id=a;
$f$;
CREATE FUNCTION pg_temp.persons(a uuid) RETURNS bigint LANGUAGE sql AS $f$
  SELECT count(*) FROM public.safety_crash_parties WHERE ingest_id=a;
$f$;
-- One VALUES row for a crash; a test builds a statement from several.
CREATE FUNCTION pg_temp.crash_row(ws uuid, a uuid, source text, external text) RETURNS text LANGUAGE sql AS $f$
  SELECT format('(%L::uuid,%L::uuid,%L,%L,''injury'',0.5,0.5)',ws,a,source,external);
$f$;
CREATE FUNCTION pg_temp.insert_crashes(rows_sql text) RETURNS text LANGUAGE sql AS $f$
  SELECT 'INSERT INTO public.safety_crashes(workspace_id,ingest_id,source_id,external_id,severity,latitude,longitude) VALUES '||rows_sql;
$f$;
-- Runs one statement and requires the fence refusal, by SQLSTATE and exact message.
CREATE FUNCTION pg_temp.refused(statement text, reason text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE state text; message text;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS state=RETURNED_SQLSTATE, message=MESSAGE_TEXT; END;
  PERFORM pg_temp.assert_crash(state='23514' AND message=reason,
    format('Expected 23514 "%s" from: %s. Got %s %s',reason,statement,coalesce(state,'success'),coalesce(message,'')));
END;
$f$;
-- Marks an acquisition as captured by a comparison revision, as save_safety_comparison would.
CREATE FUNCTION pg_temp.capture(a uuid) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO public.reports(id,workspace_id,project_id,title,report_type,created_by)
    VALUES('__REPORT__',pg_temp.ws('__ACTOR__'),'__PROJECT__','SYNTHETIC crash fence report','project_status','__ACTOR__');
  INSERT INTO public.report_safety_comparison_revisions(workspace_id,project_id,report_id,acquisition_id,payload,content_text,created_by)
    SELECT pg_temp.ws('__ACTOR__'),'__PROJECT__','__REPORT__',a,v,v::text,'__ACTOR__'
    FROM (SELECT '{"version":"openplan.safety-comparison.v2","effect":"unassessed","programBasis":"missing_exact_fy_nofo"}'::jsonb v) q;
$f$;
