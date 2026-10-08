"""Observe competing real transactions in the named isolated publication database."""
from pathlib import Path
import json
import os
import re
import selectors
import subprocess
import time
import uuid

ROOT=Path(__file__).resolve().parent


def quoted(value):
    return "'"+value.replace("'","''")+"'"


def ready(process):
    with selectors.DefaultSelector() as selector:
        selector.register(process.stdout,selectors.EVENT_READ)
        if not selector.select(12):
            raise RuntimeError('Owned publication session did not become ready')
    value=process.stdout.readline().strip()
    if not value:
        raise RuntimeError('Owned publication session closed before receipt')
    return json.loads(value)


def verify():
    meta=json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
    if not re.fullmatch('openplan_attempt_cli_[0-9a-f]{32}',meta['database']) or meta['container']!='supabase_db_openplan-restore-target-2026091050':
        raise ValueError('Select only the named owned proof database')
    fixture=str(uuid.UUID(meta['fixture_run']))
    command=['docker','exec','-i',meta['container'],'psql','-X','-qAt','-U','postgres','-d',meta['database'],'-v','ON_ERROR_STOP=1']
    def sql(statement):
        result=subprocess.run(command,input=statement,text=True,capture_output=True,timeout=25)
        if result.returncode:
            raise RuntimeError(result.stderr)
        return result.stdout.strip()
    source=(ROOT/'evidence-publication.sql').read_text()
    def check(candidate,mode):
        if sql("SELECT to_regclass('public.model_evidence_publication_receipts') IS NULL AND to_regclass('public.model_evidence_publication_context') IS NULL;")!='t':
            raise RuntimeError('Publication proof objects already exist; do not replace them')
        sql('BEGIN;\n'+candidate+'\nCOMMIT;')
        owner=contender=None
        try:
            run=str(uuid.uuid4()); request=str(uuid.uuid4()); label='publication_'+uuid.uuid4().hex
            ws=sql(f"INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by) SELECT '{run}',workspace_id,model_id,'aequilibrae','queued','Synthetic publication contention',created_by FROM public.model_runs WHERE id='{fixture}' RETURNING workspace_id;")
            ws=str(uuid.UUID(ws))
            expected=json.loads(sql(f"SELECT public.read_legacy_model_evidence('{ws}','{run}','assignment');"))
            payload={'claim':{'workspace_id':ws,'model_run_id':run,'track':'assignment','claim_status':'prototype_only','status_reason':'Synthetic concurrent publication','validation_summary_json':{}},'metrics':[]}
            def call(identity):
                return f"public.publish_legacy_model_evidence('{identity}','{ws}','{run}','assignment',{quoted(json.dumps(expected))}::jsonb,{quoted(json.dumps(payload))}::jsonb)"
            owner=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
            owner.stdin.write('SET statement_timeout=12000; SET idle_in_transaction_session_timeout=15000; BEGIN; SET LOCAL ROLE service_role; SELECT '+call(request)+';\n');owner.stdin.flush()
            first=ready(owner)
            contender_id=request if mode=='retry' else str(uuid.uuid4())
            contender=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            contender.stdin.write(f"SET application_name='{label}'; SET statement_timeout=12000; SET ROLE service_role; SELECT "+call(contender_id)+';\n');contender.stdin.close();contender.stdin=None
            blocked=False
            for _ in range(40):
                if sql(f"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='{label}' AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0);")=='t':
                    blocked=True;break
                if contender.poll() is not None:break
                time.sleep(.05)
            if not blocked:
                raise AssertionError('Competing publication did not wait on a lock')
            owner.stdin.write('COMMIT;\n\\q\n');owner.stdin.flush();owner.stdin.close();owner.stdin=None
            _,error=owner.communicate(timeout=15)
            if owner.returncode:raise RuntimeError(error)
            output,error=contender.communicate(timeout=15)
            if mode=='retry':
                if contender.returncode or json.loads(output)!=first:
                    raise AssertionError('Concurrent exact retry did not return original receipt')
            else:
                if contender.returncode==0:
                    raise AssertionError('Two stale publishers both committed')
                if 'Publication evidence changed' not in error:raise RuntimeError(error)
            count=sql(f"SELECT count(*) FROM public.model_evidence_publication_receipts WHERE run_id='{run}';")
            if count!='1':raise AssertionError('Publication retained multiple receipts')
            retained=json.loads(sql(f"SELECT public.read_legacy_model_evidence('{ws}','{run}','assignment');"))
            if retained!=first['evidence']:raise AssertionError('Concurrent publication changed first committed evidence')
            return {'mode':mode,'run_id':run,'lock_wait_observed':True,'receipt_count':1}
        finally:
            for process in (owner,contender):
                if process is not None and process.poll() is None:
                    if process.stdin is not None:
                        process.stdin.close();process.stdin=None
                    try:process.communicate(timeout=16)
                    except subprocess.TimeoutExpired:
                        raise RuntimeError('Owned proof session still live; leave objects for diagnosis')
            # Only objects created by this invocation in the explicitly owned DB.
            sql('''BEGIN;
DROP TRIGGER retained_model_evidence ON public.modeling_claim_decisions;
DROP TRIGGER retained_model_evidence ON public.modeling_validation_results;
DROP FUNCTION public.guard_retained_model_evidence();
DROP FUNCTION public.publish_legacy_model_evidence(uuid,uuid,uuid,text,jsonb,jsonb);
DROP FUNCTION public.read_legacy_model_evidence(uuid,uuid,text);
DROP TABLE public.model_evidence_publication_context;
DROP TABLE public.model_evidence_publication_receipts;
COMMIT;''')
    results=[]
    for name,candidate in [('baseline',source),('harmless',source+'\n-- Harmless contention comment.\n')]:
        for mode in ('retry','competing'):
            results.append({'case':name,**check(candidate,mode)})
    mutants=[('stale-check-bypass',source.replace('IF previous IS DISTINCT FROM p_expected THEN','IF false THEN',1),'competing','Two stale publishers both committed'),('wrong-retry-receipt',source.replace('RETURN receipt.response_payload;',"RETURN '{}'::jsonb;",1),'retry','Concurrent exact retry did not return original receipt')]
    for name,candidate,mode,error in mutants:
        try:check(candidate,mode)
        except AssertionError as failure:
            if str(failure)!=error:raise
            results.append({'case':name,'mode':mode,'caught':error})
        else:raise AssertionError('Contention mutation survived: '+name)
    for mode in ('retry','competing'):
        results.append({'case':'restored',**check(source,mode)})
    if sql("SELECT to_regclass('public.model_evidence_publication_receipts') IS NULL;")!='t':
        raise AssertionError('Publication proof cleanup failed')
    output=Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT']).resolve();output.mkdir(mode=0o700,parents=True,exist_ok=True)
    evidence={'cases':results,'cleanup_confirmed':True,'scope':'Committed synthetic records in the named owned proof DB, actual constraints and service-role calls in separate PostgreSQL sessions. Candidate proof objects removed; synthetic run/projection rows retained. No installed migration, HTTP, reaper race, worker adoption, county or scientific acceptance.'}
    (output/'publication-contention.json').write_text(json.dumps(evidence,indent=2)+'\n')
    return evidence

if __name__=='__main__':
    print(json.dumps(verify(),indent=2))
