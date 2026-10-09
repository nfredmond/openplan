"""Verify that both replacement guards protect retained host evidence."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[4]
runtime=ROOT/'workers/activitysim_worker/runtime.py'
pipeline=ROOT/'scripts/modeling/run_behavioral_demand_prototype.py'
original={path:path.read_bytes() for path in (runtime,pipeline)}
runtime_call=b'    require_no_host_custody(path)\n'
pipeline_call=b'    require_no_host_custody(resolved_output_root / "runtime")\n'
alias_guard=b'if records.exists() or records.is_symlink():'
assert original[runtime].count(runtime_call)==1
assert original[pipeline].count(pipeline_call)==1
assert original[runtime].count(alias_guard)==1
cases=[]
variants=(
    ('harmless',{path:content+b'\n# Harmless host retention control.\n' for path,content in original.items()},None),
    ('erase-runtime',{runtime:original[runtime].replace(runtime_call,b'')},'test_runtime_force_preserves_host_records'),
    ('erase-pipeline',{pipeline:original[pipeline].replace(pipeline_call,b'')},'test_pipeline_force_preserves_host_records'),
    ('ignore-record-alias',{runtime:original[runtime].replace(alias_guard,b'if records.exists():')},'test_runtime_force_preserves_host_records'),
    ('restored',{},None),
)
if sys.version_info[:2]==(3,11):
    current_loop=b'    for stage in (path / "stages").glob("*"):\n        records = stage / "host_supervision"\n'
    old_loop=b'    for records in path.glob("stages/*/host_supervision"):\n'
    assert original[runtime].count(current_loop)==1
    variants=variants[:-1]+(('old-python-glob',{runtime:original[runtime].replace(current_loop,old_loop)},'test_runtime_force_preserves_host_records'),)+variants[-1:]
try:
    for name,changes,failure in variants:
        for path,content in original.items():path.write_bytes(changes.get(path,content))
        result=subprocess.run([sys.executable,'-B','-m','unittest','discover','-s','workers/activitysim_worker/tests',
            '-p','test_host_record_preservation.py','-v'],cwd=ROOT,text=True,capture_output=True,timeout=30)
        output=result.stdout+result.stderr
        expected=(result.returncode!=0 and failure in output and ('RuntimeError not raised' in output or 'Retained pipeline was replaced' in output)) if failure else result.returncode==0
        assert expected,output
        cases.append({'case':name,'returncode':result.returncode,'expected_behavior_observed':True})
finally:
    for path,content in original.items():path.write_bytes(content)
report={'python_version':sys.version.split()[0],'cases':cases,'sources':{str(path.relative_to(ROOT)):hashlib.sha256(content).hexdigest() for path,content in original.items()},
    'limits':['Synthetic retained filesystem records and dangling aliases','No concurrent filesystem attacker, active native process, database or scientific acceptance']}
content=json.dumps(report,indent=2)+'\n'
Path(__file__).with_name(f'host-record-preservation-py{sys.version_info.major}{sys.version_info.minor}-controls.json').write_text(content)
print(content)
