"""Coverage claims for the actual assignment branch and retained numerical path."""
import hashlib,json,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'
source=(WORKER/'main.py').read_text()
cases=[('baseline',source,''),('harmless',source+'\n# Harmless comment.\n',''),
 ('ignore-geometry-identity',source.replace('expected_geometry=zone_geometry', 'expected_geometry=None'),'test_changed_assignment_geometry_stops_without_auto_fallback'),
 ('erase-transit-status',source.replace('transit_status = retained_transit["transit_status"]', 'transit_status = "no_local_feed"'),'test_actual_mode_choice_uses_retained_result_and_writes_auto_matrix'),
 ('swallow-custody-failure',source.replace('            except WorkerStateWriteUnconfirmed:\n                raise\n', '').replace('                if transit_inputs_override is not None:\n                    raise WorkerStateWriteUnconfirmed("Retained mode choice requires reconciliation") from e\n',''),'test_corrupted_feed_stops_without_auto_fallback'),
 ('skip-parent-transit-request',source.replace('transit_inputs_override = _call_engine_binding(engine, "prepare_transit", out_dir, transit_inputs_override)', 'transit_inputs_override = None'),'test_bound_assignment_requests_parent_transit_before_mode_choice'),
 ('restored',source,'')]
runner='''
import ast,sys,unittest
import test_assignment_retained_transit as tests
from test_model_skip_dispatch import aeq
source=open(sys.argv[1]).read();tests.ASSIGNMENT_SOURCE=source
node=next(n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef) and n.name=='consume_assignment_transit')
exec(compile(ast.Module(body=[node],type_ignores=[]),'main.py','exec'),vars(aeq))
name='test_assignment_retained_transit'+('.AssignmentRetainedTransitTests.'+sys.argv[2] if sys.argv[2] else '')
r=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromName(name))
raise SystemExit(0 if r.wasSuccessful() else 1)
'''
records=[]
with tempfile.TemporaryDirectory() as directory:
 p=Path(directory)/'candidate.py'
 for name,body,target in cases:
  p.write_text(body)
  r=subprocess.run([sys.executable,'-B','-c',runner,str(p),target],cwd=WORKER,capture_output=True,text=True,timeout=30)
  if target:
   if r.returncode!=1 or 'FAIL: '+target not in r.stderr:raise AssertionError(name+': '+r.stderr)
  elif r.returncode:raise AssertionError(name+': '+r.stderr)
  records.append({'control':name,'exit_code':r.returncode,'targeted_test':target or None})
report={'module_sha256':hashlib.sha256(source.encode()).hexdigest(),'controls':records,'limits':'Actual mode-choice AST branch, real synthetic feed and geometry, and auto matrix artifact. No full native assignment, dispatcher lifecycle or scientific acceptance.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'assignment-transit-controls.json').write_text(content);print(content)
