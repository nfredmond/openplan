"""Race recovery with native writes in the disconnected synthetic proof database."""
import hashlib
import importlib.util
import json
from pathlib import Path
import uuid

review=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('concurrency',review/'prove-decision-concurrency.py')
c=importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)
source=(review/'decision-resolution-candidate.sql').read_text()
resolver=source[source.index('CREATE FUNCTION public.resolve_engagement_decision_request('):source.index('CREATE OR REPLACE FUNCTION public.write_engagement_response_decision_link(')].replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1)
writer=source[source.index('CREATE OR REPLACE FUNCTION public.write_engagement_response_decision_link('):]


def resolve(f,resolution=None,request=None):
    return c.identity(f)+f"SELECT resolve_engagement_decision_request('{f['campaign']}','{request or f['request']}','{resolution or f['resolution']}','\"SYNTHETIC damaged concurrent copy\"','SYNTHETIC recovery reason');"


def new(label):
    f=c.fixture(label)
    f['resolution']=str(uuid.uuid4())
    return f


def result(run):
    assert run.returncode==0,run.stderr
    return c.objects(run.stdout)[-1]


def writer_first(label,rollback=False):
    f=new(label)
    with c.held(c.write(f),label) as (child,records):
        saved=records[-1]
        c.denied(c.call(resolve(f),label+'-overlap'),'PT503',label+' recovery overlap was not refused')
        c.finish(child,not rollback)
    recovered=result(c.call(resolve(f),label+'-recover',True))
    state=json.loads(recovered['resultText'])
    if rollback:
        assert state['state']=='cancelled' and state['link'] is None,label+' rollback not cancelled'
        c.denied(c.call(c.write(f),label+'-late'),'PT409',label+' late write was not refused')
    else:
        assert state['state']=='saved' and state['link']==saved['link'],label+' committed receipt differs'
        assert result(c.call(c.write(f),label+'-retry'))=={**saved,'replayed':True},label+' saved retry changed'


def resolver_first(label,rollback=False):
    f=new(label)
    with c.held(resolve(f),label) as (child,records):
        saved=records[-1]
        c.denied(c.call(c.write(f),label+'-overlap'),'PT503',label+' writer overlap was not refused')
        c.finish(child,not rollback)
    if rollback:
        assert result(c.call(c.write(f),label+'-late',True))['replayed'] is False,label+' rollback prevented fresh write'
    else:
        c.denied(c.call(c.write(f),label+'-late'),'PT409',label+' cancelled late write was not refused')
        assert result(c.call(resolve(f),label+'-retry',True))=={**saved,'replayed':True},label+' recovery replay differs'
        assert c.must(f"SELECT count(*) FROM engagement_decision_request_resolutions WHERE request_id='{f['request']}';",label+'-count')=='1',label+' duplicated recovery'


def resolution_race(label,same_resolution=False):
    f=new(label)
    other_request=str(uuid.uuid4()) if same_resolution else f['request']
    other_resolution=f['resolution'] if same_resolution else str(uuid.uuid4())
    with c.held(resolve(f),label) as (child,_):
        c.denied(c.call(resolve(f,other_resolution,other_request),label+'-overlap'),'PT503',label+' resolution overlap was not refused')
        c.finish(child)
    late=c.call(resolve(f,other_resolution,other_request),label+'-late',True)
    if same_resolution:
        c.denied(late,'PT409',label+' reused resolution ID accepted different request')
    else:
        assert json.loads(result(late)['resultText'])['state']=='cancelled',label+' second copy not resolved'
        assert c.must(f"SELECT count(*) FROM engagement_decision_request_resolutions WHERE request_id='{f['request']}';",label+'-count')=='2',label+' lost independent copy'


