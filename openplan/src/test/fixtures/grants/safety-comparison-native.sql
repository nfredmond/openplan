-- AUTHORED, UNEXECUTED. Extends the existing isolated SS4A SQL fixture only.
-- Synthetic zero stored observations is not evidence of complete zero crashes.
CREATE FUNCTION pg_temp.comparison_command(request uuid DEFAULT gen_random_uuid()) RETURNS jsonb LANGUAGE sql AS $f$
 SELECT jsonb_build_object('operation','save','requestId',request,'expectedReportRevision',r.updated_at,
 'expectedProjectRevision',p.updated_at,'expectedAcquisitionRevision',a.evidence_revision::text,
 'expectedComparison',CASE WHEN r.metadata_json->'safetyComparisonV2' IS NULL THEN 'null'::jsonb ELSE (r.metadata_json->'safetyComparisonV2')-'version' END,
 'inputs',jsonb_build_object('title','Synthetic input review','acquisitionId',a.id,'siteLabel','Synthetic neutral geometry',
 'siteIdentity',jsonb_build_object('state','unknown','reason','No site source'),
 'analysisGeometry','{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,1],[0,0]]]}'::jsonb,
 'influenceArea','{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,1],[0,0]]]}'::jsonb,
 'influenceRationale','Synthetic bounds, no real geography','selectedYears','[2020]'::jsonb,'severities','["fatal"]'::jsonb,
 'involvement','all','siteFacts','[]'::jsonb,'findings','Effects remain unassessed',
 'alternatives',(SELECT jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'kind',kind,'name',kind,
  'scope','Synthetic scope','operatingAssumptions','No forecast','treatmentDescription','No numerical CMF',
  'proposedTimeRange',jsonb_build_object('state','unknown','reason','No time range'),'applicability','unknown',
  'applicabilityRationale','No match','conditions','[]'::jsonb,'cost',jsonb_build_object('kind','missing','reason','No estimate'),
  'effect','unassessed','effectReason','No complete primary record')) FROM unnest(ARRAY['no_build','treatment']) kind)))
 FROM public.reports r JOIN public.projects p ON p.id=r.project_id JOIN public.safety_crash_ingests a ON a.project_id=p.id
 WHERE r.id='__REPORT__' AND a.id='__INGEST__';
$f$;


-- Bind identity to the created project, independently of the actor's role.
CREATE OR REPLACE FUNCTION pg_temp.safety_workspace() RETURNS uuid LANGUAGE sql AS $f$
 SELECT workspace_id FROM public.projects WHERE id='__PROJECT__';
