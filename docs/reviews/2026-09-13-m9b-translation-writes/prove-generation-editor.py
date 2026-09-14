"""Generation editor native/React fault controls; no live database or provider calls."""
from pathlib import Path
import hashlib, json, re, subprocess, time
review = Path(__file__).resolve().parent
app = review.parents[2] / 'openplan'
paths = {'helper': app/'src/lib/engagement/translation-generation-editor.ts', 'panel': app/'src/components/engagement/translation-generation-panel.tsx'}
original = {key: path.read_text() for key,path in paths.items()}
test = app/'src/test/translation-generation-editor.test.tsx'
private = Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/generation-editor-controls')/time.strftime('%Y%m%dT%H%M%S')
private.mkdir(parents=True)
cases = [('baseline', 'helper', original['helper'], None)]
for key in paths: cases.append(('harmless-'+key,key,original[key]+'\n// Harmless generation editor control.\n',None))
def mutate(name,key,old,new,expected):
    assert original[key].count(old)==1,(name,original[key].count(old))
    cases.append((name,key,original[key].replace(old,new),expected))
mutate('ignore-snapshot-scope','helper','snapshot.campaignId !== scope.campaignId','false','freezes exact source')
mutate('lose-baseline','helper','revision: before.revision','revision: before.revision + 1','freezes exact source')
mutate('trim-original-source','helper','...address, expectedSource, expectedTranslation:','...address, expectedSource: { ...expectedSource, text: expectedSource.text?.trim() ?? null }, expectedTranslation:','freezes exact source')
mutate('ignore-frozen-identity','helper','return canonicalizeActionPayload(fixed);','return canonicalizeActionPayload({ ...fixed, intent: undefined });','retains exact request identity')
mutate('include-phase-in-identity','helper','canonicalizeActionPayload(fixed)','canonicalizeActionPayload(pending)','retains exact request identity')
mutate('ignore-stored-workspace','helper','if (value.workspaceId !== scope.workspaceId || pendingGenerationKey(value) !== key)', 'if (pendingGenerationKey(value) !== key)', 'reports unreadable and wrong workspace')
mutate('replace-archive-bytes','helper','storage.setItem(archive, raw);','storage.setItem(archive, "{}");','reports unreadable and wrong workspace')
mutate('ignore-read-request','helper','value.requestId !== scope.requestId ||','false ||','rejects a generation read with changed request')
mutate('ignore-read-campaign','helper','value.campaignId !== scope.campaignId ||','false ||','rejects a generation read with changed campaign')
mutate('ignore-read-workspace','helper','value.campaignId !== scope.campaignId || value.workspaceId !== scope.workspaceId ||','value.campaignId !== scope.campaignId ||','rejects a generation read with changed workspace')
mutate('ignore-read-actor','helper','retained.userId !== value.actorId ||','false ||','rejects a generation read with changed actor')
mutate('ignore-read-locale','helper','retained.intent.locale !== value.locale ||','false ||','rejects a generation read with changed locale')
mutate('ignore-read-count','helper','retained.intent.fields.length !== value.fields.length ||','false ||','rejects a generation read with changed partial')
mutate('ignore-read-fields','helper','retained.intent.fields.some(wanted => !value.fields.some(field => field.id === wanted.id && canonicalizeActionPayload(field.address) === canonicalizeActionPayload(wanted.address)))','false','rejects a generation read with changed baseline')
mutate('ignore-duplicate-id','helper','new Set(value.fields.map(field => field.id)).size !== value.fields.length ||','false ||','rejects a generation read with changed duplicate_id')
mutate('ignore-duplicate-address','helper','new Set(value.fields.map(field => canonicalizeActionPayload({ entityType: field.address.entityType, entityId: field.address.entityId, field: field.address.field }))).size !== value.fields.length','false','rejects a generation read with changed duplicate_address')
mutate('use-latest-history','helper','row.translation_id === expected.id && row.revision === expected.revision','row.translation_id === expected.id','prepares publication from original history')
mutate('accept-removal-baseline','helper',' || matches[0].event === "removed"','','refuses unusable original history removed')
mutate('ignore-history-workspace','helper','row.record.workspace_id !== scope.workspaceId ||','false ||','refuses unusable original history workspace')
mutate('ignore-history-header','helper','row.campaign_id !== scope.campaignId ||','false ||','refuses unusable original history campaign')
mutate('dispatch-without-storage','panel','retained = retainPendingGeneration(localStorage, retained); volatile.current.delete(retained.intent.requestId); restore();','volatile.current.delete(retained.intent.requestId); restore();','does not dispatch when storage')
mutate('retry-new-identity','panel','body: JSON.stringify(retained.intent), signal','body: JSON.stringify({ ...retained.intent, requestId: crypto.randomUUID() }), signal','retains before dispatch and retries')
mutate('trust-other-ack','panel','if (ack.requestId !== retained.intent.requestId)','if (false)','keeps recovery after an acknowledgement for a different request')
mutate('ignore-read-intent','panel','readRequest(retained.intent.requestId, retained, signal)','readRequest(retained.intent.requestId, undefined, signal)','keeps recovery when the server read changes')
mutate('lose-page-copy','panel','for (const value of remembered.current)','for (const value of [] as PendingGeneration[])','retains before dispatch and retries')
mutate('publish-after-failed-read','panel','const [readFailed, setReadFailed] = useState(false);','const [, setReadFailed] = useState(false); const readFailed = false;','disables publication after a failed status read')
results=[];count=None
try:
    for name,key,body,expected in cases:
        assert all(path.read_text()==original[k] for k,path in paths.items())
        paths[key].write_text(body); output=private/(name+'.json')
        command=['npm','exec','--','vitest','run',str(test.relative_to(app)),'--reporter=json','--outputFile='+str(output)]
        if expected: command+=['-t',re.escape(expected)]
        try: run=subprocess.run(command,cwd=app,text=True,capture_output=True,timeout=40)
        finally: paths[key].write_text(original[key])
        (private/(name+'.log')).write_text(run.stdout+run.stderr)
        report=json.loads(output.read_text())
        assert report['numPassedTests']+report['numFailedTests']>0
        failed=[assertion['fullName'] for suite in report['testResults'] for assertion in suite['assertionResults'] if assertion['status']=='failed']
        if count is None: count=report['numPassedTests']; assert count>=28
        correct=(run.returncode==0 and report['numPassedTests']==count) if expected is None else (run.returncode!=0 and any(expected in item for item in failed))
        results.append({'case':name,'outcome':'survived' if run.returncode==0 else 'killed','expectedFailure':expected,'failedAssertions':failed,'expectedOutcome':correct})
        (review/'generation-editor-controls.json').write_text(json.dumps({'sourceSha256':{k:hashlib.sha256(value.encode()).hexdigest() for k,value in original.items()},'testSha256':hashlib.sha256(test.read_bytes()).hexdigest(),'testCount':count,'privateEvidence':str(private),'results':results,'limits':'Pure helper and React recovery behavior with synthetic safe DTOs and mocked HTTP. Does not prove cryptographic server reading, database isolation, actual provider/worker execution, full parent controls or rendered browser acceptance.'},indent=2)+'\n')
        print(name,results[-1]['outcome'],'expected' if correct else 'UNEXPECTED',flush=True)
        assert correct,(name,failed)
finally:
    assert all(path.read_text()==original[key] for key,path in paths.items())
