"""Run owned native root cohorts and controlled corruption, restoring source."""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def intended_failure(code, text, reason):
    errors = re.findall(r'^([A-Za-z_][\w.]*Error:.*)$', text, flags=re.MULTILINE)
    return code == 1 and errors == ['AssertionError: '+reason]


def run(out):
    os.umask(0o077);out.mkdir(mode=0o700)
    driver = Path(__file__).with_name('native_restore.py');original = driver.read_bytes()
    rows = []
    def execute(label, before=None, after=None, reason=None, harmless=False):
        driver.write_bytes(original)
        text = original.decode()
        if before:
            assert text.count(before) == 1, 'Restore mutation anchor must be unique'
            text = text.replace(before,after,1)
        if harmless:text += '\n# Harmless committed-task recovery comment.\n'
        ast.parse(text);driver.write_text(text)
        try:
            result = subprocess.run([sys.executable,'-B',str(driver),'--out',str(out/label)],capture_output=True,text=True,timeout=120,
                env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
            diagnostic = result.stdout+result.stderr
            (out/(label+'-private.log')).write_text(diagnostic)
            (out/(label+'-process.json')).write_text(json.dumps({'returncode':result.returncode})+'\n')
            if reason:
                assert intended_failure(result.returncode,diagnostic,reason), 'Wrong stopped-root native fault: '+label
                outcome = 'intended_failure'
            else:
                assert result.returncode == 0, 'Stopped-root positive failed: '+label
                values = json.loads((out/label/'results.json').read_text())
                assert values['apiTaskRestored'] is True and values['originalAndPackageUnchanged'] is True
                assert values['exactSourcePackageRelocation'] is True and values['newEngineIdentity'] is True
                assert values['workerRecoveryAccepted'] is False and values['engineAdoptionAuthorized'] is False
                outcome = 'survived'
            rows.append({'control':label,'outcome':outcome,'reason':reason});print(label+': '+outcome,flush=True)
            (out/'partial-controls.json').write_text(json.dumps(rows,indent=2)+'\n')
        finally:
            driver.write_bytes(original)
            with driver.open('rb') as stream:os.fsync(stream.fileno())
    try:
        execute('baseline');execute('harmless-comment',harmless=True);execute('restored-after-harmless')
        execute('package-bytes-changed',
            "        retained = out/'package/root';assert inventory(retained) == before, 'Captured failed-task bytes differ'",
            "        retained = out/'package/root'\n        target = next(path for path in retained.rglob('*') if path.is_file());target.write_bytes(target.read_bytes()+b'Changed package bytes')\n        assert inventory(retained) == before, 'Captured failed-task bytes differ'",
            'Captured failed-task bytes differ')
        execute('relocation-bytes-changed',
            "        runtime = out/'runtime';shutil.copytree(retained,runtime);assert inventory(runtime) == before, 'Relocated failed-task bytes differ'",
            "        runtime = out/'runtime';shutil.copytree(retained,runtime)\n        target = next(path for path in runtime.rglob('*') if path.is_file());target.write_bytes(target.read_bytes()+b'Changed relocated bytes')\n        assert inventory(runtime) == before, 'Relocated failed-task bytes differ'",
            'Relocated failed-task bytes differ')
        execute('restored-status-changed',
            "        observed = json.loads(restored_info['body'])",
            "        observed = json.loads(restored_info['body']);observed['status']={'code':40}",
            'Restored failed-task API projection differs')
        execute('restored-task-uuid-changed',
            "        observed = json.loads(restored_info['body'])",
            "        observed = json.loads(restored_info['body']);observed['uuid']='different-task'",
            'Restored failed-task API projection differs')
        execute('original-source-changed',
            "        assert inventory(source) == before and inventory(retained) == before, 'Restoration must not mutate original or package'",
            "        target=next(path for path in source.rglob('*') if path.is_file());target.write_bytes(target.read_bytes()+b'Changed original bytes')\n        assert inventory(source) == before and inventory(retained) == before, 'Restoration must not mutate original or package'",
            'Restoration must not mutate original or package')
        execute('restored-final')
        oracles = []
        diagnostic = 'AssertionError: Targeted recovery failure\n'
        for name,code,text,expected in [('baseline',1,diagnostic,True),('harmless',1,diagnostic+'# Harmless detail\n',True),('restored',1,diagnostic,True),
            ('zero-exit',0,diagnostic,False),('wrong-reason',1,'AssertionError: Unrelated error\n',False),
            ('missing-error',1,'No error\n',False),('extra-error',1,diagnostic+'ValueError: Second error\n',False),
            ('wrong-type',1,'ValueError: Targeted recovery failure\n',False)]:
            assert intended_failure(code,text,'Targeted recovery failure') is expected, 'Restore failure oracle differs'
            oracles.append({'case':name,'outcome':'survived' if expected else 'intended_refusal'})
        (out/'controls.json').write_text(json.dumps(rows,indent=2)+'\n')
        (out/'oracle-controls.json').write_text(json.dumps(oracles,indent=2)+'\n')
        assert driver.read_bytes() == original, 'Restore driver did not restore exactly'
        (out/'source-bindings.json').write_text(json.dumps({str(path):hashlib.sha256(path.read_bytes()).hexdigest() for path in (driver,Path(__file__))},indent=2)+'\n')
        if os.environ.get('OPENPLAN_OWNED_PROOF_UNIT'):
            raw=subprocess.check_output(['systemctl','--user','show',os.environ['OPENPLAN_OWNED_PROOF_UNIT'],'-p','ControlGroup','-p','MemoryMax','-p','MemorySwapMax','-p','MemoryPeak'],text=True)
            props=dict(line.split('=',1) for line in raw.splitlines());group=Path('/sys/fs/cgroup')/props.pop('ControlGroup').lstrip('/');props['memoryEvents']=dict(line.split() for line in (group/'memory.events').read_text().splitlines());(out/'resources.json').write_text(json.dumps(props,indent=2)+'\n')
        print(json.dumps({'controls':len(rows),'survivors':4,'faults':5,'oracleControls':len(oracles)}))
    finally:driver.write_bytes(original)


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args();run(args.out.resolve())
