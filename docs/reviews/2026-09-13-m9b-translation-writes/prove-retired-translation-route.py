"""Retired route refusal and current accept-batch contract fault controls."""
from pathlib import Path
import hashlib,json,re,subprocess,time
review=Path(__file__).resolve().parent;app=review.parents[2]/'openplan'
paths={'route':app/'src/app/api/engagement/campaigns/[campaignId]/translations/route.ts','write':app/'src/lib/engagement/translation-write.ts'}
original={key:path.read_text() for key,path in paths.items()}
tests=['src/test/engagement-translation-retired-route.test.ts','src/test/an-operator-can-author-a-campaigns-translations.test.tsx']
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/retired-translation-route-controls')/time.strftime('%Y%m%dT%H%M%S');private.mkdir(parents=True)
cases=[('baseline','route',original['route'],None)]
for key in paths:cases.append(('harmless-'+key,key,original[key]+'\n// Harmless retired route control.\n',None))
def mutate(name,key,old,new,expected):
 assert original[key].count(old)==1,(name,original[key].count(old))
 cases.append((name,key,original[key].replace(old,new),expected))
mutate('false-success','route','status: 410','status: 200','refuses legacy POST save')
mutate('cache-retirement','route','"private, no-store"','"public, max-age=3600"','refuses legacy DELETE')
mutate('redirect-legacy-body','route','"Cache-Control": "private, no-store"','"Cache-Control": "private, no-store", Location: "/api/engagement/campaigns/old/translations/commands"','refuses legacy POST save')
mutate('discard-unsaved-instructions','route','Keep a copy of any unsaved words, then reopen','Reopen','refuses legacy POST save')
mutate('claim-write-happened','route','This request did not change saved translations or request machine generation.','Saved and generated successfully.','refuses legacy POST publish_machine')
mutate('reflect-private-words','route','kind: "retired",','kind: "retired", reflected: "SYNTHETIC private unsaved words",','refuses legacy POST save')
mutate('consume-old-body','route','export function POST() { return retiredTranslationWrite(); }','export function POST(request: Request) { void request.text(); return retiredTranslationWrite(); }','refuses legacy POST save')
for name,module,dependency,verb,expected in [
 ('reopen-user-db','@/lib/supabase/server','createClient','POST','refuses legacy POST save'),
 ('reopen-service-db','@/lib/supabase/server','createServiceRoleClient','DELETE','refuses legacy DELETE'),
 ('call-model','@/lib/engagement/translation','translateEngagementText','POST','refuses legacy POST publish_machine')]:
 body='import { '+dependency+' } from "'+module+'";\n'+original['route'].replace('export function '+verb+'() { return','export function '+verb+'() { void '+dependency+'(); return')
 cases.append((name,'route',body,expected))
for size in (199,201):mutate('accept-cap-'+str(size),'write','TRANSLATION_WRITE_BATCH_MAX = 200','TRANSLATION_WRITE_BATCH_MAX = '+str(size),'bounds the accept button by the same constant the route enforces')
results=[];count=None
try:
 for name,key,body,expected in cases:
  assert all(path.read_text()==original[k] for k,path in paths.items());paths[key].write_text(body);out=private/(name+'.json')
  command=['npm','exec','--','vitest','run',*tests,'--reporter=json','--outputFile='+str(out)]
  if expected:command+=['-t',re.escape(expected)]
  try:run=subprocess.run(command,cwd=app,text=True,capture_output=True,timeout=45)
  finally:paths[key].write_text(original[key])
  (private/(name+'.log')).write_text(run.stdout+run.stderr);report=json.loads(out.read_text())
  assert report['numPassedTests']+report['numFailedTests']>0
  failed=[a['fullName'] for suite in report['testResults'] for a in suite['assertionResults'] if a['status']=='failed']
  if count is None:count=report['numPassedTests'];assert count>=40
  correct=run.returncode==0 and report['numPassedTests']==count if expected is None else run.returncode!=0 and any(expected in name for name in failed)
  results.append({'case':name,'outcome':'survived' if run.returncode==0 else 'killed','expectedFailure':expected,'failedAssertions':failed,'expectedOutcome':correct})
  (review/'retired-translation-route-controls.json').write_text(json.dumps({'sourceSha256':{k:hashlib.sha256(v.encode()).hexdigest() for k,v in original.items()},'testSha256':{t:hashlib.sha256((app/t).read_bytes()).hexdigest() for t in tests},'testCount':count,'privateEvidence':str(private),'results':results,'limits':'Native exported route refusal and current command parser batch limits with synthetic requests and mocked forbidden dependencies. Does not verify live middleware, database isolation, worker behavior, or browser navigation. Other active command invariants retain separate evidence.'},indent=2)+'\n')
  print(name,results[-1]['outcome'],'expected' if correct else 'UNEXPECTED',flush=True);assert correct,(name,failed)
finally:assert all(path.read_text()==original[k] for k,path in paths.items())
