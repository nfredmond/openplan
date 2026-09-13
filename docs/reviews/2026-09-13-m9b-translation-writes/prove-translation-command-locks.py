"""Two-connection contention checks; command changes always roll back.

A dedicated, named synthetic source fixture is retained in the disposable DB.
No existing campaign or user is modified. Source-delete probes roll back too.
"""
from pathlib import Path
import json,os,select,subprocess,time,uuid

review=Path(__file__).parent
container='supabase_db_openplan-restore-target-2731143'
base=['docker','exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-A','-t','-q','-v','ON_ERROR_STOP=1']
def query(sql):
    return subprocess.check_output(base,input=sql,text=True,timeout=30).strip()
assert query("SELECT count(*)||':'||max(version) FROM supabase_migrations.schema_migrations;")=='328:20261014000009'
fixture_path=review/'translation-command-lock-fixture.json'
if not fixture_path.exists():
    fixture={name:str(uuid.uuid4()) for name in ['actor','workspace','campaign','category','otherCategory']}
    fixture['container']=container
    fixture['purpose']='SYNTHETIC retained source fixture for rollback-only translation command lock probes'
    fixture_path.write_text(json.dumps(fixture,indent=2)+'\n')
fixture=json.loads(fixture_path.read_text())
assert fixture['container']==container
actor,workspace,campaign,category,other=[str(uuid.UUID(fixture[k])) for k in ['actor','workspace','campaign','category','otherCategory']]
if query(f"SELECT count(*) FROM engagement_campaigns WHERE id='{campaign}';")=='0':
    query(f"""BEGIN;
INSERT INTO auth.users(id,aud,role,email) VALUES('{actor}','authenticated','authenticated','{actor}@translation-lock.invalid');
INSERT INTO workspaces(id,name,slug) VALUES('{workspace}','SYNTHETIC translation lock fixture','{workspace}');
INSERT INTO workspace_members(workspace_id,user_id,role) VALUES('{workspace}','{actor}','owner');
INSERT INTO engagement_campaigns(id,workspace_id,title,created_by) VALUES('{campaign}','{workspace}','SYNTHETIC translation lock fixture','{actor}');
INSERT INTO engagement_categories(id,campaign_id,label,slug) VALUES('{category}','{campaign}','SYNTHETIC target source','command-target'),('{other}','{campaign}','SYNTHETIC other source','command-other');
COMMIT;""")
assert query(f"SELECT count(*) FROM engagement_categories WHERE campaign_id='{campaign}' AND id IN ('{category}','{other}');")=='2'
source=(review.resolve().parents[2]/'openplan/supabase/migrations/20261014000010_engagement_translation_commands.sql').read_text()
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/translation-command-lock-controls')
private.mkdir(exist_ok=True)

