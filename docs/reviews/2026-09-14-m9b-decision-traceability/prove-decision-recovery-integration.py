"""Fault-test actual recovery storage, HTTP and editor seams; restore all source."""
from pathlib import Path
import hashlib
import json
import subprocess
import time

review=Path(__file__).resolve().parent
app=review.parents[2]/'openplan'
paths={
 'route':app/'src/app/api/engagement/campaigns/[campaignId]/decision-links/resolutions/route.ts',
 'server':app/'src/lib/engagement/decision-resolution-server.ts',
 'storage':app/'src/lib/engagement/decision-resolution-recovery.ts',
 'hook':app/'src/components/engagement/decision-resolution-panel.tsx',
 'parent':app/'src/components/engagement/decision-links-panel.tsx',
}
original={key:path.read_text() for key,path in paths.items()}
tests=['src/test/decision-resolution-routes.test.ts','src/test/decision-resolution-recovery.test.ts','src/test/decision-resolution-panel.test.tsx','src/test/decision-links-panel.test.tsx']
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context')/('recovery-integration-'+str(time.time_ns()))
private.mkdir()


def run(label):
    result=subprocess.run(['./node_modules/.bin/vitest','run',*tests,'--reporter=json'],cwd=app,text=True,capture_output=True,timeout=75)
    (private/(label+'.log')).write_text(result.stdout+result.stderr)
    data=json.loads(result.stdout[result.stdout.index('{'):])
    return result,data


def restore():
    for key,path in paths.items():path.write_text(original[key])


