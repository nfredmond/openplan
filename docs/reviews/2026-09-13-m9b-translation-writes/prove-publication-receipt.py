"""Native publication receipt controls, separate from SQL authorization proof."""
from pathlib import Path
import hashlib,json,re,subprocess,time
review=Path(__file__).resolve().parent;app=review.parents[2]/'openplan'
source=app/'src/lib/engagement/translation-publication.ts';test=app/'src/test/translation-publication.test.ts';original=source.read_text()
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/publication-receipt-controls')/time.strftime('%Y%m%dT%H%M%S');private.mkdir(parents=True)
cases=[('baseline',original,None),('harmless',original+'\n// Harmless publication receipt control.\n',None)]
def mutate(name,old,new,expected):
 assert original.count(old)==1,(name,original.count(old),old)
 cases.append((name,original.replace(old,new),expected))
for name,expr in [('duplicate_address','addresses.has(address) ||'),('duplicate_field','fields.has(entry.generation.fieldId) ||'),('unavailable','!entry.expectedSource.available ||')]:
 mutate('intent-'+name,expr,'false ||','refuses publication intent '+name)
mutate('intent-blank-source','!entry.expectedSource.text?.trim()','false','refuses publication intent blank_source')
mutate('intent-reason','value.trim().length > 0 &&','true &&','refuses publication intent blank_reason')
mutate('intent-extra-text','translationGenerationAddressSchema.extend({ generation: translationPublicationReferenceSchema }).strict()','translationGenerationAddressSchema.extend({ generation: translationPublicationReferenceSchema }).passthrough()','refuses publication intent text')
mutate('intent-ref-extra','deliveryDigest: digest }).strict()','deliveryDigest: digest }).passthrough()','refuses publication intent reference_extra')
mutate('intent-batch-max',').min(1).max(200),\n}).strict().superRefine',').min(1).max(201),\n}).strict().superRefine','bounds a publication batch')
mutate('intent-batch-min',').min(1).max(200),\n}).strict().superRefine',').min(0).max(200),\n}).strict().superRefine','bounds a publication batch')
mutate('reason-codepoints','[...value].length <= 2000','true','bounds a publication batch')
mutate('duplicate-reads','new Set(requests.map(request => request.requestId)).size !== requests.length','false','rejects repeated retained request identities')
for name,expr in [('campaign','result.campaignId !== scope.campaignId ||'),('request','result.requestId !== intent.requestId ||'),('locale','result.locale !== intent.locale ||')]:
 mutate('receipt-'+name,expr,'false ||','rejects changed receipt '+name)
mutate('receipt-count','result.entries.length !== intent.entries.length','false','rejects changed receipt count')
for name,expr in [('row_campaign','row.campaign_id !== scope.campaignId ||'),('row_workspace','row.workspace_id !== scope.workspaceId ||'),('row_locale','row.locale !== intent.locale ||'),('same_row_id','seen.has(row.id) ||'),('same_field','seenFields.has(expected.generation.fieldId) ||')]:
 mutate('receipt-'+name,expr,'false ||','rejects changed receipt '+name)
mutate('receipt-publisher','row.created_by !== scope.publisherId','false','rejects changed receipt publisher')
for name,expr in [('campaign','request.campaignId !== scope.campaignId ||'),('workspace','request.workspaceId !== scope.workspaceId ||'),('locale','request.locale !== intent.locale ||'),('attempt','field.attemptId !== reference.attemptId ||')]:
 mutate('retained-'+name,expr,'false ||','rejects changed retained generation '+name)
mutate('retained-digest','field.output?.deliveryDigest !== reference.deliveryDigest ||','false ||','rejects changed retained generation digest')
mutate('retained-source','canonicalizeActionPayload(field.address) !== canonicalizeActionPayload(expectedAddress)','false','rejects changed retained generation address')
for name,expr in [('job_state','field.state !== "completed" ||'),('output_status','field.output.status !== "completed" ||')]:
 mutate('retained-'+name,expr,'false ||','rejects changed retained generation '+name)
mutate('retained-accepted-state','field.output.acceptedState !== "completed"','false','rejects changed retained generation accepted_state')
mutate('receipt-revision','saved.revision !== (expected.expectedTranslation?.revision ?? 0) + 1 ||','false ||','rejects changed receipt revision')
mutate('receipt-saved-id','(expected.expectedTranslation && row.id !== expected.expectedTranslation.id)','false','rejects changed receipt saved_id')
for name,expr in [('operator','row.source !== "machine" ||'),('model','row.machine_model !== field.output.model ||'),('words','row.translated_text !== field.output.text ||')]:
 mutate('receipt-'+name,expr,'false ||','rejects changed receipt '+name)
mutate('receipt-reference','canonicalizeActionPayload(saved.generation) !== canonicalizeActionPayload({ ...reference, actorId: request.actorId, outputHash: field.output.outputHash })','false','rejects changed receipt generation_actor')
results=[];count=None
try:
 for name,body,expected in cases:
  assert source.read_text()==original;source.write_text(body);output=private/(name+'.json')
  command=['npm','exec','--','vitest','run','src/test/translation-publication.test.ts','--reporter=json','--outputFile='+str(output)]
  if expected:command+=['-t',re.escape(expected)]
  try:run=subprocess.run(command,cwd=app,text=True,capture_output=True,timeout=30)
  finally:source.write_text(original)
  (private/(name+'.log')).write_text(run.stdout+run.stderr)
  report=json.loads(output.read_text());assert report['numPassedTests']+report['numFailedTests']>0
  failed=[a['fullName'] for suite in report['testResults'] for a in suite['assertionResults'] if a['status']=='failed']
  if count is None:count=report['numPassedTests'];assert count>=42
  correct=run.returncode==0 and report['numPassedTests']==count if expected is None else run.returncode!=0 and any(expected in f for f in failed)
  results.append({'case':name,'outcome':'survived' if run.returncode==0 else 'killed','expectedFailure':expected,'failedAssertions':failed,'expectedOutcome':correct})
  (review/'publication-receipt-controls.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(original.encode()).hexdigest(),'testSha256':hashlib.sha256(test.read_bytes()).hexdigest(),'testCount':count,'privateEvidence':str(private),'results':results,'limits':'Native acknowledgement checks against supplied verified-read DTOs. SQL independently owns scope and current-version authorization. No browser storage or editor integration.'},indent=2)+'\n')
  print(name,results[-1]['outcome'],'expected' if correct else 'UNEXPECTED',flush=True);assert correct,(name,failed)
finally:assert source.read_text()==original
