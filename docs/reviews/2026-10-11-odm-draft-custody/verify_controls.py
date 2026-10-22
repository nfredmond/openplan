"""Bounded draft-inspection controls with exact source restoration."""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def replace(value, before, after):
    if value.count(before) != 1: raise ValueError('Draft control anchor must be unique')
    return value.replace(before, after, 1)


def guard(value, message):
    lines = value.splitlines(keepends=True)
    hits = [i for i, line in enumerate(lines) if "raise ValueError('"+message+"')" in line]
    if len(hits) != 1: raise ValueError('Draft guard anchor must be unique')
    index = hits[0]-1;lines[index] = lines[index][:len(lines[index])-len(lines[index].lstrip())]+'if False:\n'
    return ''.join(lines)


def run(repo, out):
    os.umask(0o077);out.mkdir(mode=0o700)
    paths = {'library': repo/'workers/odm_worker/draft_custody.py', 'cli': repo/'openplan/scripts/ops/odm_draft_custody.py'}
    originals = {key: path.read_bytes() for key, path in paths.items()}
    tests = repo/'workers/odm_worker/test_draft_custody.py';test_bytes = tests.read_bytes()
    census = {node.name for node in ast.walk(ast.parse(test_bytes)) if isinstance(node, ast.FunctionDef) and node.name.startswith('test_')}
    cases = []
    def add(label, test, transform, reason, source='library', kind='broken_behavior'):
        cases.append((label, test, transform, reason, source, kind))
    def swap(before, after): return lambda value: replace(value, before, after)
    def disable(message): return lambda value: guard(value, message)
    add('matching-bytes-grant-permission', 'test_complete_draft_reports_exact_bytes_without_permission', swap("'transportPermission': False", "'transportPermission': True"), 'captured matching bytes must not grant transport permission')
    add('wrong-original-plan-hash', 'test_complete_draft_reports_exact_bytes_without_permission', swap("'planSha256': hashlib.sha256(json_bytes(plan)).hexdigest()", "'planSha256': '0'*64"), 'draft result must bind exact original plan')
    add('partial-draft-promoted', 'test_partial_draft_accounts_for_missing_planned_upload', swap("'partial_matching_draft' if result['missingUploads']", "'complete_matching_draft' if result['missingUploads']"), 'known missing upload must remain partial')
    add('absence-promoted', 'test_absent_draft_is_inconclusive', swap("result.update(state='inconclusive'", "result.update(state='complete_matching_draft'"), 'absence cannot establish that an engine effect did not run')
    add('missing-body-promoted', 'test_missing_metadata_remains_inconclusive', swap("'inconclusive' if result['metadata'] is None", "'complete_matching_draft' if result['metadata'] is None"), 'missing metadata can follow an uncertain commit')
    add('overwritten-metadata-accepted', 'test_changed_native_metadata_refuses', disable('Captured draft metadata differs from original initialization'), 'ValueError not raised')
    add('changed-source-bytes-accepted', 'test_changed_upload_bytes_refuse', disable('Captured draft upload differs from original bytes'), 'ValueError not raised')
    add('duplicate-uploads-accepted', 'test_unknown_duplicate_files_and_directories_refuse', disable('Captured draft contains mixed or duplicate files'), 'ValueError not raised')
    add('unbounded-file-census', 'test_filename_enumeration_is_bounded', disable('Captured draft has too many files or duplicates'), 'Draft enumeration read beyond declared bound')
    add('wrong-plan-shape-diagnostic', 'test_original_plan_shape_and_source_hash_guards', disable('Original engine plan shape or source identity differs'), 'does not match', kind='mixed_target_failures')
    add('empty-mapping-diagnostic', 'test_original_upload_mapping_and_typed_rows_refuse', disable('Original engine upload mapping is required'), 'does not match', kind='diagnostic_refusal')
    add('changed-original-slot', 'test_original_upload_mapping_and_typed_rows_refuse', disable('Original engine upload record differs'), 'ValueError not raised')
    add('normalized-plan-rebound', 'test_original_engine_plan_bindings_reconstructed', disable('Original engine plan identity differs'), 'ValueError not raised')
    add('duplicate-native-json-key', 'test_metadata_duplicate_keys_and_nonfinite_values_refuse', disable('Captured draft metadata repeats a JSON key'), 'ValueError not raised')
    add('unbounded-native-json', 'test_metadata_bound_rejects_oversized_valid_json', disable('Captured draft metadata exceeds its bound'), 'ValueError not raised')
    add('upload-reader-bypassed', 'test_alias_public_and_special_files_refuse', swap("observed = digest(draft, row['filename'], remaining, deadline)", "observed = {key: row[key] for key in ('bytes','sha256')}"), 'not raised')
    for label, anchor in [('public-engine-root','root = absolute(root);private(root, True)'),
                          ('public-engine-tmp','        private(temporary, True)'), ('public-engine-draft','    private(draft, True)')]:
        after = 'root = absolute(root)' if label == 'public-engine-root' else ('        pass' if label == 'public-engine-tmp' else '    pass')
        add(label, 'test_private_roots_and_aliases_refuse', swap(anchor, after), 'ValueError not raised')
    add('planned-byte-budget-ignored', 'test_byte_budgets_and_deadlines_refuse', disable('Original planned images exceed inspection byte budget'), 'Draft bytes read before planned-budget admission')
    add('invalid-inspection-timeout', 'test_byte_budgets_and_deadlines_refuse', disable('Draft inspection timeout must be positive and finite'), 'not raised', kind='mixed_target_failures')
    add('invalid-byte-budget', 'test_byte_budgets_and_deadlines_refuse', swap('    finite_limit(max_bytes)', '    pass # byte argument guard removed'), 'ValueError not raised')
    add('late-upload-filename-ignored', 'test_late_planned_filename_refuses_partial_snapshot', disable('Captured draft filenames changed during inspection'), 'ValueError not raised')
    add('inspection-edits-draft', 'test_inspection_preserves_all_ordinary_files_and_modes', swap('    check_time(deadline)\n    return result', "    check_time(deadline)\n    (draft/'body.json').write_bytes(b'Synthetic changed bytes')\n    return result"), 'draft inspection must leave ordinary bytes and modes unchanged')
    add('wrong-package-verification-grade', 'test_actual_cli_verifies_package_before_inspection', swap("result['rootPackageVerification'] = 'verified'", "result['rootPackageVerification'] = 'unassessed'"), 'actual root package must be verified', source='cli')
    add('invalid-plan-hash-before-read', 'test_cli_refuses_original_plan_hash_mismatch', disable('Original engine plan hash is required'), 'Plan bytes read before hash format admission', source='cli')
    add('changed-plan-hash-accepted', 'test_cli_refuses_original_plan_hash_mismatch', disable('Original engine plan hash differs'), 'ValueError not raised', source='cli')
    add('package-verification-after-draft', 'test_cli_refuses_corrupt_package_before_draft_parse', swap('\n    record = worker_root_snapshot.verify(snapshot, timeout=deadline-time.monotonic())', "\n    record = {'format': 'synthetic-bypassed-verifier'}"), 'Draft parsed before package verification', source='cli')
    add('late-package-change-ignored', 'test_cli_reverifies_package_after_inspection', swap('final_record = worker_root_snapshot.verify(snapshot, timeout=deadline-time.monotonic())', 'final_record = record'), 'ValueError not raised', source='cli')
    add('changed-package-manifest-ignored', 'test_cli_refuses_changed_manifest_after_inspection', disable('Captured engine root manifest changed during inspection'), 'ValueError not raised', source='cli')
    add('invalid-cli-timeout', 'test_cli_private_plan_parent_and_time_budget', disable('Draft verification timeout must be positive and finite'), 'ValueError not raised', source='cli')
    add('public-plan-parent', 'test_cli_private_plan_parent_and_time_budget', swap('    private(plan_path.parent, True)', '    pass # plan parent privacy omitted'), 'ValueError not raised', source='cli')
    if {row[1] for row in cases} != census: raise ValueError('New draft tests lack controls')
    outcomes = []
    def restore():
        for key, path in paths.items(): path.write_bytes(originals[key])
    def execute(label, test=None):
        cwd = out/(label+'-cwd');cwd.mkdir(mode=0o700)
        result = subprocess.run([sys.executable,'-B',str(tests)]+(['Checks.'+test] if test else []), cwd=cwd,
            env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'}, capture_output=True, timeout=15)
        output = (result.stdout+result.stderr).decode(errors='replace');(out/(label+'.log')).write_text(output)
        return result.returncode, output
    def positive(label, harmless=False):
        restore()
        if harmless:
            for key, path in paths.items(): path.write_bytes(originals[key]+b'\n# Harmless draft inspection control.\n')
        code, output = execute(label)
        if code or 'Ran '+str(len(census))+' tests' not in output: raise AssertionError(label+': baseline failed')
        outcomes.append({'control':label,'outcome':'survived'})
    try:
        positive('baseline');positive('harmless-comments', True);positive('restored-after-harmless')
        for label, test, transform, reason, source, kind in cases:
            try:
                changed = transform(originals[source].decode());ast.parse(changed);paths[source].write_text(changed)
                code, output = execute(label, test)
                if code == 0 or ('FAIL: '+test not in output and 'ERROR: '+test not in output): raise AssertionError(label+': target did not fail')
                lines = output.splitlines();starts = [i for i, line in enumerate(lines) if re.match(r'^[A-Za-z_][\w.]*Error:', line)]
                diagnostic = ''
                if starts:
                    end = next((i for i in range(starts[-1]+1,len(lines)) if lines[i].startswith('-----')),len(lines))
                    diagnostic = '\n'.join(lines[starts[-1]:end])
                if reason not in diagnostic: raise AssertionError(label+': wrong diagnostic '+repr(diagnostic))
                outcomes.append({'control':label,'test':test,'source':source,'kind':kind,'outcome':'intended_failure','reason':reason})
            finally: restore()
        positive('restored-final')
        if tests.read_bytes() != test_bytes or any(path.read_bytes() != originals[key] for key, path in paths.items()): raise AssertionError('Draft source or tests changed')
        (out/'controls.json').write_text(json.dumps(outcomes,indent=2)+'\n')
        (out/'source-bindings.json').write_text(json.dumps({str(path.relative_to(repo)):hashlib.sha256(path.read_bytes()).hexdigest() for path in [*paths.values(),tests]},indent=2)+'\n')
        print(json.dumps({'controls':len(outcomes),'positive':4,'broken':len(cases),'testsCovered':len(census)}))
    finally:
        restore()
        for path in paths.values():
            with path.open('rb') as stream: os.fsync(stream.fileno())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__);parser.add_argument('--repo',type=Path,required=True)
    parser.add_argument('--out',type=Path,required=True);args = parser.parse_args();run(args.repo.resolve(),args.out.absolute())
