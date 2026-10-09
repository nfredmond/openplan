"""Temporary-source controls for explicit persisted network factor maps."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

root=Path(__file__).resolve().parents[4]
worker=root/'workers/aequilibrae_worker'
source=(worker/'network_settings.py').read_text()
checks=[('baseline',None),('harmless',None),('persisted-null','test_persisted_non_objects_never_select_baseline'),
        ('builder-falsy','test_builder_rejects_non_objects_with_domain_error'),
        ('snapshot-null','test_malformed_persisted_factors_stop_before_snapshot_or_execution'),('restored',None)]
results=[]
for control,test in checks:
    candidate=source
    if control in ('persisted-null','snapshot-null'):
        old="    if not isinstance(settings['road_class_factors'],dict):"
        assert candidate.count(old)==1
        candidate=candidate.replace(old,'    if False:')
    elif control=='builder-falsy':
        old='    if not isinstance(road_class_factors,dict):'
        assert candidate.count(old)==1
        candidate=candidate.replace(old,'    if False:').replace('in road_class_factors.items():','in (road_class_factors or {}).items():')
    elif control=='harmless':candidate+='\n# Harmless factor-map comment.\n'
    with tempfile.TemporaryDirectory(prefix='openplan-network-settings-control-') as tmp:
        (Path(tmp)/'network_settings.py').write_text(candidate)
        targets=['test_network_settings','test_assignment_network_graph']
        if test:
            module='test_assignment_network_graph.NetworkGraphTests' if control=='snapshot-null' else 'test_network_settings.NetworkSettingsTests'
            targets=[module+'.'+test]
        code=f"import sys,unittest;sys.path[:0]=[{tmp!r},{str(worker)!r}];result=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromNames({targets!r}));raise SystemExit(not result.wasSuccessful())"
        result=subprocess.run([sys.executable,'-B','-c',code],capture_output=True,text=True,timeout=30)
        log=result.stdout+result.stderr
        reason='AssignmentSettingsError not raised' if test else None
        matched=result.returncode==0 if reason is None else result.returncode!=0 and reason in log
        if not matched:raise AssertionError(f'{control}: {log}')
        results.append({'control':control,'returncode':result.returncode,'expected_failure':reason,'matched':matched})
assert (worker/'network_settings.py').read_text()==source
report={'source_sha256':hashlib.sha256(source.encode()).hexdigest(),'controls':results,
        'limits':'Validator and pre-execution synthetic solver checks. No native engine, database, demand-equivalence or scientific acceptance claim.'}
(Path(__file__).parent/'network-settings-controls.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
