"""Exercise committed commands through independent sessions in a named proof DB.

Fixtures and their immutable history are deliberately retained. Mutations replace
only the candidate function in this disconnected proof database, then restore it.
No app, demo, source database or migration is changed.
"""
from contextlib import contextmanager
from pathlib import Path
import hashlib,json,os,select,subprocess,time,uuid

review=Path(__file__).parent
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/translation-command-races')
private.mkdir(exist_ok=True)
manifest=json.loads((review/'translation-command-proof-database.json').read_text())
assert manifest['database']=='openplan_translation_command_proof_20260913'
assert manifest['container']=='supabase_db_openplan-restore-target-2731143'
base=['docker','exec','-i',manifest['container'],'psql','-U','postgres','-d',manifest['database'],'-X','-A','-t','-q','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
def literal(value):
    return "'"+value.replace("'","''")+"'"
def query(sql):
    return subprocess.check_output(base,input=sql,text=True,timeout=15).strip()
assert query("SELECT to_regprocedure('public.write_engagement_translations(uuid,uuid,text,text,text,jsonb)') IS NOT NULL;")=='t'
candidate=(review/'translation-command-candidate.sql').read_text()
definition=candidate[candidate.index('CREATE FUNCTION public.write_engagement_translations('):]
definition=definition[:definition.index('REVOKE ALL ON FUNCTION public.write_engagement_translations')]
definition=definition.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1)
fixtures=[]
def fixture():
    f={name:str(uuid.uuid4()) for name in ['actor','workspace','campaign','category']}
    a,w,c,k=[f[key] for key in ['actor','workspace','campaign','category']]
    query(f"""BEGIN;
INSERT INTO auth.users(id,aud,role,email) VALUES('{a}','authenticated','authenticated','{a}@translation-race.invalid');
INSERT INTO workspaces(id,name,slug) VALUES('{w}','SYNTHETIC translation race','{w}');
INSERT INTO workspace_members(workspace_id,user_id,role) VALUES('{w}','{a}','owner');
INSERT INTO engagement_campaigns(id,workspace_id,title,created_by) VALUES('{c}','{w}','SYNTHETIC campaign','{a}');
INSERT INTO engagement_categories(id,campaign_id,label,slug) VALUES('{k}','{c}','SYNTHETIC source','race-source');
COMMIT;""")
    fixtures.append(f)
    return f
def entry(f,text='SYNTHETIC original',version=None,source='SYNTHETIC source'):
    result={'entityType':'category','entityId':f['category'],'field':'label',
      'expectedSource':{'text':source,'sourceLocale':None,'available':True},'expectedTranslation':version}
    if text is not None: result['text']=text
    return result
def command(f,entries,request=None,operation='save',reason='SYNTHETIC race reason'):
    return "public.write_engagement_translations("+','.join([
      literal(f['campaign']),literal(request or str(uuid.uuid4())),literal(operation),"'qaa'",literal(reason),literal(json.dumps(entries))+'::jsonb'])+")"
def auth(f):
    return "SET LOCAL request.jwt.claim.sub="+literal(f['actor'])+"; SET LOCAL ROLE authenticated;"
def execute(f,call):
    run=subprocess.run(base,input='BEGIN; SET LOCAL statement_timeout=\'5s\'; '+auth(f)+' SELECT '+call+'; COMMIT;',capture_output=True,text=True,timeout=10)
    if run.returncode:
        return {'code': next((code for code in ['PT409','PT503','42501','22023'] if 'ERROR:  '+code+':' in run.stderr),'unexpected'), 'error':run.stderr}
    return {'result':json.loads(run.stdout.strip())}
def expect_refusal(outcome,code,label):
    assert outcome.get('code')==code,f'{label}: expected {code}, got {outcome}'
def result(outcome):
    assert 'result' in outcome,outcome
    return outcome['result']
def version(saved):
    return {'id':saved['entries'][0]['entry']['id'],'revision':saved['entries'][0]['revision']}

