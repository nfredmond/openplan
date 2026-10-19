-- Synthetic SQL boundary fixture, not a typed report-builder or browser fixture.
-- The caller wraps every case in BEGIN/ROLLBACK, including all injected faults.
INSERT INTO auth.users(id,email) VALUES
  ('__ACTOR__','__ACTOR__@example.test'),
  ('__VIEWER__','__VIEWER__@example.test'),
  ('__OUTSIDER__','__OUTSIDER__@example.test');
CREATE FUNCTION pg_temp.safety_workspace() RETURNS uuid LANGUAGE sql AS $f$
  SELECT workspace_id FROM public.workspace_members
    WHERE user_id='__ACTOR__' AND role='owner' LIMIT 1;
$f$;
INSERT INTO public.workspace_members(workspace_id,user_id,role)
  VALUES(pg_temp.safety_workspace(),'__VIEWER__','viewer');
SELECT set_config('request.jwt.claim.sub','__ACTOR__',true);
INSERT INTO public.projects(id,workspace_id,name,created_by)
  VALUES('__PROJECT__',pg_temp.safety_workspace(),'SYNTHETIC Safety transaction fixture','__ACTOR__');
INSERT INTO public.reports(id,workspace_id,project_id,title,report_type,created_by)
  VALUES('__REPORT__',pg_temp.safety_workspace(),'__PROJECT__','SYNTHETIC Safety report','project_status','__ACTOR__');
INSERT INTO public.safety_crash_ingests(id,workspace_id,project_id,min_lon,min_lat,max_lon,max_lat,
  source_id,source_label,attribution,coverage_state,status)
  VALUES('__INGEST__',pg_temp.safety_workspace(),'__PROJECT__',0,0,1,1,
    'synthetic-sql-fixture','Synthetic SQL fixture','Not observed crash data','source_unavailable','ready');
INSERT INTO public.funding_opportunities(id,workspace_id,project_id,title,pursuit_kind,created_by)
  VALUES('__OPPORTUNITY__',pg_temp.safety_workspace(),'__PROJECT__','SYNTHETIC SS4A SQL fixture','grant','__ACTOR__');
INSERT INTO public.funding_opportunity_application_sections(workspace_id,opportunity_id,section_key,title,source)
  SELECT pg_temp.safety_workspace(),'__OPPORTUNITY__',key,key,'catalog'
  FROM unnest(ARRAY['project-overview','safety-problem-and-impact','equity-and-underserved-communities',
    'engagement-and-collaboration','implementation-and-capacity','budget-narrative']) key;
INSERT INTO public.funding_opportunity_section_drafts(id,workspace_id,opportunity_id,section_id,draft_markdown,created_by)
  SELECT '__OLD_DRAFT__',pg_temp.safety_workspace(),'__OPPORTUNITY__',id,'Retain this prior draft.','__ACTOR__'
  FROM public.funding_opportunity_application_sections
  WHERE opportunity_id='__OPPORTUNITY__' AND section_key='project-overview';

CREATE FUNCTION pg_temp.assert_safety(ok boolean, reason text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%',reason; END IF; END;
$f$;
CREATE TEMP TABLE safety_input AS
SELECT jsonb_build_object('id','__ARTIFACT__','report_id',r.id,'artifact_kind','html',
  'storage_path',NULL,'generated_by','__ACTOR__','generated_at','2026-10-18T12:00:00Z',
  'metadata_json',jsonb_build_object('htmlContent','<p>Synthetic SQL boundary fixture</p>',
    'generationWriteback',NULL,'safetyPlanSnapshotV1',jsonb_build_object(
      'version','openplan.safety-plan-snapshot.v1','hash',repeat('a',64),
      'artifactId','__ARTIFACT__','reportId',r.id,'workspaceId',r.workspace_id,'projectId',p.id,
      'generatedAt','2026-10-18T12:00:00Z','projectUpdatedAt',p.updated_at,'reportUpdatedAt',r.updated_at))) artifact,
  jsonb_build_object('status','generated','generated_at','2026-10-18T12:00:00Z',
    'latest_artifact_kind','html','latest_artifact_url','/synthetic-sql-fixture',
    'metadata_json','{}'::jsonb,'rtp_basis_stale',false,'rtp_basis_stale_reason',NULL,
    'rtp_basis_stale_run_id',NULL,'rtp_basis_stale_marked_at',NULL) report_update,
  p.updated_at project_before,r.updated_at report_before
FROM public.projects p JOIN public.reports r ON r.project_id=p.id
WHERE p.id='__PROJECT__' AND r.id='__REPORT__';
GRANT SELECT ON safety_input TO service_role;
CREATE FUNCTION pg_temp.persist_safety() RETURNS jsonb LANGUAGE sql AS $f$
  SELECT public.persist_safety_plan_generation('__ACTOR__',artifact,report_update) FROM safety_input;
$f$;
CREATE FUNCTION pg_temp.safety_rows() RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_object('opportunity',to_jsonb(o),'project',to_jsonb(p),'report',to_jsonb(r),
    'artifact',to_jsonb(a),'persistence',to_jsonb(c),'acquisition',to_jsonb(i),
    'sections',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.funding_opportunity_application_sections s
      WHERE s.opportunity_id=o.id),
    'drafts',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'section_id',d.section_id) ORDER BY d.id),'[]'::jsonb)
      FROM public.funding_opportunity_section_drafts d WHERE d.opportunity_id=o.id))
  FROM public.funding_opportunities o JOIN public.projects p ON p.id=o.project_id
  JOIN public.reports r ON r.id='__REPORT__' JOIN public.report_artifacts a ON a.id='__ARTIFACT__'
  JOIN public.report_safety_snapshot_persistence c ON c.artifact_id=a.id
  JOIN public.safety_crash_ingests i ON i.id='__INGEST__'
  WHERE o.id='__OPPORTUNITY__';
$f$;
CREATE FUNCTION pg_temp.safety_sections() RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_agg(jsonb_build_object('section_id',id,'section_key',section_key,
    'draft_markdown','Synthetic working draft, not submission-ready.',
    'provenance',jsonb_build_object('synthetic_sql_fixture',true)) ORDER BY id)
  FROM public.funding_opportunity_application_sections WHERE opportunity_id='__OPPORTUNITY__';
$f$;
