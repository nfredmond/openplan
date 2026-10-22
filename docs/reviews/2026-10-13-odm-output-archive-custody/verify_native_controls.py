"""Challenge the actual original-task reader and selected-root observations."""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def native_failure(code, output, reason):
    return (type(code) is int and code == 1 and isinstance(output, str)
            and isinstance(reason, str) and bool(reason)
            and 'Traceback (most recent call last):' in output
            and re.findall(r'(?m)^AssertionError: (.+)$', output) == [reason])


def oracle_controls(output, reason):
    result = []
    for label, text in [('baseline', output), ('harmless-prefix', '# Harmless oracle note.\n' + output), ('restored', output)]:
        if not native_failure(1, text, reason):
            raise AssertionError('Native oracle positive refused: ' + label)
        result.append({'control':label, 'outcome':'survived'})
    faults = [('success-exit', 0, output, reason), ('boolean-exit', True, output, reason),
              ('other-exit', 2, output, reason), ('missing-output', 1, None, reason),
              ('missing-reason', 1, output, None), ('empty-reason', 1, output, ''),
              ('unrelated-reason', 1, output.replace(reason, 'unrelated'), reason),
              ('extra-assertion', 1, output + '\nAssertionError: unrelated\n', reason),
              ('missing-traceback', 1, output.replace('Traceback (most recent call last):', ''), reason),
              ('stdout-decoy', 1, reason + '\n' + output.replace(reason, 'unrelated'), reason)]
    for label, code, text, expected in faults:
        if native_failure(code, text, expected):
            raise AssertionError('Native oracle invalid result accepted: ' + label)
        result.append({'control':label, 'outcome':'intended_refusal'})
    return result


def run(repo, out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    driver=repo/'docs/reviews/2026-10-13-odm-output-archive-custody/native_recovery.py'
    producer=driver
    original=driver.read_bytes();text=original.decode();cases=[]
    def add(label,before,insertion,reason):
        if text.count(before)!=1:raise ValueError(label+' native anchor must be unique')
        cases.append((label,text.replace(before,insertion+before,1),reason))
    add('interruption-exit-not-checked', "        assert launch(folder, point) == 44", "        launch_original = launch\n        def launch(folder, point):\n            code = launch_original(folder, point)\n            return 0 if code == 44 else code\n", 'Owned archive child must stop at the actual interruption point')
    add('interrupted-plan-census-lost', "        assert (folder / 'retained/plan.json').exists()", "        (folder / 'retained/plan.json').unlink()\n", 'Interrupted archive must retain its frozen plan without a complete receipt')
    add('interrupted-link-not-observed', "            assert (folder / 'retained/archive.zip').stat().st_nlink == 2", "            (folder / 'retained/.archive-partial').unlink()\n", 'After-link interruption must expose its actual unpublished alias')
    add('recovery-byte-hash-changed', "        assert (folder / 'retained/archive.zip').read_bytes() == raw", "        result['archive']['sha256'] = '0'*64\n", 'Recovered archive must preserve its exact original bytes and hash')
    add('publication-promoted', "        assert result['publicationPermission'] is False", "        result['publicationPermission'] = True\n", 'Supplied archive recovery cannot grant publication, callback or quality')
    add('recovery-alias-left', "        assert (folder / 'retained/archive.zip').stat().st_nlink == 1", "        os.link(folder/'retained/archive.zip',folder/'retained/.unpublished-alias')\n", 'Recovered archive must reconcile the owned interrupted alias')
    add('copied-receipt-changed', "        assert json.loads((copied / 'result.json').read_bytes()) == result", "        result['scope'] = 'changed'\n", 'Local copied archive receipt must remain exact')
    outcomes = []
    oracles = None
    def execute(label):
        result = subprocess.run([sys.executable, '-B', str(producer), '--out', str(out/(label+'-private'))], capture_output=True,cwd=repo,timeout=30,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
        output = (result.stdout + result.stderr).decode(errors='replace')
        (out / (label + '.log')).write_text(output)
        return result.returncode, output
    def positive(label, payload):
        driver.write_bytes(payload)
        code, output = execute(label)
        if code:
            raise AssertionError(label + ': native positive failed\n' + output)
        controls=json.loads((out/(label+'-private')/'controls.json').read_bytes())
        if len(controls)!=4 or any(x.get('actualEngineProvenance') is True or x.get('physicalHostRecovery') is True for x in controls): raise AssertionError(label+': limits differ')
        outcomes.append({'control':label, 'outcome':'survived'})
    try:
        positive('baseline', original)
        positive('harmless-comment', original + b'\n# Harmless selected-root native control.\n')
        positive('restored-after-harmless', original)
        for label, changed, reason in cases:
            try:
                ast.parse(changed)
                driver.write_text(changed)
                code, output = execute(label)
                if not native_failure(code,output,reason):raise AssertionError(label+': wrong native failure\n'+output)
                child=output
                if oracles is None:
                    oracles = oracle_controls(child, reason)
                outcomes.append({'control':label, 'outcome':'intended_failure', 'reason':reason, 'exitCode':code})
            finally:
                driver.write_bytes(original)
        positive('restored-final', original)
        if driver.read_bytes() != original:
            raise AssertionError('Native retention source did not restore')
        (out / 'controls.json').write_text(json.dumps(outcomes, indent=2) + '\n')
        (out / 'oracle-controls.json').write_text(json.dumps(oracles, indent=2) + '\n')
        (out / 'source-bindings.json').write_text(json.dumps({str(p.relative_to(repo)):
            hashlib.sha256(p.read_bytes()).hexdigest() for p in (driver, Path(__file__))}, indent=2) + '\n')
        print(json.dumps({'positive':4, 'broken':len(cases), 'controls':len(outcomes)}))
    finally:
        driver.write_bytes(original)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    run(args.repo.resolve(), args.out.resolve())
