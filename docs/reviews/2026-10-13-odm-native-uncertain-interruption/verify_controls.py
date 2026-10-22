"""Run serial owned native cohorts and selected faults with exact restoration."""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def intended_failure(code, diagnostic, reason, error_type):
    errors = re.findall(r'^([A-Za-z_][\w.]*Error:.*)$', diagnostic, flags=re.MULTILINE)
    return code == 1 and errors == [error_type+': '+reason]


def oracle_controls(code, diagnostic, reason, error_type):
    rows = []
    for name, text in [('baseline', diagnostic), ('harmless', diagnostic+'# Harmless diagnostic comment.\n'), ('restored', diagnostic)]:
        assert intended_failure(code, text, reason, error_type)
        rows.append({'case': error_type+'-'+name, 'outcome':'survived'})
    for name, status, text in [('zero-exit', 0, diagnostic), ('wrong-reason', code, diagnostic.replace(reason, 'Unrelated failure')),
        ('extra-error', code, diagnostic+'RuntimeError: Unexpected secondary error\n'), ('missing-error', code, 'No error block\n'),
        ('wrong-type', code, diagnostic.replace(error_type+':', 'TypeError:'))]:
        assert not intended_failure(status, text, reason, error_type), 'Native composition fault oracle accepted unrelated failure'
        rows.append({'case':error_type+'-'+name, 'outcome':'intended_refusal'})
    return rows


