from pathlib import Path
import subprocess,json,time,re,uuid,os
root=Path('/home/nathaniel/.local/state/openplan/m2d4-period-closure-2026-09-09/openplan');out=Path('/home/nathaniel/.local/state/openplan/m2d4-period-closure-evidence-2026-09-09');fixture=json.loads(Path('/tmp/m2d4-settlement-browser-fixture.json').read_text());program=fixture['programId'];owner=fixture['ownerId'];report=fixture['reportId']
args=['docker','exec','-i','supabase_db_m2d3-reimbursement-verification','psql','-X','-U','postgres','-v','ON_ERROR_STOP=1','-At']
def sql(body,check=True):return subprocess.run(args,input=body,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=check)
def read():return json.loads(sql(f"SELECT public.read_work_program_closeout('{program}','{owner}','{report}');").stdout)
def command(name,body):return json.loads(sql(f"SELECT public.{name}('{program}','{owner}','{json.dumps(body)}'::jsonb);").stdout)
def envelope(data,kind):return dict(kind=kind,requestId=str(uuid.uuid4()),reportId=report,expectedVersion=data['records'][-1]['version'],sourceHash=data['sourceHash'],note='Synthetic race verification authority; no real agency decision')
def closure_version():return int(sql(f"SELECT coalesce(max(version),0) FROM public.work_program_period_closures WHERE program_id='{program}';").stdout)
source=(root/'supabase/migrations/20261005000001_work_program_period_closure.sql').read_text();guard=re.search(r'CREATE FUNCTION public.guard_closed_work_program_period\(\).*?END \$\$;',source,re.S).group().replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION')
results=[]
for name,body,expect_denied in [('harmless comment',guard+'\n-- harmless race control',True),('removed program lock',guard.replace('PERFORM 1 FROM public.programs WHERE id=p FOR UPDATE;','NULL;'),False)]:
 sql(body)
 try:
  data=read();assert data['records'][-1]['state']=='approved'
  sql(f"UPDATE public.invoicing_time_entries SET hours=hours WHERE work_program_id='{program}';")
  close={**envelope(data,'close_period'),'expectedClosureVersion':closure_version()}
  statement=f"SET application_name='m2d4-closure-race'; BEGIN; SELECT public.work_program_period_closure_command('{program}','{owner}','{json.dumps(close)}'::jsonb); SELECT pg_sleep(3); COMMIT;"
  process=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);process.stdin.write(statement);process.stdin.close()
  for attempt in range(60):
   sleeping=sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='m2d4-closure-race' AND wait_event='PgSleep';").stdout.strip()
   if sleeping=='1':break
   time.sleep(.05)
  else:raise RuntimeError('Closure race did not reach the sleeping transaction')
  started=time.monotonic();write=sql(f"UPDATE public.invoicing_time_entries SET hours=hours WHERE work_program_id='{program}';",False);elapsed=time.monotonic()-started
  process.wait();assert process.returncode==0,process.stderr.read()
  denied=write.returncode!=0 and 'accounting period is closed' in write.stderr
  assert denied==expect_denied,(name,write.stderr)
  if expect_denied:assert elapsed>1.5,elapsed
  results.append({'name':name,'writeDenied':denied,'seconds':round(elapsed,2),'mutationDetected':not expect_denied,'testMatchedExpected':True})
  command('work_program_period_closure_command',{**envelope(read(),'reopen_period'),'expectedClosureVersion':closure_version()})
  command('work_program_closeout_command',envelope(read(),'reopen'))
  command('work_program_closeout_command',envelope(read(),'approve'))
 finally:sql(guard)
(out/'concurrency-results.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(results,indent=2))
