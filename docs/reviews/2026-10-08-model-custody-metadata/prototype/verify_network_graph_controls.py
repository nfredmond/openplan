"""Temporary-source controls for directed network transformations."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

root=Path(__file__).resolve().parents[4];worker=root/'workers/aequilibrae_worker'
source=(worker/'model_assignment_network_graph.py').read_text()
checks=[
 ('baseline',None,None,None,None),('harmless',None,None,None,None),
 ('skip-comparison',"if actual!=expected:raise ValueError('Assignment graph differs from source and recorded transformations')",'pass','test_drift_stops_snapshot_and_execution_even_when_live_arrays_agree','ValueError not raised'),
 ('ignore-factor',"factor=factors.get(str(row.get('link_type') or ''),1.0)",'factor=1.0','test_recorded_road_class_factors_match_effective_fields','ValueError: Assignment graph differs'),
 ('ignore-mode',"if mode not in modes:end=start",'if False:end=start','test_unavailable_mode_collapses_both_directions_to_source_a_node','ValueError: Assignment graph differs'),
 ('no-reverse-swap','sign,start if sign==1 else end,end if sign==1 else start,','sign,start,end,','test_baseline_and_row_reordering_match_source','ValueError: Assignment graph differs'),
 ('extra-directions',"if record['position']!=len(record['order']):raise ValueError('Assignment graph adds directions absent from source')",'pass','test_missing_and_extra_directions_refuse','ValueError not raised'),
 ('absent-nodes',"if record['remaining_nodes']:raise ValueError('Assignment graph node map contains nodes absent from source')",'pass','test_invalid_or_absent_node_map_refuses','ValueError not raised'),
 ('restored',None,None,None,None),
]
results=[]
for control,old,new,test,reason in checks:
 candidate=source
 if old:
  assert candidate.count(old)==1,control
  candidate=candidate.replace(old,new)
 elif control=='harmless':candidate+='\n# Harmless directed graph comment.\n'
 with tempfile.TemporaryDirectory(prefix='openplan-network-graph-control-') as tmp:
  (Path(tmp)/'model_assignment_network_graph.py').write_text(candidate)
  target='test_assignment_network_graph'+('.NetworkGraphTests.'+test if test else '')
  code=f"import sys,unittest;sys.path[:0]=[{tmp!r},{str(worker)!r}];result=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromName({target!r}));raise SystemExit(not result.wasSuccessful())"
  result=subprocess.run([sys.executable,'-B','-c',code],capture_output=True,text=True,timeout=30)
  log=result.stdout+result.stderr
  matched=result.returncode==0 if reason is None else result.returncode!=0 and reason in log
  results.append({'control':control,'returncode':result.returncode,'expected_failure':reason,'matched':matched})
  if not matched:raise AssertionError(f'{control}: {log}')
report={'source_sha256':hashlib.sha256(source.encode()).hexdigest(),'controls':results,
        'limits':'Real SQLite with synthetic graph objects. Does not establish compressed routing equivalence, demand transformations or scientific acceptance.'}
(Path(__file__).parent/'network-graph-controls.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
