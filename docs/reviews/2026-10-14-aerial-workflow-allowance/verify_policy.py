"""Check the complete job allowance while preserving its executable recipe."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess


def normalize(text):
    return '\n'.join(line for line in re.sub(r'(?m)^    timeout-minutes: [0-9]+$', '    timeout-minutes: ALLOWANCE', text).splitlines()
        if not line.lstrip().startswith('#')).rstrip()


def check(text, original):
    lines=text.splitlines();start=lines.index('  odm-worker:')
    block=[]
    for line in lines[start+1:]:
        if line.startswith('  ') and not line.startswith('    '):break
        block.append(line)
    values=[int(m.group(1)) for line in block if (m:=re.fullmatch(r'    timeout-minutes: ([0-9]+)',line))]
    assert values==[30], 'Complete aerial regression job needs the declared 30-minute allowance'
    assert normalize(text)==normalize(original), 'Changing the job allowance must preserve the executable recipe'


def run(repo, out):
    original=subprocess.check_output(['git','-C',str(repo),'show','00821399288104ea6b51734488edbcffc496a39a:.github/workflows/odm-worker-regression.yml']).decode()
    path=repo/'.github/workflows/odm-worker-regression.yml';actual=path.read_text();rows=[]
    for name,value in [('baseline',actual),('harmless',actual+'\n# Harmless workflow allowance comment.\n'),('restored',actual)]:
        check(value,original);rows.append({'case':name,'outcome':'survived'})
    for name,value,message in [
        ('shortened-job',actual.replace('    timeout-minutes: 30','    timeout-minutes: 20'), 'Complete aerial regression job needs the declared 30-minute allowance'),
        ('removed-stage',actual.replace('          for suite in workers/odm_worker/test_*.py; do','          for suite in workers/odm_worker/test_contract.py; do'),'Changing the job allowance must preserve the executable recipe')]:
        try:check(value,original)
        except AssertionError as error:assert str(error)==message;rows.append({'case':name,'outcome':'intended_failure','diagnostic':message})
        else:raise AssertionError(name+' did not fail')
    out.mkdir(mode=0o700);(out/'controls.json').write_text(json.dumps(rows,indent=2)+'\n')
    (out/'source-binding.json').write_text(json.dumps({'workflowSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'originalRef':'00821399288104ea6b51734488edbcffc496a39a'},indent=2)+'\n')
    print(json.dumps({'positive':3,'faults':2,'recipeUnchanged':True}))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    args=p.parse_args();run(args.repo.resolve(),args.out.resolve())
