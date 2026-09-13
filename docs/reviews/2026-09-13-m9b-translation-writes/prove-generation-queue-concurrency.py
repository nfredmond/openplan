"""Retain synthetic concurrent queue evidence in the dedicated proof database.

No model calls, application database changes or fixture deletion. Temporary
function controls restore the original function and roll back their claims.
"""
from generation_schema_source import GenerationSection
from pathlib import Path
import hashlib,json,os,select,subprocess,time
review=Path(__file__).resolve().parent
app=review.parents[2]/'openplan'
source=GenerationSection('queue').read_text()
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/queue-concurrency')/time.strftime('%Y%m%dT%H%M%S')
private.mkdir(parents=True,exist_ok=False)
command=['docker','exec','-i','supabase_db_openplan-restore-target-2731143','psql','-X','-U','postgres','-d','openplan_translation_command_proof_20260913','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
def literal(value): return "'"+str(value).replace("'","''")+"'"
def sql(statement,label):
 run=subprocess.run(command,input=statement,text=True,capture_output=True,timeout=10)
 (private/(label+'.log')).write_text(run.stdout+run.stderr)
 return {'code':run.returncode,'out':run.stdout,'error':run.stderr}
def must(statement,label):
 result=sql(statement,label); assert result['code']==0,(label,result); return result['out'].strip()
def invoke(expression,label,rollback=False):
 return sql('BEGIN; SET LOCAL statement_timeout=\'3s\'; SET LOCAL ROLE service_role; SELECT '+expression+'; '+('ROLLBACK;' if rollback else 'COMMIT;'),label)
def parsed(result):
 assert result['code']==0,result
 lines=result['out'].strip().splitlines()
 return json.loads(lines[-1]) if lines and lines[-1] else None

generated=subprocess.run(['npm','exec','--','tsx',str(review/'generation-queue-fixture.ts')],cwd=app,text=True,capture_output=True,timeout=30)
assert generated.returncode==0,generated.stderr
f=json.loads(generated.stdout)
(private/'fixture.json').write_text(json.dumps(f,indent=2)+'\n')
w,c,a,v,o,r=[f[key] for key in ['workspaceId','campaignId','actorId','viewerId','outsiderId','requestId']]
setup='BEGIN;\n'
for user in [a,v,o]: setup+=f"INSERT INTO auth.users(id,aud,role,email) VALUES({literal(user)},'authenticated','authenticated',{literal(user+'@queue-concurrency.invalid')});\n"
setup+=f"INSERT INTO workspaces(id,name,slug) VALUES({literal(w)},'SYNTHETIC concurrent queue',{literal(w)});\n"
setup+=f"INSERT INTO workspace_members(workspace_id,user_id,role) VALUES({literal(w)},{literal(a)},'owner'),({literal(w)},{literal(v)},'viewer');\n"
setup+=f"INSERT INTO engagement_campaigns(id,workspace_id,title,summary,created_by,default_content_locale) VALUES({literal(c)},{literal(w)},{literal(f['source'])},{literal(f['source'])},{literal(a)},NULL);\n"
setup+=f"INSERT INTO workspace_integration_keys(workspace_id,provider,key_ciphertext,key_last4,configured_by) VALUES({literal(w)},'anthropic',{literal(f['keyCiphertext'])},'-KEY',{literal(a)}); COMMIT;"
must(setup,'setup')
create='create_translation_generation_request('+','.join(map(literal,[r,a,c,'es',json.dumps(f['fields']),json.dumps(f['credential']),f['selectedKeyHash']]))+')'
def overlapping_calls(expression,label):
 # The first transaction remains open after its actual write, so the second
 # caller demonstrably encounters its lock. It then retries the same request.
 first=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 try:
  first.stdin.write(("BEGIN; SET LOCAL ROLE service_role; SELECT "+expression+"; SELECT 'OVERLAP_READY';\n").encode());first.stdin.flush()
  observed=b''; deadline=time.monotonic()+5
  while b'OVERLAP_READY' not in observed:
   assert first.poll() is None,'First transaction ended before readiness'
   assert time.monotonic()<deadline,'First transaction readiness timed out'
   ready,_,_=select.select([first.stdout],[],[],0.1)
   if ready: observed+=os.read(first.stdout.fileno(),4096)
  (private/(label+'-first-ready.log')).write_bytes(observed)
  first_value=json.loads(next(line for line in observed.decode().splitlines() if line.startswith('{')))
  second=invoke(expression,label+'-contended')
  assert second['code']!=0 and 'PT503' in second['error'],(label,second)
  assert first.poll() is None,'First transaction was not held through contention'
  first.stdin.write(b'COMMIT;\n');first.stdin.flush()
  first.stdin.close();first.stdin=None
  stdout,stderr=first.communicate(timeout=5)
  (private/(label+'-first-commit.log')).write_bytes(stdout+stderr)
  assert first.returncode==0,(label,stderr)
  retry=invoke(expression,label+'-same-request-retry')
  return first_value,parsed(retry)
 finally:
  if first.poll() is None:
   first.stdin.write(b'ROLLBACK;\n');first.stdin.flush();first.stdin.close();first.stdin=None
   first.communicate(timeout=5)

results=[]
created=overlapping_calls(create,'create')
assert [x['created'] for x in created]==[True,False],created
results.append({'case':'overlapping-identical-create','firstTransactionHeld':True,'secondReturnedBusy':True,'requestsCreated':1,'retryRetainedOriginal':True})
field=f['fields'][0]['id']; second=f['fields'][1]['id']
job,other=overlapping_calls('claim_translation_generation_field('+literal(field)+')','claim')
assert job['state']=='reserved' and other is None,(job,other)
results.append({'case':'overlapping-claim','firstTransactionHeld':True,'secondReturnedBusy':True,'claims':1,'retryClaim':None})
dispatch='authorize_translation_generation_dispatch('+','.join(map(literal,[field,job['attempt_id'],job['reservation_id']]))+')'
acks=overlapping_calls(dispatch,'dispatch')
assert acks[0]==acks[1] and acks[0]['state']=='running',acks
count=int(must('SELECT count(*) FROM usage_events WHERE workspace_id='+literal(w)+';','event-count'))
assert count==1,count
results.append({'case':'overlapping-dispatch-acknowledgement','firstTransactionHeld':True,'secondReturnedBusy':True,'identicalAcknowledgements':True,'events':count})

start=source.index('CREATE FUNCTION public.lock_translation_generation_scope')
end=source.index('END $$;',start)+len('END $$;')
original=source[start:end].replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1)
harmless=original.replace('BEGIN\n','BEGIN\n -- Harmless lock control.\n',1)
broken=original.replace("IF NOT pg_try_advisory_xact_lock(hashtextextended('engagement-response:'||p_campaign::text,0)) THEN",'IF false THEN',1)
assert broken!=original
holder=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
try:
 holder.stdin.write(("BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('engagement-response:'||"+literal(c)+"::text,0)); SELECT 'QUEUE_LOCK_READY';\n").encode());holder.stdin.flush()
 deadline=time.monotonic()+5; observed=b''
 while b'QUEUE_LOCK_READY' not in observed:
  assert holder.poll() is None,'Lock holder ended before readiness'
  assert time.monotonic()<deadline,'Lock holder readiness timed out'
  ready,_,_=select.select([holder.stdout],[],[],0.1)
  if ready: observed+=os.read(holder.stdout.fileno(),4096)
 (private/'holder-ready.log').write_bytes(observed)
 for name,body,expected_busy in [('baseline-lock',original,True),('harmless-lock',harmless,True),('removed-advisory-lock',broken,False)]:
  must(body,name+'-install')
  begin=time.monotonic(); result=invoke('claim_translation_generation_field('+literal(second)+')',name,rollback=True); elapsed=time.monotonic()-begin
  busy=result['code']!=0 and 'PT503' in result['error']
  if expected_busy: assert busy and elapsed<2,(name,result,elapsed)
  else: assert result['code']==0 and parsed(result)['state']=='reserved',(name,result)
  results.append({'case':name,'guardOutcome':'survived' if busy else 'killed','returnedBusy':busy,'seconds':elapsed,'expectedOutcome':busy==expected_busy})
