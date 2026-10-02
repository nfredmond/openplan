"""Verify the test-stack allowlist fails closed and restore every mutation."""
import json
from pathlib import Path
import subprocess
root=Path(__file__).resolve().parents[4]
app=root/'openplan'
source=app/'src/test/helpers/contract-verification-stack.ts'
original=source.read_bytes()
text=original.decode()
assert text.count(' if (!named.includes(container)')==1
out=Path(__file__).resolve().parent
results=[]
try:
 for name,candidate,must_fail in [
  ('baseline',text,False),
  ('harmless-comment','// Harmless isolation control.\n'+text,False),
  ('allowlist-bypass',text.replace(' if (!named.includes(container)',' if (false && !named.includes(container)'),True),
 ]:
  source.write_text(candidate)
  report=out/f'security-stack-helper-{name}.json'
  run=subprocess.run(['node','node_modules/vitest/vitest.mjs','run','src/test/contract-verification-stack.test.ts','--reporter=json',f'--outputFile={report}'],cwd=app,capture_output=True,text=True)
  source.write_bytes(original)
  result=json.loads(report.read_text())
  failures=[case for suite in result['testResults'] for case in suite['assertionResults'] if case['status']=='failed']
  if must_fail:
   assert run.returncode!=0 and len(failures)==8
   assert all(any('to throw' in message for message in case['failureMessages']) for case in failures)
  else:
   assert run.returncode==0 and not failures and result['numPassedTests']==13
  results.append({'case':name,'passed':result['numPassedTests'],'failed':result['numFailedTests'],'classification':'KILLED' if must_fail else 'SURVIVED','failedAssertions':[case['fullName'] for case in failures]})
finally:
 source.write_bytes(original)
assert source.read_bytes()==original
(out/'security-stack-helper-mutations.json').write_text(json.dumps({'sourceRestored':True,'results':results},indent=2)+'\n')
print(json.dumps(results,indent=2))
