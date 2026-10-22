"""Check each operator command case with named source faults and restoration."""
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
    os.umask(0o077)
    out.mkdir(mode=0o700)
    source = repo / 'workers/odm_worker/task_observation_cli.py'
    helper = repo / 'workers/odm_worker/retained_source.py'
    tests = repo / 'workers/odm_worker/test_task_observation_cli.py'
    guard_path = repo / 'docs/reviews/2026-10-13-odm-task-observation-retention/verify_controls.py'
    spec = importlib.util.spec_from_file_location('original_retention_control_helpers', guard_path)
    guards = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(guards)
    originals = {p: p.read_bytes() for p in (source, helper, tests)}
    census = {n.name for n in ast.walk(ast.parse(originals[tests]))
              if isinstance(n, ast.FunctionDef) and n.name.startswith('test_')}
    cases = []
    def add(label, test, transform, reason, file=source):
        cases.append((label, test, transform, reason, file))
    def swap(before, after):
        return lambda text: guards.swap(text, before, after)
    def omit(message):
        return lambda text: guards.disabled(text, message)
    add('summary-body-hash-replaced', 'test_actual_record_read_and_private_root_relocation',
        swap('return {field: result[field] for field in SUMMARY_FIELDS}',
             "return {**{field: result[field] for field in SUMMARY_FIELDS}, 'bodySha256':'0'*64}"),
        'Command summary must bind actual supplied reply bytes')
    add('raw-body-in-summary', 'test_summary_excludes_raw_body_error_details_and_engine_configuration',
        swap('def execute(engine_root, records_root,',
             "SUMMARY_FIELDS = SUMMARY_FIELDS + ('bodyBase64',)\n\ndef execute(engine_root, records_root,"),
        'Command summary must exclude private detail field bodyBase64')
    add('invalid-mode-reaches-plan-read', 'test_mode_validation_precedes_any_plan_read',
        omit('Choose exactly one task observation record, read or original fetch'), 'Invalid mode reached plan read')
    add('invalid-status-reaches-plan-read', 'test_explicit_status_type_and_read_status_refuse_before_plan_read',
        omit('Supply an explicit integer response status for recording only'), 'Invalid status reached plan read')
    add('invalid-timeout-reaches-plan-read', 'test_timeout_validation_precedes_any_plan_read',
        omit('Task observation command timeout must be positive and finite'), 'Invalid timeout reached plan read')
    add('oversized-input-read', 'test_supplied_file_size_refuses_before_reading_the_body',
        omit('Supplied task reply exceeds its byte bound'), 'Oversized input reached body reading')
    add('public-input-file-accepted', 'test_supplied_body_paths_aliases_and_permissions_refuse',
        lambda text: text.replace('or stat.S_IMODE(info.st_mode) & 0o077', 'or False'), 'ValueError not raised', helper)
    add('public-input-directory-accepted', 'test_public_input_directory_refuses_even_with_a_private_reply',
        swap('        private(path.parent, True)\n', ''), 'ValueError not raised')
    add('body-read-restarts-deadline', 'test_shared_deadline_covers_input_read_and_recording',
        lambda text: text.replace('        check_time(deadline)\n', '')
                         .replace('store.record(response_status, body, deadline=deadline)', 'store.record(response_status, body)'),
        'Late input cannot publish a record')
    add('refusal-prints-summary', 'test_actual_failure_has_no_summary_or_private_diagnostic',
        swap("        sys.stderr.write('Task observation refused.",
             "        sys.stdout.write('{}\\n')\n        sys.stderr.write('Task observation refused."),
        'Refused command cannot print a success summary')
    add('refusal-exit-success', 'test_actual_failure_has_no_summary_or_private_diagnostic',
        swap('        return 2\n', '        return 0\n'), 'Actual refused command must exit two')
    add('missing-roots-reach-execution', 'test_parser_requires_roots_and_exactly_one_operation',
        lambda text: text.replace('type=Path, required=True', 'type=Path, required=False'),
        'Incomplete command must fail argument validation')
    add('missing-mode-skips-parser', 'test_parser_requires_roots_and_exactly_one_operation',
        swap('add_mutually_exclusive_group(required=True)', 'add_mutually_exclusive_group(required=False)'),
        'Incomplete command must fail in the argument parser')
    add('summary-grants-publication', 'test_record_replay_preserves_the_original_file_and_denied_claims',
        swap('return {field: result[field] for field in SUMMARY_FIELDS}',
             "return {**{field: result[field] for field in SUMMARY_FIELDS}, 'publicationPermission':True}"),
        'Command cannot grant publicationPermission')
    if {c[1] for c in cases} != census:
        raise ValueError('Operator command cases lack targeted source controls')
    outcomes = []
    oracles = None
    def restore():
        for p, b in originals.items():p.write_bytes(b)
    def execute(label, test=None):
        cwd = out / (label + '-cwd')
        cwd.mkdir(mode=0o700)
        result = subprocess.run([sys.executable, '-B', str(tests)] + (['Checks.' + test] if test else []),
            cwd=cwd, capture_output=True, timeout=30,
            env={**os.environ, 'PYTHONDONTWRITEBYTECODE':'1', 'PYTHONPATH':str(source.parent)})
        output = (result.stdout + result.stderr).decode(errors='replace')
        (out / (label + '.log')).write_text(output)
        return result.returncode, output
    def positive(label):
        code, output = execute(label)
        if code or 'Ran ' + str(len(census)) + ' tests' not in output:
            raise AssertionError(label + ': operator positive failed\n' + output)
        outcomes.append({'control':label, 'outcome':'survived'})
    try:
        positive('baseline')
        source.write_bytes(originals[source] + b'\n# Harmless operator command control.\n')
        helper.write_bytes(originals[helper] + b'\n# Harmless private input reader control.\n')
        positive('harmless-comments')
        restore();positive('restored-after-harmless')
        for label, test, transform, reason, file in cases:
            try:
                changed = transform(originals[file].decode())
                ast.parse(changed)
                file.write_text(changed)
                code, output = execute(label, test)
                if not guards.intended_failure(code, output, test, reason):
                    raise AssertionError(label + ': wrong command failure\n' + output)
                if oracles is None:
                    oracles = guards.oracle_controls(code, output, test, reason)
                outcomes.append({'control':label, 'test':test, 'source':str(file.relative_to(repo)),
                    'outcome':'intended_failure', 'reason':reason})
            finally:
                restore()
        positive('restored-final')
        if any(p.read_bytes() != b for p, b in originals.items()):
            raise AssertionError('Operator sources did not restore')
        (out / 'controls.json').write_text(json.dumps(outcomes, indent=2) + '\n')
        (out / 'oracle-controls.json').write_text(json.dumps(oracles, indent=2) + '\n')
        (out / 'source-bindings.json').write_text(json.dumps({str(p.relative_to(repo)):
            hashlib.sha256(p.read_bytes()).hexdigest() for p in (*originals, guard_path)}, indent=2) + '\n')
        print(json.dumps({'cases':len(census), 'survivors':4, 'faults':len(cases), 'controls':len(outcomes)}))
    finally:
        restore()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    run(args.repo.resolve(), args.out.resolve())
