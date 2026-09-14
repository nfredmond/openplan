"""Probe public HTTP/client/cache guards in the isolated worktree, restoring bytes.

No server/browser may consume this checkout while the runner is active. RPC and
fetch are mocked; installed SQL, network dispatch and browser reachability are
separate evidence. JSON assertion names prevent runner errors counting as kills.
"""
from pathlib import Path
import hashlib,json,re,subprocess,time
review=Path(__file__).resolve().parent
app=review.parents[2]/'openplan'
paths={
 'route':app/'src/app/api/engage/[shareToken]/items/[itemId]/translate/route.ts',
 'client':app/'src/components/engagement/use-public-comment-translations.ts',
 'server':app/'src/lib/engagement/public-translation-generation.ts',
}
tests=['src/test/engagement-translate-route.test.ts','src/test/public-comment-translations.test.tsx','src/test/public-translation-generation.test.ts']
originals={key:path.read_text() for key,path in paths.items()}
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/public-http-client-controls')/time.strftime('%Y%m%dT%H%M%S');private.mkdir(parents=True,exist_ok=False)
cases=[('baseline','route',originals['route'],None)]
for key,body in originals.items():cases.append(('harmless-'+key,key,body+'\n// Harmless public translation control.\n',None))
def mutate(name,key,old,new,target,all_occurrences=False):
 body=originals[key];assert old in body,(name,'missing');assert all_occurrences or body.count(old)==1,(name,body.count(old))
 cases.append((name,key,body.replace(old,new),target))
mutate('agent-marker-presence','route','request.headers.has(key)','Boolean(request.headers.get(key))','refuses unregistered agent marker')
mutate('browser-origin','route','requireProviderBrowserOrigin(request);','/* Origin guard removed. */','refuses cross-origin creation')
mutate('actual-body-bound','route','request, 2048','request, 8192','counts streamed bytes')
mutate('strict-intent','route','retryOf: z.string().uuid().optional() }).strict()','retryOf: z.string().uuid().optional() })','refuses invalid intent')
mutate('route-scope','route','shareToken: z.string().min(8).max(64)','shareToken: z.string()','refuses bad route identity')
mutate('retry-cache-substitution','route','if (parsed.data.retryOf === undefined)','if (true)','retries the named attempt')
mutate('cache-creates-work','route','if (cached !== null) return reply','if (false) return reply','returns valid legacy cache')
mutate('recovery-request-id','route','parsed.data, requestId.data, request.signal','parsed.data, undefined, request.signal','recovers completed exact words through GET')
mutate('duplicate-query','route','new Set(pairs.map(([key]) => key)).size !== pairs.length || ','','rejects ambiguous recovery query')
mutate('unknown-query','route','pairs.some(([key]) => !["language", "sourceHash", "requestId"].includes(key))','false','rejects ambiguous recovery query')
mutate('pending-status','route','status: pending ? 202 : 200','status: 200','reports queued as pending')
mutate('public-response-cache','route','private, no-store','public, max-age=3600','queues the source-bound request')
mutate('unvalidated-response','route','if (!parsed.success) return failure("unavailable", 503);','if (!parsed.success) return NextResponse.json(value);','refuses a malformed retained response')
mutate('client-original-hash','client','JSON.stringify([item.title, item.body])','JSON.stringify([item.title?.trim(), item.body.trim()])','queues the exact displayed hash')
mutate('client-read-is-write','client','await request(mode === "read" ? "GET" : "POST", 10)','await request("POST", 10)','recovers an unacknowledged request')
mutate('client-exact-recovery','client','query.set("requestId", state.requestId)','query.set("requestId", "44444444-4444-4444-8444-444444444444")','recovers the same pending request with GET')
mutate('client-retry-predecessor','client','retryOf: previous!.requestId','retryOf: "44444444-4444-4444-8444-444444444444"','creates an explicitly requested successor')
mutate('client-unsafe-retry','client','!["failed", "missing"].includes(previous.status)','false','recovers an unacknowledged request')
mutate('client-no-clear-cancel','client','function stop(operation: Operation) { operation.controller.abort();','function stop(operation: Operation) {','does not revive a cleared translation')
mutate('client-late-cleared-write','client','const isCurrent = () => mounted.current && !operation.controller.signal.aborted && active.current.get(itemId) === operation &&\n      current.current.shareToken === shareToken && !current.current.previewMode && current.current.versions.get(itemId) === original;', 'const isCurrent = () => true;', 'does not revive a cleared translation')
mutate('client-wrong-source','client','payload.data.sourceHash !== state.sourceHash','false','rejects substituted public response')
mutate('client-wrong-language','client','(payload.data.source === "queue" ? payload.data.request.language : payload.data.language) !== language','false','rejects substituted public response')
mutate('client-wrong-request','client','payload.data.request.requestId !== state.requestId','false','rejects another request')
mutate('client-unbounded-poll','client','remaining > 0','true','polls existing work for a bounded period')
mutate('client-poll-recreates','client','void request("GET", remaining - 1)','void request("POST", remaining - 1)','polls existing work for a bounded period')
cases.append(('client-preview-write','client',originals['client'].replace('if (previewMode || !mounted.current','if (false || !mounted.current').replace(' && !current.current.previewMode', ''),'sends no preview requests'))
mutate('client-missing-is-failed','client','status: "missing", requestId: null','status: "failed", requestId: null','allows a new root only after conclusive missing recovery')
# Cache-only changes deliberately avoid mutating the shared queue/read functions.
cache_start=originals['server'].index('export async function readPublicTranslationCache')
def cache_mutation(name,old,new,target):
 body=originals['server'];prefix=body[:cache_start];tail=body[cache_start:];assert tail.count(old)==1,(name,tail.count(old));cases.append((name,'server',prefix+tail.replace(old,new),target))
