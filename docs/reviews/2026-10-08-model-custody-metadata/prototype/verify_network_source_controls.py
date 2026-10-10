"""Harmless and broken controls for logical node/link source identity."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

root=Path(__file__).resolve().parents[4];worker=root/'workers/aequilibrae_worker'
source=(worker/'model_assignment_network_source.py').read_text()
checks=[
 ('baseline',None,None,None,None),('harmless',None,None,None,None),
 ('ignore-geometry',"if isinstance(value,bytes): return ['blob',value.hex()]","if isinstance(value,bytes): return ['blob','ignored']",'test_node_link_topology_values_and_geometry_changes_are_detected','AssertionError'),
 ('duplicate-identities','if not isinstance(item_id,int) or item_id==previous:','if not isinstance(item_id,int):','test_duplicate_or_noninteger_ids_refuse','ValueError not raised'),
 ('noninteger-identities','if not isinstance(item_id,int) or item_id==previous:','if item_id==previous:','test_duplicate_or_noninteger_ids_refuse','ValueError not raised'),
 ('empty-source',"if count==0: raise ValueError('Network source table is empty')",'pass','test_empty_or_view_source_refuses','ValueError not raised'),
 ('column-order',"columns=sorted(item[1] for item in connection.execute('PRAGMA table_info(\"'+table+'\")'))","columns=[item[1] for item in connection.execute('PRAGMA table_info(\"'+table+'\")')]",'test_column_order_and_row_insertion_order_are_irrelevant','AssertionError'),
 ('restored',None,None,None,None),
]
results=[]
for control,old,new,test,reason in checks:
 candidate=source
 if old:
  assert candidate.count(old)==1,control
  candidate=candidate.replace(old,new)
 elif control=='harmless':candidate+='\n# Harmless source identity comment.\n'
 with tempfile.TemporaryDirectory(prefix='openplan-network-source-control-') as tmp:
  (Path(tmp)/'model_assignment_network_source.py').write_text(candidate)
  target='test_assignment_network_source'+('.NetworkSourceTests.'+test if test else '')
  code=f"import sys,unittest;sys.path[:0]=[{tmp!r},{str(worker)!r}];result=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromName({target!r}));raise SystemExit(not result.wasSuccessful())"
  result=subprocess.run([sys.executable,'-B','-c',code],capture_output=True,text=True,timeout=30)
  log=result.stdout+result.stderr
  matched=result.returncode==0 if reason is None else result.returncode!=0 and reason in log
  results.append({'control':control,'returncode':result.returncode,'expected_failure':reason,'matched':matched})
  if not matched:raise AssertionError(f'{control}: {log}')
report={'source_sha256':hashlib.sha256(source.encode()).hexdigest(),'controls':results,
        'limits':'Real synthetic SQLite tables. Does not establish the transformation from source records to the solver graph, source adequacy or scientific acceptance.'}
(Path(__file__).parent/'network-source-controls.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
