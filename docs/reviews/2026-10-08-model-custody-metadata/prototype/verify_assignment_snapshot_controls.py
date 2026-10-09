"""Mutation checks for the pre-execution snapshot using isolated module copies."""
import hashlib,json,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
worker=ROOT/'workers/aequilibrae_worker'
source=(worker/'model_assignment_input_snapshot.py').read_text()
checks=[
 ('harmless',None,None,None,None),
 ('early-execute','    classes=list(assignment.classes)','    assignment.execute()\n    classes=list(assignment.classes)','test_complete_exact_inputs_exist_before_execute','FileNotFoundError'),
 ('reuse-directory','destination.mkdir(mode=0o700,exist_ok=False)','destination.mkdir(mode=0o700,exist_ok=True)','test_partial_directory_is_not_adopted','FileExistsError not raised'),
 ('skip-readback','if restored.dtype!=array.dtype or not np.array_equal(restored,array):','if False:','test_corrupt_saved_array_prevents_execute','ValueError not raised'),
 ('changed-settings',"if any(actual[key]!=profile[key] for key in actual):",'if False:','test_changed_settings_or_pce_never_execute','ValueError not raised'),
 ('changed-graph','if not np.array_equal(index,np.asarray(item.graph.centroids)):','if False:','test_graph_centroid_mismatch_never_executes','ValueError not raised'),
 ('restored',None,None,None,None),
]
results=[]
for name,old,new,test,reason in checks:
 candidate=source
 if old:
  assert candidate.count(old)==1,name
  candidate=candidate.replace(old,new)
 elif name=='harmless':candidate+='\n# Harmless comment.\n'
 with tempfile.TemporaryDirectory(prefix='openplan-input-control-') as tmp:
  (Path(tmp)/'model_assignment_input_snapshot.py').write_text(candidate)
  target='test_assignment_input_snapshot'+('.SnapshotTests.'+test if test else '')
  code=f"import sys,unittest;sys.path[:0]=[{tmp!r},{str(worker)!r}];result=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromName({target!r}));raise SystemExit(not result.wasSuccessful())"
  result=subprocess.run([sys.executable,'-B','-c',code],capture_output=True,text=True,timeout=30)
  log=result.stdout+result.stderr
  matched=result.returncode==0 if reason is None else result.returncode!=0 and reason in log
  results.append({'control':name,'returncode':result.returncode,'expected_failure':reason,'matched':matched})
  if not matched:raise AssertionError(f'{name}: {log}')
report={'source_sha256':hashlib.sha256(source.encode()).hexdigest(),'controls':results,'limits':'Injected solver interface with real arrays and files. Native engine evidence is recorded separately.'}
(Path(__file__).parent/'assignment-snapshot-controls.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
