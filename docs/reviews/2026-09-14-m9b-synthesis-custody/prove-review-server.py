"""Exercise review server/API guards with restored faults and a surviving harmless control."""
from pathlib import Path
import hashlib, json, subprocess
review = Path(__file__).resolve().parent
app = review.parents[2] / 'openplan'
server = app / 'src/lib/engagement/synthesis-review-server.ts'
route = app / 'src/app/api/engagement/campaigns/[campaignId]/synthesis/reviews/route.ts'
records = app / 'src/lib/engagement/synthesis-review-records.ts'
originals = {p:p.read_bytes() for p in [server,route,records]}
tests = ['src/test/engagement-synthesis-review-server.test.ts','src/test/engagement-synthesis-review-route.test.ts']
cases = [('baseline',None,'','',[]),('harmless-comment',server,'','// Harmless review server control.\n',[])]
for message, expected in [
 ('Saved review scope differs','refuses foreign records'),
 ('Saved review checksum differs','refuses foreign records'),
 ('Saved review authorship differs','binds source checksums'),
 ('Saved review original differs','binds source checksums'),
 ('Saved review correction lineage differs','binds source checksums'),
 ('Saved review source checksum differs','binds source checksums'),
 ('Saved review preparation differs from its source','refuses dishonest preparation'),
 ('Saved review parent differs','refuses missing or discontinuous'),
 ('Saved review content differs from its command','refuses dishonest preparation'),
 ('Saved review receipt differs','refuses failed, foreign'),
]: cases.append((message,server,f'throw new Error("{message}")',f'void "Removed {message}"',[expected]))
cases += [
 ('failed-query-as-missing',server,'if (result.error) throw databaseError(result.error.code);\n  if (result.data === null)', 'if (result.error) return null;\n  if (result.data === null)',['refuses missing or discontinuous','refuses failed, foreign']),
 ('changed-retry',server,'throw new SynthesisReviewError("conflict", "This request belongs to a different review command")','void "Removed retry check"',['recovers exact original']),
 ('stale-parent',server,'throw new SynthesisReviewError("conflict", "Open the current review before correcting it")','void "Removed parent check"',['refuses stale parents']),
 ('changed-selection',server,'throw new SynthesisReviewError("conflict", "The selected source checksum differs")','void "Removed source selection check"',['refuses stale parents']),
 ('missed-concurrent-recovery',server,'if (raced) return raced;', 'void raced;', ['recovers the same request']),
 ('lost-correction',server,'content = applySynthesisReviewChange(parent.content, intent.change, source.snapshot, source.snapshotSha256);','content = parent.content;',['computes complete original','refuses stale parents']),
 ('agent-markers',route,'.some(key => request.headers.has(key))','.some(() => false)',['requires the real browser origin']),
 ('foreign-origin',route,'requireProviderBrowserOrigin(request);','void request;',['requires the real browser origin']),
 ('actor-binding',route,'intent.data.actorId !== access.user.id','false',['protects both read and write']),
 ('workspace-binding',route,'intent.data.workspaceId !== access.workspaceId','false',['protects both read and write']),
 ('read-user-binding',route,'request.headers.get("x-openplan-expected-user") !== user.id','false',['protects both read and write']),
 ('read-workspace-binding',route,'request.headers.get("x-openplan-expected-workspace") !== workspaceId','false',['protects both read and write']),
 ('staff-access',route,'!access.allowed','false',['protects both read and write']),
 ('access-outage',route,'if (access.error) return { response: failure("unavailable") };','',['protects both read and write']),
 ('command-limit',route,'request, 65_536','request, 131_072',['bounds commands']),
 ('repeated-query',route,'new Set(entries.map(([key]) => key)).size !== entries.length','false',['bounds commands']),
 ('partial-cursor',route,'Boolean(query.data.beforeId) !== Boolean(query.data.beforeCreatedAt)','false',['bounds commands']),
 ('history-scope',route,'throw new Error("Saved review history scope differs")','void "Removed history scope check"',['refuses foreign or failed history']),
 ('root-page-identities',records,'new Set(page.entries.map(row => row.reviewId)).size !== page.entries.length','false',['checks history page identities']),
 ('revision-page-identities',records,'new Set(page.entries.map(row => row.requestId)).size !== page.entries.length','false',['checks history page identities']),
 ('revision-page-numbers',records,'new Set(page.entries.map(row => row.revisionNo)).size !== page.entries.length','false',['checks history page identities']),
 ('root-cursor-id',records,'page.nextCursor.id !== last?.reviewId','false',['checks history page identities']),
 ('root-cursor-date',records,'page.nextCursor.createdAt !== last?.createdAt','false',['checks history page identities']),
 ('revision-cursor',records,'page.nextCursor !== page.entries.at(-1)?.revisionNo','false',['checks history page identities']),
]
results=[]
try:
 for name,path,old,replacement,expected in cases:
  for file,raw in originals.items(): file.write_bytes(raw)
  if path:
   source=originals[path].decode()
   if old and source.count(old)!=(2 if name=='missed-concurrent-recovery' else 1): raise RuntimeError('Missing/ambiguous seam: '+name)
   path.write_text(source.replace(old,replacement) if old else replacement+source)
  run=subprocess.run(['npm','exec','--','vitest','run',*tests,'--reporter=json'],cwd=app,text=True,capture_output=True,timeout=60)
  data=json.loads(run.stdout[run.stdout.index('{'):])
  failed=[a['fullName'] for f in data['testResults'] for a in f['assertionResults'] if a['status']=='failed']
  ok=data['numTotalTests']==19 and data['numPendingTests']==0 and (run.returncode==0 and not failed if not expected else run.returncode==1 and all(any(e in f for f in failed) for e in expected))
  results.append({'case':name,'exitCode':run.returncode,'failed':failed,'expectedOutcome':ok}); print(json.dumps(results[-1]),flush=True)
  if not ok: raise RuntimeError(run.stdout+run.stderr)
finally:
 for file,raw in originals.items(): file.write_bytes(raw)
(review/'review-server-mutations.json').write_text(json.dumps({'sourcesRestored':all(p.read_bytes()==raw for p,raw in originals.items()),'cases':results,
 'sourceSha256':{str(p.relative_to(app)):hashlib.sha256(raw).hexdigest() for p,raw in originals.items()},
 'testSha256':{p:hashlib.sha256((app/p).read_bytes()).hexdigest() for p in tests},
 'limits':'Actual server/model and route code with mocked database transport and session/access reads. Not native RPC interoperability, concurrency, browser recovery or planner usefulness.'},indent=2)+'\n')