def held_lock(label,kind):
    f=new(label)
    locks={
        'request':f"SELECT pg_advisory_xact_lock(hashtextextended('engagement-decision-request:{f['request']}',0));",
        'resolution':f"SELECT pg_advisory_xact_lock(hashtextextended('engagement-decision-resolution:{f['resolution']}',0));",
        'membership':f"SELECT 1 FROM workspace_members WHERE workspace_id='{f['workspace']}' AND user_id='{f['actor']}' FOR NO KEY UPDATE;",
        'campaign':f"SELECT 1 FROM engagement_campaigns WHERE id='{f['campaign']}' FOR NO KEY UPDATE;",
        'workspace':f"SELECT 1 FROM workspaces WHERE id='{f['workspace']}' FOR NO KEY UPDATE;",
    }
    with c.held(locks[kind],label) as (child,_):
        c.denied(c.call(resolve(f),label+'-overlap'),'PT503',label+' isolated lock was not respected')
        c.finish(child,False)
    assert json.loads(result(c.call(resolve(f),label+'-after'))['resultText'])['state']=='cancelled',label+' unlocked recovery failed'


def foreign_scope(label):
    f=new(label)
    foreign={**f,'campaign':f['otherCampaign']}
    with c.held(f"SELECT 1 FROM engagement_campaigns WHERE id='{f['otherCampaign']}' FOR NO KEY UPDATE;",label) as (child,_):
        c.denied(c.call(resolve(foreign),label+'-overlap'),'42501',label+' foreign campaign lock leaked')
        c.finish(child,False)
    c.denied(c.call(resolve(foreign),label+'-after'),'42501',label+' foreign campaign unlocked access differs')


def scenarios(prefix):
    writer_first(prefix+'-writer-commit')
    writer_first(prefix+'-writer-rollback',True)
    resolver_first(prefix+'-resolver-commit')
    resolver_first(prefix+'-resolver-rollback',True)
    resolution_race(prefix+'-copies')
    resolution_race(prefix+'-resolution-identity',True)
    for kind in ('request','resolution','membership','campaign','workspace'):
        held_lock(prefix+'-'+kind,kind)
    foreign_scope(prefix+'-foreign')


