"""Observe the actual intake deadline, with harmless setup delay and faults."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

TEST = 'test_shared_deadline_clamps_nested_fetch_deadline'


def run(repo, out):
    os.umask(0o077);out.mkdir(mode=0o700)
    source = repo/'workers/odm_worker/runtime_url_intake.py';tests = source.with_name('test_runtime_url_intake.py')
    originals = {path:path.read_bytes() for path in (source, tests)}
    helper_path = repo/'docs/reviews/2026-10-11-odm-url-transport/verify_controls.py'
    spec = importlib.util.spec_from_file_location('clock_fault_helper', helper_path)
    helper = importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    def restore():
        for path, payload in originals.items():
            path.write_bytes(payload)
            with path.open('rb') as stream:os.fsync(stream.fileno())
    def execute(label, delay=False, complete=False):
        if delay:
            script = ('import sys,time,unittest;sys.path.insert(0,'+repr(str(source.parent))+');'
                'import test_runtime_url_intake as m;original=m.Checks.resume;'
                'm.Checks.resume=lambda self:(time.sleep(.02),original(self))[1];'
                'r=unittest.TextTestRunner().run(unittest.TestSuite([m.Checks('+repr(TEST)+')]));'
                'sys.exit(0 if r.wasSuccessful() else 1)')
            args = [sys.executable, '-B', '-c', script]
        else:args = [sys.executable, '-B', str(tests)]+([] if complete else ['Checks.'+TEST])
        result = subprocess.run(args, cwd=repo, capture_output=True, text=True, timeout=30, env={**os.environ, 'PYTHONDONTWRITEBYTECODE':'1'})
        diagnostic = result.stdout+result.stderr;(out/(label+'-private.log')).write_text(diagnostic)
        (out/(label+'-process.json')).write_text(json.dumps({'returncode':result.returncode})+'\n')
        return result.returncode, diagnostic
    rows = [];oracles = []
    def positive(label, harmless=False, delay=False, complete=False):
        restore()
        if harmless:tests.write_bytes(originals[tests]+b'\n# Harmless shared deadline observation comment.\n')
        code, diagnostic = execute(label, delay, complete)
        assert code == 0 and ('Ran 39 tests' if complete else 'Ran 1 test') in diagnostic, 'Clock positive control failed: '+label
        rows.append({'control':label, 'outcome':'survived'});print(label+': survived', flush=True)
    try:
        positive('baseline');positive('harmless-comment', harmless=True);positive('harmless-owner-startup-delay', delay=True)
        for label, path, before, after, reason in [
            ('nested-deadline-unclamped', source, 'min(deadline,given_deadline)', 'given_deadline', 'Nested fetch cannot extend the original intake deadline'),
            ('actual-deadline-not-observed', tests, 'shared.append(deadline);return original_check', 'return original_check', 'Intake must expose its actual shared deadline')]:
            try:
                restore();text = originals[path].decode();assert text.count(before) == 1, 'Clock mutation anchor must be unique'
                path.write_text(text.replace(before, after, 1));code, diagnostic = execute(label)
                helper.verify_failure(TEST, code, diagnostic, reason)
                if not oracles:oracles = helper.oracle_controls(TEST, code, diagnostic, reason)
                rows.append({'control':label, 'outcome':'intended_failure', 'reason':reason});print(label+': intended_failure', flush=True)
            finally:restore()
        positive('restored-final');positive('complete-intake-suite', complete=True)
        assert all(path.read_bytes() == payload for path,payload in originals.items())
        (out/'controls.json').write_text(json.dumps(rows, indent=2)+'\n');(out/'oracle-controls.json').write_text(json.dumps(oracles, indent=2)+'\n')
        bindings = {str(path.relative_to(repo)):hashlib.sha256(payload).hexdigest() for path,payload in originals.items()}
        bindings[str(Path(__file__).relative_to(repo))] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
        (out/'source-bindings.json').write_text(json.dumps(bindings, indent=2)+'\n')
        if os.environ.get('OPENPLAN_OWNED_PROOF_UNIT'):
            raw = subprocess.check_output(['systemctl', '--user', 'show', os.environ['OPENPLAN_OWNED_PROOF_UNIT'], '-p', 'ControlGroup', '-p', 'MemoryMax', '-p', 'MemorySwapMax', '-p', 'MemoryPeak'], text=True)
            props = dict(line.split('=', 1) for line in raw.splitlines());group = Path('/sys/fs/cgroup')/props.pop('ControlGroup').lstrip('/')
            props['memoryEvents'] = dict(line.split() for line in (group/'memory.events').read_text().splitlines())
            (out/'resources.json').write_text(json.dumps(props, indent=2)+'\n')
        print(json.dumps({'controls':len(rows), 'faults':2, 'survivors':5, 'oracleControls':len(oracles)}))
    finally:restore()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__);parser.add_argument('--repo', type=Path, required=True);parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args();run(args.repo.resolve(), args.out.resolve())
