"""Check effect delivery timing without weakening the readiness requirement."""
import hashlib,json,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
app=ROOT/'openplan'
component=app/'src/components/engagement/synthesis-thematic-inputs-panel.tsx'
test=app/'src/test/engagement-synthesis-thematic-choice-panel.test.tsx'
source=component.read_text();fixed=test.read_text()
anchor='useEffect(() => { onReadyChange(complete); }, [complete, onReadyChange]);'
assert source.count(anchor)==1
delayed=source.replace(anchor,'useEffect(() => { const timer = setTimeout(() => onReadyChange(complete), 20); return () => clearTimeout(timer); }, [complete, onReadyChange]);')
broken=source.replace(anchor,'useEffect(() => { onReadyChange(false); }, [complete, onReadyChange]);')
old=fixed.replace('await waitFor(() => expect(onReadyChange).toHaveBeenLastCalledWith(true));','expect(onReadyChange).toHaveBeenLastCalledWith(true);')
assert old!=fixed
cases=[]
try:
 for name,body,spec,expected in [('old-test-delayed-effect',delayed,old,1),('fixed-test-delayed-effect',delayed,fixed,0),('never-ready',broken,fixed,1),('restored',source,fixed,0)]:
  component.write_text(body);test.write_text(spec)
  run=subprocess.run(['npm','exec','--','vitest','run',str(test.relative_to(app)),'-t','does not report readiness until every source contribution has a confirmed choice','--maxWorkers=1','--no-file-parallelism'],cwd=app,text=True,capture_output=True)
  output=run.stdout+run.stderr
  assert run.returncode==expected,output
  if expected:assert 'expected last' in output and 'true' in output,output
  cases.append({'case':name,'returncode':run.returncode,'expected_behavior_observed':True})
finally:component.write_text(source);test.write_text(fixed)
print(json.dumps({'cases':cases,'test_sha256':hashlib.sha256(fixed.encode()).hexdigest(),'component_unchanged_sha256':hashlib.sha256(source.encode()).hexdigest(),'limits':['Focused DOM test; delayed effect is a timing control, not reproduction of the full CI scheduler','Full shuffled suite and real browser acceptance remain separate']},indent=2))
