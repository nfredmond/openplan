"""Fault controls for publication command transport and retained acknowledgement.

Runs only native route/helper tests. Database authorization and browser recovery
are separate evidence. Every edited source is restored before the next case.
"""
from pathlib import Path
import hashlib, json, re, subprocess, time
review=Path(__file__).resolve().parent; app=review.parents[2]/'openplan'
paths={'route':app/'src/app/api/engagement/campaigns/[campaignId]/translations/commands/route.ts',
       'server':app/'src/lib/engagement/translation-publication-server.ts',
       'read':app/'src/lib/engagement/translation-generation-read.ts'}
original={key:path.read_text() for key,path in paths.items()}
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/publication-command-controls')/time.strftime('%Y%m%dT%H%M%S');private.mkdir(parents=True)
cases=[('baseline','server',original['server'],None)]
for key in paths:cases.append(('harmless-'+key,key,original[key]+'\n// Harmless publication command control.\n',None))
def mutate(name,key,old,new,test):
 assert original[key].count(old)==1,(name,original[key].count(old),old)
 cases.append((name,key,original[key].replace(old,new),test))
mutate('origin','route','requireProviderBrowserOrigin(request);','void request;','refuses foreign origin')
for marker in ['execution-source','input-hash','approval-id']:
 mutate('agent-'+marker,'route','"x-openplan-assistant-'+marker+'"','"x-ignored-'+marker+'"','refuses even empty unregistered agent marker x-openplan-assistant-'+marker)
mutate('publisher','route','publisherId: user.id','publisherId: params.data.campaignId','publishes once with the authenticated publisher')
mutate('publication-join','route','parsed.data.operation === "publish_generated"','false','publishes once with the authenticated publisher')
mutate('parse-publication','route','z.union([translationWriteIntentSchema, translationPublicationIntentSchema]).safeParse(raw)','translationWriteIntentSchema.safeParse(raw)','publishes once with the authenticated publisher')
mutate('input-validation','server','if (!parsed.success)','if (false)','validates direct helper input')
mutate('replace-request','server','p_request: intent.requestId','p_request: crypto.randomUUID()','publishes once with the authenticated publisher')
mutate('ignore-refusal','server','if (reply.error)','if (false)','preserves transaction refusal PT409')
mutate('trust-receipt','server','readTranslationPublicationResult(reply.data, scope, intent, retained)','reply.data','withholds a receipt when words')
mutate('source-checksum','server','saved.entry.source_text_hash !== createHash("sha256").update(expected.expectedSource.text!.trim(), "utf8").digest("hex")','false','withholds a receipt when source_checksum')
mutate('skip-generation','server','loadTranslationGenerationRequest(client, { campaignId: scope.campaignId, workspaceId: scope.workspaceId, requestId }, deadline)','Promise.resolve({})','publishes once with the authenticated publisher')
mutate('deduplicate','server','[...new Set(intent.entries.map(entry => entry.generation.requestId))]','intent.entries.map(entry => entry.generation.requestId)','publishes once with the authenticated publisher')
mutate('concurrency','server','ids.slice(offset, offset + 8)','ids.slice(offset, offset + 9)','bounds concurrent evidence reads')
mutate('omit-batch','server','offset < ids.length','offset < Math.min(ids.length, 8)','bounds concurrent evidence reads')
mutate('total-timeout','server','AbortSignal.timeout(20000)','AbortSignal.timeout(20001)','stops after the shared command deadline')
mutate('omit-read-deadline','server','requestId }, deadline)','requestId })','passes the same total deadline')
mutate('ignore-final-deadline','server','    deadline.throwIfAborted();\n    const result =','    const result =','passes the same total deadline')
mutate('ignore-caller-deadline','read','signal ? AbortSignal.any([signal, deadline]) : deadline','deadline','passes the same total deadline')
mutate('start-aborted-read','read','  readSignal.throwIfAborted();','  // Removed preflight check.','does not start a generation RPC')
results=[];count=None
try:
 for name,key,body,expected in cases:
  assert all(path.read_text()==original[k] for k,path in paths.items())
  paths[key].write_text(body);out=private/(name+'.json')
  command=['npm','exec','--','vitest','run','src/test/translation-publication-command.test.ts','--reporter=json','--outputFile='+str(out)]
  if expected:command+=['-t',re.escape(expected)]
  try:run=subprocess.run(command,cwd=app,text=True,capture_output=True,timeout=40)
  finally:paths[key].write_text(original[key])
  (private/(name+'.log')).write_text(run.stdout+run.stderr)
  report=json.loads(out.read_text());assert report['numPassedTests']+report['numFailedTests']>0
  failed=[a['fullName'] for suite in report['testResults'] for a in suite['assertionResults'] if a['status']=='failed']
  if count is None:count=report['numPassedTests'];assert count>=28
  correct=run.returncode==0 and report['numPassedTests']==count if expected is None else run.returncode!=0 and any(expected in f for f in failed)
  results.append({'case':name,'outcome':'survived' if run.returncode==0 else 'killed','expectedFailure':expected,'failedAssertions':failed,'expectedOutcome':correct})
  (review/'publication-command-controls.json').write_text(json.dumps({'sourceSha256':{k:hashlib.sha256(v.encode()).hexdigest() for k,v in original.items()},'testSha256':hashlib.sha256((app/'src/test/translation-publication-command.test.ts').read_bytes()).hexdigest(),'testCount':count,'privateEvidence':str(private),'results':results,'limits':'Native POST and helper using actual output codec/readers with mocked authenticated RPC transport. Does not establish SQL privileges, concurrent writes, browser recovery or provider execution.'},indent=2)+'\n')
  print(name,results[-1]['outcome'],'expected' if correct else 'UNEXPECTED',flush=True);assert correct,(name,failed)
finally:assert all(path.read_text()==original[k] for k,path in paths.items())
