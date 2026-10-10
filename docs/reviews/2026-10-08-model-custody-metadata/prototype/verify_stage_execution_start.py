"""Prove new stage claims retain a start even without any output receipt.

Rollback-only native checks. No historical backfill, live worker, HTTP claim,
concurrent execution, continuation or scientific acceptance is established.
"""
from pathlib import Path
import json
import os
import re
import subprocess
import uuid


def verify(source):
    meta=json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
    if meta['container']!='supabase_db_openplan-restore-target-2026091050' or not re.fullmatch(r'openplan_kpi_upgrade_[0-9a-f]{32}',meta['database']):
        raise ValueError('Select an owned KPI upgrade proof database')
    fixture=str(uuid.UUID(meta['fixture_run']))
    run,stage,inserted,failed=[str(uuid.uuid4()) for _ in range(4)]
    base=Path(__file__).with_name('retained-output-protection.sql').read_text()
    sql=f"""BEGIN;
{base}
{source}
INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
 SELECT '{run}',workspace_id,model_id,'aequilibrae','queued','Synthetic stage start',created_by FROM public.model_runs WHERE id='{fixture}';
INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES('{stage}','{run}','Synthetic stage start','queued',1);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.model_stage_execution_starts WHERE run_id='{run}') THEN
 RAISE EXCEPTION 'Start recorded before claim'; END IF;
END $$;
CREATE FUNCTION pg_temp.must_refuse(statement text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN SQLSTATE '55000' THEN RETURN; END;
 RAISE EXCEPTION 'Guard accepted prohibited change: %',statement;
END $$;
SET LOCAL ROLE service_role;
UPDATE public.model_run_stages SET status='running' WHERE id='{stage}' AND status='queued';
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.model_stage_execution_starts WHERE stage_id='{stage}' AND run_id='{run}' AND boundary='queued_to_running')<>1 THEN
 RAISE EXCEPTION 'Claim did not retain exact execution start'; END IF;
 IF EXISTS(SELECT 1 FROM public.model_legacy_kpi_receipts WHERE run_id='{run}') OR EXISTS(SELECT 1 FROM public.model_legacy_artifact_receipts WHERE run_id='{run}') THEN
 RAISE EXCEPTION 'Probe unexpectedly has output receipts'; END IF;
END $$;
SET LOCAL ROLE service_role;
UPDATE public.model_runs SET status='running' WHERE id='{run}';
UPDATE public.model_run_stages SET log_tail='Still running' WHERE id='{stage}';
UPDATE public.model_run_stages SET status='running' WHERE id='{stage}' AND status='queued';
SELECT pg_temp.must_refuse('UPDATE public.model_runs SET status=''queued'' WHERE id=''{run}''');
SELECT pg_temp.must_refuse('UPDATE public.model_run_stages SET status=''queued'' WHERE id=''{stage}''');
UPDATE public.model_run_stages SET status='succeeded' WHERE id='{stage}';
SELECT pg_temp.must_refuse('UPDATE public.model_run_stages SET status=''running'' WHERE id=''{stage}''');
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.model_stage_execution_starts WHERE run_id='{run}')<>1 THEN
 RAISE EXCEPTION 'Claim retry or progress changed start count'; END IF;
END $$;
SELECT pg_temp.must_refuse('DELETE FROM public.model_stage_execution_starts WHERE stage_id=''{stage}''');
SELECT pg_temp.must_refuse('UPDATE public.model_stage_execution_starts SET boundary=''inserted_running'' WHERE stage_id=''{stage}''');
DO $$ BEGIN
 IF has_table_privilege('service_role','public.model_stage_execution_starts','INSERT')
 OR has_table_privilege('authenticated','public.model_stage_execution_starts','SELECT')
 OR has_table_privilege('anon','public.model_stage_execution_starts','SELECT') THEN
 RAISE EXCEPTION 'Execution start permissions widened'; END IF;
END $$;
SET LOCAL ROLE service_role;
INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES('{inserted}','{run}','Synthetic inserted running','running',2);
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.model_stage_execution_starts WHERE stage_id='{inserted}' AND boundary='inserted_running') THEN
 RAISE EXCEPTION 'Inserted running stage has no start'; END IF;
END $$;
-- Force a failure after the start insert. Both the claim and its marker roll back.
CREATE FUNCTION pg_temp.fail_after_start() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.stage_id='{failed}' THEN RAISE EXCEPTION 'Synthetic late failure' USING ERRCODE='ZX001'; END IF; RETURN NEW; END $$;
CREATE TRIGGER zz_test_late_failure AFTER INSERT ON public.model_stage_execution_starts FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_after_start();
DO $$ BEGIN
 BEGIN
  INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES('{failed}','{run}','Synthetic failed start','running',3);
  RAISE EXCEPTION 'Late failure did not abort claim';
 EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
 END;
 IF EXISTS(SELECT 1 FROM public.model_run_stages WHERE id='{failed}') OR EXISTS(SELECT 1 FROM public.model_stage_execution_starts WHERE stage_id='{failed}') THEN
 RAISE EXCEPTION 'Failed claim left partial start'; END IF;
END $$;
ROLLBACK;"""
    result=subprocess.run(['docker','exec','-i',meta['container'],'psql','-X','-qAt','-U','postgres','-d',meta['database'],'-v','ON_ERROR_STOP=1'],input=sql,text=True,capture_output=True,timeout=40)
    if result.returncode:
        raise AssertionError(result.stderr.strip())
    return {'claim_before_output_receipts':True,'conditional_retry_and_progress_no_duplicate':True,'late_failure_atomic':True,'reset_and_restart_refused':True,'inserted_running_recorded':True,'private_immutable_marker':True,'rolled_back':True}


def main():
    source=Path(__file__).with_name('stage-execution-start.sql').read_text()
    variants=[('baseline',source,None),('harmless',source+'\n-- Harmless control.\n',None),
        ('missing-claim-trigger',source.replace('AFTER INSERT OR UPDATE ON public.model_run_stages','AFTER INSERT ON public.model_run_stages'),'Claim did not retain exact execution start'),
        ('missing-retention-selector',source.replace('EXISTS(SELECT 1 FROM public.model_stage_execution_starts WHERE run_id=p_run)','false'),'Guard accepted prohibited change'),
        ('missing-insert-trigger',source.replace('AFTER INSERT OR UPDATE ON public.model_run_stages','AFTER UPDATE ON public.model_run_stages'),'Inserted running stage has no start'),
        ('mutable-start',source.replace("RAISE EXCEPTION 'Model stage execution start is immutable' USING ERRCODE='55000';","IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;"),'Guard accepted prohibited change'),
        ('restored',source,None)]
    records=[]
    for name,body,error in variants:
        try: result=verify(body)
        except AssertionError as failure:
            if error is None or error not in str(failure): raise
            records.append({'case':name,'detected':True,'reason':str(failure).splitlines()[0]})
        else:
            if error: raise AssertionError('Broken start boundary escaped: '+name)
            records.append({'case':name,'result':result})
    output=Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT']);output.mkdir(parents=True,exist_ok=True)
    (output/'stage-execution-start.json').write_text(json.dumps(records,indent=2)+'\n')
    print(json.dumps(records,indent=2))


if __name__=='__main__': main()
