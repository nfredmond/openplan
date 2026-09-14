"""Hold independent native transactions; never attach this proof DB to a worker."""
from pathlib import Path
import contextlib
import hashlib
import importlib.util
import json
import os
import select
import subprocess
import time
import uuid

review=Path(__file__).resolve().parent
manifest=json.loads((review/'decision-proof-database.json').read_text())
assert manifest['database']=='openplan_decision_link_proof_20260914'
assert manifest['container']=='supabase_db_openplan-restore-target-2026091050'
spec=importlib.util.spec_from_file_location('context_fixture',review/'prove-decision-context.py')
fixture_module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture_module)
private=Path(manifest['privateEvidence']).parent/('concurrency-'+str(time.time_ns()))
private.mkdir(mode=0o700)
command=['docker','exec','-i',manifest['container'],'psql','-U','supabase_admin','-d',manifest['database'],'-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']


def sql(statement,label):
    run=subprocess.run(command,input=statement,text=True,capture_output=True,timeout=10)
    (private/(label+'.log')).write_text(run.stdout+run.stderr)
    return run


def must(statement,label):
    run=sql(statement,label)
    assert run.returncode==0,(label,run.stderr)
    return run.stdout.strip()


def objects(output):
    return [json.loads(line) for line in output.splitlines() if line.startswith('{')]


def identity(f):
    return f"SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','{f['actor']}',true);"


def fixture(label):
    f={key:str(uuid.uuid4()) for key in fixture_module.f}
    seed=fixture_module.seed
    for key,value in fixture_module.f.items():
        seed=seed.replace(value,f[key])
    must('BEGIN;'+seed+'COMMIT;',label+'-fixture')
    f['preview']=objects(must('BEGIN;'+identity(f)+f"SELECT read_engagement_response_decision_context('{f['campaign']}','{f['response']}','{f['decision']}'); ROLLBACK;",label+'-preview'))[-1]
    f['request']=str(uuid.uuid4())
    return f


def write(f,request=None,previous=None):
    request=request or f['request']
    op='refresh' if previous else 'link'
    pred="'"+previous+"'" if previous else 'NULL'
    return identity(f)+f"SELECT write_engagement_response_decision_link('{f['campaign']}','{f['response']}','{f['decision']}','{request}','{op}',{pred},'{f['preview']['contextSha256']}','SYNTHETIC concurrent link');"


def call(statement,label,commit=False):
    return sql("BEGIN; SET LOCAL statement_timeout='2s'; SET LOCAL lock_timeout='1500ms';"+statement+('COMMIT;' if commit else 'ROLLBACK;'),label)


def denied(result,code,label):
    assert result.returncode!=0 and f'ERROR:  {code}:' in result.stderr,label+': '+result.stderr


@contextlib.contextmanager
def held(statement,label):
    child=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    observed=b''
    try:
        child.stdin.write(("BEGIN; SET LOCAL statement_timeout='4s';"+statement+"SELECT json_build_object('marker','DECISION_READY','backendPid',pg_backend_pid());\n").encode())
        child.stdin.flush()
        deadline=time.monotonic()+6
        while b'DECISION_READY' not in observed:
            assert child.poll() is None,label+': transaction ended before readiness'
            assert time.monotonic()<deadline,label+': readiness expired'
            ready,_,_=select.select([child.stdout],[],[],0.1)
            if ready: observed+=os.read(child.stdout.fileno(),65536)
        records=objects(observed.decode())
        pid=records[-1]['backendPid']
        assert must(f"SELECT state FROM pg_stat_activity WHERE pid={pid} AND datname='{manifest['database']}';",label+'-live')=='idle in transaction',label+': transaction is not live'
        (private/(label+'-held.log')).write_bytes(observed)
        yield child,records[:-1]
    finally:
        if child.poll() is None and child.stdin is not None:
            child.stdin.write(b'ROLLBACK;\n');child.stdin.flush();child.stdin.close();child.stdin=None
        out,error=child.communicate(timeout=8)
        (private/(label+'-closed.log')).write_bytes(out+error)
        assert child.returncode==0,(label,error.decode())


def finish(child,commit=True):
    assert child.poll() is None,'Held transaction ended before competing call'
    child.stdin.write(b'COMMIT;\n' if commit else b'ROLLBACK;\n')
    child.stdin.flush();child.stdin.close();child.stdin=None
    child.wait(timeout=8)
    assert child.returncode==0,'Held transaction did not finish successfully'


