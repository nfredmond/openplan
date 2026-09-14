"""Pending publication storage and component controls, separate from real navigation."""
from pathlib import Path
import hashlib,json,re,subprocess,time
review=Path(__file__).resolve().parent;app=review.parents[2]/'openplan'
paths={'pending':app/'src/lib/engagement/pending-translation.ts','publication':app/'src/lib/engagement/translation-publication.ts','recovery':app/'src/components/engagement/translation-write-recovery.tsx','draft':app/'src/components/engagement/translation-draft-recovery.tsx'}
original={k:p.read_text() for k,p in paths.items()};private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/pending-publication-controls')/time.strftime('%Y%m%dT%H%M%S');private.mkdir(parents=True)
cases=[('baseline','pending',original['pending'],None)]
for k in paths:cases.append(('harmless-'+k,k,original[k]+'\n// Harmless pending publication control.\n',None))
def mutate(name,key,old,new,test):
 assert original[key].count(old)==1,(name,original[key].count(old),old)
 cases.append((name,key,original[key].replace(old,new),test))
mutate('retain-unbound-output','pending','readTranslationPublicationSelection(pending, pending.intent, pending.retained);','void pending;','rejects missing or changed viewed generation source')
mutate('ignore-extra-request','publication','requests.some(request => !intent.entries.some(entry => entry.generation.requestId === request.requestId)) ||','false ||','refuses ambiguous retained selection extra_request')
mutate('ignore-ambiguous-field','publication','requests.some(request => new Set(request.fields.map(field => field.id)).size !== request.fields.length)','false','refuses ambiguous retained selection duplicate_field')
mutate('trust-publication-ack','pending','readTranslationPublicationResult(data, { campaignId: pending.campaignId,\n    workspaceId: pending.workspaceId, publisherId: pending.userId }, pending.intent, pending.retained)','data as TranslationPublicationResult','confirms against viewed evidence before clearing recovery')
mutate('replace-viewed-output','pending','return canonicalizeActionPayload(fixed);','return canonicalizeActionPayload({ ...fixed, retained: undefined });','does not overwrite or clear a frozen publication with changed words')
mutate('display-earlier-words','pending','return reference && pending.retained.find(request => request.requestId === reference.requestId)?.fields.find(field => field.id === reference.fieldId)?.output?.text;','return pending.before[index]?.entry.translated_text;','round-trips exact viewed words')
mutate('use-field-array-index','pending','?.fields.find(field => field.id === reference.fieldId)','?.fields[index]','round-trips exact viewed words')
for name,position,test in [('archive-words',0,'preserves refused generated words in the archive'),('active-words',1,'retains exact publication after in-flight storage deletion')]:
 old='pendingTranslationWords(value, index)';assert original['recovery'].count(old)==2
 chunks=original['recovery'].split(old);chunks[position]+='value.before[index]?.entry.translated_text';body=chunks[0]+('' if position==0 else old)+chunks[1]+('' if position==1 else old)+chunks[2]
 cases.append((name,'recovery',body,test))
mutate('rebase-as-operator-draft','draft','if (pending.intent.operation === "publish_generated") return;','if (false) return;','preserves refused generated words in the archive')
results=[];count=None
try:
 for name,key,body,expected in cases:
  assert all(p.read_text()==original[k] for k,p in paths.items());paths[key].write_text(body);out=private/(name+'.json')
  cmd=['npm','exec','--','vitest','run','src/test/pending-translation-publication.test.tsx','--reporter=json','--outputFile='+str(out)]
  if expected:cmd+=['-t',re.escape(expected)]
  try:run=subprocess.run(cmd,cwd=app,text=True,capture_output=True,timeout=40)
  finally:paths[key].write_text(original[key])
  (private/(name+'.log')).write_text(run.stdout+run.stderr);report=json.loads(out.read_text());assert report['numPassedTests']+report['numFailedTests']>0
  failed=[a['fullName'] for suite in report['testResults'] for a in suite['assertionResults'] if a['status']=='failed']
  if count is None:count=report['numPassedTests'];assert count>=26
  correct=run.returncode==0 and report['numPassedTests']==count if expected is None else run.returncode!=0 and any(expected in f for f in failed)
  results.append({'case':name,'outcome':'survived' if run.returncode==0 else 'killed','expectedFailure':expected,'failedAssertions':failed,'expectedOutcome':correct})
  (review/'pending-publication-controls.json').write_text(json.dumps({'sourceSha256':{k:hashlib.sha256(v.encode()).hexdigest() for k,v in original.items()},'testSha256':hashlib.sha256((app/'src/test/pending-translation-publication.test.tsx').read_bytes()).hexdigest(),'testCount':count,'privateEvidence':str(private),'results':results,'limits':'Schema, exact browser-storage identity and React recovery behavior in jsdom with synthetic verified-read DTOs and mocked HTTP. Does not prove real navigation, rendered geometry, SQL, worker execution or the unfinished editor generation producer.'},indent=2)+'\n')
  print(name,results[-1]['outcome'],'expected' if correct else 'UNEXPECTED',flush=True);assert correct,(name,failed)
finally:assert all(p.read_text()==original[k] for k,p in paths.items())
