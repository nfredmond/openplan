"""Check native scoped inspection and truthful treatment of historical runs."""
from pathlib import Path
import json,os,re,subprocess,uuid
ROOT=Path(__file__).resolve().parent


def verify(source):
    meta=json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
    if meta['container']!='supabase_db_openplan-restore-target-2026091050' or not re.fullmatch(r'openplan_kpi_upgrade_[0-9a-f]{32}',meta['database']):
        raise ValueError('Select owned proof database')
    fixture=str(uuid.UUID(meta['fixture_run']))
    historic,new,stage,wrong=[str(uuid.uuid4()) for _ in range(4)]
    def run_insert(identity):
        return f"INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by) SELECT '{identity}',workspace_id,model_id,'aequilibrae','queued','Synthetic custody inspection',created_by FROM public.model_runs WHERE id='{fixture}';"
    sql='BEGIN;\n'+run_insert(historic)+'\n'+(ROOT/'retained-output-protection.sql').read_text()+'\n'+(ROOT/'stage-execution-start.sql').read_text()+'\n'+source+'\n'+run_insert(new)+f"""
CREATE FUNCTION pg_temp.assert_state(target uuid,expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual jsonb; ws uuid;
BEGIN
 SELECT workspace_id INTO ws FROM public.model_runs WHERE id=target;
 actual:=public.inspect_model_relaunch_custody(ws,target);
 IF actual IS DISTINCT FROM jsonb_build_object('workspace_id',ws,'run_id',target,'state',expected) THEN
 RAISE EXCEPTION 'Custody state differs: expected %, received %',expected,actual; END IF;
END $$;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_state('{historic}','unassessed');
UPDATE public.model_runs SET created_at=clock_timestamp() WHERE id='{historic}';
SELECT pg_temp.assert_state('{historic}','unassessed');
SELECT pg_temp.assert_state('{new}','unstarted');
INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES('{stage}','{new}','Synthetic custody','queued',1);
SELECT pg_temp.assert_state('{new}','unstarted');
UPDATE public.model_run_stages SET status='running' WHERE id='{stage}' AND status='queued';
SELECT pg_temp.assert_state('{new}','retained');
DO $$ BEGIN
 BEGIN
  PERFORM public.inspect_model_relaunch_custody('{wrong}','{new}');
  RAISE EXCEPTION 'Wrong workspace accepted' USING ERRCODE='ZX002';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM<>'Model recovery scope mismatch' THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF has_function_privilege('authenticated','public.inspect_model_relaunch_custody(uuid,uuid)','EXECUTE')
 OR has_function_privilege('anon','public.inspect_model_relaunch_custody(uuid,uuid)','EXECUTE')
 OR has_table_privilege('service_role','public.model_execution_custody_enrollment','INSERT') THEN
 RAISE EXCEPTION 'Private inspection permissions widened'; END IF;
 BEGIN
  UPDATE public.model_execution_custody_enrollment SET provenance='new_run' WHERE run_id='{historic}';
  RAISE EXCEPTION 'Historical enrollment replaced' USING ERRCODE='ZX002';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
 END;
END $$;
ROLLBACK;
"""
    r=subprocess.run(['docker','exec','-i',meta['container'],'psql','-X','-qAt','-U','postgres','-d',meta['database'],'-v','ON_ERROR_STOP=1'],input=sql,text=True,capture_output=True,timeout=30)
    if r.returncode: raise AssertionError(r.stderr.strip())
    return {'historical_and_edited_date_unassessed':True,'new_unstarted_then_claim_retained':True,'wrong_workspace_refused':True,'private_immutable_enrollment':True,'rolled_back':True}


def main():
    source=(ROOT/'relaunch-custody-inspection.sql').read_text()
    variants=[('baseline',source,None),('harmless',source+'\n-- Harmless control.\n',None),
        ('history-bypass',source.replace("provenance='historical_unassessed' OR EXISTS(","false OR EXISTS("),'Custody state differs'),
        ('scope-bypass',source.replace('id=p_run AND workspace_id=p_workspace FOR SHARE','id=p_run FOR SHARE'),'Wrong workspace accepted'),
        ('claim-bypass',source.replace('parent.attempt_managed OR public.model_run_has_retained_commands(p_run)','false'),'Custody state differs'),
        ('restored',source,None)]
    records=[]
    for name,body,error in variants:
        try: result=verify(body)
        except AssertionError as failure:
            if error is None or error not in str(failure): raise
            records.append({'case':name,'detected':True,'reason':str(failure).splitlines()[0]})
        else:
            if error: raise AssertionError('Inspection fault survived: '+name)
            records.append({'case':name,'result':result})
    output=Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT']);output.mkdir(parents=True,exist_ok=True)
    (output/'relaunch-custody-inspection.json').write_text(json.dumps(records,indent=2)+'\n')
    print(json.dumps(records,indent=2))

if __name__=='__main__': main()