cache_mutation('cache-source-binding','p_snapshot: snapshot','p_snapshot: null','reads a valid cache with the exact original')
cache_mutation('cache-failed-is-missing','signal.throwIfAborted(); checkError(result.error);','signal.throwIfAborted();','does not call a failed cache read a cache miss')
cache_mutation('cache-invalid-words','if (!checked.success) return null;','if (!checked.success) return result.data;','leaves invalid or absent legacy cache unused')
results=[]
try:
 for name,key,body,expected in cases:
  assert all(paths[k].read_text()==v for k,v in originals.items())
  target=private/(name+'.json');paths[key].write_text(body)
  args=['npm','exec','--','vitest','run',*tests,'--reporter=json','--outputFile='+str(target)]
  if expected:args+=['-t',re.escape(expected)]
  try:run=subprocess.run(args,cwd=app,text=True,capture_output=True,timeout=45)
  finally:paths[key].write_text(originals[key])
  (private/(name+'.log')).write_text(run.stdout+run.stderr)
  report=json.loads(target.read_text());failed=[a['fullName'] for s in report['testResults'] for a in s['assertionResults'] if a['status']=='failed']
  assert report['numPassedTests'] + report['numFailedTests'] > 0,(name,'No selected tests')
  correct=run.returncode==0 and report['numPassedTests']==128 if expected is None else run.returncode!=0 and any(expected in f for f in failed)
  results.append({'case':name,'file':str(paths[key].relative_to(app)),'outcome':'survived' if run.returncode==0 else 'killed','expectedFailure':expected,'failedTests':failed,'expectedOutcome':correct})
  print(name,results[-1]['outcome'],'expected' if correct else 'UNEXPECTED',flush=True)
  assert correct,(name,failed)
finally:
 assert all(paths[k].read_text()==v for k,v in originals.items())
 (review/'public-translation-http-client-controls.json').write_text(json.dumps({'files':{str(paths[k].relative_to(app)):hashlib.sha256(v.encode()).hexdigest() for k,v in originals.items()},'tests':{f:hashlib.sha256((app/f).read_bytes()).hexdigest() for f in tests},'privateEvidence':str(private),'results':results,'limits':'Real HTTP handlers, shared schemas and React hook with mocked RPC orchestration and fetch. No native database, provider dispatch, installed worker, browser navigation or rendered artifact proof. Overlapping cancellation guards may mask individual mutations; observed survivors must be investigated.'},indent=2)+'\n')