@contextmanager
def held(f,sql):
    process=subprocess.Popen(base,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    assert process.stdin and process.stdout and process.stderr
    committed=False
    try:
        process.stdin.write("BEGIN; SET LOCAL statement_timeout='5s'; "+auth(f)+sql+"\n\\echo OPENPLAN_RACE_READY\n")
        process.stdin.flush()
        received=b''
        deadline=time.monotonic()+10
        while b'OPENPLAN_RACE_READY' not in received.splitlines():
            remaining=deadline-time.monotonic()
            assert remaining>0,'Race holder readiness timed out'
            ready,_,_=select.select([process.stdout],[],[],remaining)
            assert ready,'Race holder readiness timed out'
            chunk=os.read(process.stdout.fileno(),65536)
            assert chunk,'Race holder failed: '+process.stderr.read()
            received+=chunk
        yield received.decode().split('OPENPLAN_RACE_READY')[0].strip()
        process.stdin.write('COMMIT;\n\\q\n'); process.stdin.flush()
        _,error=process.communicate(timeout=10)
        assert process.returncode==0,error
        committed=True
    finally:
        if not committed and process.poll() is None:
            process.stdin.write('ROLLBACK;\n\\q\n'); process.stdin.flush()
            process.communicate(timeout=10)

def creation():
    f=fixture(); request=str(uuid.uuid4())
    first=command(f,[entry(f)],request)
    second=command(f,[entry(f,'SYNTHETIC competing creation')])
    with held(f,'SELECT '+first+';') as output:
        original=json.loads(output)
        expect_refusal(execute(f,second),'PT503','uncommitted competing creation')
        expect_refusal(execute(f,first),'PT503','uncommitted exact retry')
    expect_refusal(execute(f,second),'PT409','committed creation must refuse another absent claim')
    replay=result(execute(f,first))
    assert replay==original|{'replayed':True},'Exact retry changed its original receipt'
    return f

def correction(accept=False):
    f=fixture(); first_request=str(uuid.uuid4())
    first_call=command(f,[entry(f)],first_request)
    original=result(execute(f,first_call))
    if accept:
        query(f"""BEGIN; {auth(f)} UPDATE engagement_content_translations SET source='machine',machine_model='SYNTHETIC legacy model'
WHERE id='{version(original)['id']}'; COMMIT;""")
        observed=version(original)|{'revision':2}
        contender=command(f,[entry(f,None,observed)],operation='accept')
    else:
        observed=version(original)
        contender=command(f,[entry(f,'SYNTHETIC competing correction',observed)])
    winning=command(f,[entry(f,'SYNTHETIC corrected',observed)])
    with held(f,'SELECT '+winning+';') as output:
        corrected=json.loads(output)
        expect_refusal(execute(f,contender),'PT503','uncommitted competing correction')
    expect_refusal(execute(f,contender),'PT409','committed correction must refuse stale version')
    replay=result(execute(f,first_call))
    assert replay==original|{'replayed':True},'Retry after correction did not retain original result'
    current=json.loads(query(f"SELECT to_jsonb(t) FROM engagement_content_translations t WHERE id='{version(original)['id']}';"))
    assert current['translated_text']=='SYNTHETIC corrected','Contender replaced corrected wording'
    history=json.loads(query(f"SELECT jsonb_agg(record_json->>'translated_text' ORDER BY revision) FROM engagement_translation_history WHERE translation_id='{current['id']}';"))
    assert history[0]=='SYNTHETIC original' and history[-1]=='SYNTHETIC corrected','Original or corrected history missing'
    assert corrected['entries'][0]['revision']==observed['revision']+1,'Correction revision missing'
    return f

def source_change(delete=False):
    f=fixture()
    original=result(execute(f,command(f,[entry(f)])))
    pending=command(f,[entry(f,'SYNTHETIC old-source save',version(original))])
    sql=(f"DELETE FROM engagement_categories WHERE id='{f['category']}';" if delete else
         f"UPDATE engagement_categories SET label='SYNTHETIC changed source' WHERE id='{f['category']}';")
    with held(f,sql):
        expect_refusal(execute(f,pending),'PT503','uncommitted source change')
    expect_refusal(execute(f,pending),'PT409','committed source change must refuse stale source')
    if not delete:
        changed=result(execute(f,command(f,[entry(f,'SYNTHETIC current-source save',version(original),'SYNTHETIC changed source')])))
        assert changed['entries'][0]['entry']['translated_text']=='SYNTHETIC current-source save'
    else:
        assert query(f"SELECT count(*) FROM engagement_content_translations WHERE campaign_id='{f['campaign']}';")=='0','Deleted source left public wording'
        assert query(f"SELECT count(*) FROM engagement_translation_history WHERE translation_id='{version(original)['id']}' AND event='removed';")=='1','Source deletion lost retained removal'
    return f

def unauthorized_contention():
    f=fixture(); outsider=str(uuid.uuid4())
    query(f"INSERT INTO auth.users(id,aud,role,email) VALUES('{outsider}','authenticated','authenticated','{outsider}@translation-race.invalid');")
    f['outsider']=outsider
    call=command(f,[entry(f)])
    with held(f,'SELECT '+call+';'):
        expect_refusal(execute(f|{'actor':outsider},call),'42501','unauthorized caller must be refused before contention')
    return f

cases=[('competing-creations',creation),('competing-corrections',correction),
       ('acceptance-versus-correction',lambda:correction(True)),('source-update',source_change),
       ('source-delete',lambda:source_change(True)),('unauthorized-contention',unauthorized_contention)]
results=[]
try:
    for mode,body in [('baseline',definition),('harmless-comment',definition+'\n-- Harmless concurrency note.\n')]:
        query(body)
        for name,probe in cases:
            f=probe();results.append({'mode':mode,'case':name,'outcome':'survived','fixture':f})
    for name,old,new,probe,failure in [
      ('ignore-absence',"IF has_previous OR p_operation<>'save' THEN","IF p_operation<>'save' THEN",creation,'committed creation must refuse another absent claim'),
      ('ignore-current-version',"expected IS DISTINCT FROM jsonb_build_object('id',previous.id","false AND expected IS DISTINCT FROM jsonb_build_object('id',previous.id",correction,'committed correction must refuse stale version'),
      ('ignore-current-source',"IF actual_source IS DISTINCT FROM entry->'expectedSource' THEN",'IF false THEN',source_change,'committed source change must refuse stale source'),
      ('lose-original-retry',"RETURN receipt.result_json||jsonb_build_object('replayed',true);","RETURN '{}'::jsonb;",creation,'Exact retry changed its original receipt'),
      ('skip-access-before-lock',"IF NOT EXISTS(SELECT 1 FROM engagement_campaigns c JOIN workspace_members m ON m.workspace_id=c.workspace_id", "IF false AND NOT EXISTS(SELECT 1 FROM engagement_campaigns c JOIN workspace_members m ON m.workspace_id=c.workspace_id",unauthorized_contention,'unauthorized caller must be refused before contention'),
    ]:
        assert old in definition
        query(definition.replace(old,new,1))
        try:
            probe()
        except AssertionError as error:
            (private/(name+'.log')).write_text(str(error)+'\n')
            assert failure in str(error),str(error)
            results.append({'case':name,'outcome':'killed','expectedFailure':failure})
        else:
            raise AssertionError('Mutation survived: '+name)
finally:
    query(definition)
    (private/'retained-fixtures.json').write_text(json.dumps(fixtures,indent=2)+'\n')
report={'database':manifest['database'],'candidateSha256':hashlib.sha256(candidate.encode()).hexdigest(),
        'results':results,'limits':'Real SQL roles and concurrent sessions. No PostgREST, browser, worker, billable generation or all-producer retirement acceptance.'}
(review/'translation-command-race-results.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
