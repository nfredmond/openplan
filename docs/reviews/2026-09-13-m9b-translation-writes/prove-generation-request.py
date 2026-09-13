"""Queue route, native read and actual SQL read mutation controls; no provider calls."""
from pathlib import Path
import hashlib,json,subprocess,time
review=Path(__file__).resolve().parent;app=review.parents[2]/'openplan'
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/generation-request-controls')/time.strftime('%Y%m%dT%H%M%S');private.mkdir(parents=True)
paths={'queue':app/'src/lib/engagement/translation-generation-queue.ts','read':app/'src/lib/engagement/translation-generation-read.ts',
 'request':app/'src/lib/engagement/translation-generation-request.ts','route':app/'src/app/api/engagement/campaigns/[campaignId]/translations/generation/route.ts',
 'sql':app/'supabase/migrations/20261014000014_engagement_translation_generation_reads.sql'}
original={k:p.read_text() for k,p in paths.items()};cases=[]
for k in paths:
 cases.append(('baseline-'+k,k,original[k],None));cases.append(('harmless-'+k,k,original[k]+('\n-- Harmless read control.\n' if k=='sql' else '\n// Harmless queue/read control.\n'),None))
def mutate(name,k,old,new,expected):
 assert original[k].count(old)==1,(name,original[k].count(old),old)
 cases.append((name,k,original[k].replace(old,new,1),expected))
q='queue';r='read';c='request';t='route';s='sql'
mutate('replay-projection',q,'id,workspace_id,campaign_id,actor_id,locale,intent','id,workspace_id,campaign_id,locale,intent','binds the authenticated scope')
for key,expr in [('id','saved.id !== body.requestId ||'),('workspace_id','saved.workspace_id !== scope.workspaceId ||'),('campaign_id','saved.campaign_id !== scope.campaignId ||'),('actor_id','saved.actor_id !== scope.actorId ||'),('locale','saved.locale !== body.locale ||'),('intent','!isDeepStrictEqual(saved.intent, intent)')]:
 mutate('replay-'+key,q,expr,'false ||' if expr.endswith('||') else 'false','refuses a retained request with changed '+key)
mutate('retry-loads-key',q,'if (response.data !== null) {','if (false) {','confirms the same request after lost acknowledgement')
mutate('wrong-actor-rpc',q,'p_actor: scope.actorId','p_actor: scope.workspaceId','binds the authenticated scope')
mutate('ack-id',q,'ack.requestId !== body.requestId ||','false ||','does not confirm a wrong_id acknowledgement')
mutate('ack-replay',q,'(response.data !== null && ack.created)','false','does not confirm a false_replay acknowledgement')
mutate('browser-origin',t,'try { requireProviderBrowserOrigin(request); } catch { return refused("forbidden", 403); }','/* missing origin gate */','refuses cross-origin generation')
mutate('agent-refusal',t,'.some(key => request.headers.has(key))','.some(() => false)','refuses unregistered agent execution')
# Both handlers share this check; a single replacement would leave an untested
# GET/POST asymmetry. The mutation deliberately removes it from both routes.
body=original[t].replace('if (!access.allowed) return refused("forbidden", 403);','/* missing staff gate */')
cases.append(('staff-permission',t,body,'refuses denied before creating a service client'))
body=original[t].replace('if (!user) return refused("forbidden", 401);','if (!user) return refused("unavailable", 503);')
cases.append(('unauthenticated-status',t,body,'refuses unauthenticated before creating a service client'))
mutate('body-bound',t,'readBytesWithLimitStreaming(request, TRANSLATION_GENERATION_BODY_LIMIT)','readBytesWithLimitStreaming(request, TRANSLATION_GENERATION_BODY_LIMIT * 2)','cancels an oversized body')
mutate('duplicate-id',c,'ids.has(field.id) ||','false ||','refuses duplicate_id source requests')
mutate('duplicate-address',c,'addresses.has(key) ||','false ||','refuses duplicate_address source requests')
# Removing the body source guard alone is still refused by packet construction,
# but with the wrong status. This checks that callers get an invalid-input result
# rather than an ambiguous transport failure that encourages the wrong retry.
for key,expr in [('unavailable','!source.available ||'),('oversize','new TextEncoder().encode(source.text).byteLength > 32000'),('nul','source.text.includes("\\0") ||'),('unpaired','!source.text.isWellFormed() ||')]:
 mutate('input-'+key,c,expr,'false ||' if expr.endswith('||') else 'false','refuses '+key+' source requests')
