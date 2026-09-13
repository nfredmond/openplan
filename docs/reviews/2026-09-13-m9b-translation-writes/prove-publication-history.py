"""Publication/history join controls; baseline, no-op and named behavioral failures."""
from pathlib import Path
import hashlib,json,re,subprocess,time
review=Path(__file__).resolve().parent;app=review.parents[2]/'openplan'
paths={'reader':app/'src/lib/engagement/translation-history-server.ts','schema':app/'src/lib/engagement/translation-history.ts'}
original={k:p.read_text() for k,p in paths.items()};cases=[]
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/publication-history-controls')/time.strftime('%Y%m%dT%H%M%S');private.mkdir(parents=True)
for k in paths:cases.extend([(f'baseline-{k}',k,original[k],None),(f'harmless-{k}',k,original[k]+'\n// Harmless publication history control.\n',None)])
def mutate(name,k,old,new,expected):
 assert original[k].count(old)==1,(name,original[k].count(old),old)
 cases.append((name,k,original[k].replace(old,new),expected))
mutate('missing-publication-revision','reader','if (versions.get(`${saved.entry.id}:${saved.revision}`)?.write_request_id !== receipt.intent.requestId)','if (false)','refuses incomplete or altered publication evidence missing_revision')
mutate('unbounded-generation-reads','reader','start += 8) retained.push(...await Promise.all(requestIds.slice(start, start + 8).map(generation)))','start += 200) retained.push(...await Promise.all(requestIds.slice(start, start + 200).map(generation)))','bounds concurrent evidence reads without omitting requests')
mutate('repeated-generation-read','reader','if (!read) { read = loadTranslationGenerationRequest','if (true) { read = loadTranslationGenerationRequest','reuses a generation read across independently published fields')
# Refusing an unavailable generation is independent from checksum-valid history.
# A broken implementation can trust the stored result without loading its origin.
a=original['reader'].index('    const retained: TranslationGenerationRead[] = [];');b=original['reader'].index('    if (result.replayed)',a)
mutate('trust-receipt-without-generation','reader',original['reader'][a:b],'    const result = translationPublicationResultSchema.parse(JSON.parse(raw.result_text));\n','does not return partial history when retained generation access is lost')
# Supply the replacement parser import only in this coherent broken behavior.
name,k,body,expected=cases[-1];cases[-1]=(name,k,body.replace('translationPublicationIntentSchema, readTranslationPublicationResult','translationPublicationIntentSchema, translationPublicationResultSchema, readTranslationPublicationResult'),expected)
mutate('trust-generation-actor','reader','const result = readTranslationPublicationResult(JSON.parse(raw.result_text), { campaignId, workspaceId, publisherId: actorId }, intent, retained);','const result = translationPublicationResultSchema.parse(JSON.parse(raw.result_text));','refuses incomplete or altered publication evidence generation_actor')
name,k,body,expected=cases[-1];cases[-1]=(name,k,body.replace('translationPublicationIntentSchema, readTranslationPublicationResult','translationPublicationIntentSchema, translationPublicationResultSchema, readTranslationPublicationResult'),expected)
old='if (recordedCampaign !== campaignId || actorId !== raw.actor_id || intent.requestId !== raw.request_id) throw new Error("Command receipt scope mismatch");'
assert original['reader'].count(old)==2
cases.append(('publication-receipt-scope','reader',original['reader'].replace(old,'/* Missing publication receipt scope. */',1),'refuses incomplete or altered publication evidence scope'))
old='if (result.replayed) throw new Error("Stored receipt is not the original result");';assert original['reader'].count(old)==2
cases.append(('publication-original-result','reader',original['reader'].replace(old,'/* Accepting a replay as original. */',1),'refuses incomplete or altered publication evidence replayed'))
mutate('publication-source-checksum','reader','row.record.source_text_hash !== createHash("sha256").update(requested.expectedSource.text!.trim(), "utf8").digest("hex")','false','refuses incomplete or altered publication evidence source_hash')
mutate('generation-history-association','reader','...(receipt.kind === "publication" && "generation" in result ? { generation: result.generation } : {})','...{}','joins one batch to exact generated words and preserves both actors')
mutate('history-evidence-schema','schema','row.change && (row.change.operation === "publish_generated") !== (row.change.generation !== undefined)','false','requires generation evidence only on publication history entries')
results=[];count=None
try:
 for name,k,body,expected in cases:
  assert paths[k].read_text()==original[k];paths[k].write_text(body);output=private/(name+'.json')
  command=['npm','exec','--','vitest','run','src/test/translation-publication-history.test.ts','--reporter=json','--outputFile='+str(output)]
  if expected:command+=['-t',re.escape(expected)]
  try:run=subprocess.run(command,cwd=app,text=True,capture_output=True,timeout=30)
  finally:paths[k].write_text(original[k])
  (private/(name+'.log')).write_text(run.stdout+run.stderr)
  report=json.loads(output.read_text());assert report['numPassedTests']+report['numFailedTests']>0
  failed=[a['fullName'] for suite in report['testResults'] for a in suite['assertionResults'] if a['status']=='failed']
  if count is None:count=report['numPassedTests'];assert count>=12
  correct=run.returncode==0 and report['numPassedTests']==count if expected is None else run.returncode!=0 and any(expected in f for f in failed)
  results.append({'case':name,'outcome':'survived' if run.returncode==0 else 'killed','expectedFailure':expected,'failedAssertions':failed,'expectedOutcome':correct})
  (review/'publication-history-controls.json').write_text(json.dumps({'sourceSha256':{k:hashlib.sha256(v.encode()).hexdigest() for k,v in original.items()},'testSha256':hashlib.sha256((app/'src/test/translation-publication-history.test.ts').read_bytes()).hexdigest(),'testCount':count,'privateEvidence':str(private),'results':results,'limits':'Native receipt/generation decoding with mocked RPC replies. Separate rollback SQL/native evidence covers actual retained rows. No browser, storage recovery or large-history performance claim.'},indent=2)+'\n')
  print(name,results[-1]['outcome'],'expected' if correct else 'UNEXPECTED',flush=True);assert correct,(name,failed)
finally:
 for k,p in paths.items():assert p.read_text()==original[k]
