"""Exercise recovery and real React wiring, with executed assertions and harmless controls."""
from pathlib import Path
import hashlib,json,re,subprocess,time
review=Path(__file__).resolve().parent
app=review.parents[2]/'openplan'
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context')/('editor-contract-'+str(time.time_ns()))
private.mkdir(mode=0o700)
files={key:app/path for key,path in {
 'pending':'src/lib/engagement/pending-decision-link.ts',
 'panel':'src/components/engagement/decision-links-panel.tsx',
 'builder':'src/components/engagement/close-loop-builder.tsx',
 'access':'src/lib/engagement/decision-link-access.ts',
}.items()}
original={key:path.read_text() for key,path in files.items()}
tests=['src/test/pending-decision-link.test.ts','src/test/decision-links-panel.test.tsx','src/test/engagement-response-recovery.test.tsx','src/test/close-loop-builder.test.tsx','src/test/workspace-write-role-gate-guard.test.ts','src/test/every-api-route-has-a-caller.test.ts']

def run(name,title=None):
 output=private/(name+'.json')
 args=[str(app/'node_modules/.bin/vitest'),'run',*tests,'--reporter=json','--outputFile='+str(output)]
 if title: args+=['-t',re.escape(title)]
 result=subprocess.run(args,cwd=app,text=True,capture_output=True,timeout=40)
 (private/(name+'.log')).write_text(result.stdout+result.stderr)
 assert output.exists(),name+': no test report'
 report=json.loads(output.read_text())
 assertions=[a for test in report['testResults'] for a in test['assertionResults']]
 if title:
  target=[a for a in assertions if a['title']==title]
  assert result.returncode!=0 and any(a['status']=='failed' for a in target),name+': targeted assertion did not fail'
 else: assert result.returncode==0 and report['numPassedTests']==80 and report['numFailedTests']==0,name+': baseline or harmless control failed'
 return {'case':name,'outcome':'killed' if title else 'survived','test':title,'passed':report['numPassedTests'],'failed':report['numFailedTests']}

mutations=[
 ('storage-readback','pending','if (storage.getItem(key) !== text)','if (false)','does not send when storage fails or silently discards the copy'),
 ('retry-recreates','pending','if (updating && old === null)','if (false)','does not recreate a request removed in another tab'),
 ('intent-replacement','pending','if (old !== null && !same(immutable(await verified(JSON.parse(old), pending)), immutable(pending)))','if (false)','refuses a different intent sharing a recovery key'),
 ('retain-concurrent-replacement','pending','if (storage.getItem(key) !== old)','if (false)','does not overwrite a request replaced while its old bytes are being checked'),
 ('cleanup-concurrent-replacement','pending','if (storage.getItem(key) !== raw)','if (false)','does not delete changed local intent or a copy replaced during cleanup'),
 ('cleanup-unchanged-intent','pending','if (raw !== null && !same(immutable(await verified(JSON.parse(raw), pending)), immutable(pending)))','if (false)','does not delete changed local intent or a copy replaced during cleanup'),
 ('cleanup-readback','pending','if (storage.getItem(key) !== null)','if (false)','reports cleanup failure without treating a retained copy as cleared'),
 ('reviewed-hash','pending','pending.intent.operation !== "withdraw" && pending.intent.expectedContextSha256 !== pending.context.contextSha256','false','refuses a nonwithdrawal whose reviewed hash differs from the intent'),
 ('withdrawal-original','pending','if (link.context_text !== pending.context.contextText || link.context_sha256 !== pending.context.contextSha256)','if (false)','refuses a withdrawal receipt with a different valid original context'),
 ('retry-identity','pending','body: JSON.stringify(pending.intent)','body: JSON.stringify({ ...pending.intent, requestId: crypto.randomUUID() })','retries a lost acknowledgement with the original ID, headers and complete intent'),
 ('expected-account','pending','"x-openplan-expected-user": pending.actorId','"x-openplan-expected-user": pending.workspaceId','retries a lost acknowledgement with the original ID, headers and complete intent'),
 ('refusal-status','pending','refusal.success && response.status === { invalid: 400, missing: 404, conflict: 409 }[refusal.data.kind]','refusal.success','keeps malformed replies, permission changes and contradictory refusals unconfirmed'),
 ('lost-ack-retention','pending','} catch { /* Keep the same request after transport, receipt or cleanup failure. */ }','} catch { storage.removeItem(pendingDecisionKey(pending)); }','retries a lost acknowledgement with the original ID, headers and complete intent'),
 ('corrupt-retention','pending','} catch { unreadable.push({ key, raw }); }','} catch { storage.removeItem(key); }','keeps corrupt bytes and mismatched keys available for recovery'),
 ('response-builder-entry','builder','<DecisionLinksPanel actorId={userId} workspaceId={workspaceId} campaignId={campaignId} responses={entries} responsesUnavailable={readError || readLoading} revision={historyRevision} />','null','opens from the actual response builder and retains a reviewed link before sending'),
 ('snapshot-account','panel','if (payload.actorId !== actorId) throw new Error("Account changed");','void actorId;','does not display a snapshot from another signed-in account'),
 ('correction-predecessor','panel','predecessorId: leaf?.id ?? null','predecessorId: null','preserves earlier history when saving a reviewed correction'),
 ('withdrawal-preserved-context','panel','const context = withdraw && leaf ? { contextText: leaf.context_text, contextSha256: leaf.context_sha256 } : preview!.packet;','const context = preview!.packet;','withdraws a retained link when current response and decision records are unavailable'),
 ('role-helper-call','access','await loadCampaignAccess(client, campaignId, user.id, "engagement.write")','{ error: null, campaign: { workspace_id: campaignId }, allowed: true }','recognizes only gates that actually consult a role'),
]
results=[]
try:
 results.append(run('baseline'))
 files['pending'].write_text(original['pending']+'\n// Harmless recovery comment.\n')
 results.append(run('harmless-comment'));files['pending'].write_text(original['pending'])
 for name,key,old,new,title in mutations:
  assert original[key].count(old)==1,name+': mutation address ambiguous'
  files[key].write_text(original[key].replace(old,new,1))
  try: results.append(run(name,title))
  finally: files[key].write_text(original[key])
  print(name,'killed',flush=True)
finally:
 for key,path in files.items():path.write_text(original[key])
 restored=all(path.read_text()==original[key] for key,path in files.items())
 (review/'decision-editor-results.json').write_text(json.dumps({'privateEvidence':str(private),'sourceSha256':{str(path.relative_to(app)):hashlib.sha256(path.read_bytes()).hexdigest() for path in [*files.values(),*(app/test for test in tests),app/'src/test/fixtures/decision-link-native.json']},'results':results,'sourcesRestored':restored,'limits':'Real React components, browser storage interface and typed receipt verification with synthetic native packets and mocked fetch. Static role-helper inventory checks invocation presence, not runtime control flow. Does not prove browser rendering, real storage events across tabs, live HTTP/database integration, publication or usable downloads.'},indent=2)+'\n')
 assert restored
