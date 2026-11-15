#!/usr/bin/env python3
"""Run bounded temporary mutations and restore exact research source bytes."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[3]
SOURCE=ROOT/'scripts/modeling/activitysim_walk_transfer.py'
original=SOURCE.read_bytes()
command=[sys.executable,'-B','-m','unittest','discover','-s','scripts/modeling/tests','-p','test_activitysim_walk_transfer.py']
mutations=[
 ('default status',"'status': 'default_unchanged'","'status': 'candidate'"),
 ('skip transferred values',"( ',' + donor[row[0]] + ',' )",''),
 ('mean denominator', 'float(x.mean()) if n else None','float(x.sum()) if n else None'),
 ('uncertainty denominator','np.sqrt(np.sum(x * (1 - x))) / n','np.sqrt(np.sum(x * (1 - x)))'),
]
mutations[1]=('skip transferred values',"(',' + donor[row[0]] + ',').encode()","(',' + old + ',').encode()")
for reason in ['duplicate coefficient','nonfinite coefficient','incompatible WALK expression','incompatible purpose template',
               'unknown development coefficient set','donor source hash mismatch','stock source hash mismatch',
               'transfer census mismatch','chooser coverage mismatch','invalid native probabilities','WALK probability absent',
               'baseline replay differs','candidate has no probability effect','joint probabilities changed','strata census mismatch',
               'runtime environment changed','stock directory changed','unexpected archive members','frozen candidate differs',
               'held-fixed inputs changed','unsupported advancement','invented observation evidence',
               'incomplete engineering checks','missing strata','aggregate census mismatch','aggregate probability conservation']:
 mutations.append((reason,f"raise ValueError('{reason}')",f"pass  # mutation: {reason}"))
mutations.append(('missing walk coefficient',"raise ValueError('missing walk coefficient')","return {'status': 'missing coefficient accepted'}"))
mutations.append(('native exit',"raise RuntimeError(f'native stage failed: {label}, exit {returncode}')",'pass  # mutation'))
records=[]
def run(label, content, expected):
 SOURCE.write_bytes(content)
 r=subprocess.run(command,cwd=ROOT,capture_output=True,text=True)
 text=r.stdout+r.stderr
 failures=re.findall(r'^(FAIL|ERROR): ([^\n]+)',text,re.M)
 records.append({'mutation':label,'expected':expected,'exit_code':r.returncode,'failures':failures,
                 'output_sha256':hashlib.sha256(text.encode()).hexdigest(),
                 'test_summary':re.findall(r'Ran \d+ tests[^\n]*|FAILED[^\n]*|OK[^\n]*',text)})
 if (expected=='pass') != (r.returncode==0):
  raise RuntimeError(f'unexpected mutation outcome: {label}: {text[-1000:]}')
try:
 run('harmless comment',original+b'\n# Harmless mutation: no numerical or custody change.\n','pass')
 for label,old,new in mutations:
  text=original.decode()
  if text.count(old)!=1: raise RuntimeError(f'nonunique mutation: {label}')
  run(label,text.replace(old,new).encode(),'fail')
finally:
 SOURCE.write_bytes(original)
run('restored',original,'pass')
if SOURCE.read_bytes()!=original: raise RuntimeError('source restoration failed')
print(json.dumps({'source_sha256':hashlib.sha256(original).hexdigest(),'command':command,
                  'restoration_exact':True,'records':records},indent=2))
