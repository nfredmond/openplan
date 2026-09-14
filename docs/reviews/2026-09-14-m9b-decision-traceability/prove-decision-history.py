"""Native private history reader and an exact synthetic receipt fixture for TS."""
import hashlib
import importlib.util
import json
from pathlib import Path
import uuid

review=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('link_probe',review/'prove-decision-links.py')
link=importlib.util.module_from_spec(spec)
spec.loader.exec_module(link)
f=link.f
candidate=review/'decision-history-candidate.sql'
original=candidate.read_text()
private=link.fixture.private/'history'
private.mkdir(exist_ok=True)
read=f"SELECT read_engagement_decision_links('{f['campaign']}')"
base="BEGIN; SET LOCAL statement_timeout='20s'; SET LOCAL lock_timeout='3s';\n"+link.fixture.original+link.original+link.fixture.seed+link.helpers


def run(body,steps,label):
    result=link.fixture.sql(base+body+steps+'\nROLLBACK;')
    (private/(label+'.log')).write_text(result.stdout+result.stderr)
    assert result.returncode==0,result.stderr
    return [json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]


def check(body):
    # Definition is privileged DDL. Return to the staff role before all reads.
    definition='RESET ROLE;'+body+'SET LOCAL ROLE authenticated;'
    empty=run(definition,read+';','empty')[-1]
    assert empty['entryCount']==0 and empty['currentCount']==0,'Empty history was not empty'
    assert empty['decisionCount']==1 and empty['decisions'][0]['record']['id']==f['decision'],'Eligible decision scope differs'
    steps=link.root_save+read+';\n'
    initial=run(definition,steps,'initial')[-1]
    assert initial['entryCount']==1 and len(initial['entries'])==1,'Original link history missing'
    assert initial['entries'][0]['id']==link.ids['root'],'Original link identity differs'
    assert initial['currentCount']==1 and initial['current'][0]['sourceState']=='unchanged','Original source state differs'
    assert initial['current'][0]['currentContextSha256']==initial['entries'][0]['context_sha256'],'Unchanged source hash differs'
    row=initial['entries'][0]
    assert hashlib.sha256(row['payload_text'].encode()).hexdigest()==row['payload_sha256'],'Payload text checksum differs'
    assert json.loads(row['payload_text'])==row['payload_json'],'Payload text content differs'
    corrected=steps+f"RESET ROLE; UPDATE project_decisions SET rationale='SYNTHETIC current corrected rationale' WHERE id='{f['decision']}'; SET LOCAL ROLE authenticated;"+read+';'
    changed=run(definition,corrected,'changed')[-1]
    assert changed['current'][0]['sourceState']=='changed' and changed['current'][0]['currentContextSha256']!=changed['entries'][0]['context_sha256'],'Source correction was hidden'
    assert json.loads(changed['entries'][0]['context_text'])['decision']['rationale']=='SYNTHETIC private rationale','Original rationale was rewritten'
    removed=corrected+f"RESET ROLE; DELETE FROM project_decisions WHERE id='{f['decision']}'; SET LOCAL ROLE authenticated;"+read+';'
    gone=run(definition,removed,'removed')[-1]
    assert gone['entryCount']==1 and gone['decisionCount']==0,'Deleted decision erased retained link'
    assert gone['current'][0]['sourceState']=='unavailable' and gone['current'][0]['unavailableReason']=='source_unavailable' and gone['current'][0]['currentContextSha256'] is None,'Missing source meaning differs'
    withdrawn=removed+link.command('withdraw',operation='withdraw',predecessor='root',expected=None)+';'+read+';'
    closed=run(definition,withdrawn,'withdrawn')[-1]
    assert closed['entryCount']==2 and closed['currentCount']==1,'Withdrawal chain census differs'
    assert closed['current'][0]['linkId']==link.ids['withdraw'],'History current pointer is not the leaf'
    assert closed['entries'][0]['context_text']==closed['entries'][1]['context_text'],'Withdrawal changed original context'
    for actor in ('viewer','outsider'):
        empty_steps=f"SELECT set_config('request.jwt.claim.sub','{f[actor]}',true);"+link.expect_error(read,'42501',actor+' history read was not refused')
        run(definition,empty_steps,actor+'-empty-denied')
        steps=link.root_save+f"SELECT set_config('request.jwt.claim.sub','{f[actor]}',true);"+link.expect_error(read,'42501',actor+' history read was not refused')
        run(definition,steps,actor+'-denied')
    for role in ('anon','service_role'):
        steps=link.root_save+f"RESET ROLE; SET LOCAL ROLE {role};"+link.expect_error(read,'42501',role+' history execution was not refused')
        run(definition,steps,role+'-denied')
    # More than a PostgREST row page, with actual unique predecessors. No fixture
    # is committed to the application DB; privileged fixture setup is explicit.
    many=link.root_save+f"""RESET ROLE;
    WITH generated AS MATERIALIZED (SELECT n,gen_random_uuid() id FROM generate_series(1,1005) n),
    chain AS (SELECT n,id,coalesce(lag(id) OVER(ORDER BY n),'{link.ids['root']}'::uuid) predecessor FROM generated)
    INSERT INTO engagement_response_decision_links(id,workspace_id,campaign_id,response_id,decision_id,project_id,predecessor_id,operation,actor_id,reason,payload_json,context_text)
    SELECT chain.id,l.workspace_id,l.campaign_id,l.response_id,l.decision_id,l.project_id,chain.predecessor,'refresh',l.actor_id,l.reason,
     l.payload_json||jsonb_build_object('operation','refresh','predecessorId',chain.predecessor),l.context_text
    FROM chain CROSS JOIN engagement_response_decision_links l WHERE l.id='{link.ids['root']}';
    SET LOCAL ROLE authenticated;
    SELECT jsonb_build_object('entries',j->>'entryCount','current',j->>'currentCount','actual',jsonb_array_length(j->'entries'))
    FROM (SELECT read_engagement_decision_links('{f['campaign']}') j) snapshot;
    """
    census=run(definition,many,'large-history')[-1]
    assert census=={'entries':'1006','current':'1','actual':1006},'Retained history truncated or leaves duplicated'
    return initial,closed