def replay_case(label,rollback=False,competing=False,successor=False):
    f=fixture(label)
    previous=None
    if successor:
        original=call(write(f),label+'-root',True)
        assert original.returncode==0,original.stderr
        previous=f['request'];f['request']=str(uuid.uuid4())
    rival=str(uuid.uuid4()) if competing else f['request']
    with held(write(f,previous=previous),label) as (child,records):
        first=records[-1]
        denied(call(write(f,rival,previous),label+'-overlap'),'PT503',label+' overlap was not refused')
        finish(child,not rollback)
    late=call(write(f,rival,previous),label+'-retry',True)
    if competing:
        denied(late,'PT409',label+' late fork was not refused')
    else:
        assert late.returncode==0,late.stderr
        receipt=objects(late.stdout)[-1]
        if rollback:
            assert receipt['replayed'] is False,label+' rollback retry was falsely replayed'
        else:
            assert receipt=={**first,'replayed':True},label+' exact retry differs'
    count=must(f"SELECT count(*) FROM engagement_response_decision_links WHERE campaign_id='{f['campaign']}';",label+'-count')
    assert count==('2' if successor else '1'),label+' duplicate receipts'


def source_case(kind,label):
    f=fixture(label)
    if kind=='source':
        first=f"UPDATE engagement_items SET body='SYNTHETIC changed input',review_expected_updated_at=updated_at,review_reason='SYNTHETIC held correction' WHERE id='{f['knownItem']}';"
    elif kind=='decision':
        first=f"UPDATE project_decisions SET rationale='SYNTHETIC held decision correction' WHERE id='{f['decision']}';"
    elif kind=='relationship':
        # Lock only this row so the test does not borrow protection from a parent
        # revision trigger. Relationship deletion is independently exercised.
        first=f"SELECT id FROM engagement_campaign_projects WHERE campaign_id='{f['campaign']}' FOR UPDATE;"
    elif kind=='membership':
        must(f"UPDATE workspace_members SET role='owner' WHERE workspace_id='{f['workspace']}' AND user_id='{f['viewer']}';",label+'-second-owner')
        first=f"UPDATE workspace_members SET role='viewer' WHERE workspace_id='{f['workspace']}' AND user_id='{f['actor']}';"
    elif kind=='source-lock':
        first=f"SELECT id FROM engagement_items WHERE id='{f['knownItem']}' FOR UPDATE;"
    elif kind=='decision-lock':
        first=f"SELECT id FROM project_decisions WHERE id='{f['decision']}' FOR UPDATE;"
    elif kind=='membership-lock':
        first=f"SELECT user_id FROM workspace_members WHERE workspace_id='{f['workspace']}' AND user_id='{f['actor']}' FOR UPDATE;"
    else:
        raise AssertionError('Unknown source case')
    with held(first,label) as (child,_):
        denied(call(write(f),label+'-overlap'),'PT503',label+' overlap was not refused')
        finish(child)
    late=call(write(f),label+'-after-change')
    if kind=='membership':
        denied(late,'42501',label+' revoked staff was not refused')
    elif kind in ('relationship','source-lock','decision-lock','membership-lock'):
        assert late.returncode==0,late.stderr
    else:
        denied(late,'PT409',label+' old source context was accepted')
        f['preview']=objects(must('BEGIN;'+identity(f)+f"SELECT read_engagement_response_decision_context('{f['campaign']}','{f['response']}','{f['decision']}'); ROLLBACK;",label+'-new-preview'))[-1]
        saved=call(write(f),label+'-new-context',True)
        assert saved.returncode==0,saved.stderr
        assert objects(saved.stdout)[-1]['replayed'] is False,label+' failed attempt became receipt'


def foreign_decision_case(label):
    f=fixture(label)
    f['decision']=f['otherDecision']
    denied(call(write(f),label+'-ordinary'),'P0002',label+' ordinary foreign decision was not refused')
    with held(f"SELECT id FROM project_decisions WHERE id='{f['otherDecision']}' FOR UPDATE;",label) as (child,_):
        denied(call(write(f),label+'-overlap'),'P0002',label+' foreign lock state was exposed')
        finish(child)