finally:
 restored=sql(original,'restore-lock-function')
 if holder.poll() is None:
  holder.stdin.write(b'ROLLBACK;\n');holder.stdin.flush()
 holder.stdin.close();holder.stdin=None
 stdout,stderr=holder.communicate(timeout=5)
 (private/'holder.log').write_bytes(stdout+stderr)
 assert holder.returncode==0 and restored['code']==0,(holder.returncode,restored)

state=must('SELECT state FROM engagement_translation_generation_fields WHERE id='+literal(second)+';','second-field-state')
assert state=='queued',state
body=must("SELECT pg_get_functiondef('public.lock_translation_generation_scope(uuid,uuid)'::regprocedure);",'restored-definition')
assert "IF NOT pg_try_advisory_xact_lock" in body and 'Harmless lock control' not in body
report={'sourceSha256':hashlib.sha256(source.encode()).hexdigest(),'database':'supabase_db_openplan-restore-target-2731143/openplan_translation_command_proof_20260913',
 'privateEvidence':str(private),'fixtureRequestId':r,'results':results,'functionRestored':True,'rolledBackControlFieldState':state,
 'limits':'Synthetic service-role SQL requests and independent psql sessions. No provider call, process restart, completed output delivery, public generation queue or browser workflow. Installed only in a separate proof database; synthetic records retained.'}
(review/'generation-queue-concurrency.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
