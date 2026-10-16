"""Generate rollback-only SQL for root's explicitly allocated NEW private database.

This program has no database transport and never executes SQL. Root must review
and allocate the target, preserve before/after inventory, then execute via psql
with ON_ERROR_STOP. Every fixture, function and constraint change rolls back.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import uuid

REPO = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
OLD = REPO / 'openplan/supabase/migrations/20260905000001_portfolio_unknown_price_year.sql'
NEW = REPO / 'openplan/supabase/migrations/20261017000017_portfolio_skip_invalid_classifications.sql'


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def generate(database):
    if not re.fullmatch(r'openplan_portfolio_skip_[a-f0-9]{24}', database):
        raise ValueError('Root must allocate a NEW exclusive openplan_portfolio_skip_<24 hex> database')
    frozen = json.loads((HERE / 'frozen-rpc-input.json').read_text())
    old = OLD.read_text().split('CREATE OR REPLACE FUNCTION public.commit_project_portfolio_import_v2(', 1)[1]
    old = 'CREATE OR REPLACE FUNCTION public.commit_project_portfolio_import_v2(' + old
    candidate = NEW.read_text()
    function_only = candidate[candidate.index('CREATE OR REPLACE FUNCTION'):]
    old_body = old.split('AS $$', 1)[1].split('$$;', 1)[0]
    ids = {k: str(uuid.uuid4()) for k in ('workspace', 'foreign_workspace', 'actor', 'viewer', 'outsider', 'source', 'foreign_source', 'workbook')}
    data = {**frozen, **ids}
    data_literal = literal(json.dumps(data))
    baseline_body = literal(old_body)
    db_literal = literal(database)
    setup = r'''
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE postgres;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '3s';
SET LOCAL idle_in_transaction_session_timeout = '30s';
SET LOCAL work_mem = '16MB';
SET LOCAL application_name = 'portfolio-skip-invalid-rollback-only';
DO $preflight$
BEGIN
  IF current_database() <> __DATABASE__ THEN RAISE EXCEPTION 'Wrong database'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 419
     OR (SELECT max(version) FROM supabase_migrations.schema_migrations) <> '20261017000016'
     OR EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261017000017')
  THEN RAISE EXCEPTION 'Expected untouched 419-migration target through 16'; END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.commit_project_portfolio_import_v2(uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb)'::regprocedure)
      IS DISTINCT FROM __OLD_BODY__ THEN RAISE EXCEPTION 'Original v2 body differs'; END IF;
END $preflight$;
CREATE TEMP TABLE portfolio_input (v jsonb NOT NULL);
DO $temp_access$
DECLARE temporary_schema text;
BEGIN
  SELECT nspname INTO STRICT temporary_schema
  FROM pg_catalog.pg_namespace
  WHERE oid = pg_catalog.pg_my_temp_schema();
  EXECUTE format(
    'GRANT USAGE ON SCHEMA %I TO service_role, authenticated, anon',
    temporary_schema
  );
END $temp_access$;
INSERT INTO portfolio_input VALUES (__INPUT__::jsonb);
GRANT SELECT ON portfolio_input TO service_role, authenticated, anon;
SELECT (SELECT count(*) FROM public.projects) projects,
  (SELECT count(*) FROM public.project_portfolio_import_batches) batches,
  (SELECT count(*) FROM public.project_portfolio_import_rows) rows,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.project_portfolio_import_rows'::regclass
    AND conname='project_portfolio_import_rows_resolved_status_check') status_constraint,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.project_portfolio_import_rows'::regclass
    AND conname='project_portfolio_import_rows_resolved_delivery_phase_check') phase_constraint
\gset portfolio_before_
DO $fixture$
DECLARE k text; d jsonb := (SELECT v FROM portfolio_input);
BEGIN
  FOREACH k IN ARRAY ARRAY['actor','viewer','outsider'] LOOP
    INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    VALUES ((d->>k)::uuid,'authenticated','authenticated',k||'-'||(d->>k)||'@portfolio-native.invalid','{}','{}',now(),now());
  END LOOP;
  FOREACH k IN ARRAY ARRAY['workspace','foreign_workspace'] LOOP
    INSERT INTO public.workspaces(id,name,slug) VALUES ((d->>k)::uuid,'Synthetic portfolio rollback fixture','portfolio-native-'||(d->>k));
  END LOOP;
  INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES
    ((d->>'workspace')::uuid,(d->>'actor')::uuid,'member'),
    ((d->>'workspace')::uuid,(d->>'viewer')::uuid,'viewer');
  FOREACH k IN ARRAY ARRAY['source','foreign_source','workbook'] LOOP
    INSERT INTO public.kb_documents(id,workspace_id,title,source_kind,original_filename,content_type,
        byte_size,checksum,status,extraction_source,storage_ref,uploaded_by)
    VALUES ((d->>k)::uuid,(d->>CASE WHEN k='foreign_source' THEN 'foreign_workspace' ELSE 'workspace' END)::uuid,
       'Synthetic portfolio rollback fixture','uploaded_spreadsheet',
       CASE WHEN k='workbook' THEN 'fixture.xlsx' ELSE 'fixture.csv' END,
       CASE WHEN k='workbook' THEN 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ELSE 'text/csv' END,
       256,CASE WHEN k='workbook' THEN repeat('f',64) ELSE d->>'sourceHash' END,
       CASE WHEN k='workbook' THEN 'stored' ELSE 'ready' END,
       CASE WHEN k='workbook' THEN 'none' ELSE 'spreadsheet_parse' END,
       'storage://kb-documents/'||(d->>'workspace')||'/'||(d->>k)||'/fixture', (d->>'actor')::uuid);
  END LOOP;
END $fixture$;
-- No Storage object is uploaded. This probe exercises SQL metadata custody only.
CREATE FUNCTION pg_temp.portfolio_call(p_rows jsonb DEFAULT NULL, p_actor uuid DEFAULT NULL,
  p_source uuid DEFAULT NULL, p_hash text DEFAULT NULL, p_preview text DEFAULT NULL,
  p_configs jsonb DEFAULT NULL, p_format text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $call$
 SELECT public.commit_project_portfolio_import_v2(
   (v->>'workspace')::uuid, COALESCE(p_actor,(v->>'actor')::uuid),
   COALESCE(p_source,(v->>'source')::uuid), NULL,
   COALESCE(p_hash,v->>'sourceHash'),COALESCE(p_format,'csv'),COALESCE(p_preview,v->>'previewHash'),
   COALESCE(p_configs,v->'configurations'),COALESCE(p_rows,v->'rows')) FROM pg_temp.portfolio_input;
$call$;
CREATE FUNCTION pg_temp.portfolio_counts() RETURNS jsonb LANGUAGE sql AS $counts$
 SELECT jsonb_build_array((SELECT count(*) FROM public.projects),
   (SELECT count(*) FROM public.project_portfolio_import_batches),
   (SELECT count(*) FROM public.project_portfolio_import_rows));
$counts$;
CREATE FUNCTION pg_temp.portfolio_expect_error(label text, command text, expected_code text,
  expected_message text, expected_constraint text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $error$
DECLARE before_counts jsonb := pg_temp.portfolio_counts(); actual_code text; actual_message text;
  actual_constraint text; actual_context text; caught boolean := false;
BEGIN
  BEGIN
    EXECUTE command;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_code=RETURNED_SQLSTATE,actual_message=MESSAGE_TEXT,
      actual_constraint=CONSTRAINT_NAME,actual_context=PG_EXCEPTION_CONTEXT;
    caught := true;
  END;
  IF NOT caught OR actual_code IS DISTINCT FROM expected_code
     OR (expected_message IS NOT NULL AND actual_message NOT LIKE '%'||expected_message||'%')
     OR (expected_constraint IS NOT NULL AND actual_constraint IS DISTINCT FROM expected_constraint)
  THEN RAISE EXCEPTION 'Unexpected result for %: code %, message %, constraint %', label,actual_code,actual_message,actual_constraint; END IF;
  IF pg_temp.portfolio_counts() IS DISTINCT FROM before_counts THEN RAISE EXCEPTION 'Partial transaction writes for %',label; END IF;
  RAISE NOTICE '%',jsonb_build_object('case',label,'sqlstate',actual_code,'message',actual_message,
    'constraint',actual_constraint,'context',actual_context,'countsUnchanged',true);
END $error$;
'''.replace('__DATABASE__', db_literal).replace('__OLD_BODY__', baseline_body).replace('__INPUT__', data_literal)
    parts = [setup, '-- Compare the exact original function, not a reimplementation.\n', old,
             "SELECT pg_temp.portfolio_expect_error('original-frozen-22023', 'SELECT pg_temp.portfolio_call()', '22023', 'Portfolio workbook row is malformed or does not match its worksheet setup');\n",
             r'''-- Diagnostic copy only: changing row 3 status alone must remove the original failure.
-- The original frozen packet and actual skipped value remain untouched.
SAVEPOINT original_status_control;
DO $status_control$
DECLARE result jsonb; d jsonb := (SELECT v FROM portfolio_input);
BEGIN
 result := pg_temp.portfolio_call(p_rows=>jsonb_set(d->'rows','{1,status}','"active"'));
 IF result->>'created' <> '1' OR result->>'invalid' <> '1'
 THEN RAISE EXCEPTION 'Original status-only diagnostic did not isolate the cause'; END IF;
 RAISE NOTICE '%',jsonb_build_object('case','original-status-only-diagnostic-success','result',result);
END $status_control$;
ROLLBACK TO SAVEPOINT original_status_control;
''',
             '-- Harmless source comment leaves original behavior unchanged.\n', old.replace('BEGIN\n  SELECT', 'BEGIN\n  -- harmless native comment control\n  SELECT', 1),
             "SELECT pg_temp.portfolio_expect_error('original-harmless-survivor', 'SELECT pg_temp.portfolio_call()', '22023', 'Portfolio workbook row is malformed or does not match its worksheet setup');\n",
             '-- Function-only fix exposes the independent audit constraint failure.\n', function_only,
             "SELECT pg_temp.portfolio_expect_error('function-only-audit-23514', 'SELECT pg_temp.portfolio_call()', '23514', NULL, 'project_portfolio_import_rows_resolved_status_check');\n",
             '-- Full additive candidate, still inside this rollback transaction.\n', candidate]
    parts.append(r'''
DO $success$
DECLARE result jsonb; d jsonb := (SELECT v FROM portfolio_input); p public.projects; a public.project_portfolio_import_rows;
BEGIN
  IF has_function_privilege('anon','public.commit_project_portfolio_import_v2(uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb)','EXECUTE')
    OR has_function_privilege('authenticated','public.commit_project_portfolio_import_v2(uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.commit_project_portfolio_import_v2(uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb)','EXECUTE')
  THEN RAISE EXCEPTION 'RPC privilege scope changed'; END IF;
  SET LOCAL ROLE service_role;
  result := pg_temp.portfolio_call();
  RESET ROLE;
  SET LOCAL ROLE postgres;
  IF result->>'created' <> '1' OR result->>'invalid' <> '1' OR result->>'skipped' <> '0'
     OR jsonb_array_length(result->'projectIds') <> 1 THEN RAISE EXCEPTION 'Incorrect batch counts: %', result; END IF;
  SELECT * INTO STRICT p FROM public.projects WHERE id=(result#>>'{projectIds,0}')::uuid;
  IF p.name IS DISTINCT FROM 'Synthetic UI import =1+1' OR p.estimated_cost_amount IS DISTINCT FROM 125000::numeric
    OR p.estimated_cost_currency IS DISTINCT FROM 'EUR' OR p.estimated_cost_basis_year IS NOT NULL
    OR p.estimated_cost_source_document_id IS DISTINCT FROM (d->>'source')::uuid
    OR p.estimated_cost_recorded_by IS DISTINCT FROM (d->>'actor')::uuid
    OR p.status IS DISTINCT FROM 'active' OR p.delivery_phase IS DISTINCT FROM 'programming'
  THEN RAISE EXCEPTION 'Created project or cost custody differs'; END IF;
  SELECT * INTO STRICT a FROM public.project_portfolio_import_rows
    WHERE batch_id=(result->>'batchId')::uuid AND source_row_number=3;
  IF a.resolved_status IS DISTINCT FROM 'invented-status' OR a.decision <> 'skip' OR a.outcome <> 'invalid'
    OR a.created_project_id IS NOT NULL OR a.errors_json IS DISTINCT FROM d#>'{rows,1,errors}'
    OR a.row_fingerprint IS DISTINCT FROM d#>>'{rows,1,fingerprint}'
    OR a.source_sha256 IS DISTINCT FROM d->>'sourceHash'
  THEN RAISE EXCEPTION 'Skipped raw audit custody differs'; END IF;
  IF (SELECT count(*) FROM public.project_portfolio_import_rows WHERE batch_id=(result->>'batchId')::uuid) <> 2
  THEN RAISE EXCEPTION 'Missing audit rows'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.project_portfolio_import_batches b WHERE b.id=(result->>'batchId')::uuid
      AND b.preview_sha256=d->>'previewHash' AND b.source_sha256=d->>'sourceHash'
      AND b.row_count=2 AND b.created_count=1 AND b.invalid_count=1)
  THEN RAISE EXCEPTION 'Batch provenance differs'; END IF;
  RAISE NOTICE '%',jsonb_build_object('case','full-candidate-frozen-success','result',result,'cost','125000 EUR','priceYear',NULL,'invalidStatusRetained',true);
END $success$;
-- Skipped source values remain literal, including unsupported phase and plan type.
DO $skip$
DECLARE result jsonb; d jsonb := (SELECT v FROM portfolio_input); rows jsonb; a public.project_portfolio_import_rows;
BEGIN
  rows := jsonb_build_array(d#>'{rows,1}' || jsonb_build_object('deliveryPhase','invented-phase','planType','  invalid source plan  '));
  result := pg_temp.portfolio_call(p_rows=>rows);
  SELECT * INTO STRICT a FROM public.project_portfolio_import_rows WHERE batch_id=(result->>'batchId')::uuid;
  IF result->>'created' <> '0' OR a.resolved_delivery_phase IS DISTINCT FROM 'invented-phase'
    OR a.resolved_plan_type IS DISTINCT FROM '  invalid source plan  ' OR a.resolved_status IS DISTINCT FROM 'invented-status'
  THEN RAISE EXCEPTION 'Skipped classifications normalized'; END IF;
  RAISE NOTICE '%',jsonb_build_object('case','raw-skipped-plan-and-phase','result',result,'retained',true);
END $skip$;
''')
    # Every fault compares all project, batch and audit row counts before/after.
    def fault(label, expression, code='22023', message=None, constraint=None):
        parts.append('SELECT pg_temp.portfolio_expect_error(' + ','.join([
            literal(label), literal('SELECT ' + expression), literal(code),
            'NULL' if message is None else literal(message), 'NULL' if constraint is None else literal(constraint)]) + ');\n')
    inp = '(SELECT v FROM pg_temp.portfolio_input)'
    rows = f"({inp}->'rows')"
    # Name confirmation bypasses an existing name match so late guards are reached.
    single = f"jsonb_build_array({inp}#>'{{rows,0}}'||jsonb_build_object('confirmNameMatch',true))"
    for field, value in [('status','invented-status'), ('deliveryPhase','invented-phase'), ('planType',''), ('planType','x'*81)]:
        fault('create-invalid-'+field+('-long' if len(value)>80 else ''),
              f"pg_temp.portfolio_call(p_rows=>jsonb_set({single},'{{0,{field}}}',to_jsonb({literal(value)}::text)))",
              message='Created project classification is invalid')
    fault('blocked-create', f"pg_temp.portfolio_call(p_rows=>jsonb_set({single},'{{0,canCreate}}','false'))", message='A blocked or unconfirmed row')
    formula = f"jsonb_set({single},'{{0,formulaFields}}','[\"estimatedCost\"]')"
    fault('unconfirmed-formula', f'pg_temp.portfolio_call(p_rows=>{formula})', message='cached formula row lacks individual confirmation')
    fault('current-name-match', f"pg_temp.portfolio_call(p_rows=>jsonb_build_array({inp}#>'{{rows,0}}'))", message='current project name match')
    batch_first = f"({inp}#>'{{rows,0}}'||jsonb_build_object('name','New batch match','fingerprint',repeat('a',64)))"
    batch_second = f"({inp}#>'{{rows,0}}'||jsonb_build_object('name','New batch match','rowNumber',4,'fingerprint',repeat('b',64)))"
    fault('batch-name-match', f'pg_temp.portfolio_call(p_rows=>jsonb_build_array({batch_first},{batch_second}))', message='batch project name match')
    fault('duplicate-source-id', f"pg_temp.portfolio_call(p_rows=>jsonb_set(jsonb_set({rows},'{{0,sourceId}}','\"SAME\"'),'{{1,sourceId}}','\"same\"'))", message='Duplicate source IDs')
    fault('created-identity-replay', f'pg_temp.portfolio_call(p_rows=>{single})', code='23505', constraint='project_portfolio_import_rows_created_identity_uidx')
    fault('invalid-late-cost', f"pg_temp.portfolio_call(p_rows=>jsonb_set({single},'{{0,estimatedCost,amount}}','\"-1\"'))", message='Created project cost is invalid')
    fault('invalid-late-text', f"pg_temp.portfolio_call(p_rows=>jsonb_set({single},'{{0,description}}',to_jsonb(repeat('x',2001))))", message='Created project text is invalid')
    # First new row can be inserted before the second row's invalid cost fails.
    first = f"({inp}#>'{{rows,0}}'||jsonb_build_object('name','Atomic first fixture','fingerprint',repeat('a',64)))"
    second = f"({inp}#>'{{rows,0}}'||jsonb_build_object('name','Atomic second fixture','rowNumber',4,'fingerprint',repeat('b',64),'estimatedCost',jsonb_build_object('amount','-1','currency','EUR','priceYear',NULL)))"
    fault('late-second-row-rolls-back-first', f'pg_temp.portfolio_call(p_rows=>jsonb_build_array({first},{second}))', message='Created project cost is invalid')
    for actor in ['viewer','outsider']:
        fault(actor+'-actor-denied', f"pg_temp.portfolio_call(p_actor=>({inp}->>'{actor}')::uuid)", code='42501', message='Current workspace role')
    fault('foreign-source', f"pg_temp.portfolio_call(p_source=>({inp}->>'foreign_source')::uuid)", message='Stored portfolio source is missing')
    fault('source-hash-drift', "pg_temp.portfolio_call(p_hash=>repeat('0',64))", message='Stored portfolio source is missing')
    fault('malformed-preview-hash', "pg_temp.portfolio_call(p_preview=>'invalid')", message='Portfolio workbook payload is malformed')
    fault('worksheet-setup-drift', "pg_temp.portfolio_call(p_configs=>'[{\"worksheetIndex\":0,\"worksheetName\":\"Wrong\",\"headerRow\":1,\"mapping\":{},\"defaults\":{}}]')", message='does not match its worksheet setup')
    fault('malformed-skipped-fingerprint', f"pg_temp.portfolio_call(p_rows=>jsonb_set({rows},'{{1,fingerprint}}','\"bad\"'))", message='does not match its worksheet setup')
    fault('invalid-skipped-decision', f"pg_temp.portfolio_call(p_rows=>jsonb_set({rows},'{{1,decision}}','\"ignore\"'))", message='does not match its worksheet setup')
    fault('format-filename-mismatch', "pg_temp.portfolio_call(p_format=>'xlsx')", message='source format does not match its filename')
    for field in ['status','content_type','storage_ref']:
        newval = "NULL" if field=='storage_ref' else literal('stored' if field=='status' else 'application/pdf')
        parts.append('SAVEPOINT source_fault;\n' + f"UPDATE public.kb_documents SET {field}={newval} WHERE id=({inp}->>'source')::uuid;\n")
        message = {'status':'source status does not match', 'content_type':'source content type does not match', 'storage_ref':'Stored portfolio source is missing'}[field]
        fault('source-'+field, f'pg_temp.portfolio_call(p_rows=>{single})', message=message)
        parts.append('ROLLBACK TO SAVEPOINT source_fault;\n')
    parts.append(r'''
-- Real role invocation and RLS reads, separate from service-role actor checks.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',v->>'actor','role','authenticated')::text,true) FROM pg_temp.portfolio_input;
DO $member$
BEGIN
 IF (SELECT count(*) FROM public.project_portfolio_import_rows) <> 3
    OR (SELECT count(*) FROM public.project_portfolio_import_batches) <> 2
 THEN RAISE EXCEPTION 'Member cannot read own audit rows'; END IF;
 BEGIN
  PERFORM pg_temp.portfolio_call();
  RAISE EXCEPTION 'Authenticated RPC unexpectedly allowed';
 EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE '%',jsonb_build_object('case','authenticated-rpc-denied','sqlstate',SQLSTATE);
 END;
END $member$;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',v->>'outsider','role','authenticated')::text,true) FROM pg_temp.portfolio_input;
DO $outsider$
BEGIN
 IF EXISTS (SELECT 1 FROM public.project_portfolio_import_rows)
    OR EXISTS (SELECT 1 FROM public.project_portfolio_import_batches)
 THEN RAISE EXCEPTION 'Outsider sees audit rows'; END IF;
 RAISE NOTICE '%',jsonb_build_object('case','native-audit-RLS','memberOwnRows',3,'outsiderRows',0);
END $outsider$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $anon$
BEGIN
 BEGIN
  PERFORM pg_temp.portfolio_call();
  RAISE EXCEPTION 'Anonymous RPC unexpectedly allowed';
 EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE '%',jsonb_build_object('case','anonymous-rpc-denied','sqlstate',SQLSTATE);
 END;
END $anon$;
RESET ROLE;
SET LOCAL ROLE postgres;
''')
    # Direct audit insertion must retain create-only status/phase constraints.
    for field, constraint in [('resolved_status','project_portfolio_import_rows_resolved_status_check'), ('resolved_delivery_phase','project_portfolio_import_rows_resolved_delivery_phase_check')]:
        command = f"""INSERT INTO public.project_portfolio_import_rows
 SELECT a.* FROM public.project_portfolio_import_rows r CROSS JOIN LATERAL jsonb_populate_record(
 NULL::public.project_portfolio_import_rows,to_jsonb(r)||jsonb_build_object('id',gen_random_uuid(),
 'decision','create','outcome','created','created_project_id',
 (SELECT id FROM public.projects WHERE workspace_id=({inp}->>'workspace')::uuid LIMIT 1),
 'resolved_status','active','resolved_delivery_phase','programming','{field}','invented')) a
 WHERE r.workspace_id=({inp}->>'workspace')::uuid AND r.source_row_number=3 LIMIT 1"""
        parts.append('SELECT pg_temp.portfolio_expect_error('+','.join([literal('direct-created-audit-'+field),literal(command),"'23514'",'NULL',literal(constraint)])+');\n')
    for table in ['project_portfolio_import_rows','project_portfolio_import_batches']:
        command = f"UPDATE public.{table} SET workspace_id=workspace_id WHERE workspace_id=({inp}->>'workspace')::uuid"
        parts.append('SELECT pg_temp.portfolio_expect_error('+','.join([literal('immutable-'+table),literal(command),"'P0001'",literal('Project portfolio import provenance is immutable'),'NULL'])+');\n')
    parts.append(r'''
-- Positive workbook SQL metadata case. Route parsing/Storage remain outside this probe.
DO $workbook$
DECLARE d jsonb := (SELECT v FROM portfolio_input); result jsonb; rows jsonb;
BEGIN
 rows := jsonb_build_array(d#>'{rows,0}'||jsonb_build_object('name','Workbook synthetic fixture'));
 result := pg_temp.portfolio_call(p_rows=>rows,p_source=>(d->>'workbook')::uuid,p_hash=>repeat('f',64),p_format=>'xlsx');
 IF result->>'created' <> '1' THEN RAISE EXCEPTION 'Workbook create failed'; END IF;
 RAISE NOTICE '%',jsonb_build_object('case','workbook-metadata-success','result',result);
END $workbook$;
ROLLBACK;
SELECT (SELECT count(*) FROM public.projects)=:portfolio_before_projects
   AND (SELECT count(*) FROM public.project_portfolio_import_batches)=:portfolio_before_batches
   AND (SELECT count(*) FROM public.project_portfolio_import_rows)=:portfolio_before_rows
   AND (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.project_portfolio_import_rows'::regclass
       AND conname='project_portfolio_import_rows_resolved_status_check')=:'portfolio_before_status_constraint'
   AND (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.project_portfolio_import_rows'::regclass
       AND conname='project_portfolio_import_rows_resolved_delivery_phase_check')=:'portfolio_before_phase_constraint'
   AS restored
\gset portfolio_after_
\if :portfolio_after_restored
\echo 'Original counts and both constraints restored after rollback'
\else
\echo 'Rollback inventory mismatch'
\quit 1
\endif
-- Final SQL assertions run AFTER rollback. Root also retains independent before/after inventory.
DO $restored$
BEGIN
 IF (SELECT prosrc FROM pg_proc WHERE oid='public.commit_project_portfolio_import_v2(uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb)'::regprocedure)
    IS DISTINCT FROM __OLD_BODY__ THEN RAISE EXCEPTION 'Original function not restored'; END IF;
 IF EXISTS (SELECT 1 FROM public.workspaces WHERE id IN (__WORKSPACE__::uuid,__FOREIGN_WORKSPACE__::uuid))
   OR EXISTS (SELECT 1 FROM auth.users WHERE id IN (__ACTOR__::uuid,__VIEWER__::uuid,__OUTSIDER__::uuid))
   OR EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261017000017')
 THEN RAISE EXCEPTION 'Fixture or candidate history persisted'; END IF;
 IF (SELECT pg_get_constraintdef(oid) LIKE '%decision%' FROM pg_constraint
     WHERE conrelid='public.project_portfolio_import_rows'::regclass AND conname='project_portfolio_import_rows_resolved_status_check')
 THEN RAISE EXCEPTION 'Candidate constraints persisted'; END IF;
 RAISE NOTICE '%',jsonb_build_object('case','rollback-restored-original','database',current_database(),'migration17Applied',false);
END $restored$;
'''.replace('__OLD_BODY__',baseline_body).replace('__WORKSPACE__',literal(ids['workspace']))
        .replace('__FOREIGN_WORKSPACE__',literal(ids['foreign_workspace'])).replace('__ACTOR__',literal(ids['actor']))
        .replace('__VIEWER__',literal(ids['viewer'])).replace('__OUTSIDER__',literal(ids['outsider'])))
    return '\n'.join(parts), {'database':database,'fixtureIds':ids,'sourceHash':frozen['sourceHash'],
        'previewHash':frozen['previewHash'],'migrationSha256':hashlib.sha256(candidate.encode()).hexdigest(),
        'originalMigrationSha256':hashlib.sha256(OLD.read_bytes()).hexdigest(),
        'nativeExecuted':False,'migrationHistoryWrites':False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database',required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    sql,plan=generate(args.database)
    args.output.mkdir(mode=0o700,parents=True,exist_ok=False)
    (args.output/'probe.sql').write_text(sql)
    plan['probeSha256']=hashlib.sha256(sql.encode()).hexdigest()
    (args.output/'plan.json').write_text(json.dumps(plan,indent=2)+'\n')
    print(json.dumps({'prepared':str(args.output),'database':args.database,'nativeExecuted':False}))


if __name__=='__main__':
    main()
