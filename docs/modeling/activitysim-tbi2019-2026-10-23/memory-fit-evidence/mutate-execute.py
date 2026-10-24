"""Prove that an engine exit failure cannot become a completed execution."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
E=Path(__file__).resolve().parent;p=E/'execute.py';original=p.read_bytes();results=[]
try:
    for name,source,survives in [
        ('execute-comment',original.decode()+'\n# Harmless execution comment.\n',True),
        ('execute-exit',original.decode().replace('    if completed.returncode:', '    if False:'),False)]:
        p.write_text(source)
        result=subprocess.run([sys.executable,'-B',str(E/'test-admission.py')],capture_output=True,text=True)
        log=result.stdout+result.stderr;(E/('mutation-'+name+'.log')).write_text(log)
        accepted=result.returncode==0 if survives else result.returncode!=0 and 'FAIL:' in log and 'AssertionError' in log
        results.append({'name':name,'expected':'survive' if survives else 'assertion_failure','accepted':accepted,'exit_code':result.returncode})
        p.write_bytes(original)
        assert accepted
finally:
    p.write_bytes(original)
    (E/'execution-mutations.json').write_text(json.dumps({'controls':results,'source_restored':p.read_bytes()==original,'source_sha256':hashlib.sha256(original).hexdigest(),'blind_category':'Mocked child exits do not establish engine behavior or memory sufficiency.'},indent=2)+'\n')
