"""Challenge restored-source evidence without altering retained proof databases."""
import argparse
import ast
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys


def run(repo,proof,out):
    os.umask(0o077);out.mkdir(mode=0o700,parents=True)
    source=repo/'docs/reviews/2026-10-14-artifact-http/native_http.py';original=source.read_bytes()
    helper_path=repo/'docs/reviews/2026-10-14-artifact-access/verify_controls.py'
    spec=importlib.util.spec_from_file_location('mutations',helper_path);helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    results=[]
    def execute(label,*,code=original,change=None,reason=None,full=False):
        case=out/label;case.mkdir(mode=0o700)
        script=case/'producer.py';ast.parse(code);script.write_bytes(code)
        receipt=json.loads((proof/'result.json').read_bytes())
        if change:change(receipt)
        copy=case/'restore-receipt';copy.mkdir(mode=0o700)
        (copy/'result.json').write_text(json.dumps(receipt))
        shutil.copyfile(proof/'candidate-after-upgrade.dump',copy/'candidate-after-upgrade.dump')
        if full:
            # Only the original repo client may derive the worker source root.
            text=script.read_text();text=helper.swap(text,"str(Path(__file__).with_name('native_client.py'))","str(repo/'docs/reviews/2026-10-14-artifact-http/native_client.py')");script.write_text(text)
        command=[sys.executable,'-B',str(script),'--repo',str(repo),'--proof',str(copy),'--out',str(case/'run')]
        if not full:command.append('--preflight-only')
        result=subprocess.run(command,cwd=repo,capture_output=True,timeout=150,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
        log=(result.stdout+result.stderr).decode(errors='replace');(case/'private.log').write_text(log)
        if reason:
            errors=re.findall(r'(?m)^([A-Za-z_][\w.]*Error:.*)$',log)
            assert result.returncode==1 and errors==['AssertionError: '+reason],'Preflight fault has exact diagnostic: '+label+'\n'+log
            outcome='intended_failure'
        else:
            assert result.returncode==0,'Original source preflight positive succeeds: '+label+'\n'+log
            if not full:assert 'Original restored source preflight passed' in log,'Original source preflight actually runs'
            outcome='survived'
        results.append({'case':label,'outcome':outcome});print(label+' '+outcome,flush=True)
    execute('baseline');execute('harmless',code=original+b'\n# Harmless original source receipt note.\n');execute('restored-after-harmless')
    execute('wrong-restore-variant',change=lambda r:r.update(variant='other'),reason='Native HTTP restore receipt selects one restored fixture')
    execute('wrong-restored-identity',change=lambda r:r['retainedDatabases'].__setitem__(1,'unrelated-database'),reason='Native HTTP source is the recorded restored database')
    execute('different-restore-capture',change=lambda r:r['restoredCapture'].update(bytes=r['restoredCapture']['bytes']+1),reason='Native HTTP original restore input matches its recorded capture')
    changed=helper.swap(original.decode(),"expected_history+=['20261017000009','20261017000010','20261017000011','20261017000012']","expected_history+=['20261017000009','20261017000099','20261017000011','20261017000012']")
    execute('different-original-history',code=changed.encode(),reason='Native HTTP original restored history matches every intended version')
    changed=helper.swap(original.decode(),'SELECT prosrc FROM pg_proc','SELECT prosrc || chr(88) FROM pg_proc')
    execute('different-original-authority',code=changed.encode(),reason='Native HTTP restored delivery body matches exact current candidate before replacement')
    execute('restored-final');execute('full-current-native',full=True)
    assert source.read_bytes()==original,'Preflight never mutates repository source'
    (out/'controls.json').write_text(json.dumps(results,indent=2)+'\n')
    (out/'source-binding.json').write_text(json.dumps({str(source.relative_to(repo)):hashlib.sha256(original).hexdigest()})+'\n')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--repo',type=Path,required=True);parser.add_argument('--proof',type=Path,required=True);parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args();run(args.repo.resolve(),args.proof.resolve(),args.out.resolve())
