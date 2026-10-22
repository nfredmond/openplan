"""Challenge actual progress POST/process recovery and restore edits in finally."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys


def intended(code, output, diagnostic):
    return code == 1 and 'AssertionError: '+diagnostic in output and 'SyntaxError' not in output


def run(repo, out):
    os.umask(0o077); out.mkdir(mode=0o700)
    module = repo/'workers/odm_worker/runtime_progress_delivery.py'
    driver = repo/'docs/reviews/2026-10-14-progress-delivery/native_recovery.py'
    originals = {path: path.read_bytes() for path in [module, driver, repo/'workers/odm_worker/progress_http.py']}
    cases = []
    def change(label, path, before, after, diagnostic, child_diagnostic=None):
        source = originals[path].decode()
        assert source.count(before) == 1, label+' has one exact source binding'
        cases.append((label, path, source.replace(before, after), diagnostic, child_diagnostic))
    change('body-reencoded', module, "command['bodyText'].encode('utf-8'), deadline,",
        "json_bytes(parse(command['bodyText'].encode('utf-8'), BODY_LIMIT)), deadline,",
        'Native saved command is exactly the received body')
    change('acknowledged-replay-posted', module, "if state != 'retry_pending':", 'if False:',
        'Native acknowledged replay makes no POST')
    change('revoked-access-ignored', module,
        "if self.reader.observe(request_id, deadline=deadline)['authorizedNow'] is not True:",
        'if False:', 'Native revoked has the expected process outcome',
        'Native revoked actor cannot receive an acknowledgement')
    change('process-interruption-skipped', driver, 'os._exit(44)', 'return result',
        'Native interrupt has the expected process outcome')
    change('receiver-duplicates-effect', driver, "assert state['ledger'][key] == raw, 'Native retry carries the exact original body'",
        "assert state['ledger'][key] == raw, 'Native retry carries the exact original body'\n                    state['ledger'][key+'duplicate'] = raw",
        'Exact replay has one remote fixture effect')
    change('replacement-changes-body', module, "command['bodyText'].encode('utf-8'), deadline,",
        "(command['bodyText'].encode('utf-8') if index == 0 else json_bytes(parse(command['bodyText'].encode('utf-8'), BODY_LIMIT))), deadline,",
        'Native recover has the expected process outcome', 'Progress HTTP child did not complete')
    controls = []; oracles = []
    def execute(label):
        target = out/label
        result = subprocess.run([sys.executable, '-B', str(driver), '--repo', str(repo), '--out', str(target)],
            capture_output=True, text=True, timeout=45, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
        output = result.stdout+result.stderr
        (out/(label+'-private.log')).write_text(output)
        return result.returncode, output, target
    def positive(label):
        code, output, target = execute(label)
        assert code == 0, label+' completes actual recovery'
        value = json.loads((target/'native.json').read_text())
        assert value['httpPosts'] == 2 and value['remoteFixtureEffects'] == 1 and value['processInterruption'] == 44 and value['revokedProcess'] == 45
        controls.append({'case': label, 'outcome': 'survived'})
    try:
        positive('baseline')
        module.write_bytes(originals[module]+b'\n# Harmless native progress delivery recovery comment.\n')
        positive('harmless-comment')
        module.write_bytes(originals[module]); positive('restored-after-harmless')
        for label, path, source, diagnostic, child_diagnostic in cases:
            try:
                path.write_text(source)
                code, output, target = execute(label)
                assert intended(code, output, diagnostic), label+' fails at the intended native assertion'
                if label == 'replacement-changes-body':
                    assert 'Native retry carries the exact original body' in output, 'Receiver witnesses the changed retry body'
                if child_diagnostic:
                    log = 'revoked-private.log' if label == 'revoked-access-ignored' else 'recover-private.log'
                    assert child_diagnostic in (target/log).read_text(), label+' keeps the intended child failure'
                for name, c, o, d, expected in [
                    ('intended', code, output, diagnostic, True), ('success', 0, output, diagnostic, False),
                    ('wrong-exit', 2, output, diagnostic, False), ('wrong-reason', code, output, 'absent reason', False),
                    ('syntax-error', code, output+'\nSyntaxError', diagnostic, False),
                    ('no-assertion', code, 'unrelated runner error', diagnostic, False)]:
                    actual = bool(intended(c, o, d)); assert actual == expected
                    oracles.append({'case': label, 'oracle': name, 'accepted': actual})
                controls.append({'case': label, 'outcome': 'intended_failure', 'diagnostic': diagnostic})
            finally:
                for target, raw in originals.items(): target.write_bytes(raw)
        positive('restored')
        (out/'controls.json').write_text(json.dumps(controls, indent=2)+'\n')
        (out/'oracles.json').write_text(json.dumps(oracles, indent=2)+'\n')
        (out/'bindings.json').write_text(json.dumps({str(path.relative_to(repo)):
            hashlib.sha256(raw).hexdigest() for path, raw in originals.items()}, indent=2)+'\n')
        group = Path('/sys/fs/cgroup')/Path('/proc/self/cgroup').read_text().split('0::', 1)[1].strip().lstrip('/')
        (out/'resources.json').write_text(json.dumps({key: (group/key).read_text().strip() for key in
            ['memory.max', 'memory.peak', 'memory.swap.max', 'memory.swap.peak', 'memory.events']}, indent=2)+'\n')
        print(json.dumps({'positive': 4, 'faults': len(cases), 'oracles': len(oracles)}))
    finally:
        for target, raw in originals.items():
            target.write_bytes(raw); assert target.read_bytes() == raw


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    run(args.repo.resolve(), args.out.resolve())