def main():
    outcomes=[]
    faults=[]
    def add(label,key,old,new,expected):faults.append((label,[(key,old,new)],expected))
    add('route-origin','route','try { requireProviderBrowserOrigin(request); }','try { /* origin guard omitted */ }','refuses changed browser origin or scope')
    add('route-user','route','request.headers.get("x-openplan-expected-user") !== access.scope.actorId','false','refuses changed browser origin or scope')
    add('route-workspace','route','request.headers.get("x-openplan-expected-workspace") !== access.scope.workspaceId','false','refuses changed browser origin or scope')
    add('route-agent','route','.some(key => request.headers.has(key))','.some(key => Boolean(request.headers.get(key)))','refuses even empty agent header')
    add('route-private','route','"private, no-store"','"public, max-age=300"','returns one verified receipt')
    add('route-body-bound','route','readBytesWithLimitStreaming(request, DECISION_RESOLUTION_BODY_LIMIT)','readBytesWithLimitStreaming(request, DECISION_RESOLUTION_BODY_LIMIT * 2)','bounds streamed JSON bodies')
    add('route-replay-status','route','result.packet.replayed ? 200 : 201','201','returns exact retry metadata')
    add('server-copy-parameter','server','p_copy_json: intent.copyJson','p_copy_json: intent.reason','returns one verified receipt')
    add('server-receipt-validation','server','const result = await readDecisionResolution(reply.data, scope, intent);','const result = { packet: reply.data };','does not acknowledge a damaged or foreign')
    add('storage-owned-key','storage','if (key.startsWith(requestPrefix(scope))) return uuid.parse(key.slice(requestPrefix(scope).length));','if (key.startsWith("openplan:decision-link:")) return uuid.parse(key.split(":").at(-1));','refuses unowned or malformed source key')
    add('storage-source-self-reference','storage','value.sourceKey === decisionResolutionPrefix(value) + requestId + ":" + value.intents[0].resolutionId','false','rejects incoherent bundle source-collision')
    add('storage-request-identity','storage','value.intents.some(intent => intent.requestId !== requestId)','false','rejects incoherent bundle request')
    add('storage-resolution-identity','storage','new Set(value.intents.map(intent => intent.resolutionId)).size !== value.intents.length','false','rejects incoherent bundle resolution')
    add('storage-copy-identity','storage','new Set(value.intents.map(intent => intent.copyJson)).size !== value.intents.length','false','rejects incoherent bundle copy')
    add('storage-page-copy','storage','if (pageCopy !== undefined && !copies.includes(pageCopy)) copies.push(pageCopy);','/* page copy omitted */','freezes both exact copies')
    add('storage-readable-scope','storage','parsedScope.success && !same(parsedScope.data, scope)','false','refuses a readable foreign scope')
    add('storage-readable-request','storage','request.success && request.data.intent.requestId !== requestId','false','refuses a readable request identity misplaced')
    add('storage-readable-resolution','storage','resolution.success && pendingDecisionResolutionKey(resolution.data) !== key','false','refuses a readable request identity misplaced')
    add('storage-preserve-null','storage','copyJson: JSON.stringify(copy)','copyJson: JSON.stringify(copy.replaceAll("\\0", ""))','freezes both exact copies')
    add('storage-retain-overwrite','storage','old !== null && !same(pendingDecisionResolutionSchema.parse(JSON.parse(old)), value)','false','retains exact intent for retry')
    add('storage-retain-readback','storage','storage.getItem(key) !== bytes','false','refuses unretained dispatch intent on readback')
    add('storage-inventory','storage','packets.length !== value.intents.length','false','requires every copy receipt')
    add('storage-receipt-verification','storage','await readDecisionResolution(packets[index], { campaignId: value.campaignId, workspaceId: value.workspaceId, actorId: value.actorId }, value.intents[index]);','void packets[index];','rejects invalid payloadSha256 before touching originals')
    add('storage-pending-preserved','storage','pending === null || !same(pendingDecisionResolutionSchema.parse(JSON.parse(pending)), value)','false','refuses a missing pending bundle')
    add('storage-archive-conflict','storage','old !== null && old !== bytes','false','refuses replacing an existing different archive')
    add('storage-archive-readback','storage','storage.getItem(archive) !== bytes || storage.getItem(key) !== pending','false','preserves originals when archive write has readback')
    add('storage-original-match','storage','currentSource !== null && decisionResolutionHasCopy(value, currentSource)','currentSource !== null','preserves changed or absent original different')
    add('storage-source-retirement','storage','storage.getItem(value.sourceKey) !== null','false','retries after failed source retirement')
    add('storage-pending-retirement','storage','if (storage.getItem(key) !== null) throw new Error("Decision resolution could not be retired");','/* pending readback omitted */','retries after failed pending retirement')
    add('storage-pending-concurrent-change','storage','if (storage.getItem(key) !== pending) throw new Error("Decision resolution changed before retirement");','/* pending identity omitted */','preserves a pending bundle changed during source retirement')
    add('storage-final-scope','storage','  assertCurrent();\n  const currentSource','  /* scope check omitted */\n  const currentSource','aborts stale lifecycle at checkpoint 2')
    add('hook-retention','hook','const retained = retainDecisionResolution(localStorage, bundle);','const retained = bundle;','does not dispatch when the intent has readback')
    add('hook-response-status','hook','if (!response.ok) throw new Error("Resolution was not confirmed");','/* status guard omitted */','keeps original and pending copies on refused')
    add('hook-lifecycle','hook','const assertCurrent = () => { if (!isCurrent()) throw new Error("Resolution editor scope changed"); controller.signal.throwIfAborted(); };','const assertCurrent = () => {};','ignores late acknowledgement after unmount')
    add('hook-same-request','hook','body: JSON.stringify(retained.intents[index]),','body: JSON.stringify({ ...retained.intents[index], resolutionId: crypto.randomUUID() }),','retains both copies before dispatch')
    add('hook-held-recovery','hook','        values.set(key, value);','        /* lost page-held recovery */','retries the exact resolution after acknowledgement loss and lost browser storage')
    add('parent-read-version','parent','if (current && version === readVersion) {\n          for','if (current) {\n          for','does not let a slow earlier storage read hide')
    add('parent-page-copy','parent','resolution.begin(copy.key, heldRequests.current.has(copy.key) ? JSON.stringify(heldRequests.current.get(copy.key)) : undefined)','resolution.begin(copy.key)','preserves page-held and corrupted copies')
    add('parent-cleared-held-copy','parent','if (decisionResolutionHasCopy(bundle, JSON.stringify(value))) heldRequests.current.delete(key);','if (decisionResolutionHasCopy(bundle, JSON.stringify(value))) { /* omitted cleanup */ }','preserves page-held and corrupted copies')
    add('parent-unverified-access','parent','canWrite: Boolean(snapshot) && !loading && !readError','canWrite: true','does not display a snapshot from another signed-in account')
    add('route-utf8','route','new TextDecoder("utf-8", { fatal: true })','new TextDecoder("utf-8")','refuses malformed UTF-8')
    faults.append(('route-stream-stop', [
        ('route','import { readBytesWithLimitStreaming }','import { readBytesWithLimit }'),
        ('route','await readBytesWithLimitStreaming(request, DECISION_RESOLUTION_BODY_LIMIT)','await readBytesWithLimit(request, DECISION_RESOLUTION_BODY_LIMIT)'),
    ], 'stops oversized uploads before reading'))
    try:
        for label in ['baseline','harmless']:
            restore()
            if label=='harmless':paths['storage'].write_text(original['storage'].replace('Recover identity only','Recover the identity only',1))
            result,data=run(label)
            assert result.returncode==0 and data['numFailedTests']==0 and data['numPassedTests']==92,(label,result.stdout[-2500:],result.stderr)
            outcomes.append({'name':label,'outcome':'passed','tests':92});print(label,flush=True)
        for label,changes,expected in faults:
            restore()
            for key,old,new in changes:
                body=paths[key].read_text();assert body.count(old)==1,(label,body.count(old));paths[key].write_text(body.replace(old,new,1))
            result,data=run(label)
            failed=[item['fullName'] for suite in data['testResults'] for item in suite['assertionResults'] if item['status']=='failed']
            if result.returncode==0 or not any(expected in name for name in failed):
                (review/'DECISION_RECOVERY_INTEGRATION_COVERAGE_GAP.json').write_text(json.dumps({'mutation':label,'expectedFailure':expected,'actualFailures':failed,'log':str(private/(label+'.log'))},indent=2)+'\n')
                raise AssertionError((label,'survived or failed for another reason',failed))
            outcomes.append({'name':label,'outcome':'killed','failedAssertions':failed});print(label,flush=True)
    finally:restore()
    packet={'sourceSha256':{key:hashlib.sha256(value.encode()).hexdigest() for key,value in original.items()},'testSha256':{name:hashlib.sha256((app/name).read_bytes()).hexdigest() for name in tests},'outcomes':outcomes,'privateEvidence':str(private),'restored':all(path.read_text()==original[key] for key,path in paths.items()),'limits':['HTTP and controller tests use synthetic transport; native cancellation and RLS have separate evidence.','No browser geometry/layout claim or installed migration claim from these tests.','The storage API has no cross-tab compare-and-swap primitive; it preserves exact observed copies and checks readbacks before cleanup.']}
    (review/'decision-recovery-integration-results.json').write_text(json.dumps(packet,indent=2)+'\n')
    print(json.dumps({'tests':92,'harmless':True,'faultsKilled':len(faults),'restored':packet['restored']}))


if __name__=='__main__':main()
