"""Run real Git capture guards with harmless and targeted source controls."""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def intended(code, output, test, diagnostic, kind='failures'):
    marker = 'FAIL:' if kind == 'failures' else 'ERROR:'
    other = 'ERROR:' if kind == 'failures' else 'FAIL:'
    names = re.findall(r'^'+marker+r' ([^ ]+) \(test_migration_source.Checks\.', output, re.MULTILINE)
    return (code == 1 and names and set(names) == {test} and diagnostic in output
        and not re.search(r'^'+other, output, re.MULTILINE)
        and re.search(r'FAILED \('+kind+r'=\d+\)\s*$', output) is not None)


def run(repo, out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    folder = repo/'docs/reviews/2026-10-14-odm-output-schema-recovery/drivers'
    source = folder/'migration_source.py'
    original = source.read_bytes()
    text = original.decode()
    cases = []
    ignored_diff = text.replace('if result.returncode != 0:', 'if False:')
    ignored_inventory = text.replace('if not selected or actual != set(selected):', 'if False:')
    cases.extend([
        ('unstaged-ignored', ignored_diff, 'test_unstaged_migration_change_refuses', 'ValueError not raised', 'failures'),
        ('staged-ignored', ignored_diff, 'test_staged_change_refuses_even_when_worktree_matches_commit', 'ValueError not raised', 'failures'),
        ('untracked-ignored', ignored_inventory, 'test_untracked_migration_refuses', 'ValueError not raised', 'failures'),
        ('missing-ignored', ignored_diff.replace('if not selected or actual != set(selected):', 'if False:'),
            'test_missing_selected_migration_refuses', 'ValueError not raised', 'failures'),
        ('unrelated-edits-blocked', text.replace("*flags, '--quiet', commit, '--', SCOPE]", "*flags, '--quiet', commit, '--', '.']"),
            'test_exact_selected_git_bytes_survive_nonmigration_edits', 'Selected migration worktree differs', 'errors'),
    ])
    tree = ast.parse(text)
    guards = [node for node in ast.walk(tree) if isinstance(node, ast.If)
        and any(isinstance(child, ast.Raise) and isinstance(child.exc, ast.Call)
            and child.exc.args and isinstance(child.exc.args[0], ast.Constant)
            and child.exc.args[0].value == 'Migration source requires a full selected commit' for child in node.body)]
    assert len(guards) == 1
    guards[0].test = ast.Constant(False)
    cases.append(('mutable-ref-accepted', ast.unparse(tree)+'\n', 'test_selected_commit_identity_is_explicit', 'ValueError not raised', 'failures'))
    before = "    return {name: subprocess.check_output(['git', 'show', commit+':'+path], cwd=repo, timeout=30)\n        for name, path in sorted(selected.items())}"
    assert text.count(before) == 1
    cases.append(('mutable-bytes-captured', text.replace(before, "    return {name: (repo/SCOPE/name).read_bytes() for name in selected}"),
        'test_selected_bytes_come_from_git_objects', 'Captured bytes must come from selected Git objects', 'failures'))
    before = "if any(str(Path(path).parent) != SCOPE for path in paths if path.endswith('.sql')):"
    assert text.count(before) == 1
    cases.append(('nested-shadow-accepted', text.replace(before, 'if False:'),
        'test_nested_migration_cannot_shadow_a_direct_member', 'ValueError not raised', 'failures'))
    before = 'if out.is_relative_to(repo) or repo.is_relative_to(out):'
    assert text.count(before) == 1
    cases.append(('checkout-output-accepted', text.replace(before, 'if False:'),
        'test_capture_destination_refuses_checkout_overlap', 'ValueError not raised', 'failures'))
    tests = ast.parse((folder/'test_migration_source.py').read_bytes())
    census = [node.name for node in ast.walk(tests) if isinstance(node, ast.FunctionDef) and node.name.startswith('test_')]
    assert len(census) == len(set(census)) == 9 and {case[2] for case in cases} == set(census)
    controls, oracles = [], []

    def execute(label, test=None):
        p = subprocess.run([sys.executable, '-B', '-m', 'unittest', '-v',
            'test_migration_source'+('.Checks.'+test if test else '')], cwd=folder,
            capture_output=True, text=True, timeout=60,
            env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
        output = p.stdout+p.stderr
        (out/(label+'-private.log')).write_text(output)
        return p.returncode, output

    def positive(label):
        code, output = execute(label)
        assert code == 0 and 'Ran 9 tests' in output and output.rstrip().endswith('OK'), label
        controls.append({'case': label, 'outcome': 'survived', 'tests': 9})

    try:
        positive('baseline')
        source.write_bytes(original+b'\n# Harmless selected migration source comment.\n')
        positive('harmless-comment')
        source.write_bytes(original)
        positive('restored-after-harmless')
        for label, changed, test, diagnostic, kind in cases:
            try:
                ast.parse(changed)
                source.write_text(changed)
                code, output = execute(label, test)
                assert intended(code, output, test, diagnostic, kind), label+' misses intended assertion'
                for name, c, o, t, d, wanted in [
                    ('exact', code, output, test, diagnostic, True),
                    ('success', 0, output, test, diagnostic, False),
                    ('wrong-exit', 2, output, test, diagnostic, False),
                    ('wrong-test', code, output, 'unrelated_test', diagnostic, False),
                    ('wrong-diagnostic', code, output, test, 'Absent diagnostic', False),
                    ('syntax', code, 'SyntaxError', test, diagnostic, False),
                    ('no-failure', code, 'Ran 1 test\nOK', test, diagnostic, False),
                    ('unrelated-error', code, output+'\nFAIL: unrelated\nERROR: unrelated\n', test, diagnostic, False),
                ]:
                    actual = bool(intended(c, o, t, d, kind))
                    assert actual == wanted, label+' oracle '+name
                    oracles.append({'case': label, 'oracle': name, 'accepted': actual})
                controls.append({'case': label, 'outcome': 'intended_failure', 'test': test, 'diagnostic': diagnostic})
            finally:
                source.write_bytes(original)
        positive('restored')
        (out/'controls.json').write_text(json.dumps(controls, indent=2)+'\n')
        (out/'oracles.json').write_text(json.dumps(oracles, indent=2)+'\n')
        (out/'source-binding.json').write_text(json.dumps({'path': str(source.relative_to(repo)),
            'sha256': hashlib.sha256(original).hexdigest(),
            'blindCategory': 'Git source custody does not establish database schema, installation or recovery acceptance.'}, indent=2)+'\n')
        print(json.dumps({'positive': 4, 'faults': len(cases), 'oracles': len(oracles)}), flush=True)
    finally:
        source.write_bytes(original)
        assert source.read_bytes() == original


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    run(args.repo.resolve(), args.out.resolve())
