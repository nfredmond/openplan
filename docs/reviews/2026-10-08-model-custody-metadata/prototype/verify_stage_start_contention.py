"""Run separate database sessions against an owned clone, observing actual locks."""
from pathlib import Path
import json
import os
import re
import subprocess
import time
import uuid
from verify_publication_contention import ready

ROOT=Path(__file__).resolve().parent


def verify():
    source=json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
    if source['container']!='supabase_db_openplan-restore-target-2026091050' or not re.fullmatch(r'openplan_kpi_upgrade_[0-9a-f]{32}',source['database']):
        raise ValueError('Select an owned proof source')
    output=Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT']);output.mkdir(parents=True,exist_ok=True)
    metadata=output/'candidate.json'
    base=['docker','exec','-i',source['container'],'psql','-X','-qAt','-U','postgres','-v','ON_ERROR_STOP=1']
    def invoke(database,statement):
        result=subprocess.run([*base,'-d',database],input=statement,text=True,capture_output=True,timeout=30)
        if result.returncode: raise RuntimeError(result.stderr)
        return result.stdout.strip()
    if metadata.exists():
        meta=json.loads(metadata.read_text())
    else:
        meta={**source,'database':'openplan_start_race_'+uuid.uuid4().hex,'source_database':source['database']}
        invoke('postgres',f"CREATE DATABASE {meta['database']} TEMPLATE {source['database']};")
        metadata.write_text(json.dumps(meta,indent=2)+'\n')
    if meta['container']!=source['container'] or not re.fullmatch(r'openplan_start_race_[0-9a-f]{32}',meta['database']):
        raise ValueError('Invalid owned contention clone')
    command=[*base,'-d',meta['database']]
    def sql(statement): return invoke(meta['database'],statement)
    fixture=str(uuid.UUID(meta['fixture_run']))
    guard=(ROOT/'retained-output-protection.sql').read_text()
    start=(ROOT/'stage-execution-start.sql').read_text()
    def check(guard_source,mode):
        if sql("SELECT to_regclass('public.model_stage_execution_starts') IS NULL AND to_regprocedure('public.guard_retained_model_outputs()') IS NULL;")!='t':
            raise RuntimeError('Proof objects already exist; leave unchanged')
        sql('BEGIN;\n'+guard_source+'\n'+start+'\nCOMMIT;')
        owner=contender=None
        try:
            run,stage,kpi=[str(uuid.uuid4()) for _ in range(3)]
            label='start_race_'+uuid.uuid4().hex
            sql(f"""INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
 SELECT '{run}',workspace_id,model_id,'aequilibrae','queued','Synthetic claim race',created_by FROM public.model_runs WHERE id='{fixture}';
 INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES('{stage}','{run}','Synthetic claim race','queued',1);
 INSERT INTO public.model_run_kpis(id,run_id,kpi_name,kpi_label,kpi_category,value,unit) VALUES('{kpi}','{run}','probe','Probe','assignment',12.5,'vehicles');""")
            claim=f"WITH changed AS (UPDATE public.model_run_stages SET status='running' WHERE id='{stage}' AND status='queued' RETURNING id) SELECT count(*) FROM changed;"
            owner=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
            owner.stdin.write('SET statement_timeout=12000; SET idle_in_transaction_session_timeout=15000; BEGIN; SET LOCAL ROLE service_role; '+claim+'\n');owner.stdin.flush()
            if ready(owner)!=1: raise AssertionError('Owner did not claim exactly once')
            if mode=='retry': operation=claim
            elif mode=='reset': operation=f"UPDATE public.model_runs SET status='queued',result_summary_json='{{}}' WHERE id='{run}';"
            else: operation=f"DELETE FROM public.model_run_kpis WHERE id='{kpi}';"
            contender=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            contender.stdin.write(f"SET application_name='{label}'; SET statement_timeout=12000; SET ROLE service_role; "+operation+'\n');contender.stdin.close();contender.stdin=None
            blocked=False
            for _ in range(50):
                if sql(f"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='{label}' AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0);")=='t':
                    blocked=True;break
                if contender.poll() is not None: break
                time.sleep(.04)
            if not blocked: raise AssertionError('Contender did not wait on an actual lock')
            owner.stdin.write(('ROLLBACK;' if mode=='rollback-cleanup' else 'COMMIT;')+'\n\\q\n');owner.stdin.flush();owner.stdin.close();owner.stdin=None
            _,error=owner.communicate(timeout=15)
            if owner.returncode: raise RuntimeError(error)
            response,error=contender.communicate(timeout=15)
            if mode in ('reset','cleanup'):
                if contender.returncode==0: raise AssertionError('Committed claim allowed '+mode)
                if 'Retained model outputs' not in error: raise RuntimeError(error)
            elif contender.returncode: raise RuntimeError(error)
            elif mode=='retry' and response.strip()!='0': raise AssertionError('Competing claim executed again')
            facts=json.loads(sql(f"SELECT json_build_object('starts',(SELECT count(*) FROM public.model_stage_execution_starts WHERE run_id='{run}'),'kpis',(SELECT count(*) FROM public.model_run_kpis WHERE run_id='{run}'),'stage_status',(SELECT status FROM public.model_run_stages WHERE id='{stage}'));"))
            expected={'starts':0,'kpis':0,'stage_status':'queued'} if mode=='rollback-cleanup' else {'starts':1,'kpis':1,'stage_status':'running'}
            if facts!=expected: raise AssertionError('Concurrent records differ: '+json.dumps(facts))
            return {'mode':mode,'lock_wait_observed':True,'facts':facts}
        finally:
            for process in (owner,contender):
                if process is not None and process.poll() is None:
                    if process.stdin is not None: process.stdin.close();process.stdin=None
                    process.communicate(timeout=18)
            sql('''BEGIN;
DROP TRIGGER retain_model_stage_execution_start ON public.model_run_stages;
DROP FUNCTION public.retain_model_stage_execution_start();
DROP TABLE public.model_stage_execution_starts;
DROP FUNCTION public.refuse_model_stage_start_mutation();
DROP TRIGGER guard_retained_model_outputs ON public.model_runs;
DROP TRIGGER guard_retained_model_outputs ON public.model_run_stages;
DROP TRIGGER guard_retained_model_outputs ON public.model_run_artifacts;
DROP TRIGGER guard_retained_model_outputs ON public.model_run_kpis;
DROP TRIGGER guard_retained_model_outputs ON public.modeling_claim_decisions;
DROP TRIGGER guard_retained_model_outputs ON public.modeling_validation_results;
DROP FUNCTION public.guard_retained_model_outputs();
DROP FUNCTION public.model_run_has_retained_commands(uuid);
COMMIT;''')
    records=[]
    for name,body in [('baseline',guard),('harmless',guard+'\n-- Harmless control.\n'),('restored',guard)]:
        for mode in ('retry','reset','cleanup','rollback-cleanup'):
            records.append({'case':name,**check(body,mode)})
    for name,body,mode in [
        ('queued-parent-reset',guard.replace("IF NEW.status='queued'\n", "IF NEW.status='queued' AND OLD.status IS DISTINCT FROM NEW.status\n",1),'reset'),
        ('delete-bypass',guard.replace("ELSIF TG_OP='DELETE' OR following IS DISTINCT FROM prior THEN", "ELSIF TG_OP='UPDATE' AND following IS DISTINCT FROM prior THEN"),'cleanup')]:
        if body==guard: raise AssertionError('Mutation anchor changed: '+name)
        try: check(body,mode)
        except AssertionError as error:
            if str(error)!='Committed claim allowed '+mode: raise
            records.append({'case':name,'caught':str(error)})
        else: raise AssertionError('Contention control survived: '+name)
    evidence={'cases':records,'scope':'Separate service-role PostgreSQL sessions; actual lock waits; synthetic owned clone retained, prototype objects removed. No live worker or authenticated route.'}
    (output/'stage-start-contention.json').write_text(json.dumps(evidence,indent=2)+'\n')
    return evidence

if __name__=='__main__': print(json.dumps(verify(),indent=2))