def run(repo, fixture, out, socket_path, daemon_uid):
    os.umask(0o077);out.mkdir(mode=0o700)
    driver = Path(__file__).with_name('native_rpc_recovery.py')
    client = driver.with_name('native_client.py')
    helper_path = repo/'docs/reviews/2026-10-12-odm-private-dispatch-reader/native_rpc_recovery.py'
    runtime = repo/'workers/odm_worker/runtime_draft.py'
    original = {path:path.read_bytes() for path in (driver, client, runtime)}
    environment = {**os.environ, 'PYTHONDONTWRITEBYTECODE':'1'}
    def restore():
        for path, payload in original.items():
            path.write_bytes(payload)
            with path.open('rb') as stream:os.fsync(stream.fileno())
    def change(path, before, after):
        text = original[path].decode()
        assert text.count(before) == 1, 'Native composition mutation anchor must be unique'
        altered = text.replace(before, after, 1);ast.parse(altered);path.write_text(altered)
    def execute(label, native=True):
        if native:
            args = [sys.executable, '-B', str(driver), '--fixture', str(fixture), '--out', str(out/label),
                '--socket', socket_path, '--daemon-uid', str(daemon_uid)]
        else:
            args = [sys.executable, '-B', '-c',
                'import importlib.util;from pathlib import Path;'
                's=importlib.util.spec_from_file_location("composition_classifier",'+repr(str(driver))+');'
                'm=importlib.util.module_from_spec(s);s.loader.exec_module(m);'
                'v={name:True for name in m.PREDICATES};print(len(m.classifiers(v)))']
        result = subprocess.run(args, cwd=repo, capture_output=True, text=True, timeout=180, env=environment)
        (out/(label+'-private.log')).write_text(result.stdout+result.stderr)
        (out/(label+'-process.json')).write_text(json.dumps({'returncode':result.returncode})+'\n')
        return result.returncode, result.stdout+result.stderr
    rows = [];oracles = {}
    def positive(label, harmless=False):
        restore()
        if harmless:
            for path, payload in original.items():path.write_bytes(payload+b'\n# Harmless native composition comment.\n')
        code, diagnostic = execute(label)
        assert code == 0, 'Native composition positive control failed: '+label
        values = json.loads((out/label/'results.json').read_text())
        assert values and all(value is True for value in values.values()), 'Native composition positive predicates differ'
        rows.append({'control':label, 'outcome':'survived'});print(label+': survived', flush=True)
    try:
        positive('baseline');positive('harmless-comment', True);positive('restored-after-harmless')
        cases = [
            ('uncertain-prefix-bypassed', runtime,
             "            if any(row['state']=='unresolved' for row in snapshot['commands']):",
             "            if False:",
             'Held uncertainty cannot send another engine command', 'native-interrupted-upload'),
            ('child-receipt-saved-instead-of-exit', client,
             '        os._exit(EXIT)', '        return response',
             'Owned upload child must exit at the intended reply boundary', 'native-interrupted-upload'),
            ('original-intent-removed', client,
             "    relocated = root.parent/'relocated-runtime';shutil.copytree(root, relocated)",
             "    next(root.glob('preparation-*/engine/command-00001.intent.json')).unlink()\n    relocated = root.parent/'relocated-runtime';shutil.copytree(root, relocated)",
             'Interrupted upload requires a durable original intent', 'native-interrupted-upload'),
            ('unrecorded-reply-made-present', client,
             "    relocated = root.parent/'relocated-runtime';shutil.copytree(root, relocated)",
             "    next(root.glob('preparation-*/engine/command-00001.intent.json')).with_name('command-00001.reply.json').write_text('{}')\n    relocated = root.parent/'relocated-runtime';shutil.copytree(root, relocated)",
             'Interrupted upload must have no saved receipt', 'native-interrupted-upload'),
            ('interruption-cohort-omitted', driver,
             "            phase('native-interrupted-upload', 'interrupt-upload', interrupted/'runtime')", '            pass',
             'native-interruption-cohort-missing', None)]
        anchor = "        rows = json.loads((out/'rpc/controls.json').read_text());by_name = {row['control']: row for row in rows}"
        for label, injection in [
            ('interrupted-backend-bytes-changed', "        saved = json.loads(next((out/'rpc/interrupted/relocated-runtime').glob('preparation-*/engine/plan.json')).read_text());image = out/'tmp'/saved['taskUuid']/saved['uploads'][0]['filename'];image.write_bytes(image.read_bytes()+b'Changed interrupted bytes')\n"),
            ('interrupted-backend-form-changed', "        saved = json.loads(next((out/'rpc/interrupted/relocated-runtime').glob('preparation-*/engine/plan.json')).read_text());body=out/'tmp'/saved['taskUuid']/'body.json';value=json.loads(body.read_text());value['name']+=' changed';body.write_text(json.dumps(value))\n"),
            ('interrupted-backend-file-added', "        saved = json.loads(next((out/'rpc/interrupted/relocated-runtime').glob('preparation-*/engine/plan.json')).read_text());(out/'tmp'/saved['taskUuid']/'unplanned.jpg').write_bytes(b'Unplanned interrupted bytes')\n")]:
            cases.append((label, driver, anchor, injection+anchor, 'native-composition-interruptedDraftExact', None))
        for label, path, before, after, reason, child in cases:
            try:
                restore();change(path, before, after);code, diagnostic = execute(label)
                if child:
                    process = json.loads((out/label/'rpc'/(child+'-process.json')).read_text())
                    diagnostic = (out/label/'rpc'/(child+'-private.log')).read_text()
                    assert code == 1 and intended_failure(process['returncode'], diagnostic, reason, 'AssertionError'), 'Native composition fault failed for another reason: '+label
                    if 'AssertionError' not in oracles:oracles['AssertionError'] = oracle_controls(process['returncode'], diagnostic, reason, 'AssertionError')
                else:
                    assert intended_failure(code, diagnostic, reason, 'ValueError'), 'Native composition fault failed for another reason: '+label
                    if 'ValueError' not in oracles:oracles['ValueError'] = oracle_controls(code, diagnostic, reason, 'ValueError')
                rows.append({'control':label, 'outcome':'intended_failure', 'reason':reason});print(label+': intended_failure', flush=True)
            finally:restore()
        for label, before, after in [
            ('predicate-census-omitted', "    if set(values)-{'note'} != PREDICATES:\n        raise ValueError('native-composition-result-census')", '    pass'),
            ('predicate-bool-type-omitted', '        if value is not True:', '        if not value:')]:
            try:
                restore();change(driver, before, after);code, diagnostic = execute(label, native=False)
                assert intended_failure(code, diagnostic, 'Changed native composition result survived', 'AssertionError'), 'Native composition classifier accepted unrelated failure'
                rows.append({'control':label, 'outcome':'intended_failure', 'reason':'Changed native composition result survived'});print(label+': intended_failure', flush=True)
            finally:restore()
        positive('restored-final')
        assert all(path.read_bytes() == payload for path,payload in original.items())
        (out/'controls.json').write_text(json.dumps(rows, indent=2)+'\n')
        (out/'oracle-controls.json').write_text(json.dumps([row for group in oracles.values() for row in group], indent=2)+'\n')
        bindings = {str(path.relative_to(repo)):hashlib.sha256(payload).hexdigest() for path,payload in original.items()}
        bindings[str(Path(__file__).relative_to(repo))] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
        (out/'source-bindings.json').write_text(json.dumps(bindings, indent=2)+'\n')
        if os.environ.get('OPENPLAN_OWNED_PROOF_UNIT'):
            raw = subprocess.check_output(['systemctl', '--user', 'show', os.environ['OPENPLAN_OWNED_PROOF_UNIT'],
                '-p', 'ControlGroup', '-p', 'MemoryMax', '-p', 'MemorySwapMax', '-p', 'MemoryPeak'], text=True)
            props = dict(line.split('=', 1) for line in raw.splitlines());group = Path('/sys/fs/cgroup')/props.pop('ControlGroup').lstrip('/')
            props['memoryEvents'] = dict(line.split() for line in (group/'memory.events').read_text().splitlines())
            (out/'resources.json').write_text(json.dumps(props, indent=2)+'\n')
        print(json.dumps({'controls':len(rows), 'survivors':4, 'faults':10, 'oracleControls':sum(len(group) for group in oracles.values())}))
    finally:restore()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True);parser.add_argument('--fixture', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True);parser.add_argument('--socket', required=True);parser.add_argument('--daemon-uid', type=int, required=True)
    args = parser.parse_args();run(args.repo.resolve(), args.fixture.resolve(), args.out.resolve(), args.socket, args.daemon_uid)
