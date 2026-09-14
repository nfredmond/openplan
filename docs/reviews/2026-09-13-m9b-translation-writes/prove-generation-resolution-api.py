"""Real route and queue helper controls with mocked database transport."""
from pathlib import Path
import hashlib,json,re,subprocess,time
review=Path(__file__).resolve().parent;app=review.parents[2]/'openplan'
paths={'route':app/'src/app/api/engagement/campaigns/[campaignId]/translations/generation/resolutions/route.ts','queue':app/'src/lib/engagement/translation-generation-queue.ts'}
tests={'route':'src/test/translation-generation-resolution-route.test.ts','queue':'src/test/translation-generation-routes.test.ts'}
original={k:p.read_text() for k,p in paths.items()}
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913')/('resolution-api-controls-'+str(time.time_ns()));private.mkdir(mode=0o700)
cases=[]
for key,body in original.items(): cases += [('baseline-'+key,key,body,None),('harmless-'+key,key,body+'\n// Harmless API control.\n',None)]
def mutate(name,key,old,new,expected):
 assert original[key].count(old)==1,(name,original[key].count(old));cases.append((name,key,original[key].replace(old,new),expected))
mutate('omit-agent-refusal','route','.some(key => request.headers.has(key))','.some(() => false)','refuses unregistered agent marker x-openplan-assistant-execution-source before authentication')
mutate('omit-origin-check','route','requireProviderBrowserOrigin(request);','/* Origin check removed. */','refuses cross-origin request through origin before authentication')
mutate('omit-body-bound','route','readBytesWithLimitStreaming(request, GENERATION_RESOLUTION_BODY_LIMIT)','readBytesWithLimitStreaming(request, GENERATION_RESOLUTION_BODY_LIMIT + 1)','cancels an oversized body without reading its tail or authenticating')
mutate('replace-invalid-utf8','route','{ fatal: true }','{ fatal: false }','refuses malformed UTF-8 without replacing the retained bytes')
mutate('omit-input-validation','route','if (!intent.success) return refused("invalid", 400);','/* Missing intent gate. */','refuses invalid reason before authentication')
mutate('omit-param-validation','route','if (!params.success) return refused("invalid", 400);','/* Missing parameter gate. */','refuses a malformed campaign before reading the body')
mutate('omit-authentication','route','if (!user) return refused("forbidden", 401);','/* Missing authentication gate. */','refuses unauthenticated before resolution')
mutate('omit-access-refusal','route','if (!access.allowed) return refused("forbidden", 403);','/* Missing access gate. */','refuses denied before resolution')
mutate('omit-access-error','route','if (access.error) return refused("unavailable", 503);','/* Missing access error gate. */','refuses error before resolution')
mutate('omit-missing-campaign','route','if (!access.campaign) return refused("forbidden", 404);','/* Missing campaign gate. */','refuses missing before resolution')
mutate('mislabel-replay','route','status: packet.replayed ? 200 : 201','status: 201','retries the exact resolution after acknowledgement loss without inventing another identity')
mutate('cache-private-receipts','route','"Cache-Control": "private, no-store"','"Cache-Control": "public, max-age=3600"','binds authenticated scope and returns verified private receipts without logging copied words')
mutate('log-private-copy','route','resolutionId: intent.data.resolutionId, replayed: packet.replayed','resolutionId: intent.data.resolutionId, replayed: packet.replayed, copy: intent.data.copyJson','binds authenticated scope and returns verified private receipts without logging copied words')
mutate('skip-resolution-preflight','queue','if (resolution.data !== null) {','if (false) {','refuses a resolved absent request before credential reads using only permitted metadata')
mutate('ignore-resolution-error','queue','rpcError(resolution.error);','/* Ignored resolution read error. */','preserves resolution lookup failure instead of preparing a fallback credential')
mutate('ignore-metadata-binding','queue','saved.request_id !== body.requestId || saved.workspace_id !== scope.workspaceId || saved.campaign_id !== scope.campaignId || saved.actor_id !== scope.actorId','false','does not trust mismatched resolution metadata actor_id')
mutate('read-private-columns','queue','.select(TRANSLATION_GENERATION_RESOLUTION_COLUMNS)','.select("*")','refuses a resolved absent request before credential reads using only permitted metadata')
mutate('unbounded-resolution-read','queue','.limit(1).abortSignal','.abortSignal','refuses a resolved absent request before credential reads using only permitted metadata')
old='.eq("request_id", body.requestId).eq("workspace_id", scope.workspaceId).eq("campaign_id", scope.campaignId).eq("actor_id", scope.actorId)'
for key in ['request_id','workspace_id','campaign_id','actor_id']:
 piece={ 'request_id':'.eq("request_id", body.requestId)', 'workspace_id':'.eq("workspace_id", scope.workspaceId)', 'campaign_id':'.eq("campaign_id", scope.campaignId)', 'actor_id':'.eq("actor_id", scope.actorId)'}[key]
 mutate('omit-resolution-filter-'+key,'queue',old,old.replace(piece,''),'refuses a resolved absent request before credential reads using only permitted metadata')
results=[]
try:
 for name,key,body,expected in cases:
  assert all(p.read_text()==original[k] for k,p in paths.items());target=private/(name+'.json');paths[key].write_text(body)
  args=['npm','exec','--','vitest','run',tests[key],'--reporter=json','--outputFile='+str(target)]
  if expected:args+=['-t',re.escape(expected)]
  try:run=subprocess.run(args,cwd=app,text=True,capture_output=True,timeout=35)
  finally:paths[key].write_text(original[key])
  (private/(name+'.log')).write_text(run.stdout+run.stderr);report=json.loads(target.read_text())
  failed=[a['fullName'] for s in report['testResults'] for a in s['assertionResults'] if a['status']=='failed']
  correct=run.returncode==0 and report['numPassedTests']==({'route':26,'queue':52}[key]) if expected is None else run.returncode!=0 and any(expected in f for f in failed)
  results.append({'case':name,'outcome':'survived' if run.returncode==0 else 'killed','expectedFailure':expected,'failedTests':failed,'expectedOutcome':correct});print(name,results[-1]['outcome'],flush=True);assert correct,(name,failed)
finally:
 assert all(p.read_text()==original[k] for k,p in paths.items())
 (review/'generation-resolution-api-controls.json').write_text(json.dumps({'sourceSha256':{k:hashlib.sha256(v.encode()).hexdigest() for k,v in original.items()},'testSha256':{k:hashlib.sha256((app/v).read_bytes()).hexdigest() for k,v in tests.items()},'privateEvidence':str(private),'results':results,'limits':'Real HTTP route functions and queue/server helpers with synthetic inputs and mocked Supabase transport. Query projections and filters asserted. No browser journey, local storage, real HTTP server/database join or release acceptance.'},indent=2)+'\n')
