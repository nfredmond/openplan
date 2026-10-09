"""Exercise the actual count-preparation function under targeted mutations."""
import ast,hashlib,json,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'
source=(WORKER/'main.py').read_text()
node=next(n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef) and n.name=='prepare_assignment_count_inputs')
body=ast.get_source_segment(source,node)
cases=[('baseline',body,None,None),('harmless',body+'\n# Harmless comment.\n',None,None),
 ('ignore-calibration-choice',body.replace('calibrate_requested=calibrate_requested','calibrate_requested=False'),'test_fresh_acquisition_preserves_run_geography_and_calibration_choice','FAIL: '),
 ('reacquire-retained-input',body.replace('if count_inputs_override is not None:', 'if False:'),'test_retained_record_consumes_without_any_new_acquisition','FAIL: '),
 ('ignore-explicit-source',body.replace('counts_path = counts_path_override or (','counts_path = ('),'test_explicit_missing_source_does_not_select_default','FAIL: '),
 ('allow-conflicting-path',body.replace('if counts_path_override is not None and counts_path_override != recorded_path:', 'if False:'),'test_conflicting_override_refused_before_copy','FAIL: '),
 ('restored',body,None,None)]
runner='''
import sys,unittest
from pathlib import Path
from test_model_skip_dispatch import aeq
exec(compile(Path(sys.argv[1]).read_text(),'main.py','exec'),vars(aeq))
name='test_assignment_count_preparation'+('.PreparationTests.'+sys.argv[2] if sys.argv[2] else '')
r=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromName(name))
raise SystemExit(0 if r.wasSuccessful() else 1)
'''
records=[]
with tempfile.TemporaryDirectory() as temp:
 p=Path(temp)/'candidate.py'
 for name,candidate,target,kind in cases:
  p.write_text(candidate)
  r=subprocess.run([sys.executable,'-B','-c',runner,str(p),target or ''],cwd=WORKER,capture_output=True,text=True,timeout=30)
  if target:
   if r.returncode!=1 or kind+target not in r.stderr:raise AssertionError(name+': '+r.stderr)
   if name=='reacquire-retained-input' and 'AssertionError: Retained record reacquired' not in r.stderr:raise AssertionError('Wrong retained-input failure')
   if name=='ignore-explicit-source' and 'AssertionError: Unexpected acquisition' not in r.stderr:raise AssertionError('Wrong explicit-source failure')
  elif r.returncode:raise AssertionError(name+': '+r.stderr)
  records.append({'control':name,'exit_code':r.returncode,'targeted_test':target})
report={'worker_sha256':hashlib.sha256(source.encode()).hexdigest(),'controls':records,'limits':'Actual extracted preparation function with real count files and manifests; acquisition mocked. No live providers, parent channel, native database registration or scientific acceptance.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'count-preparation-controls.json').write_text(content);print(content)
