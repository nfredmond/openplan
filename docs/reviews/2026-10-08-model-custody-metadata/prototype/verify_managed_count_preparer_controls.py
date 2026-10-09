"""Exercise the actual count-preparation function under targeted mutations."""
import ast,hashlib,json,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'
source=(WORKER/'main.py').read_text()
node=next(n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef) and n.name=='managed_assignment_count_preparer')
body=ast.get_source_segment(source,node)
cases=[('baseline',body,None,None),('harmless',body+'\n# Harmless comment.\n',None,None),
 ('lose-calibration',body.replace('calibrate_requested=resolve_calibration_enabled(run_row)','calibrate_requested=False'),'test_original_setup_and_current_calibration_reach_acquisition','FAIL: '),
 ('share-setup',body.replace('setup = copy.deepcopy(setup_result)','setup = setup_result'),'test_original_setup_and_current_calibration_reach_acquisition','FAIL: '),
 ('skip-owned-read',body.replace('run_row = writer.read_run(writer.context.run_id)',"run_row = {'input_snapshot_json': {}}"),'test_changed_ownership_stops_before_preparation','FAIL: '),
 ('ignore-bound-owner',body.replace('if managed.current() is not writer:', 'if False:'),'test_requires_original_binding_at_invocation','FAIL: '),
 ('restored',body,None,None)]
runner='''
import sys,unittest
from pathlib import Path
from test_model_skip_dispatch import aeq
exec(compile(Path(sys.argv[1]).read_text(),'main.py','exec'),vars(aeq))
name='test_managed_count_preparer'+('.ManagedCountPreparerTests.'+sys.argv[2] if sys.argv[2] else '')
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
  elif r.returncode:raise AssertionError(name+': '+r.stderr)
  records.append({'control':name,'exit_code':r.returncode,'targeted_test':target})
report={'worker_sha256':hashlib.sha256(source.encode()).hexdigest(),'controls':records,'limits':'Actual parent adapter, channel and real child using retained bytes; mocked HTTP, acquisition and project resolver. No live provider, native registration, full stage or scientific acceptance.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'managed-count-preparer-controls.json').write_text(content);print(content)
