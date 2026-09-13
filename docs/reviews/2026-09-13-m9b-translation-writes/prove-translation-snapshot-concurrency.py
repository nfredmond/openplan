"""Hold a real snapshot read across a committed source/translation correction."""
from pathlib import Path
import json,os,select,subprocess,time,uuid

review=Path(__file__).parent
root=review.resolve().parents[2]
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/translation-snapshot')
base=['docker','exec','-i','supabase_db_openplan-restore-target-2731143','psql','-U','postgres','-d','openplan_translation_command_proof_20260913','-X','-A','-t','-q','-v','ON_ERROR_STOP=1']
def query(sql):
    return subprocess.check_output(base,input=sql,text=True,timeout=15).strip()
def auth(actor):
    return f"SET LOCAL request.jwt.claim.sub='{actor}'; SET LOCAL ROLE authenticated;"
original=(root/'openplan/supabase/migrations/20261014000011_engagement_translation_snapshot.sql').read_text().replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1)
assert ' WITH categories AS MATERIALIZED (' in original
barrier=original.replace(' WITH categories AS MATERIALIZED (',' PERFORM pg_advisory_xact_lock(918273645);\n WITH categories AS MATERIALIZED (',1)

def probe(body):
    query(body)
    actor,workspace,campaign,translation=[str(uuid.uuid4()) for _ in range(4)]
    query(f"""BEGIN;
INSERT INTO auth.users(id,aud,role,email) VALUES('{actor}','authenticated','authenticated','{actor}@translation-snapshot-race.invalid');
INSERT INTO workspaces(id,name,slug) VALUES('{workspace}','SYNTHETIC snapshot race','{workspace}');
INSERT INTO workspace_members(workspace_id,user_id,role) VALUES('{workspace}','{actor}','owner');
INSERT INTO engagement_campaigns(id,workspace_id,title) VALUES('{campaign}','{workspace}','SYNTHETIC original source');
{auth(actor)}
INSERT INTO engagement_content_translations(id,workspace_id,campaign_id,entity_type,entity_id,field,locale,translated_text,source,created_by)
VALUES('{translation}','{workspace}','{campaign}','campaign','{campaign}','title','qaa','SYNTHETIC original translation','operator','{actor}');
COMMIT;""")
    holder=subprocess.Popen(base,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    assert holder.stdin and holder.stdout and holder.stderr
    reader=None
    try:
        holder.stdin.write('BEGIN; SELECT pg_advisory_xact_lock(918273645);\n\\echo SNAPSHOT_BARRIER_READY\n');holder.stdin.flush()
        received=b'';deadline=time.monotonic()+10
        while b'SNAPSHOT_BARRIER_READY' not in received.splitlines():
            remaining=deadline-time.monotonic(); assert remaining>0,'Barrier readiness timed out'
            ready,_,_=select.select([holder.stdout],[],[],remaining);assert ready,'Barrier readiness timed out'
            chunk=os.read(holder.stdout.fileno(),4096);assert chunk,'Barrier process exited'
            received+=chunk
        reader=subprocess.Popen(base,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        assert reader.stdin
        reader.stdin.write(f"BEGIN; SET LOCAL statement_timeout='10s'; SET LOCAL application_name='openplan-translation-snapshot-proof'; {auth(actor)} SELECT read_engagement_translation_snapshot('{campaign}'); COMMIT;\n\\q\n")
        reader.stdin.flush()
        deadline=time.monotonic()+8
        while query("SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.datname=current_database() AND a.application_name='openplan-translation-snapshot-proof' AND l.locktype='advisory' AND NOT l.granted;")!='1':
            assert reader.poll() is None,'Snapshot reader exited before waiting'
            assert time.monotonic()<deadline,'Snapshot reader did not reach the actual barrier'
            time.sleep(.05)
        # The reader has begun and passed its access check. Commit both changes
        # from an independent connection while that exact read remains live.
        query(f"""BEGIN; {auth(actor)}
UPDATE engagement_campaigns SET title='SYNTHETIC corrected source',default_content_locale='en' WHERE id='{campaign}';
UPDATE engagement_content_translations SET translated_text='SYNTHETIC corrected translation' WHERE id='{translation}';
COMMIT;""")
        holder.stdin.write('ROLLBACK;\n\\q\n');holder.stdin.flush();holder.communicate(timeout=10)
        output,error=reader.communicate(timeout=12)
        assert reader.returncode==0,error
        data=json.loads(output)
        assert data['campaign']['title']=='SYNTHETIC original source' and data['campaign']['default_content_locale'] is None and data['translations'][0]['translated_text']=='SYNTHETIC original translation' and data['translations'][0]['revision']==1,'Statement snapshot changed after a later commit'
        fresh=json.loads(query(f"BEGIN; {auth(actor)} SELECT read_engagement_translation_snapshot('{campaign}'); ROLLBACK;"))
        assert fresh['campaign']['title']=='SYNTHETIC corrected source' and fresh['translations'][0]['translated_text']=='SYNTHETIC corrected translation' and fresh['translations'][0]['revision']==2,'Fresh read did not observe the committed correction'
        return {'campaign':campaign,'originalReadRevision':1,'freshReadRevision':2}
    finally:
        if holder.poll() is None:
            holder.stdin.write('ROLLBACK;\n\\q\n');holder.stdin.flush();holder.communicate(timeout=10)
        if reader is not None and reader.poll() is None: reader.communicate(timeout=12)

results=[]
try:
    for name,body in [('baseline',barrier),('harmless-comment',barrier+'\n-- Harmless snapshot note.\n')]:
        results.append({'case':name,'outcome':'survived',**probe(body)})
    try: probe(barrier.replace('STABLE SECURITY DEFINER','VOLATILE SECURITY DEFINER',1))
    except AssertionError as error:
        (private/'volatile-snapshot.log').write_text(str(error)+'\n')
        assert str(error)=='Statement snapshot changed after a later commit',str(error)
        results.append({'case':'volatile-snapshot','outcome':'killed','expectedFailure':str(error)})
    else: raise AssertionError('Changing snapshot timing survived')
finally:
    query(original)
(review/'translation-snapshot-concurrency-results.json').write_text(json.dumps({'database':'openplan_translation_command_proof_20260913','results':results,'limits':'A controlled advisory barrier pauses the actual read after access checking. No arbitrary scheduler, HTTP concurrency or browser acceptance claim.'},indent=2)+'\n')
print(json.dumps(results))
