"""Exercise retained-output guards in a rollback-only owned database transaction.

Receipt-selector fixtures isolate each receipt table. KPI registration uses its
real RPC. This does not exercise HTTP access, the launch route or continuation.
"""
from pathlib import Path
import argparse
import json
import os
import re
import subprocess
import uuid


def verify(source):
    meta = json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
    if meta['container'] != 'supabase_db_openplan-restore-target-2026091050' or not re.fullmatch(r'openplan_kpi_upgrade_[0-9a-f]{32}', meta['database']):
        raise ValueError('Select an owned KPI upgrade proof database')
    fixture = str(uuid.UUID(meta['fixture_run']))
    statements = ['BEGIN;', source, '''CREATE FUNCTION pg_temp.must_refuse(statement text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN SQLSTATE '55000' THEN RETURN;
 END;
 RAISE EXCEPTION 'Guard accepted prohibited change: %',statement;
END;
$$;''']
    count = 0
    for mode in ('none', 'kpi', 'artifact', 'assessment'):
        run, stage, kpi, artifact, request = [str(uuid.uuid4()) for _ in range(5)]
        statements.append(f"""INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
 SELECT '{run}',workspace_id,model_id,'aequilibrae','running','Synthetic retained output protection',created_by FROM public.model_runs WHERE id='{fixture}';
 INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES('{stage}','{run}','Synthetic protection','running',1);
 INSERT INTO public.model_run_artifacts(id,run_id,stage_id,artifact_type,file_url) VALUES('{artifact}','{run}','{stage}','csv','synthetic://output');
 INSERT INTO public.model_run_kpis(id,run_id,kpi_name,kpi_label,kpi_category,value,unit) VALUES('{kpi}','{run}','probe','Probe','assignment',12.5,'vehicles');""")
        # Each selector fixture has only one receipt family. It does not assert
        # that a fabricated assessment payload passed scientific ingestion.
        if mode == 'kpi':
            statements.append(f"""DELETE FROM public.model_run_kpis WHERE id='{kpi}';
 SET LOCAL ROLE service_role;
 SELECT public.record_legacy_model_kpi(workspace_id,jsonb_build_object('id','{kpi}','run_id','{run}','stage_id','{stage}','kpi_name','probe','kpi_label','Probe','kpi_category','assignment','value',12.5,'unit','vehicles','geometry_ref',NULL,'breakdown_json','{{}}'::jsonb)) IS NOT NULL FROM public.model_runs WHERE id='{run}';
 RESET ROLE;""")
        elif mode == 'artifact':
            statements.append(f"INSERT INTO public.model_legacy_artifact_receipts VALUES('{artifact}','{run}','{{}}','{{}}');")
        elif mode == 'assessment':
            statements.append(f"INSERT INTO public.model_assessment_command_receipts(request_id,run_id,request_payload,response_payload) VALUES('{request}','{run}','{{}}','{{}}');")
        statements.append('SET LOCAL ROLE service_role;')
        if mode == 'none':
            statements.append(f"UPDATE public.model_runs SET status='queued' WHERE id='{run}'; DELETE FROM public.model_run_kpis WHERE id='{kpi}';")
        else:
            prohibited = [
                f"UPDATE public.model_runs SET status='queued' WHERE id='{run}'",
                f"UPDATE public.model_runs SET input_snapshot_json='{{\"changed\":true}}' WHERE id='{run}'",
                f"UPDATE public.model_run_stages SET status='queued' WHERE id='{stage}'",
                f"DELETE FROM public.model_run_stages WHERE id='{stage}'",
                f"UPDATE public.model_run_stages SET stage_name='Changed' WHERE id='{stage}'",
                f"DELETE FROM public.model_run_artifacts WHERE id='{artifact}'",
                f"UPDATE public.model_run_artifacts SET file_url='synthetic://replacement' WHERE id='{artifact}'",
                f"DELETE FROM public.model_run_kpis WHERE id='{kpi}'",
                f"UPDATE public.model_run_kpis SET value=99 WHERE id='{kpi}'",
                f"DELETE FROM public.model_runs WHERE id='{run}'",
            ]
            for statement in prohibited:
                statements.append("SELECT pg_temp.must_refuse('" + statement.replace("'", "''") + "');")
                count += 1
            statements.append(f"""UPDATE public.model_run_stages SET log_tail='Progress retained',status='succeeded' WHERE id='{stage}';
 UPDATE public.model_runs SET status='succeeded' WHERE id='{run}';
 UPDATE public.model_run_kpis SET value=value WHERE id='{kpi}';
 DO $$ BEGIN
 IF (SELECT value FROM public.model_run_kpis WHERE id='{kpi}') IS DISTINCT FROM 12.5::double precision
 OR (SELECT file_url FROM public.model_run_artifacts WHERE id='{artifact}') IS DISTINCT FROM 'synthetic://output'
 OR (SELECT status FROM public.model_runs WHERE id='{run}') IS DISTINCT FROM 'succeeded'
 THEN RAISE EXCEPTION 'Guard did not preserve outputs and allow normal completion'; END IF;
 END $$;""")
        statements.append('RESET ROLE;')
    statements.append('ROLLBACK;')
    result = subprocess.run(['docker','exec','-i',meta['container'],'psql','-X','-qAt','-U','postgres','-d',meta['database'],'-v','ON_ERROR_STOP=1'], input='\n'.join(statements),capture_output=True,text=True,timeout=40)
    if result.returncode:
        raise AssertionError(result.stderr.strip())
    return {'prohibited_changes_refused':count,'receipt_families':3,'ordinary_progress_and_completion':True,'unretained_run_unchanged':True,'rolled_back':True}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--controls',action='store_true')
    args=parser.parse_args()
    source=Path(__file__).with_name('retained-output-protection.sql').read_text()
    variants=[('baseline',source,False)]
    if args.controls:
        variants.extend([
            ('harmless',source+'\n-- Harmless source control.\n',False),
            ('no-retention-check',source.replace('IF public.model_run_has_retained_commands(run) THEN','IF false THEN'),True),
            ('kpi-selector-missing',source.replace('EXISTS(SELECT 1 FROM public.model_legacy_kpi_receipts WHERE run_id=p_run)','false'),True),
            ('artifact-selector-missing',source.replace('EXISTS(SELECT 1 FROM public.model_legacy_artifact_receipts WHERE run_id=p_run)','false'),True),
            ('assessment-selector-missing',source.replace('EXISTS(SELECT 1 FROM public.model_assessment_command_receipts WHERE run_id=p_run)','false'),True),
            ('requeue-allowed',source.replace("NEW.status='queued' AND OLD.status IS DISTINCT FROM NEW.status","false"),True),
            ('snapshot-rewrite-allowed',source.replace('NEW.input_snapshot_json IS DISTINCT FROM OLD.input_snapshot_json','false'),True),
            ('delete-allowed',source.replace("ELSIF TG_OP='DELETE' OR following IS DISTINCT FROM prior THEN","ELSIF TG_OP='UPDATE' AND following IS DISTINCT FROM prior THEN"),True),
            ('replacement-allowed',source.replace("ELSIF TG_OP='DELETE' OR following IS DISTINCT FROM prior THEN","ELSIF TG_OP='DELETE' THEN"),True),
            ('restored',source,False),
        ])
    records=[]
    for name,body,broken in variants:
        try:
            result=verify(body)
        except AssertionError as error:
            if not broken or 'Guard accepted prohibited change:' not in str(error):
                raise
            records.append({'case':name,'detected':True,'reason':str(error).splitlines()[0]})
        else:
            if broken:
                raise AssertionError('Broken guard escaped: '+name)
            records.append({'case':name,'result':result})
    output=Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT'])
    output.mkdir(parents=True,exist_ok=True)
    (output/'retained-output-protection.json').write_text(json.dumps(records,indent=2)+'\n')
    print(json.dumps(records,indent=2))


if __name__=='__main__':
    main()
