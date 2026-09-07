import subprocess,json,uuid,time
from pathlib import Path
base=['docker','exec','-i','supabase_db_owp-review-verification','psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At']
def run(q):
 r=subprocess.run(base,input=q,text=True,capture_output=True)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout
p=str(uuid.uuid4());a=run("select id from auth.users where email='owp-review-owner@example.test'").strip();w=run("select workspace_id from public.programs where id='c21b0ea6-0046-4e01-ba09-141d8c2bb231'").strip()
run(f"INSERT INTO public.programs(id,workspace_id,title,program_type,cycle_name) VALUES('{p}','{w}','Synthetic concurrent save exercise','other','Engineering only');SELECT id FROM public.save_program_work_program_revision('{p}','{a}',0,'{uuid.uuid4()}', '{{\"schemaVersion\":1,\"elements\":[],\"agency\":\"Synthetic concurrency\"}}');")
results=[]
def race(label,q1,q2,second_success):
 first=subprocess.Popen(base,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 first.stdin.write("BEGIN;"+q1+";SELECT 'LOCK_ACQUIRED';SELECT pg_sleep(2);COMMIT;");first.stdin.close()
 while True:
  line=first.stdout.readline()
  if 'LOCK_ACQUIRED' in line:break
  if not line:raise RuntimeError(first.stderr.read())
 started=time.monotonic();second=subprocess.run(base,input='\\set VERBOSITY verbose\n'+q2+';',capture_output=True,text=True);elapsed=time.monotonic()-started
 first.wait();first_error=first.stderr.read()
 assert first.returncode==0,first_error
 assert (second.returncode==0)==second_success,second.stderr
 if not second_success:assert 'PT409' in second.stderr,second.stderr
 assert elapsed>=1,elapsed
 results.append({'case':label,'firstExit':first.returncode,'secondExit':second.returncode,'secondSQLSTATE':None if second_success else 'PT409','secondWaitSeconds':round(elapsed,2)})
q=lambda request,agency:f"SELECT id FROM public.save_program_work_program_revision('{p}','{a}',1,'{request}', '{{\"schemaVersion\":1,\"elements\":[],\"agency\":\"{agency}\"}}')"
race('simultaneous preparation edits',q(uuid.uuid4(),'First save'),q(uuid.uuid4(),'Second save'),False)
r=json.loads(run(f"select json_build_object('id',id,'hash',content_sha256) from public.program_work_program_revisions where program_id='{p}' and revision=2").strip())
def command(request,seq,note):return {'requestId':str(request),'expectedSequence':seq,'expectedRevision':2,'revisionId':r['id'],'revisionHash':r['hash'],'kind':'comment','note':note,'visibility':'internal','reviewerIds':[],'documentIds':[],'authority':'','scope':'','evidenceDate':None,'dueOn':None,'targetEventId':None}
def event(c):return f"SELECT id FROM public.record_work_program_event('{p}','{a}', '{json.dumps(c)}')"
race('simultaneous review decisions',event(command(uuid.uuid4(),0,'First comment')),event(command(uuid.uuid4(),0,'Second comment')),False)
same=event(command(uuid.uuid4(),1,'Same exact request'))
race('simultaneous exact request retry',same,same,True)
counts=json.loads(run(f"select json_build_object('revisions',(select count(*) from public.program_work_program_revisions where program_id='{p}'),'events',(select count(*) from public.program_work_program_events where program_id='{p}'))").strip());assert counts=={'revisions':2,'events':2},counts
out={'container':'supabase_db_owp-review-verification','program':p,'cases':results,'finalCounts':counts,'blindCategory':'Two-session serialization and exact retry, not load testing. SQL guard mutation proof is independently retained in A final evidence.'}
Path('/tmp/owp-review-concurrency.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out,indent=2))