mutations=[
 ('unscoped-decisions','cp.project_id = p.id','true','Eligible decision scope differs'),
 ('hidden-change',"THEN 'unchanged' ELSE 'changed'","THEN 'unchanged' ELSE 'unchanged'",'Source correction was hidden'),
 ('invented-current-source',"'sourceState', 'unavailable'","'sourceState', 'unchanged'",'Missing source meaning differs'),
 ('viewer-history',"m.role IN ('owner', 'admin', 'member')","m.role IN ('owner', 'admin', 'member', 'viewer')",'viewer history read was not refused'),
 ('anonymous-execute','TO authenticated;','TO authenticated, anon;','anon history execution was not refused'),
 ('service-execute','TO authenticated;','TO authenticated, service_role;','service_role history execution was not refused'),
 ('missing-history-row','FROM public.engagement_response_decision_links l\n  WHERE','FROM (SELECT * FROM public.engagement_response_decision_links LIMIT 1000) l\n  WHERE','Retained history truncated or leaves duplicated'),
 ('nonleaf-current','AND NOT EXISTS (SELECT 1 FROM public.engagement_response_decision_links child WHERE child.predecessor_id = l.id)','AND true','Withdrawal chain census differs'),
]
results=[]
try:
 for name,body,expected in [('baseline',original,None),('harmless-comment',original+'\n-- Harmless history comment.\n',None)]+[(name,original.replace(old,new,1),expected) for name,old,new,expected in mutations]:
    if expected:
        old=next(old for key,old,_,_ in mutations if key==name)
        assert original.count(old)==1,name
    try:
        initial,closed=check(body)
    except AssertionError as error:
        assert expected and expected in str(error),str(error)
        (private/(name+'-failure.log')).write_text(str(error)+'\n')
        outcome='killed'
    else:
        assert expected is None,'History mutation survived: '+name
        outcome='survived'
        if name=='baseline':
            app=review.parents[2]/'openplan'
            (app/'src/test/fixtures/decision-link-native.json').write_text(json.dumps({'synthetic':True,'scope':{'campaignId':f['campaign'],'workspaceId':f['workspace'],'actorId':f['actor']},'initial':initial,'withdrawn':closed},indent=2)+'\n')
    results.append({'case':name,'outcome':outcome,'expectedFailure':expected})
    print(name,outcome,flush=True)
finally:
 restored=link.fixture.state()=='339:20261014000020\nt'
 result=link.fixture.sql("SELECT to_regprocedure('public.read_engagement_decision_links(uuid)') IS NULL;")
 restored=restored and result.returncode==0 and result.stdout.strip()=='t'
 (review/'decision-history-results.json').write_text(json.dumps({'container':link.fixture.container,'database':'postgres','candidateSha256':hashlib.sha256(candidate.read_bytes()).hexdigest(),'contextCandidateSha256':hashlib.sha256(link.fixture.candidate.read_bytes()).hexdigest(),'linkCandidateSha256':hashlib.sha256(link.candidate.read_bytes()).hexdigest(),'results':results,'candidateAndFixturesRolledBack':restored,'limits':'Native serial history, permission and complete 1006-row reads. The committed fixture contains synthetic data only. HTTP row transport, browser controls and public readers remain unfinished.'},indent=2)+'\n')
 assert restored
