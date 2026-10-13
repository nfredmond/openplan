"""Challenge actual original processing access boundaries and restore source in finally."""
import argparse
import ast
import hashlib
import json
import os
import re
from pathlib import Path
import subprocess
import sys


def intended(code, output, test, diagnostic, kind):
    marker = 'FAIL:' if kind == 'failures' else 'ERROR:'
    other = 'ERROR:' if kind == 'failures' else 'FAIL:'
    names = re.findall(r'^' + marker + r' ([^ ]+) \(test_retained_output_archive.Checks.[^)]*\)', output, re.MULTILINE)
    return type(code) is int and code == 1 and names and set(names) == {test} and diagnostic in output and not re.search(
        r'^' + other, output, re.MULTILINE) and re.search(r'FAILED \(' + kind + r'=\d+\)\s*$', output) is not None


def run(repo, out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    module = repo / 'workers/odm_worker/retained_output_archive.py'
    originals = {module: module.read_bytes()}
    original = originals[module]; text = original.decode()
    tests = repo / 'workers/odm_worker/test_retained_output_archive.py'
    rows=[];oracles=[];cases=[]
    def fault(label,before,after,test,diagnostic,kind='failures'):
        if text.count(before)!=1:raise ValueError(label+' binding must be unique')
        cases.append((label,module,text.replace(before,after),test,diagnostic,kind))
    def removed(label,message,test,diagnostic='ValueError not raised',kind='failures'):
        tree=ast.parse(text)
        found=[n for n in ast.walk(tree) if isinstance(n,ast.If) and any(isinstance(c,ast.Raise) and isinstance(c.exc,ast.Call) and c.exc.args and isinstance(c.exc.args[0],ast.Constant) and c.exc.args[0].value==message for c in n.body)]
        if len(found)!=1:raise ValueError(label+' guard must be unique')
        found[0].test=ast.Constant(False);cases.append((label,module,ast.unparse(tree)+'\n',test,diagnostic,kind))
    fault('archive-bytes-changed', "return result", "return {**result, 'archive':{**actual,'sha256':'0'*64}}", 'test_exact_archive_and_all_members_remain_private_and_unassessed', 'AssertionError')
    fault('complete-replay-refetches', '    bound = ', '    private(source_root, True)\n    bound = ', 'test_completed_replay_needs_no_original_source_and_preserves_inode', 'FileNotFoundError:', 'errors')
    fault('copied-receipt-changed', '        return result', "        if destination.name == 'copied-output': result['format'] = 'wrong'\n        return result", 'test_private_root_copy_preserves_original_receipt', 'Local copied archive must retain original byte and context receipt')
    removed('raw-size-preflight-omitted','Output archive exceeds raw byte budget','test_raw_archive_bound_refuses_before_plan','Raw bound must precede ZIP directory parsing')
    removed('expanded-size-preflight-omitted','Output archive exceeds declared expanded byte budget','test_expanded_member_bound_refuses_before_plan','Expanded bound must precede member inflation')
    fault('directory-bounds-ignored', "limits['entries'], limits['directoryBytes'], deadline)", '10**9, 10**9, deadline)', 'test_directory_and_entry_bounds_precede_zip_loading', 'Directory bounds must precede ZIP loading')
    removed('unsafe-members-accepted','Output archive member name is unsafe or repeated','test_unsafe_and_duplicate_names_refuse_before_receipt')
    removed('special-members-accepted','Output archive encrypted or special member is unsupported','test_special_members_and_empty_archives_refuse')
    removed('noncompleted-source-accepted','Output archive requires original reported completion','test_noncompleted_original_observation_refuses_before_output_directory')
    removed('original-plan-not-compared','Saved output archive original plan differs','test_changed_plan_or_receipt_cannot_replace_original_custody')
    fault('corrupt-archive-not-rechecked', "        actual = inventory(destination, 'archive.zip', limits, deadline)", "        actual = plan['archive']", 'test_corrupt_retained_archive_refuses_without_recopied_source', 'not raised')
    fault('interrupted-alias-left-behind', '            temporary.unlink()\n            synchronize(destination)\n        if not archive.exists()', '            synchronize(destination)\n        if not archive.exists()', 'test_interrupted_alias_publication_recovers_exact_original_bytes', 'Source file must be private and owned without aliases', 'errors')
    removed('changed-copy-hash-unchecked','Supplied output archive differs from its frozen original bytes','test_changed_source_after_frozen_plan_refuses_original_version','does not match')
    fault('expired-copy-published', '            check_time(deadline)\n            os.link', '            os.link', 'test_expired_copy_never_publishes_archive_receipt', 'Expired copy cannot publish archive bytes')
    fault('integer-limits-unchecked', '        finite_limit(value)', '        pass', 'test_limits_types_and_separate_private_roots_are_required', 'does not match')
    removed('overlapping-roots-accepted','Output archive roots must not overlap original custody','test_limits_types_and_separate_private_roots_are_required')
    fault('finite-timeout-unchecked', 'if not isinstance(observations, Observations) or not finite_number(timeout) or timeout <= 0:', 'if not isinstance(observations, Observations):', 'test_limits_types_and_separate_private_roots_are_required', 'does not match')
    fault('original-observer-type-unchecked', 'if not isinstance(observations, Observations) or not finite_number(timeout) or timeout <= 0:', 'if not finite_number(timeout) or timeout <= 0:', 'test_limits_types_and_separate_private_roots_are_required', "'NoneType' object has no attribute 'load'", 'errors')
    removed('lost-plan-reconstructed','Output archive original plan is missing','test_missing_original_plan_refuses_before_reconstructing_existing_archive','Missing original plan cannot be reconstructed from a source path')
    fault('owned-partial-kept', '        path.unlink()', '        pass', 'test_owned_unpublished_metadata_does_not_accumulate_on_recovery', 'Owned unpublished metadata must be removed without changing original receipt')
    removed('unknown-partial-discarded','Output archive has an unknown unpublished record','test_unknown_unpublished_file_is_preserved_and_refused')
    census={node.name for node in ast.walk(ast.parse(tests.read_bytes())) if isinstance(node,ast.FunctionDef) and node.name.startswith('test_')}
    if {row[3] for row in cases}!=census:raise ValueError('Every processing access case requires a targeted control')
    def execute(label, test=None):
        names = ['test_retained_output_archive' + ('.Checks.' + test if test else '')]
        result = subprocess.run([sys.executable, '-B', '-m', 'unittest', '-v', *names], cwd=module.parent,
            capture_output=True, text=True, timeout=30, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
        output = result.stdout + result.stderr
        (out / (label + '-private.log')).write_text(output)
        return result.returncode, output
    def positive(label, payload):
        module.write_bytes(payload)
        code, output = execute(label)
        if code or 'Ran 18 tests' not in output or not output.rstrip().endswith('OK'):
            raise AssertionError(label + ' complete task-read cohort failed')
        rows.append({'control': label, 'outcome': 'survived', 'cases': 18})
    try:
        positive('baseline', original)
        positive('harmless-comment', original + b'\n# Harmless original processing access control.\n')
        positive('restored-after-harmless', original)
        for label, target, changed, test, diagnostic, kind in cases:
            try:
                ast.parse(changed)
                target.write_text(changed)
                code, output = execute(label, test)
                if not intended(code, output, test, diagnostic, kind):
                    raise AssertionError(label + ' did not fail at its intended assertion')
                for name, c, o, t, d, k, wanted in [
                    ('exact', code, output, test, diagnostic, kind, True),
                    ('wrong-exit', 0, output, test, diagnostic, kind, False),
                    ('boolean-exit', True, output, test, diagnostic, kind, False),
                    ('wrong-case', code, output, 'unrelated_case', diagnostic, kind, False),
                    ('wrong-diagnostic', code, output, test, 'unrelated diagnostic', kind, False),
                    ('wrong-kind', code, output, test, diagnostic, 'errors' if kind == 'failures' else 'failures', False),
                    ('success-output', code, 'OK', test, diagnostic, kind, False)]:
                    actual = bool(intended(c, o, t, d, k))
                    if actual is not wanted:
                        raise AssertionError('Original processing authority failure oracle differs')
                    oracles.append({'control': label + '-' + name, 'accepted': actual})
                rows.append({'control': label, 'outcome': 'intended_failure', 'case': test, 'diagnostic': diagnostic, 'kind': kind})
            finally:
                for path, data in originals.items(): path.write_bytes(data)
        positive('restored-final', original)
        if module.read_bytes() != original:
            raise AssertionError('Original processing authority HTTP source did not restore')
        (out / 'controls.json').write_text(json.dumps(rows, indent=2) + '\n')
        (out / 'oracle-controls.json').write_text(json.dumps(oracles, indent=2) + '\n')
        (out / 'source-bindings.json').write_text(json.dumps({str(p.relative_to(repo)): hashlib.sha256(p.read_bytes()).hexdigest() for p in [module, tests, Path(__file__)]}, indent=2) + '\n')
        print(json.dumps({'positiveCohorts': 4, 'casesPerPositive': 18, 'targetedFaults': len(cases), 'oracleControls': len(oracles), 'sourceRestored': True}))
    finally:
        for path, data in originals.items(): path.write_bytes(data)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    run(args.repo.resolve(), args.out.resolve())
