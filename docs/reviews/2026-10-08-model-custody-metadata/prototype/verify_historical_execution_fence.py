"""Challenge historical worker writes against the combined proposed guards.

Synthetic service-role SQL, rolled back. This cannot stop an already-running
scientific process and does not prove operator or practitioner acceptance.
"""
from pathlib import Path
import json,os,re,subprocess,uuid
ROOT=Path(__file__).resolve().parent


def verify(source):
    meta=json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
    if meta['container']!='supabase_db_openplan-restore-target-2026091050' or not re.fullmatch(r'openplan_kpi_upgrade_[0-9a-f]{32}',meta['database']):
        raise ValueError('Select owned proof database')
    fixture=str(uuid.UUID(meta['fixture_run']))
    old,new,stage,artifact,kpi,claim,metric,new_stage,new_kpi=[str(uuid.uuid4()) for _ in range(9)]
    def run_insert(identity):
        return f"INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by) SELECT '{identity}',workspace_id,model_id,'aequilibrae','queued','Synthetic historical fence',created_by FROM public.model_runs WHERE id='{fixture}';"
    def claim_insert(identity,run):
        return f"INSERT INTO public.modeling_claim_decisions(id,workspace_id,model_run_id,track,claim_status,status_reason) SELECT '{identity}',workspace_id,'{run}','assignment','prototype_only','Synthetic' FROM public.model_runs WHERE id='{run}'"
    def metric_insert(identity,run):
        return f"INSERT INTO public.modeling_validation_results(id,workspace_id,model_run_id,track,metric_key,metric_label,status,detail) SELECT '{identity}',workspace_id,'{run}','assignment','probe','Probe','warn','Synthetic' FROM public.model_runs WHERE id='{run}'"
    setup=run_insert(old)+f"""
INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES('{stage}','{old}','Historical queued','queued',1);
INSERT INTO public.model_run_artifacts(id,run_id,stage_id,artifact_type,file_url) VALUES('{artifact}','{old}','{stage}','csv','synthetic://historical');
INSERT INTO public.model_run_kpis(id,run_id,kpi_name,kpi_label,kpi_category,value,unit) VALUES('{kpi}','{old}','probe','Probe','assignment',12.5,'vehicles');
"""+claim_insert(claim,old)+';\n'+metric_insert(metric,old)+';\n'
    sql=['BEGIN;',setup]
    for name in ('retained-output-protection.sql','stage-execution-start.sql','relaunch-custody-inspection.sql'):
        sql.append((ROOT/name).read_text())
    sql.extend([source,run_insert(new),f"INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES('{new_stage}','{new}','New queued','queued',1);"])
    sql.append('''CREATE FUNCTION pg_temp.must_refuse(statement text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN SQLSTATE '55000' THEN
  IF SQLERRM<>'Historical model execution requires reconciliation' THEN RAISE; END IF;
  RETURN;
 END;
 RAISE EXCEPTION 'Historical mutation accepted: %',statement;
END $$;
SET LOCAL ROLE service_role;''')
    cases=[
        f"UPDATE public.model_run_stages SET status='running' WHERE id='{stage}' AND status='queued'",
        f"UPDATE public.model_runs SET status='running' WHERE id='{old}'",
        f"UPDATE public.model_run_stages SET log_tail='Late old worker' WHERE id='{stage}'",
        f"UPDATE public.model_runs SET engine_key='ite_trip_generation' WHERE id='{old}'",
        f"DELETE FROM public.model_run_artifacts WHERE id='{artifact}'",
        f"UPDATE public.model_run_artifacts SET file_url='synthetic://replaced' WHERE id='{artifact}'",
        f"INSERT INTO public.model_run_artifacts(run_id,stage_id,artifact_type,file_url) VALUES('{old}','{stage}','csv','synthetic://late')",
        f"DELETE FROM public.model_run_kpis WHERE id='{kpi}'",
        f"UPDATE public.model_run_kpis SET value=99 WHERE id='{kpi}'",
        f"INSERT INTO public.model_run_kpis(run_id,kpi_name,kpi_label,kpi_category,value,unit) VALUES('{old}','late','Late','assignment',99,'vehicles')",
        f"UPDATE public.model_run_stages SET run_id='{old}' WHERE id='{new_stage}'",
        f"UPDATE public.model_run_stages SET run_id='{new}' WHERE id='{stage}'",
        f"DELETE FROM public.modeling_claim_decisions WHERE id='{claim}'",
        f"UPDATE public.modeling_claim_decisions SET status_reason='Late' WHERE id='{claim}'",
        claim_insert(str(uuid.uuid4()),old).replace("'assignment'","'behavioral_demand'"),
        f"DELETE FROM public.modeling_validation_results WHERE id='{metric}'",
        f"UPDATE public.modeling_validation_results SET detail='Late' WHERE id='{metric}'",
        metric_insert(str(uuid.uuid4()),old),
    ]
    for case in cases: sql.append("SELECT pg_temp.must_refuse('"+case.replace("'","''")+"');")
    sql.append(f"""
UPDATE public.model_run_stages SET status='running' WHERE id='{new_stage}' AND status='queued';
UPDATE public.model_runs SET status='running' WHERE id='{new}';
INSERT INTO public.model_run_kpis(id,run_id,kpi_name,kpi_label,kpi_category,value,unit) VALUES('{new_kpi}','{new}','new','New','assignment',10,'vehicles');
"""+claim_insert(str(uuid.uuid4()),new)+';\n'+metric_insert(str(uuid.uuid4()),new)+f""";
UPDATE public.model_run_stages SET status='succeeded' WHERE id='{new_stage}';
UPDATE public.model_runs SET status='succeeded' WHERE id='{new}';
RESET ROLE;
DO $$ BEGIN
 IF (SELECT status FROM public.model_runs WHERE id='{old}')<>'queued'
 OR (SELECT status FROM public.model_run_stages WHERE id='{stage}')<>'queued'
 OR (SELECT value FROM public.model_run_kpis WHERE id='{kpi}')<>12.5
 OR EXISTS(SELECT 1 FROM public.model_stage_execution_starts WHERE run_id='{old}')
 OR (SELECT status FROM public.model_runs WHERE id='{new}')<>'succeeded'
 OR (SELECT count(*) FROM public.model_stage_execution_starts WHERE run_id='{new}')<>1 THEN
 RAISE EXCEPTION 'Historical preservation or new completion differs'; END IF;
END $$;
ROLLBACK;""")
    r=subprocess.run(['docker','exec','-i',meta['container'],'psql','-X','-qAt','-U','postgres','-d',meta['database'],'-v','ON_ERROR_STOP=1'],input='\n'.join(sql),text=True,capture_output=True,timeout=30)
    if r.returncode: raise AssertionError(r.stderr.strip())
    return {'historical_mutations_refused':len(cases),'historical_rows_preserved':True,'new_claim_projection_and_completion_allowed':True,'rolled_back':True}


def main():
    source=(ROOT/'historical-execution-fence.sql').read_text()
    variants=[('baseline',source,None),('harmless',source+'\n-- Harmless control.\n',None),
        ('historical-bypass',source.replace("IF enrollment IS DISTINCT FROM 'new_run' THEN","IF false THEN"),'Historical mutation accepted'),
        ('old-scope-omitted',source.replace('id IN(old_run,new_run)','id IN(new_run)'),'Historical mutation accepted'),
        ('new-scope-omitted',source.replace('id IN(old_run,new_run)','id IN(old_run)'),'Historical mutation accepted'),
        ('restored',source,None)]
    records=[]
    for name,body,error in variants:
        try: result=verify(body)
        except AssertionError as failure:
            if error is None or error not in str(failure): raise
            records.append({'case':name,'detected':True,'reason':str(failure).splitlines()[0]})
        else:
            if error: raise AssertionError('Historical fault survived: '+name)
            records.append({'case':name,'result':result})
    output=Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT']);output.mkdir(parents=True,exist_ok=True)
    (output/'historical-execution-fence.json').write_text(json.dumps(records,indent=2)+'\n')
    print(json.dumps(records,indent=2))

if __name__=='__main__': main()