candidate=review/'decision-link-candidate.sql'
source=candidate.read_text()
assert hashlib.sha256(candidate.read_bytes()).hexdigest()==manifest['candidateSha256'][candidate.name]
function='CREATE OR REPLACE FUNCTION public.write_engagement_response_decision_link'+source.split('CREATE FUNCTION public.write_engagement_response_decision_link',1)[1].split('REVOKE ALL ON FUNCTION',1)[0]
original_definition=must("SELECT pg_get_functiondef('public.write_engagement_response_decision_link(uuid,uuid,uuid,uuid,text,uuid,text,text)'::regprocedure);",'original-definition')
def main():
    results=[]
    try:
        for name,definition in [('baseline',function),('harmless-comment',function+'\n-- Harmless lock comment.\n')]:
            must(definition,name+'-install')
            replay_case(name+'-exact-retry')
            replay_case(name+'-interrupted-rollback',rollback=True)
            replay_case(name+'-competing-root',competing=True)
            replay_case(name+'-competing-successor',competing=True,successor=True)
            for kind in ('source','decision','relationship','membership','source-lock','decision-lock','membership-lock'):
                source_case(kind,name+'-'+kind)
            foreign_decision_case(name+'-foreign-decision')
            results.append({'case':name,'outcome':'survived','overlappingCases':12})
            print(name,'survived 12 races',flush=True)
        for name,old,new,kind in [
            ('missing-source-lock','PERFORM 1 FROM public.engagement_items WHERE campaign_id = p_campaign\n      AND id = ANY(response.source_item_ids) ORDER BY id FOR SHARE NOWAIT;','PERFORM 1;','source-lock'),
            ('missing-decision-lock',') FOR SHARE OF d NOWAIT;',');','decision-lock'),
            ('missing-relationship-lock','AND workspace_id = campaign.workspace_id FOR SHARE NOWAIT) THEN','AND workspace_id = campaign.workspace_id) THEN','relationship'),
            ('missing-membership-lock',"AND user_id = auth.uid() AND role IN ('owner', 'admin', 'member') FOR SHARE NOWAIT","AND user_id = auth.uid() AND role IN ('owner', 'admin', 'member')",'membership-lock'),
        ]:
            assert function.count(old)==1,name
            must(function.replace(old,new,1),name+'-install')
            try:
                source_case(kind,name)
            except AssertionError as error:
                assert name+' overlap was not refused' in str(error),str(error)
                (private/(name+'-expected-failure.log')).write_text(str(error)+'\n')
                results.append({'case':name,'outcome':'killed','expectedFailure':name+' overlap was not refused'})
                print(name,'killed',flush=True)
            else:
                raise AssertionError('Lock mutation survived: '+name)
        name='foreign-decision-lock-scope'
        old='WHERE d.id = p_decision AND EXISTS (\n        SELECT 1 FROM public.projects p JOIN public.engagement_campaign_projects cp ON cp.project_id = p.id\n        WHERE p.id = d.project_id AND p.workspace_id = campaign.workspace_id\n          AND cp.campaign_id = p_campaign AND cp.workspace_id = campaign.workspace_id\n      ) FOR SHARE OF d NOWAIT;'
        assert function.count(old)==1
        must(function.replace(old,'WHERE d.id = p_decision FOR SHARE OF d NOWAIT;',1),name+'-install')
        try:
            foreign_decision_case(name)
        except AssertionError as error:
            assert name+' foreign lock state was exposed' in str(error),str(error)
            results.append({'case':name,'outcome':'killed','expectedFailure':name+' foreign lock state was exposed'})
            print(name,'killed',flush=True)
        else:
            raise AssertionError('Foreign decision scope mutation survived')
    finally:
        must(function,'restore-function')
        final=must("SELECT pg_get_functiondef('public.write_engagement_response_decision_link(uuid,uuid,uuid,uuid,text,uuid,text,text)'::regprocedure);",'final-definition')
        restored=final==original_definition
        (review/'decision-concurrency-results.json').write_text(json.dumps({
            'container':manifest['container'],'database':manifest['database'],'privateEvidence':str(private),
            'candidateSha256':manifest['candidateSha256'],'results':results,'definitionRestored':restored,
            'limits':'Real held native transactions with pg_stat_activity readiness and process liveness. Synthetic fixtures remain only in disconnected proof DB. No PostgREST, browser, public disclosure or provider/worker traffic. Failed competitors roll back, and failed held test transactions roll back.',
        },indent=2)+'\n')
        assert restored,'Native command definition not restored'


if __name__ == "__main__":
    main()