mutate('unsupported-language',c,'.refine(supportsMachineTranslation)','','refuses unsupported_language source requests')
for key,expr in [('requestId','saved.requestId !== scope.requestId ||'),('workspaceId','saved.workspaceId !== scope.workspaceId ||'),('campaignId','saved.campaignId !== scope.campaignId ||'),('count','saved.count !== saved.fields.length ||'),('source','packet.sourceText !== field.address.expectedSource.text ||'),('state','field.output.acceptedState !== field.state ||')]:
 mutate('read-'+key,r,expr,'false ||','rejects a mismatched '+key)
mutate('read-lost-access-status',r,'response.error.code === "42501" ? 403 : 503','503','reports access lost during the database read as forbidden')
mutate('read-missing-output',r,'else if (field.state === "completed" || field.state === "incomplete") invalid();','else { /* missing output */ }','rejects a mismatched missing_output')
mutate('read-partial-claim',r,'field.reservationId !== null || field.leaseExpiresAt !== null','false','rejects a mismatched partial_claim')
mutate('sql-access',s,'workspace:=lock_translation_generation_scope(p_campaign,auth.uid());','SELECT workspace_id INTO workspace FROM engagement_campaigns WHERE id=p_campaign;','Removed staff read was permitted')
mutate('sql-scope',s,'id=p_request AND campaign_id=p_campaign AND workspace_id=workspace','id=p_request','Foreign request read was permitted')
mutate('sql-truncate',s,'WHERE f.request_id=request.id;','WHERE f.request_id=request.id AND f.ordinal=1;','Reader truncated field inventory')
mutate('sql-output-loss',s,'o.field_id=f.id AND o.attempt_id=f.attempt_id','false','Reader lost retained output or queued field')
mutate('sql-credential-leak',s,"'credential',jsonb_build_object('id',request.credential->>'credentialId','configurationHash',request.credential->>'configurationHash',\n    'model',request.credential#>>'{configuration,modelId}','source',request.credential->>'source'),","'credential',request.credential,",'Reader leaked captured credentials')
mutate('sql-anon-grant',s,'TO authenticated;','TO authenticated,anon;','Anonymous request read was permitted')
results=[];baseline_count=None
try:
 for name,k,body,expected in cases:
  assert paths[k].read_text()==original[k];paths[k].write_text(body)
  output=private/(name+'.json')
  try:
   if k=='sql':command=['python3',str(review/'run-generation-request-read-probe.py')]
   else:
    command=['npm','exec','--','vitest','run','src/test/translation-generation-routes.test.ts','--reporter=json','--outputFile='+str(output)]
    if expected:command+=['-t',expected]
   run=subprocess.run(command,cwd=app,text=True,capture_output=True,timeout=40)
  finally:paths[k].write_text(original[k])
  (private/(name+'.log')).write_text(run.stdout+run.stderr)
  if k=='sql':
   correct=run.returncode==0 and '"rollbackContained": true' in run.stdout if expected is None else run.returncode!=0 and expected in run.stdout+run.stderr
   failed=[]
  else:
   report=json.loads(output.read_text());failed=[a['fullName'] for suite in report['testResults'] for a in suite['assertionResults'] if a['status']=='failed']
   if baseline_count is None:baseline_count=report['numPassedTests'];assert baseline_count>=43
   correct=run.returncode==0 and report['numPassedTests']==baseline_count if expected is None else run.returncode!=0 and any(expected in f for f in failed)
  results.append({'case':name,'outcome':'survived' if run.returncode==0 else 'killed','expectedFailure':expected,'failedAssertions':failed,'expectedOutcome':correct})
  (review/'generation-request-controls.json').write_text(json.dumps({'sourceSha256':{k:hashlib.sha256(s.encode()).hexdigest() for k,s in original.items()},'testCount':baseline_count,'privateEvidence':str(private),'results':results,'limits':'Mocked route authentication and service query; real native credential/codec and SQL permission read in rolled-back isolated proof DB. No browser queue submission or app worker dispatch.'},indent=2)+'\n')
  print(name,results[-1]['outcome'],'expected' if correct else 'UNEXPECTED',flush=True)
  assert correct,(name,failed)
finally:
 for k,p in paths.items():assert p.read_text()==original[k]
