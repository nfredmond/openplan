"""Focused storage-failure controls for the real generation editor and helpers."""
from pathlib import Path
import hashlib,json,re,subprocess,time
review=Path(__file__).resolve().parent;app=review.parents[2]/'openplan'
paths={'helper':app/'src/lib/engagement/translation-generation-editor.ts','panel':app/'src/components/engagement/translation-generation-panel.tsx','resolution':app/'src/lib/engagement/translation-resolution-recovery.ts'}
original={k:p.read_text() for k,p in paths.items()};test=app/'src/test/translation-generation-editor.test.tsx'
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913')/('generation-recovery-controls-'+str(time.time_ns()));private.mkdir(mode=0o700)
cases=[('baseline','helper',original['helper'],None)]+[('harmless-'+k,k,body+'\n// Harmless recovery control.\n',None) for k,body in original.items()]
def mutate(name,key,old,new,expected):
 assert original[key].count(old)==1,(name,original[key].count(old));cases.append((name,key,original[key].replace(old,new),expected))
mutate('omit-request-readback','helper','if (storage.getItem(key) !== raw) throw new Error("Generation request was not retained");','/* Missing retained request readback. */','refuses dispatch when retained request readback differs')
mutate('lose-refusal-phase','panel','catch { volatile.current.set(retained.intent.requestId, retained); }','catch { /* Lost refusal memory. */ }','retains a refused phase in memory when its storage update fails')
mutate('erase-unretrieved-request','panel','} catch { setMessage("The saved request could not be matched,','} catch { localStorage.removeItem(key); restore(); setMessage("The saved request could not be matched,','preserves unreadable recovery when the saved request cannot be retrieved')
mutate('stale-generation-message','panel','onResolved: bundle => {\n      setMessage(null);','onResolved: bundle => {','clears the earlier unconfirmed message after verified resolution')
mutate('omit-archive-readback','resolution','if (storage.getItem(archive) !== archiveRaw || storage.getItem(key) !== pending)','if (storage.getItem(key) !== pending)','keeps the refused source copy when archive readback fails')
results=[]
try:
 for name,key,body,expected in cases:
  assert all(p.read_text()==original[k] for k,p in paths.items());paths[key].write_text(body);target=private/(name+'.json')
  command=['npm','exec','--','vitest','run',str(test.relative_to(app)),'--reporter=json','--outputFile='+str(target)]
  if expected:command+=['-t',re.escape(expected)]
  try:run=subprocess.run(command,cwd=app,text=True,capture_output=True,timeout=30)
  finally:paths[key].write_text(original[key])
  (private/(name+'.log')).write_text(run.stdout+run.stderr);report=json.loads(target.read_text())
  failed=[a['fullName'] for suite in report['testResults'] for a in suite['assertionResults'] if a['status']=='failed']
  correct=run.returncode==0 and report['numPassedTests']==33 if expected is None else run.returncode!=0 and any(expected in f for f in failed)
  results.append({'case':name,'outcome':'survived' if run.returncode==0 else 'killed','expectedFailure':expected,'failedTests':failed,'expectedOutcome':correct});print(name,results[-1]['outcome'],flush=True);assert correct,(name,failed)
finally:
 assert all(p.read_text()==original[k] for k,p in paths.items())
 (review/'generation-recovery-controls.json').write_text(json.dumps({'sourceSha256':{k:hashlib.sha256(v.encode()).hexdigest() for k,v in original.items()},'testSha256':hashlib.sha256(test.read_bytes()).hexdigest(),'privateEvidence':str(private),'results':results,'limits':'React and storage failures with synthetic records and mocked HTTP. Tests protect retention and refusal behavior; resolution archive readback uses the real controller and checksum helper with synthetic absent-request receipts. No real downloads, HTTP/database join, browser lifecycle or public generation acceptance.'},indent=2)+'\n')
