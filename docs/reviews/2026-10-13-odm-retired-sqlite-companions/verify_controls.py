"""Retired SQLite companion controls with exact restoration and failure checks."""
import argparse
import ast
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys


def run(repo, out):
    os.umask(0o077);out.mkdir(mode=0o700)
    source = repo/'workers/odm_worker/admission_journal.py'
    tests = source.with_name('test_retired_sqlite_companions.py')
    original = source.read_bytes();test_bytes = tests.read_bytes()
    observer_tests = source.with_name('test_native_engine_attestation.py')
    observer_bytes = observer_tests.read_bytes()
    helper_path = repo/'docs/reviews/2026-10-11-odm-url-transport/verify_controls.py'
    spec = importlib.util.spec_from_file_location('authority_fault_helper', helper_path)
    helper = importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    census = {node.name for node in ast.walk(ast.parse(test_bytes)) if isinstance(node, ast.FunctionDef) and node.name.startswith('test_')}
    cases = []
    def add(label, test, change, reason):
        cases.append((label, 'test_'+test, change, reason, 'broken_behavior'))
    swap = lambda before, after: lambda text: helper.replace(text, before, after)
    add('retired-zero-link-metadata-refused', 'unlinked_inode_metadata_does_not_refuse_committed_original',
        swap('except (FileNotFoundError, ValueError):', 'except FileNotFoundError:'),
        'Retired companion must preserve its committed original: ValueError')
    add('missing-retirement-refused', 'missing_companion_retirement_preserves_original',
        swap('                    except FileNotFoundError:\n                        pass', '                    except FileNotFoundError:\n                        raise'),
        'Retired companion must preserve its committed original: FileNotFoundError')
    add('present-unsafe-companion-error-swallowed', 'present_unsafe_companion_still_refuses_before_sqlite',
        swap('                    else:\n                        raise', '                    else:\n                        pass'),
        'Present unsafe companion reached SQLite')
    add('dangling-alias-followed-for-retirement', 'dangling_alias_is_not_a_missing_companion',
        swap('                        companion.lstat()', '                        companion.stat()'),
        'Dangling companion alias reached SQLite')
    add('missing-lookup-ignored-without-name-recheck', 'reappeared_alias_after_missing_lookup_refuses_before_sqlite',
        swap('                except (FileNotFoundError, ValueError):',
            '                except (FileNotFoundError, ValueError) as error:\n                    if isinstance(error, FileNotFoundError):\n                        continue'),
        'Reappeared companion alias reached SQLite')
    if {row[1] for row in cases} != census:raise ValueError('Retired companion tests lack selected controls')
    observer_cases = [
        ('exited-proc-lookup-refused', 'test_observer_ends_when_parent_exits',
         swap('except (FileNotFoundError, ProcessLookupError):', 'except FileNotFoundError:'),
         'Exited observer lookup must count as retired', 'broken_behavior'),
        ('unavailable-proc-lookup-hidden', 'test_observer_ends_when_parent_exits',
         swap('except (FileNotFoundError, ProcessLookupError):', 'except OSError:'),
         'Unavailable observer lookup must retain its permission refusal', 'broken_behavior')]
    rows = [];oracles = []
    def restore():
        source.write_bytes(original)
        observer_tests.write_bytes(observer_bytes)
        for path in (source, observer_tests):
            with path.open('rb') as stream:os.fsync(stream.fileno())
    def execute(label, test=None, observer=False):
        selected = observer_tests if observer else tests
        namespace = 'NativeTests.' if observer else 'Checks.'
        result = subprocess.run([sys.executable, '-B', str(selected)]+([namespace+test] if test else []),
            cwd=repo, capture_output=True, timeout=20, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
        diagnostic = (result.stdout+result.stderr).decode(errors='replace')
        (out/(label+'-private.log')).write_text(diagnostic)
        return result.returncode, diagnostic
    def positive(label, harmless=False):
        restore()
        if harmless:
            source.write_bytes(original+b'\n# Harmless native observation comment.\n')
            observer_tests.write_bytes(observer_bytes+b'\n# Harmless observer-test comment.\n')
        code, diagnostic = execute(label)
        assert code == 0 and 'Ran '+str(len(census))+' tests' in diagnostic, 'Retired companion positive control failed: '+label
        code, diagnostic = execute(label+'-observer', 'test_observer_ends_when_parent_exits', observer=True)
        assert code == 0 and 'Ran 1 test' in diagnostic, 'Observer retirement positive control failed: '+label
        rows.append({'control': label, 'outcome': 'survived'})
    try:
        positive('baseline');positive('harmless-comment', True);positive('restored-after-harmless')
        for label, test, change, reason, kind in cases:
            try:
                text = change(original.decode());ast.parse(text);source.write_text(text)
                code, diagnostic = execute(label, test)
                helper.verify_failure(test, code, diagnostic, reason)
                if not oracles:oracles = helper.oracle_controls(test, code, diagnostic, reason)
                rows.append({'control': label, 'test': test, 'kind': kind, 'reason': reason, 'outcome': 'intended_failure'})
            finally:restore()
        for label, test, change, reason, kind in observer_cases:
            try:
                text = change(observer_bytes.decode());ast.parse(text);observer_tests.write_text(text)
                code, diagnostic = execute(label, test, observer=True)
                helper.verify_failure(test, code, diagnostic, reason)
                rows.append({'control': label, 'test': test, 'kind': kind, 'reason': reason, 'outcome': 'intended_failure'})
            finally:restore()
        positive('restored-final')
        assert source.read_bytes() == original and tests.read_bytes() == test_bytes and observer_tests.read_bytes() == observer_bytes
        (out/'controls.json').write_text(json.dumps(rows, indent=2)+'\n')
        (out/'oracle-controls.json').write_text(json.dumps(oracles, indent=2)+'\n')
        (out/'source-bindings.json').write_text(json.dumps({str(path.relative_to(repo)):hashlib.sha256(path.read_bytes()).hexdigest() for path in (source, tests, observer_tests, Path(__file__))}, indent=2)+'\n')
        if os.environ.get('OPENPLAN_OWNED_PROOF_UNIT'):
            unit = os.environ['OPENPLAN_OWNED_PROOF_UNIT']
            raw = subprocess.check_output(['systemctl', '--user', 'show', unit, '-p', 'ControlGroup', '-p', 'MemoryMax', '-p', 'MemorySwapMax', '-p', 'MemoryPeak'], text=True)
            values = dict(line.split('=', 1) for line in raw.splitlines())
            group = Path('/sys/fs/cgroup') / values.pop('ControlGroup').lstrip('/')
            values['memoryEvents'] = dict(line.split() for line in (group / 'memory.events').read_text().splitlines())
            (out / 'resources.json').write_text(json.dumps(values, indent=2) + '\n')
        print(json.dumps({'tests': len(census)+1, 'controls': len(rows), 'faults': len(cases)+len(observer_cases), 'survivors': 4, 'oracleControls': len(oracles)}))
    finally:restore()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True);parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args();run(args.repo.resolve(), args.out.resolve())
