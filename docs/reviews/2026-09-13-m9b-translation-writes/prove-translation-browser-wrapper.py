"""Guard controls using mocked process boundaries, followed by real installed-state exit probes."""
from pathlib import Path
import hashlib,json,os,subprocess,time
review=Path(__file__).resolve().parent
source=review/'run-translation-editor-browser.py';original=source.read_text()
test=review/'test-translation-browser-wrapper.py'
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913')/('translation-browser-wrapper-controls-'+time.strftime('%Y%m%dT%H%M%S'));private.mkdir(parents=True)
cases=[('baseline',original,None),('harmless',original+'\n# Harmless wrapper control.\n',None)]
def mutate(name,old,new,expected):
 assert original.count(old)==1,(name,original.count(old));cases.append((name,original.replace(old,new),expected))
mutate('omit-installation-check',"assert before['count'] == 336 and before['latest'] == '20261014000017', 'Expected installed translation migration 17'",'pass','test_wrong_installation_never_launches_child')
for name,old in [('staff-command',"before['command'] and "),('anonymous-command',"not before['anonymousCommand'] and "),('direct-writes'," and not before['directWrites']")]:
 mutate('omit-'+name,old,'','test_wrong_installation_never_launches_child')
mutate('omit-preservation-check',"assert preserved, 'Browser child changed installed translation permissions or migrations'",'pass','test_child_cannot_silently_change_installed_state')
mutate('lose-child-exit-code','return code','return 0','test_normal_and_abrupt_children_preserve_installed_state')
results=[]
try:
 for name,body,expected in cases:
  assert source.read_text()==original;source.write_text(body)
  try:run=subprocess.run(['python3','-B',str(test),'-v'],text=True,capture_output=True,timeout=30)
  finally:source.write_text(original)
  output=run.stdout+run.stderr;(private/(name+'.log')).write_text(output)
  correct=run.returncode!=0 and 'FAIL: '+expected in output and 'AssertionError' in output if expected else run.returncode==0 and 'Ran 4 tests' in output
  results.append({'case':name,'expectedFailure':expected,'exit':run.returncode,'expectedOutcome':correct})
  print(name,'expected' if correct else 'UNEXPECTED',flush=True);assert correct,output
finally:assert source.read_text()==original
# These child exit probes use the real identified dev stack; they do not launch Chrome or mutate grants.
for access in [False,True]:
 for mode,code in [('control',0),('1',23)]:
  env={**os.environ,'OPENPLAN_TRANSLATION_CLEANUP_PROBE':mode,'OPENPLAN_TRANSLATION_ACCESS_PROBE':'1' if access else '0'}
  run=subprocess.run(['python3','-B',str(source)],env=env,text=True,capture_output=True,timeout=30)
  (private/(f'installed-{access}-{mode}.log')).write_text(run.stdout+run.stderr)
  assert run.returncode==code,(run.returncode,run.stdout,run.stderr)
  suffix='control' if mode=='control' else 'abrupt-exit'
  proof=json.loads((private.parent/f'translation-editor-installed-permissions-{"access-" if access else ""}{suffix}.json').read_text())
  assert proof['installedPermissionsPreserved'] and proof['before']==proof['after'] and proof['childExit']==code
  results.append({'case':f'installed-{access}-{mode}','exit':code,'installedPermissionsPreserved':True,'expectedOutcome':True})
  print('installed',access,mode,'preserved',flush=True)
(review/'translation-browser-wrapper-controls.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(original.encode()).hexdigest(),'testSha256':hashlib.sha256(test.read_bytes()).hexdigest(),'privateEvidence':str(private),'results':results,'limits':'Source faults run only against mocked process/SQL boundaries. Four actual child exits read installed 336/17 grants before and after; no permission changes, browser journeys or model calls occur in this script.'},indent=2)+'\n')
