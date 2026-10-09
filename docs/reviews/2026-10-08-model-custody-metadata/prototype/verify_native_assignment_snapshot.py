"""Compare a completed native assignment's input snapshot with its OMX exports."""
import hashlib
import json
import os
from pathlib import Path
import numpy as np
from aequilibrae.matrix import AequilibraeMatrix

ROOT=Path(__file__).resolve().parent
output=Path(os.environ['OPENPLAN_BOUND_ASSIGNMENT_OUTPUT'])
control=os.environ.get('OPENPLAN_SNAPSHOT_VERIFICATION_CONTROL','baseline')
assert control in ('baseline','harmless','matrix-mismatch','restored')
results=list(output.glob('runs/**/assignment-result.json'))
assert len(results)==1,'Expected one completed native assignment'
result=json.loads(results[0].read_bytes())
record=result['initial_assignment_inputs']
path=Path(record['manifest_path'])
content=path.read_bytes()
assert len(content)==record['bytes'] and hashlib.sha256(content).hexdigest()==record['sha256']
manifest=json.loads(content)
if control=='harmless':manifest=dict(reversed(list(manifest.items())))
assert manifest['scope']=='initial_assignment_only' and manifest['scientific_acceptance']=='unassessed'
assert manifest['network_state']==result['network_state_record']
assert manifest['network_settings']==result['network_settings']
checked=[]
for entry in manifest['classes']:
    for role in ('centroids','demand'):
        data=(path.parent/entry[role]['path']).read_bytes()
        assert len(data)==entry[role]['bytes'] and hashlib.sha256(data).hexdigest()==entry[role]['sha256']
    matrix=AequilibraeMatrix()
    try:
        matrix.load(str(path.parent.parent/(entry['class']+'_demand.omx')))
        matrix.computational_view([entry['class']])
        np.testing.assert_array_equal(matrix.index,np.load(path.parent/entry['centroids']['path'],allow_pickle=False))
        expected=np.load(path.parent/entry['demand']['path'],allow_pickle=False)
        if control=='matrix-mismatch':expected[0,1]+=1
        np.testing.assert_array_equal(matrix.matrix_view,expected)
    finally:matrix.close()
    checked.append(entry['class'])
assert checked==['resident','external']
worker=ROOT.parents[3]/'workers/aequilibrae_worker'
report={'control':control,'native_engine_version':json.loads((output/'result.json').read_bytes())['engine_version'],
        'classes_checked':checked,'matrix_exports_equal_retained_inputs':True,
        'network_state_and_settings_match_result':True,'manifest_sha256':record['sha256'],
        'source_sha256':hashlib.sha256((worker/'model_assignment_input_snapshot.py').read_bytes()).hexdigest(),
        'limits':'Two-centroid, one-link synthetic initial assignment using injected parent database responses. No calibration, preparation registration, normal dispatch or scientific acceptance.'}
(output/'snapshot-verification.json').write_text(json.dumps(report,indent=2)+'\n')
(ROOT/'native-assignment-input-snapshot.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
