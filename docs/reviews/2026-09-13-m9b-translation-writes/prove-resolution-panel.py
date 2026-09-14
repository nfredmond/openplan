"""Fault controls for the real resolution hook using mocked HTTP and browser storage."""
from pathlib import Path
import hashlib,json,re,subprocess,time
review=Path(__file__).resolve().parent;app=review.parents[2]/'openplan';source=app/'src/components/engagement/translation-resolution-panel.tsx';test='src/test/translation-resolution-panel.test.tsx'
original=source.read_text();private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913')/('resolution-panel-controls-'+str(time.time_ns()));private.mkdir(mode=0o700)
cases=[('baseline',original,None),('harmless',original+'\n// Harmless controller control.\n',None)]
def mutate(name,old,new,expected):
 assert original.count(old)==1,(name,original.count(old));cases.append((name,original.replace(old,new),expected))
mutate('begin-without-access','if (!options.canWrite || options.busy || active.current || candidate)','if (options.busy || active.current || candidate)','does not prepare resolution when blocked by access')
mutate('begin-while-busy','if (!options.canWrite || options.busy || active.current || candidate)','if (!options.canWrite || active.current || candidate)','does not prepare resolution when blocked by busy')
mutate('forget-lost-storage','for (const [key, value] of held.current) {','for (const [key, value] of new Map<string, PendingResolution>()) {','retries the exact resolution after acknowledgement loss and lost browser storage')
mutate('send-unretained','const retained = retainPendingResolution(localStorage, bundle);','const retained = bundle;','does not dispatch when the intent has quota storage failure')
mutate('omit-user-pin','"x-openplan-expected-user": scope.userId','"x-openplan-expected-user": "changed"','retains both copies before dispatch with pinned login and archives confirmed receipts')
mutate('omit-workspace-pin','"x-openplan-expected-workspace": scope.workspaceId','"x-openplan-expected-workspace": "changed"','retains both copies before dispatch with pinned login and archives confirmed receipts')
mutate('send-new-identity','body: JSON.stringify(retained.intents[index])','body: JSON.stringify({ ...retained.intents[index], resolutionId: crypto.randomUUID() })','retains both copies before dispatch with pinned login and archives confirmed receipts')
mutate('omit-second-copy','index < retained.intents.length','index < 1','retains both copies before dispatch with pinned login and archives confirmed receipts')
mutate('ignore-refusal','if (!response.ok)','if (false)','keeps original and pending copies on refused response')
# Removing only identity comparison survived because cleanup aborts and the explicit
# abort check still prevents retirement. Break both protections to test stale work.
scope_fault=original.replace('current.current.identity === identity && current.current.canWrite','current.current.canWrite').replace('controller.signal.throwIfAborted();','/* Abort check removed in combined lifecycle fault. */')
assert scope_fault != original
cases.append(('missing-scope-and-abort-lifecycle',scope_fault,'ignores late acknowledgement after workspace-changed'))
# Both immediate cancellation and the response-time permission check protect loss.
access_fault=original.replace('current.current.identity === identity && current.current.canWrite','current.current.identity === identity').replace('if (canWrite || !controller) return;', 'if (true) return;')
cases.append(('missing-access-and-cancellation-lifecycle',access_fault,'ignores late acknowledgement after access-revoked'))
mutate('omit-access-abort','    controller.abort();','    /* Missing access abort. */','does not revive an old response after edit access returns')
mutate('keep-cancelled-active-token','    active.current = null;\n    release();','    release();','retries the same resolution while the cancelled response is still pending')
mutate('keep-cancelled-busy-state','    release();\n  }, [canWrite, release]);','    /* Missing busy release. */\n  }, [canWrite, release]);','retries the same resolution while the cancelled response is still pending')
mutate('old-finally-releases-new-resolution','if (active.current === controller) { active.current = null;','if (true) { active.current = null;','retries the same resolution while the cancelled response is still pending')
mutate('missing-abort','active.current?.abort();','/* No abort on unmount. */','ignores late acknowledgement after unmount')
mutate('skip-archive','const archived = await archiveResolvedGeneration(localStorage, retained, receipts, assertCurrent);','const archived = { sourceChanged: false };','retains both copies before dispatch with pinned login and archives confirmed receipts')
mutate('forget-resolution-callback','options.onResolved(retained); restore();','restore();','retains both copies before dispatch with pinned login and archives confirmed receipts')
mutate('forget-held-retirement','held.current.delete(pendingResolutionKey(retained));','/* Old intent left in memory. */','retains both copies before dispatch with pinned login and archives confirmed receipts')
mutate('allow-replacement','blocked: !ready || candidate !== null || saved.pending.length > 0 || saved.unreadable.length > 0','blocked: false','retains both copies before dispatch with pinned login and archives confirmed receipts')
mutate('download-wrong-archive','options.download(copy.raw,','options.download("wrong archive",','retains both copies before dispatch with pinned login and archives confirmed receipts')
results=[]
try:
 for name,body,expected in cases:
  assert source.read_text()==original;target=private/(name+'.json');source.write_text(body)
  args=['npm','exec','--','vitest','run',test,'--reporter=json','--outputFile='+str(target)]
  if expected:args+=['-t',re.escape(expected)]
  try:run=subprocess.run(args,cwd=app,text=True,capture_output=True,timeout=35)
  finally:source.write_text(original)
  (private/(name+'.log')).write_text(run.stdout+run.stderr);report=json.loads(target.read_text())
  failed=[a['fullName'] for s in report['testResults'] for a in s['assertionResults'] if a['status']=='failed']
  correct=run.returncode==0 and report['numPassedTests']==19 if expected is None else run.returncode!=0 and any(expected in f for f in failed)
  results.append({'case':name,'outcome':'survived' if run.returncode==0 else 'killed','expectedFailure':expected,'failedTests':failed,'expectedOutcome':correct});print(name,results[-1]['outcome'],flush=True);assert correct,(name,failed)
finally:
 assert source.read_text()==original
 (review/'resolution-panel-controls.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(original.encode()).hexdigest(),'testSha256':hashlib.sha256((app/test).read_bytes()).hexdigest(),'privateEvidence':str(private),'results':results,'limits':'Actual React controller, recovery helper and native cryptographic verification using synthetic absent-request receipts and mocked HTTP. Browser geometry, real cookies, database transitions, provider execution and actual download artifacts are outside this suite.'},indent=2)+'\n')