def probe(name,lock_sql,want_busy,body):
    holder=subprocess.Popen(base,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
    assert holder.stdin and holder.stdout and holder.stderr
    try:
        holder.stdin.write("BEGIN; SET LOCAL statement_timeout='5s';\n"+lock_sql+";\n\\echo OPENPLAN_LOCK_READY\n")
        holder.stdin.flush()
        deadline=time.monotonic()+10
        # Read the descriptor directly: TextIOWrapper.read can buffer the marker
        # while select sees an empty OS pipe and waits forever.
        received=b''
        while True:
            remaining=deadline-time.monotonic()
            if remaining<=0: raise TimeoutError('Lock holder did not report readiness')
            ready,_,_=select.select([holder.stdout],[],[],remaining)
            if not ready: raise TimeoutError('Lock holder did not report readiness')
            chunk=os.read(holder.stdout.fileno(),4096)
            if not chunk: raise RuntimeError('Lock holder exited: '+holder.stderr.read())
            received+=chunk
            if b'OPENPLAN_LOCK_READY' in received.splitlines(): break
        expectation="IF code IS DISTINCT FROM 'PT503' THEN RAISE EXCEPTION 'Busy result expected PT503, got %',COALESCE(code,'accepted'); END IF;" if want_busy else "IF code IS NOT NULL OR result#>>'{entries,0,entry,translated_text}' IS DISTINCT FROM 'SYNTHETIC lock wording' THEN RAISE EXCEPTION 'Harmless lock prevented a valid write: %',code; END IF;"
        no_writes="IF EXISTS(SELECT 1 FROM engagement_content_translations WHERE campaign_id='"+campaign+"') OR EXISTS(SELECT 1 FROM engagement_translation_write_receipts WHERE campaign_id='"+campaign+"') THEN RAISE EXCEPTION 'Busy command retained partial writes'; END IF;" if want_busy else ''
        sql="BEGIN; SET LOCAL statement_timeout='3s';\n"+body+f"""
GRANT EXECUTE ON FUNCTION public.write_engagement_translations(uuid,uuid,text,text,text,jsonb) TO authenticated;
DO $probe$ DECLARE result jsonb; code text; BEGIN
PERFORM set_config('request.jwt.claim.sub','{actor}',true); SET LOCAL ROLE authenticated;
BEGIN result:=public.write_engagement_translations('{campaign}',gen_random_uuid(),'save','qaa',NULL,
jsonb_build_array(jsonb_build_object('entityType','category','entityId','{category}','field','label',
 'expectedSource',jsonb_build_object('text','SYNTHETIC target source','sourceLocale',NULL,'available',true),
 'expectedTranslation',NULL,'text','SYNTHETIC lock wording')));
EXCEPTION WHEN OTHERS THEN code:=SQLSTATE; END;
{expectation}
{no_writes}
RESET ROLE; END $probe$;
SELECT 'LOCK_PROBE_OK'; ROLLBACK;
"""
        started=time.monotonic()
        run=subprocess.run(base,input=sql,text=True,capture_output=True,timeout=15)
        elapsed=time.monotonic()-started
        output=run.stdout+run.stderr
        (private/(name+'.log')).write_text(output)
        return {'case':name,'exit':run.returncode,'seconds':round(elapsed,3),'passed':run.returncode==0 and 'LOCK_PROBE_OK' in output,'output':output}
    finally:
        if holder.poll() is None:
            holder.stdin.write('ROLLBACK;\n\\q\n'); holder.stdin.flush()
        holder.communicate(timeout=10)
        assert query("SELECT to_regclass('public.engagement_translation_write_receipts') IS NULL;")=='t'
        assert query(f"SELECT count(*) FROM engagement_content_translations WHERE campaign_id='{campaign}';")=='0'
        assert query(f"SELECT count(*) FROM engagement_categories WHERE campaign_id='{campaign}';")=='2'

cases=[
 ('unrelated-source-lock',f"SELECT id FROM engagement_categories WHERE id='{other}' FOR UPDATE",False),
 ('foreign-key-target-lock',f"SELECT id FROM engagement_categories WHERE id='{category}' FOR UPDATE",True),
 ('actual-source-delete',f"DELETE FROM engagement_categories WHERE id='{category}'",True),
 ('campaign-row-lock',f"SELECT id FROM engagement_campaigns WHERE id='{campaign}' FOR UPDATE",True),
 ('unrelated-advisory-lock',f"SELECT pg_advisory_xact_lock(hashtextextended('engagement-response:{uuid.uuid4()}',0))",False),
 ('source-advisory-lock',f"SELECT pg_advisory_xact_lock(hashtextextended('engagement-response:{campaign}',0))",True),
]
results=[]
for name,lock,busy in cases:
    result=probe(name,lock,busy,source)
    assert result['passed'],result
    result.pop('output'); results.append(result)
# A harmless source change must still survive the complete contention behavior.
result=probe('harmless-comment',cases[1][1],True,source+'\n-- Harmless contention comment.\n')
assert result['passed'],result
result.pop('output');results.append(result)
for name,old,new,target_case,expected_failure in [
 ('remove-bounded-fk-wait',"set_config('lock_timeout','100ms',true)","set_config('lock_timeout','0',true)",cases[1],'canceling statement due to statement timeout'),
 ('ignore-source-advisory',"NOT pg_try_advisory_xact_lock(hashtextextended('engagement-response:'||p_campaign::text,0))",'false',cases[5],'Busy result expected PT503'),
]:
    assert old in source
    result=probe(name,target_case[1],True,source.replace(old,new,1))
    assert not result['passed'] and expected_failure in result['output'],result
    result.pop('output');result['expectedMutationFailure']=True;results.append(result)
(review/'translation-command-migration-lock-results.json').write_text(json.dumps({'fixture':fixture,'results':results,'limits':'Actual row/advisory contention and rolled-back category deletion. No simultaneous successful corrections, real PostgREST, generation or browser-write acceptance yet.'},indent=2)+'\n')
print(json.dumps(results))
