"""Keep relaunch notices testable without bypassing retained-execution refusal."""
import json,os,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4];APP=ROOT/'openplan'
path=APP/'src/components/models/model-run-evidence-panel.tsx';original=path.read_bytes();source=original.decode()
tests=['src/test/a-failed-run-says-it-failed.test.tsx','src/test/a-relaunch-says-whether-the-fix-took.test.tsx','src/test/model-recovery-status-controls.test.tsx']
cases=[('harmless',source+'\n// Harmless relaunch fixture control.\n',None),
 ('missing-runtime-copy',source.replace('{runMode.runtimeExpectation}','{"Synthetic missing runtime copy"}'),'shows evidence-panel runtime guidance'),
 ('false-demographics-warning',source.replace('payload.zoneAttributes.status !== "supplied" &&','true &&'),'stays silent on a SUCCESSFUL rebuild'),
 ('unsafe-relaunch',source.replace('relaunchNotice === null && isWorkerExecutedRunMode','isWorkerExecutedRunMode'),'withholds relaunch for'),
 ('restored',source,None)]
records=[]
try:
 for name,body,expected in cases:
  if expected:assert body!=source
  path.write_text(body)
  result=subprocess.run(['npx','vitest','run',*tests,'--maxWorkers=1'],cwd=APP,capture_output=True,text=True,timeout=90)
  output=result.stdout+result.stderr
  if expected:assert result.returncode!=0 and expected in output,output
  else:assert result.returncode==0,output
  records.append({'case':name,'returncode':result.returncode,'detected':expected,'verified':True})
finally:path.write_bytes(original)
print(json.dumps({'cases':records,'limits':['Component tests with mocked fetch','No browser, authenticated route or human acceptance']},indent=2))
