"""Temporary-source controls for live profile verification."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parents[4]
worker = root/'workers/aequilibrae_worker'
source = (worker/'model_assignment_live_profile.py').read_text()
checks = [
    ('baseline',None,None,None), ('harmless',None,None,None),
    ('engine-version',"if installed_assignment_engine_version() != expected['engine_version']:",'if False:','test_installed_version_mismatch_refuses'),
    ('internal-settings','if getattr(target, attribute) != expected[key]:','if False:','test_internal_solver_settings_drift_refuses'),
    ('fields-vdf',"if getattr(target, field) != expected['capacity_field'] or target.vdf.function != expected['vdf']:",'if False:','test_internal_fields_or_vdf_drift_refuses'),
    ('vdf-values',"if array.ndim != 1 or array.size == 0 or not np.all(array == expected['vdf_parameters'][key]):",'if False:','test_effective_vdf_arrays_refuse_drift_or_wrong_shape'),
    ('network-values',"or not np.array_equal(array[indices], np.asarray(graph[expected[field]]))",'or False','test_graph_values_must_match_effective_arrays'),
    ('class-identity','if len(solver.traffic_classes) != len(classes) or any(a is not b for a, b in zip(classes, solver.traffic_classes)):','if False:','test_class_identity_and_internal_cores_refuse'),
    ('class-cores',"if item.results.cores != expected['cores'] or item._aon_results.cores != expected['cores']:",'if False:','test_class_identity_and_internal_cores_refuse'),
    ('restored',None,None,None),
]
results = []
for control, old, new, test in checks:
    candidate = source
    if old:
        assert candidate.count(old) == 1, control
        candidate = candidate.replace(old,new)
    elif control == 'harmless': candidate += '\n# Harmless profile comment.\n'
    with tempfile.TemporaryDirectory(prefix='openplan-live-profile-control-') as tmp:
        (Path(tmp)/'model_assignment_live_profile.py').write_text(candidate)
        target = 'test_assignment_live_profile' + ('.LiveProfileTests.'+test if test else '')
        code = f"import sys,unittest;sys.path[:0]=[{tmp!r},{str(worker)!r}];result=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromName({target!r}));raise SystemExit(not result.wasSuccessful())"
        result = subprocess.run([sys.executable,'-B','-c',code],capture_output=True,text=True,timeout=30)
        log = result.stdout+result.stderr
        reason = 'ValueError not raised' if old else None
        matched = result.returncode == 0 if reason is None else result.returncode != 0 and reason in log
        results.append({'control':control,'returncode':result.returncode,'expected_failure':reason,'matched':matched})
        if not matched: raise AssertionError(f'{control}: {log}')
report = {'source_sha256':hashlib.sha256(source.encode()).hexdigest(),'controls':results,
          'limits':'Synthetic solver objects and real snapshot files. Native engine controls are separate; neither establishes scientific acceptance.'}
(Path(__file__).parent/'live-profile-controls.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