$f$;
CREATE FUNCTION pg_temp.comparison_actor_role(requested_role text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE workspace uuid:=pg_temp.safety_workspace(); custodian uuid:=gen_random_uuid();
BEGIN
 IF requested_role NOT IN('owner','admin','member') THEN RAISE EXCEPTION 'Unsupported synthetic writer'; END IF;
 IF requested_role<>'owner' THEN
  INSERT INTO auth.users(id,email) VALUES(custodian,custodian::text||'@example.test');
  INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(workspace,custodian,'owner');
 END IF;
 UPDATE public.workspace_members SET role=requested_role WHERE workspace_id=workspace AND user_id='__ACTOR__';
 IF NOT FOUND THEN RAISE EXCEPTION 'Synthetic writer missing'; END IF;
END;
$f$;

-- R11 proposal only. Each new case owns one random document placeholder.
-- Parent rows satisfy the real export guards; no trigger, FK or policy is disabled.
CREATE FUNCTION pg_temp.comparison_estimate_source(source_state text DEFAULT 'stored', association text DEFAULT 'exact')
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE w uuid:=pg_temp.safety_workspace(); other_project uuid; other_workspace uuid;
BEGIN
 IF association='wrong_project' THEN
  INSERT INTO public.projects(workspace_id,name) VALUES(w,'SYNTHETIC other estimate project') RETURNING id INTO other_project;
 ELSIF association='wrong_workspace' THEN
  SELECT workspace_id INTO STRICT other_workspace FROM public.workspace_members WHERE user_id='__OUTSIDER__' AND role='owner';
 END IF;
 INSERT INTO public.kb_documents(id,workspace_id,project_id,uploaded_by,title,source_kind,original_filename,content_type,
   storage_ref,checksum,status,updated_at)
 VALUES('__DOCUMENT__',coalesce(other_workspace,w),CASE association WHEN 'unassociated' THEN NULL WHEN 'wrong_project' THEN other_project ELSE '__PROJECT__'::uuid END,
   '__ACTOR__','SYNTHETIC retained estimate.xlsx','uploaded_spreadsheet','estimate.xlsx',
   'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
   'storage://kb-documents/'||coalesce(other_workspace,w)||'/__DOCUMENT__/estimate.xlsx',repeat('e',64),source_state,'2026-10-18T12:00:00.123456Z');
 UPDATE public.projects SET estimated_cost_amount=999999999999999.99,estimated_cost_currency='USD',estimated_cost_basis_year=NULL,
   estimated_cost_source_document_id='__DOCUMENT__',estimated_cost_recorded_by='__ACTOR__',estimated_cost_recorded_at='2026-10-18T11:00:00.123456Z'
 WHERE id='__PROJECT__';
END;
$f$;

CREATE FUNCTION pg_temp.comparison_restrict_source(family text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE w uuid:=pg_temp.safety_workspace(); parent_id uuid:=gen_random_uuid(); program_id uuid:=gen_random_uuid();
 period_id uuid:=gen_random_uuid(); client_id uuid:=gen_random_uuid(); engagement_id uuid:=gen_random_uuid();
BEGIN
 IF family='management' THEN
  INSERT INTO public.programs(id,workspace_id,title,program_type,cycle_name) VALUES(program_id,w,'SYNTHETIC export parent','other','Synthetic');
  INSERT INTO public.work_program_reporting_periods(id,program_id,workspace_id,name,starts_on,ends_on,source_cutoff,created_by)
   VALUES(period_id,program_id,w,'Synthetic period','2026-01-01','2026-12-31',now(),'__ACTOR__');
  INSERT INTO public.work_program_period_reports(id,period_id,program_id,workspace_id,version,snapshot,snapshot_hash,issued_by)
   VALUES(parent_id,period_id,program_id,w,1,'{}',repeat('a',64),'__ACTOR__');
  UPDATE public.kb_documents SET work_program_report_id=parent_id,work_program_report_format='xlsx' WHERE id='__DOCUMENT__';
 ELSIF family='contract' THEN
  INSERT INTO public.invoicing_clients(id,workspace_id,name) VALUES(client_id,w,'SYNTHETIC export client');
  INSERT INTO public.invoicing_engagements(id,workspace_id,client_id,project_id,title)
   VALUES(engagement_id,w,client_id,'__PROJECT__','SYNTHETIC export engagement');
  INSERT INTO public.contract_snapshots(id,engagement_id,workspace_id,title,snapshot,snapshot_hash,created_by)
   VALUES(parent_id,engagement_id,w,'SYNTHETIC finance export','{}',repeat('a',64),'__ACTOR__');
  UPDATE public.kb_documents SET contract_snapshot_id=parent_id,contract_snapshot_format='xlsx' WHERE id='__DOCUMENT__';
 ELSE RAISE EXCEPTION 'Unknown synthetic private family'; END IF;
END;
$f$;

CREATE FUNCTION pg_temp.comparison_cost_command() RETURNS jsonb LANGUAGE sql AS $f$
 SELECT jsonb_set(c,'{inputs,alternatives}',(SELECT jsonb_agg(CASE WHEN alt->>'kind'='treatment' THEN
  jsonb_set(alt,'{cost}','{"kind":"project_estimate","scopeRelationship":"context_only","scopeRationale":"Synthetic project estimate retained as context, no scope equivalence","estimatingBasis":{"state":"unknown","reason":"No estimate basis"},"includedElements":{"state":"unknown","reason":"No element inventory"}}'::jsonb)
  ELSE alt END ORDER BY ord) FROM jsonb_array_elements(c->'inputs'->'alternatives') WITH ORDINALITY q(alt,ord)))
 FROM (SELECT pg_temp.comparison_command() c) command;
$f$;

-- Keep this explicit projection equal to SAFETY_COMPARISON_RECORD_SELECT.
-- Whole-row to_jsonb(v) would add acquisition_id and fail the actual strict reader.
CREATE FUNCTION pg_temp.comparison_record() RETURNS jsonb LANGUAGE sql AS $f$
 SELECT jsonb_build_object('id',v.id,'workspace_id',v.workspace_id,'project_id',v.project_id,'report_id',v.report_id,
  'parent_revision_id',v.parent_revision_id,'created_by',v.created_by,'created_at',v.created_at,
  'content_hash',v.content_hash,'content_text',v.content_text,'payload',v.payload)
 FROM public.report_safety_comparison_revisions v JOIN public.reports r ON r.metadata_json->'safetyComparisonV2'->>'revisionId'=v.id::text
 WHERE r.id='__REPORT__';
$f$;
CREATE FUNCTION pg_temp.comparison_generation_command() RETURNS jsonb LANGUAGE sql AS $f$
 SELECT jsonb_build_object('requestId',gen_random_uuid(),'revisionId',r.metadata_json->'safetyComparisonV2'->>'revisionId',
  'contentHash',r.metadata_json->'safetyComparisonV2'->>'hash','expectedReportRevision',r.updated_at,
  'expectedProjectRevision',p.updated_at,'format','html') FROM public.reports r JOIN public.projects p ON p.id=r.project_id WHERE r.id='__REPORT__';
$f$;

-- Fixture encoder for ASCII/integer synthetic values, checked independently by
-- the production snapshot reader after psql returns. Not a production hasher.
CREATE FUNCTION pg_temp.comparison_stable_json(v jsonb) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE result text;
BEGIN
 CASE jsonb_typeof(v)
 WHEN 'object' THEN SELECT '{'||coalesce(string_agg(to_jsonb(key)::text||':'||pg_temp.comparison_stable_json(value),',' ORDER BY key COLLATE "C"),'')||'}' INTO result FROM jsonb_each(v);
 WHEN 'array' THEN SELECT '['||coalesce(string_agg(pg_temp.comparison_stable_json(value),',' ORDER BY ord),'')||']' INTO result FROM jsonb_array_elements(v) WITH ORDINALITY q(value,ord);
 ELSE result:=v::text; END CASE;
 RETURN result;
END;
$f$;
CREATE FUNCTION pg_temp.comparison_artifact(c jsonb) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE row_value jsonb:=pg_temp.comparison_record(); s jsonb; generated text:='2026-10-19T12:00:00.123456Z';
BEGIN
 s:=jsonb_build_object('version','openplan.safety-plan-snapshot.v2','renderVersion','openplan.safety-input-review-render.v2',
  'artifactId',c->>'requestId','reportId','__REPORT__','workspaceId',row_value->>'workspace_id','projectId','__PROJECT__',
  'generatedAt',generated,'reportUpdatedAt',c->>'expectedReportRevision','projectUpdatedAt',c->>'expectedProjectRevision','comparison',row_value);
 s:=s||jsonb_build_object('hash',encode(extensions.digest(pg_temp.comparison_stable_json(s),'sha256'),'hex'));
 RETURN jsonb_build_object('id',c->>'requestId','report_id','__REPORT__','artifact_kind','html','generated_by','__ACTOR__','generated_at',generated,
  'storage_path',(row_value->>'workspace_id')||'/__REPORT__/'||(c->>'requestId')||'-'||repeat('b',64)||'.html',
  'metadata_json',jsonb_build_object('safetyPlanSnapshotV2',s,'sha256',repeat('b',64),'htmlContent','<p>Synthetic SQL metadata fixture, no stored object</p>'));
END;
$f$;
