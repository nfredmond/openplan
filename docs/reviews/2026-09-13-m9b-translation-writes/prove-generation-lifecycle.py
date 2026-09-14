"""Fault controls for retained request ownership across browser lifecycle changes."""
from pathlib import Path
import hashlib,json,subprocess,time
review=Path(__file__).resolve().parent;app=review.parents[2]/'openplan'
source=app/'src/components/engagement/translation-generation-panel.tsx';test=app/'src/test/translation-generation-editor.test.tsx';original=source.read_text()
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913')/('generation-lifecycle-controls-'+str(time.time_ns()));private.mkdir(mode=0o700)
cases=[('baseline',original,None),('harmless-comment',original+'\n// Harmless lifecycle ownership control.\n',None)]
def change(name,old,new,expected):
 assert original.count(old)==1,(name,original.count(old));cases.append((name,original.replace(old,new),expected))
change('ignore-operation-ownership','assertCurrent: () => { if (!isCurrent()) throw new Error("Generation editor scope changed"); signal.throwIfAborted(); },','assertCurrent: () => {},','preserves pending recovery')
change('detach-read-signal','{ cache: "no-store", signal: run.signal });\n    run.assertCurrent();','{ cache: "no-store", signal: AbortSignal.timeout(30000) });\n    run.assertCurrent();','active read cancelled')
change('omit-unmount-abort','mounted.current = false; active.current?.abort();','mounted.current = false;','active read cancelled')
change('ignore-access-loss','if (!canWrite) {','if (false) {','revocation permanently cancels this operation')
change('old-completion-releases-new-operation','if (active.current !== controller) return;','/* Lost operation ownership. */','old completion cannot release the newer operation')
change('keep-publication-enabled-after-access-loss','setBusy(false); setReadFailed(true);','setBusy(false);','requires a fresh retained-output read')
cases.append(('publish-stale-error',original.replace('if (run.isCurrent())','if (true)'),'ignores a delayed'))
results=[]
try:
 for name,body,expected in cases:
  assert source.read_text()==original;source.write_text(body);output=private/(name+'.json')
  try:run=subprocess.run(['npm','exec','--','vitest','run',str(test.relative_to(app)),'--reporter=json','--outputFile='+str(output)],cwd=app,text=True,capture_output=True,timeout=45)
  finally:
   assert source.read_text()==body;source.write_text(original)
  (private/(name+'.log')).write_text(run.stdout+run.stderr);report=json.loads(output.read_text())
  failed=[{'name':a['fullName'],'messages':a.get('failureMessages',[])} for suite in report['testResults'] for a in suite['assertionResults'] if a['status']=='failed']
  correct=run.returncode==0 and report['numPassedTests']==42 if expected is None else run.returncode!=0 and expected in json.dumps(failed)
  results.append({'case':name,'outcome':'survived' if run.returncode==0 else 'killed','expectedFailure':expected,'failedTests':failed,'expectedOutcome':correct});print(name,results[-1]['outcome'],flush=True);assert correct,(name,failed)
finally:
 assert source.read_text()==original
 (review/'generation-lifecycle-controls.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(original.encode()).hexdigest(),'testSha256':hashlib.sha256(test.read_bytes()).hexdigest(),'privateEvidence':str(private),'results':results,'limits':'Actual React hook with controlled delayed HTTP responses, including bodies fulfilled after abort. No real authentication, browser navigation, live database authorization or provider execution is established by these tests. Scope identity is also enforced by the keyed parent; predicate removal can be masked by redundant token/abort guards.'},indent=2)+'\n')
