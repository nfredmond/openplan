"""Exercise admission refusal sensitivity and restore exact source bytes."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

E=Path(__file__).resolve().parent; source=E/'admission.py'; original=source.read_bytes()
mutations=[
 ('harmless-comment',None,None,True),
 ('cache-coverage',"if 'initial_row_size is zero' in log:","if False:",False),
 ('input-custody',"if m.digest(m.INPUT/folder/name) != expected:","if False:",False),
 ('final-file-custody',"if {p.name:m.digest(p) for p in root.glob('final_*.csv')} != expected:","if False:",False),
 ('cache-custody',"or m.digest(cache) != result['cache_sha256']","or False",False),
 ('proof-status',"result.get('status') != 'passed_choice_parity'","False",False),
 ('choice-parity',"if not m.compare(prefix+'full-preflight-'+arm, OLD_R/ref, m.R/name):","if False:",False),
]
results=[]
try:
    for name,before,after,survives in mutations:
        text=original.decode()
        if before is None: text += '\n# Harmless custody comment.\n'
        else:
            assert text.count(before)==1
            text=text.replace(before,after)
        source.write_text(text)
        p=subprocess.run([sys.executable,'-B',str(E/'test-admission.py')],capture_output=True,text=True)
        output=p.stdout+p.stderr;(E/('mutation-'+name+'.log')).write_text(output)
        accepted=(p.returncode==0) if survives else (p.returncode!=0 and 'FAIL:' in output and 'AssertionError' in output)
        results.append({'name':name,'expected':'survive' if survives else 'assertion_failure','exit_code':p.returncode,'accepted':accepted})
        source.write_bytes(original)
        assert accepted, name
finally:
    source.write_bytes(original)
    (E/'mutations.json').write_text(json.dumps({'controls':results,'source_restored':source.read_bytes()==original,
        'source_sha256':hashlib.sha256(original).hexdigest(),'blind_category':'Synthetic admission fixtures do not establish engine choices, full memory fit, or scientific accuracy.'},indent=2)+'\n')
