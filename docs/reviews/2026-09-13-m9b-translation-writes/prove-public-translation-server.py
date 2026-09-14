"""Test server orchestration faults separately from native SQL authority.

Temporarily edits only this worktree's public server helper; no browser/server
may consume this checkout during the run. Always restores the exact bytes.
"""
from pathlib import Path
import hashlib,json,re,subprocess,time
review=Path(__file__).resolve().parent
app=review.parents[2]/'openplan';source=app/'src/lib/engagement/public-translation-generation.ts';test='src/test/public-translation-generation.test.ts'
original=source.read_text();private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/public-server-controls')/time.strftime('%Y%m%dT%H%M%S');private.mkdir(parents=True,exist_ok=False)
cases=[('baseline',original,None),('harmless-comment',original+'\n// Harmless server queue control.\n',None)]
def mutate(name,old,new,target):
 assert original.count(old)==1,(name,original.count(old));cases.append((name,original.replace(old,new,1),target))
def function_mutation(name,start,end,old,new,target):
 a=original.index(start);b=original.index(end,a);body=original[a:b];assert body.count(old)==1,(name,body.count(old));cases.append((name,original[:a]+body.replace(old,new,1)+original[b:],target))
mutate('trim-source', 'source.title, source.body', 'source.title?.trim() ?? null, source.body.trim()', 'preserves null and empty title as different original identities')
mutate('ignore-original-hash','if (publicTranslationSourceHash(parsed.data) !== intent.sourceHash)', 'if (false)', 'refuses a changed displayed original before looking for a job')
mutate('ignore-item-identity', ' || parsed.data.itemId !== scope.itemId', '', 'refuses a source from another item')
mutate('recreate-on-recovery', 'if (existing !== null) return { ...existing, created: false };', '/* Missing recovery. */', 'recovers retained output without selecting a replacement credential')
mutate('ignore-active-predecessor', 'if (!retryable.has(previous.state))', 'if (false)', 'recovers rather than retries')
mutate('create-root-for-retry', 'intent.retryOf === undefined ? service.rpc("create_public_translation_request", args)', 'true ? service.rpc("create_public_translation_request", args)', 'creates one explicit successor')
mutate('retry-wrong-predecessor', 'p_previous: intent.retryOf ?? null', 'p_previous: null', 'creates one explicit successor')
mutate('lookup-without-snapshot', 'p_previous: intent.retryOf ?? null, p_snapshot: snapshot', 'p_previous: intent.retryOf ?? null', 'captures the exact original and one credential after conclusive discovery')
mutate('receipt-without-snapshot', 'p_request: requestId, p_share_token: scope.shareToken, p_item: scope.itemId, p_snapshot: snapshot', 'p_request: requestId, p_share_token: scope.shareToken, p_item: scope.itemId', 'pins the displayed snapshot in exact receipt recovery')
mutate('wrong-queue-original', 'p_snapshot: snapshot, p_packet_canonical: packetCanonical', 'p_snapshot: { ...snapshot, body: "SYNTHETIC wrong" }, p_packet_canonical: packetCanonical', 'captures the exact original and one credential after conclusive discovery')
mutate('omit-source-title', 'sourceText: snapshot.title ? `${snapshot.title}\\n\\n${snapshot.body}` : snapshot.body', 'sourceText: snapshot.body', 'captures the exact original and one credential after conclusive discovery')
mutate('accept-wrong-acknowledgement', ' || (ack.data.created && ack.data.requestId !== requestId)', '', 'refuses a created acknowledgement with a different identity')
mutate('ignore-competing-creator', 'ack.data.requestId, snapshot, signal', 'requestId, snapshot, signal', "recovers a competing creator's exact retained request")
mutate('accept-other-receipt', ' || (requestId !== undefined && parsed.data.requestId !== requestId)', '', 'refuses an exact receipt for another request')
mutate('accept-other-locale', ' || parsed.data.language !== language', '', 'refuses an invalid retained public DTO')
function_mutation('fail-open-discovery','async function find(', '// Both discovery', 'signal.throwIfAborted(); checkError(result.error);', 'signal.throwIfAborted();', 'does not treat failed discovery')
function_mutation('late-response-after-abort','async function find(', '// Both discovery', 'signal.throwIfAborted(); checkError(result.error);', 'checkError(result.error);', 'never returns a translation after the caller has left')
mutate('create-after-abort', 'signal.throwIfAborted();\n  const args', 'const args', 'does not create work after credential preparation is interrupted')
function_mutation('strip-unknown-input','export const publicTranslationIntentSchema', 'export type PublicTranslationIntent', '}).strict();', '});', 'refuses invalid or unsupported intent before database access')
function_mutation('strip-private-dto','export const publicTranslationViewSchema', 'export type PublicTranslationView', '}).strict().refine', '}).refine', 'refuses an invalid retained public DTO')
function_mutation('unsupported-language-before-db','export const publicTranslationIntentSchema', 'export type PublicTranslationIntent', '.refine(supportsMachineTranslation)', '', 'refuses invalid or unsupported intent before database access')
mutate('publish-incomplete-words', ': value.translated === null);', ': true);', 'refuses an invalid retained public DTO')
mutate('accept-empty-output', 'value.translated.trim().length > 0', 'true', 'refuses an invalid retained public DTO')
mutate('accept-oversized-output', '[...value.translated].length <= 8000', 'true', 'refuses an invalid retained public DTO')
mutate('accept-broken-unicode', 'value.translated.isWellFormed()', 'true', 'refuses an invalid retained public DTO')
mutate('accept-null-byte', '!value.translated.includes("\\0")', 'true', 'refuses an invalid retained public DTO')
results=[]
try:
 for name,body,expected in cases:
  assert source.read_text()==original;target=private/(name+'.json');source.write_text(body)
  args=['npm','exec','--','vitest','run',test,'--reporter=json','--outputFile='+str(target)]
  if expected:args+=['-t',re.escape(expected)]
  try:run=subprocess.run(args,cwd=app,text=True,capture_output=True,timeout=30)
  finally:source.write_text(original)
  (private/(name+'.log')).write_text(run.stdout+run.stderr)
  report=json.loads(target.read_text());failed=[a['fullName'] for s in report['testResults'] for a in s['assertionResults'] if a['status']=='failed']
  correct=run.returncode==0 and report['numPassedTests']==50 if expected is None else run.returncode!=0 and any(expected in f for f in failed)
  results.append({'case':name,'outcome':'survived' if run.returncode==0 else 'killed','expectedFailure':expected,'failedTests':failed,'expectedOutcome':correct})
  print(name,results[-1]['outcome'],'expected' if correct else 'UNEXPECTED',flush=True);assert correct,(name,failed)
finally:
 assert source.read_text()==original
 (review/'public-translation-server-controls.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(original.encode()).hexdigest(),'testSha256':hashlib.sha256((app/test).read_bytes()).hexdigest(),'privateEvidence':str(private),'results':results,'limits':'Actual server helper and shared packet validation with mocked RPC responses/credential selection. RPC names and source snapshots are asserted. Native SQL, RLS, concurrency, credential encryption, provider execution, HTTP and real browser behavior require separate evidence.'},indent=2)+'\n')
