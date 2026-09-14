"""Exercise the installed public-queue RLS test with reversible transaction faults."""
from pathlib import Path
import subprocess,json,hashlib,time,os
review=Path(__file__).resolve().parent;app=review.parents[2]/'openplan';fixture=app/'src/test/fixtures/engagement/public-translation-queue.sql';original=fixture.read_text()
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/public-installed-rls-controls')/time.strftime('%Y%m%dT%H%M%S');private.mkdir(parents=True)
base="ALTER TABLE public.engagement_public_translation_requests DISABLE ROW LEVEL SECURITY;\n"
cases=[('baseline',original,None),('harmless-comment',original+'\n-- Harmless installed RLS control.\n',None),('grant-without-policy', 'GRANT SELECT ON public.engagement_public_translation_requests TO anon;\n'+original,None),('anonymous-rows',base+'GRANT SELECT ON public.engagement_public_translation_requests TO anon;\n'+original,'Private public queue leak: anonymous authority rows'),('authenticated-rows',base+'GRANT SELECT ON public.engagement_public_translation_requests TO authenticated;\n'+original,'Private public queue leak: authenticated authority rows')]
env={**os.environ,'OPENPLAN_RLS_LIVE_TEST':'1','OPENPLAN_SUPABASE_WORKDIR':'/home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050'}
results=[]
try:
 for name,body,expected in cases:
  output=private/(name+'.json');fixture.write_text(body)
  try:run=subprocess.run(['npm','exec','--','vitest','run','src/test/engagement-public-translation-queue-rls.test.ts','--reporter=json','--outputFile='+str(output)],cwd=app,env=env,capture_output=True,text=True,timeout=45)
  finally:fixture.write_text(original)
  log=run.stdout+run.stderr;(private/(name+'.log')).write_text(log);report=json.loads(output.read_text())
  correct=run.returncode==0 and report['numPassedTests']==1 if expected is None else run.returncode!=0 and report['numFailedTests']==1 and expected in log
  results.append({'case':name,'outcome':'survived' if run.returncode==0 else 'killed','expectedFailure':expected,'expectedOutcome':correct});print(name,correct,flush=True);assert correct,name
finally:
 assert fixture.read_text()==original
 (review/'public-installed-rls-controls.json').write_text(json.dumps({'fixtureSha256':hashlib.sha256(original.encode()).hexdigest(),'privateEvidence':str(private),'results':results,'limits':'Installed native database roles with rollback-contained fixtures and permission changes. No actual browser bearer-token or remote PostgREST privacy proof. Public source, queue and retry semantics use the same fixture covered by the separate SQL mutation suite.'},indent=2)+'\n')
