"""Concurrent public creation and budget evidence in an isolated proof database.

Creates retained synthetic fixtures, never provider calls. Mutated claim bodies
are restored in finally; contested budget claims roll back on both connections.
"""
from pathlib import Path
import hashlib,json,os,select,subprocess,time,uuid
review=Path(__file__).resolve().parent
source=(review/'public-generation-queue-candidate.sql').read_text()
probe=(review/'public-generation-queue-probe.sql').read_text()
helper=probe[probe.index('CREATE FUNCTION pg_temp.queue_public_fixture'):probe.index('DO $probe$')]
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/public-queue-concurrency')/time.strftime('%Y%m%dT%H%M%S')
private.mkdir(parents=True,exist_ok=False)
command=['docker','exec','-i','supabase_db_openplan-restore-target-2026091050','psql','-X','-U','supabase_admin','-d','openplan_public_translation_proof_20260913','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
def literal(value):return "'"+str(value).replace("'","''")+"'"
def sql(statement,label):
 run=subprocess.run(command,input=statement,text=True,capture_output=True,timeout=20)
 (private/(label+'.log')).write_text(run.stdout+run.stderr)
 return {'code':run.returncode,'out':run.stdout,'error':run.stderr}
def must(statement,label):
 r=sql(statement,label);assert r['code']==0,(label,r);return r['out'].strip()
def call(expression,label,commit=False):
 return sql("BEGIN; SET LOCAL statement_timeout='3s'; "+helper+" SET LOCAL ROLE service_role; SELECT "+expression+'; '+('COMMIT;' if commit else 'ROLLBACK;'),label)
def parsed(r):
 assert r['code']==0,r
 return json.loads(r['out'].strip().splitlines()[-1])
def begin_held(expression,label):
 p=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 p.stdin.write(("BEGIN; SET LOCAL statement_timeout='3s'; "+helper+" SET LOCAL ROLE service_role; SELECT "+expression+"; SELECT 'PUBLIC_OVERLAP_READY';\n").encode());p.stdin.flush()
 observed=b'';deadline=time.monotonic()+10
 try:
  while b'PUBLIC_OVERLAP_READY' not in observed:
   assert p.poll() is None,'Held connection exited before readiness'
   assert time.monotonic()<deadline,'Held connection readiness timed out'
   ready,_,_=select.select([p.stdout],[],[],0.1)
   if ready:observed+=os.read(p.stdout.fileno(),4096)
  (private/(label+'-held.log')).write_bytes(observed)
  return p,json.loads(next(line for line in observed.decode().splitlines() if line.startswith('{')))
 except BaseException:
  finish(p,label,False)
  raise

def finish(p,label,commit=False):
 if p.poll() is None:
  p.stdin.write(b'COMMIT;\n' if commit else b'ROLLBACK;\n');p.stdin.flush();p.stdin.close();p.stdin=None
 out,err=p.communicate(timeout=10);(private/(label+'-end.log')).write_bytes(out+err)
 assert p.returncode==0,(label,err)

def setup(label,count=1):
 w,a,c,d=[str(uuid.uuid4()) for _ in range(4)];token='SYNTHETIC-public-'+c;other='SYNTHETIC-public-'+d
 statement='BEGIN;\n'+helper
 statement+=f"INSERT INTO auth.users(id,aud,role,email) VALUES({literal(a)},'authenticated','authenticated',{literal(a+'@public-concurrency.invalid')});\n"
 statement+=f"INSERT INTO workspaces(id,name,slug) VALUES({literal(w)},'SYNTHETIC public concurrency',{literal(w)});\n"
 statement+=f"INSERT INTO workspace_members(workspace_id,user_id,role) VALUES({literal(w)},{literal(a)},'owner');\n"
 statement+=f"INSERT INTO engagement_campaigns(id,workspace_id,title,created_by,status,share_token) VALUES({literal(c)},{literal(w)},'SYNTHETIC public concurrency',{literal(a)},'active',{literal(token)}),({literal(d)},{literal(w)},'SYNTHETIC other campaign',{literal(a)},'active',{literal(other)});\n"
 items=[str(uuid.uuid4()) for _ in range(count)]
 for i,item in enumerate(items):
  campaign=d if i==count-1 and count>1 else c
  statement+=f"INSERT INTO engagement_items(id,campaign_id,body,status,source_type) VALUES({literal(item)},{literal(campaign)},'SYNTHETIC concurrent original','approved','internal');\n"
 statement+='COMMIT;'
 must(statement,label+'-setup')
 return {'workspace':w,'campaign':c,'otherCampaign':d,'token':token,'otherToken':other,'items':items}

def creation(f,index=0):
 other=index==len(f['items'])-1 and len(f['items'])>1
 return 'pg_temp.queue_public_fixture('+','.join(map(literal,[f['otherCampaign'] if other else f['campaign'],f['items'][index],f['otherToken'] if other else f['token']]))+')'

results=[]
f=setup('deduplication')
held,value=begin_held(creation(f),'create')
try:
 contention=call(creation(f),'create-contended')
 assert held.poll() is None
 assert contention['code']!=0 and 'PT503' in contention['error'],contention
finally:finish(held,'create',True)
retry=parsed(call(creation(f),'create-retry',True))
assert value['ack']['created'] is True and retry['ack']=={'requestId':value['request'],'created':False},(value,retry)
count=int(must('SELECT count(*) FROM engagement_public_translation_requests WHERE campaign_id='+literal(f['campaign'])+';','create-count'))
assert count==1,count
results.append({'case':'overlapping-create','originalTransactionHeld':True,'competingResponse':'PT503','retrySameRequest':True,'retainedRequests':count})

start=source.index('CREATE OR REPLACE FUNCTION public.claim_translation_generation_field(');end=source.index('END $$;',start)+len('END $$;')
original=source[start:end]
lock="PERFORM pg_advisory_xact_lock(hashtextextended(CASE WHEN request.authority_kind='public' THEN 'public_translation_dispatch:' ELSE 'assistant_api_dispatch:' END||request.workspace_id::text,0));"
assert original.count(lock)==1
cases=[('baseline',original,False),('harmless-comment',original+'\n-- Harmless concurrent budget control.\n',False),('remove-budget-lock',original.replace(lock,'NULL;'),True)]
try:
 for name,body,broken in cases:
  must(body,name+'-function')
  f=setup(name,31)
  jobs=[parsed(call(creation(f,i),name+'-queue-'+str(i),True)) for i in range(31)]
  # Reserve the first 29 in committed, independent calls. Two slots compete for
  # the final public place from different campaigns in the same workspace.
  for i,job in enumerate(jobs[:29]):
   claim=parsed(call('claim_translation_generation_field('+literal(job['field'])+')',name+'-reserve-'+str(i),True))
   assert claim['state']=='reserved',claim
  held,value=begin_held('claim_translation_generation_field('+literal(jobs[29]['field'])+')',name)
  try:
   assert value['state']=='reserved',value
   contention=call('claim_translation_generation_field('+literal(jobs[30]['field'])+')',name+'-competing')
   assert held.poll() is None
   if broken:
    assert parsed(contention)['state']=='reserved',contention
   else:
    assert contention['code']!=0 and 'PT503' in contention['error'],contention
  finally:finish(held,name,False)
  # Rollback frees the last place; it can be claimed exactly once afterward.
  final=parsed(call('claim_translation_generation_field('+literal(jobs[30]['field'])+')',name+'-after-release',True))
  assert final['state']=='reserved',final
  rejected=call('claim_translation_generation_field('+literal(jobs[29]['field'])+')',name+'-over-limit')
  assert rejected['code']!=0 and 'PT429' in rejected['error'],rejected
  events=int(must('SELECT count(*) FROM usage_events WHERE workspace_id='+literal(f['workspace'])+';',name+'-events'))
  assert events==0,events
  results.append({'case':name,'outcome':'killed' if broken else 'survived','originalTransactionHeld':True,'crossCampaignCompetition':True,'competingResponse':'reserved without required serialization' if broken else 'PT503','afterRelease':'reserved','overLimit':'PT429','providerDispatchEvents':events,'expectedOutcome':True})
finally:
 must(original,'restored-function')
 installed=must("SELECT pg_get_functiondef('public.claim_translation_generation_field(uuid)'::regprocedure);",'restored-definition')
 assert lock in installed and "IF recent_dispatches+active_reservations>=allowance THEN" in installed
 (review/'public-generation-concurrency-evidence.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(source.encode()).hexdigest(),'privateEvidence':str(private),'database':'openplan_public_translation_proof_20260913','results':results,'claimFunctionRestored':True,'limits':'Real overlapping PostgreSQL transactions with synthetic unopenable credentials. No provider calls, actual worker/browser recovery or application migration. Synthetic queue rows remain in this schema-only proof database, which must never be connected to a worker.'},indent=2)+'\n')
print(json.dumps(results,indent=2))
