"""Actual stage snapshot must retain its native working database identity."""
import json
import os
from pathlib import Path
import subprocess
import sys

root=Path(__file__).resolve().parent
output=Path(os.environ['OPENPLAN_NATIVE_NETWORK_SOURCE_CONTROLS'])
output.mkdir(mode=0o700,parents=True,exist_ok=False)
results=[]
for control in ('baseline','harmless','omit-source','restored'):
    inject="\nimport model_assignment_input_snapshot\noriginal_snapshot=model_assignment_input_snapshot.retain_and_execute\ndef omit_source(*args,**kwargs):\n kwargs['network_database']=None\n return original_snapshot(*args,**kwargs)\nmodel_assignment_input_snapshot.retain_and_execute=omit_source\n"
    code=f"import sys;sys.path.insert(0,{str(root)!r});import verify_native_bound_assignment as proof;"
    if control=='omit-source':code+=f"proof.CHILD=proof.CHILD.replace('import main\\n','import main\\n'+{inject!r});"
    elif control=='harmless':code+="proof.CHILD+='\\n# Harmless source custody comment.\\n';"
    code+='proof.main()'
    env=dict(os.environ,OPENPLAN_BOUND_ASSIGNMENT_OUTPUT=str(output/control),OPENPLAN_BOUND_ASSIGNMENT_CONTROL='baseline')
    result=subprocess.run([sys.executable,'-B','-c',code],env=env,capture_output=True,text=True,timeout=150)
    log=result.stdout+result.stderr;(output/(control+'.log')).write_text(log)
    failure='Native assignment source network identity missing or different' if control=='omit-source' else None
    matched=result.returncode==0 if failure is None else result.returncode!=0 and failure in log
    results.append({'control':control,'returncode':result.returncode,'expected_failure':failure,'matched':matched})
    if not matched:raise AssertionError(f'{control}: {log[-4000:]}')
report={'controls':results,'limits':'Actual AequilibraE 1.6.2 assignment with synthetic two-centroid, one-link inputs and injected parent transport. Exact logical working source readback, not prepared graph transformation equivalence or scientific acceptance.'}
(output/'controls.json').write_text(json.dumps(report,indent=2)+'\n')
(root/'native-network-source-controls.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
