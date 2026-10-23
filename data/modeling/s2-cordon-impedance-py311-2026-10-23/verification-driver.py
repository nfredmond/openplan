import subprocess,json,hashlib,sys
from pathlib import Path
root=Path.cwd(); out=root/'data/modeling/s2-cordon-impedance-py311-2026-10-23'
py='/home/nathaniel/.local/state/openplan/s2-cordon-py311-20261023/venv/bin/python3'
bad='/home/nathaniel/.local/state/openplan/s2-cordon-20261023/venv/bin/python3'
checks=[('dependency_preflight',[py,'-B','workers/aequilibrae_worker/check_local_dependencies.py'],0),('actual_python314_refusal',[bad,'-B','workers/aequilibrae_worker/check_local_dependencies.py'],1)]
for s in ['workers/aequilibrae_worker/test_assignment_runtime.py','scripts/modeling/s2_cordon/test_measurement_contract.py','scripts/modeling/s2_cordon/test_py311_successor.py','workers/aequilibrae_worker/test_local_launchers.py','workers/aequilibrae_worker/test_assignment_settings.py','scripts/modeling/tests/test_screening_assignment_settings.py','scripts/modeling/s2_cordon/test_successor.py','scripts/modeling/s2_cordon/test_study.py','workers/hosted-models/verify_graph_compatibility.py','workers/aequilibrae_worker/test_dependency_pins.py']:
 checks.append((s,[py,'-B',s,'-v'],0))
records=[]
for name,cmd,expected in checks:
 r=subprocess.run(cmd,capture_output=True,text=True)
 text=r.stdout+r.stderr
 okay=r.returncode==expected and (name!='actual_python314_refusal' or 'CPython 3.11' in text)
 records.append({'name':name,'command':cmd,'exit_code':r.returncode,'expected_exit':expected,'matched_expectation':okay,'output':text,'sha256':hashlib.sha256(text.encode()).hexdigest()})
 (out/'checks.json').write_text(json.dumps(records,indent=2)+'\n')
 print(name,r.returncode,text[-220:],flush=True)
 if not okay:sys.exit(1)