def main():
    # This database is intentionally disconnected from PostgREST and workers.
    # Install additively once; never recreate or reset it. Application postgres
    # is read-only here and must retain its installed function and table state.
    before=c.fixture_module.state()
    assert before.startswith('340:20261014000021\nf'),before
    app_res=c.fixture_module.sql("SELECT to_regclass('public.engagement_decision_request_resolutions') IS NULL; SELECT encode(extensions.digest(pg_get_functiondef('public.write_engagement_response_decision_link(uuid,uuid,uuid,uuid,text,uuid,text,text)'::regprocedure),'sha256'),'hex');")
    assert app_res.returncode==0 and app_res.stdout.startswith('t\n'),app_res.stderr
    exists=c.must("SELECT to_regclass('public.engagement_decision_request_resolutions') IS NULL;",'proof-table-state')
    if exists=='t':
        c.must('BEGIN;'+source+'COMMIT;','install-proof-recovery')
    else:
        # An earlier interrupted run may have installed this candidate. Validate
        # its structure and current candidate provenance before replacing functions.
        old=json.loads((review/'decision-resolution-proof-install.json').read_text())
        assert old['candidateSha256']==hashlib.sha256(source.encode()).hexdigest(),'Existing proof candidate changed; inspect before replacing'
    install={'database':c.manifest['database'],'container':c.manifest['container'],'candidateSha256':hashlib.sha256(source.encode()).hexdigest(),'applicationMigration':'340:20261014000021','applicationRecoveryInstalled':False,'privateEvidence':str(c.private)}
    (review/'decision-resolution-proof-install.json').write_text(json.dumps(install,indent=2)+'\n')
    original_functions=c.must("SELECT pg_get_functiondef('public.resolve_engagement_decision_request(uuid,uuid,uuid,text,text)'::regprocedure); SELECT pg_get_functiondef('public.write_engagement_response_decision_link(uuid,uuid,uuid,uuid,text,uuid,text,text)'::regprocedure);",'original-functions')
    outcomes=[]
    try:
        scenarios('baseline');outcomes.append({'name':'baseline','scenarios':12,'outcome':'passed'})
        c.must(resolver.replace('-- Scope precedes shared locks','-- Harmless comment. Scope precedes shared locks',1)+writer,'harmless-install')
        scenarios('harmless');outcomes.append({'name':'harmless','scenarios':12,'outcome':'survived'})
        mutations=[
            ('resolver-request-lock',resolver,"OR NOT pg_try_advisory_xact_lock(hashtextextended('engagement-decision-request:' || p_request::text, 0))",'OR false',lambda:held_lock('broken-request','request'),'isolated lock was not respected'),
            ('resolution-identity-lock',resolver,"NOT pg_try_advisory_xact_lock(hashtextextended('engagement-decision-resolution:' || p_resolution::text, 0))",'false',lambda:held_lock('broken-resolution','resolution'),'isolated lock was not respected'),
            ('cancelled-write-guard',writer,'WHERE request_id = p_request AND campaign_id = p_campaign\n      AND workspace_id = campaign.workspace_id AND actor_id = auth.uid()','WHERE false',lambda:resolver_first('broken-late'),'cancelled late write was not refused'),
            ('resolution-membership-lock',resolver,"AND user_id = actor AND role IN ('owner', 'admin', 'member') FOR SHARE NOWAIT","AND user_id = actor AND role IN ('owner', 'admin', 'member')",lambda:held_lock('broken-membership','membership'),'isolated lock was not respected'),
            ('resolution-workspace-lock',resolver,'PERFORM 1 FROM public.workspaces WHERE id = campaign.workspace_id FOR SHARE NOWAIT;','NULL;',lambda:held_lock('broken-workspace','workspace'),'isolated lock was not respected'),
            ('resolution-campaign-lock',resolver,') FOR SHARE OF c NOWAIT;',');',lambda:held_lock('broken-campaign','campaign'),'isolated lock was not respected'),
            ('foreign-scope-before-lock',resolver,"WHERE c.id = p_campaign AND EXISTS (\n      SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = c.workspace_id\n        AND m.user_id = actor AND m.role IN ('owner', 'admin', 'member')\n    ) FOR SHARE OF c NOWAIT;",'WHERE c.id = p_campaign FOR SHARE OF c NOWAIT;',lambda:foreign_scope('broken-foreign'),'foreign campaign lock leaked'),
        ]
        for label,body,old,new,check,expected in mutations:
            assert body.count(old)==1,(label,body.count(old))
            c.must(resolver+writer,'restore-before-'+label)
            c.must(body.replace(old,new,1),'install-'+label)
            try:check()
            except AssertionError as error:
                assert expected in str(error),(label,str(error))
                outcomes.append({'name':label,'outcome':'killed','assertion':str(error)})
            else:raise AssertionError(label+' survived')
    finally:
        c.must(resolver+writer,'restore-candidate-functions')
        restored=c.must("SELECT pg_get_functiondef('public.resolve_engagement_decision_request(uuid,uuid,uuid,text,text)'::regprocedure); SELECT pg_get_functiondef('public.write_engagement_response_decision_link(uuid,uuid,uuid,uuid,text,uuid,text,text)'::regprocedure);",'restored-functions')
        assert restored==original_functions,'Proof functions not restored'
    after=c.fixture_module.sql("SELECT to_regclass('public.engagement_decision_request_resolutions') IS NULL; SELECT encode(extensions.digest(pg_get_functiondef('public.write_engagement_response_decision_link(uuid,uuid,uuid,uuid,text,uuid,text,text)'::regprocedure),'sha256'),'hex');")
    assert after.returncode==0 and after.stdout==app_res.stdout and c.fixture_module.state()==before,'Application schema changed'
    packet={**install,'outcomes':outcomes,'proofFunctionsRestored':True,'applicationUnchanged':True,'limits':['Synthetic native transactions; no browser or HTTP recovery integration yet.','Persistent proof fixtures are isolated from application users and workers.','Checks hold actual idle-in-transaction backends and observe competing calls; this is not a load test.']}
    (review/'decision-resolution-concurrency-results.json').write_text(json.dumps(packet,indent=2)+'\n')
    print(json.dumps({'scenarios':12,'harmlessSurvived':True,'faultsKilled':len(mutations),'applicationUnchanged':True,'privateEvidence':str(c.private)}))


if __name__=='__main__':main()
