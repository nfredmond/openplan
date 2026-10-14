"""Challenge private task records and restore every mutated source in finally."""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def swap(value, before, after):
    if value.count(before) != 1:
        raise ValueError('Retention mutation anchor must be unique')
    return value.replace(before, after, 1)


def disabled(value, message):
    tree = ast.parse(value)
    matches = [node for node in ast.walk(tree) if isinstance(node, ast.If)
               and any(isinstance(s, ast.Raise) and isinstance(s.exc, ast.Call)
                       and s.exc.args and isinstance(s.exc.args[0], ast.Constant)
                       and s.exc.args[0].value == message for s in node.body)]
    if len(matches) != 1:
        raise ValueError('Retention guard anchor must be unique')
    matches[0].test = ast.Constant(False)
    return ast.unparse(tree) + '\n'


def intended_failure(code, output, test, reason):
    if type(code) is not int or code != 1 or not isinstance(output, str) or not isinstance(test, str) or not isinstance(reason, str) or not reason:
        return False
    names = re.findall(r'(?m)^(?:FAIL|ERROR): (test_\w+)', output)
    if not names or any(name != test for name in names) or not re.search(r'(?m)^Ran 1 test in [\d.]+s$', output) or not re.search(r'(?m)^FAILED \((?:failures=\d+(?:, errors=\d+)?|errors=\d+)\)$', output):
        return False
    lines = output.splitlines()
    starts = [i for i, line in enumerate(lines) if re.match(r'^[A-Za-z_][\w.]*Error:', line)]
    if not starts:
        return False
    end = next((i for i in range(starts[-1] + 1, len(lines)) if lines[i].startswith('-----')), len(lines))
    return reason in '\n'.join(lines[starts[-1]:end])


def oracle_controls(code, output, test, reason):
    positives = [('baseline', code, output, test, reason),
                 ('harmless-prefix', code, '# Harmless oracle note.\n' + output, test, reason),
                 ('restored', code, output, test, reason)]
    faults = [('success-exit', 0, output, test, reason), ('boolean-exit', True, output, test, reason),
              ('other-exit', 2, output, test, reason), ('missing-output', code, None, test, reason),
              ('wrong-test', code, output.replace(test, 'test_unrelated'), test, reason),
              ('missing-reason', code, output.replace(reason, 'unrelated'), test, reason),
              ('extra-test', code, output + '\nFAIL: test_unrelated (other.Checks.test_unrelated)\n', test, reason),
              ('missing-summary', code, re.sub(r'(?m)^Ran 1 test.*$', '', output), test, reason),
              ('wrong-count', code, output.replace('Ran 1 test', 'Ran 2 tests'), test, reason),
              ('missing-failed-result', code, re.sub(r'(?m)^FAILED.*$', '', output), test, reason),
              ('earlier-decoy-reason', code, reason + '\n' + output.replace(reason, 'unrelated'), test, reason),
              ('later-unrelated-error', code, output.replace('FAILED (failures=1)', 'KeyError: unrelated\nFAILED (failures=1)'), test, reason),
              ('missing-test', code, output, None, reason), ('missing-reason-value', code, output, test, None)]
    result = []
    for label, c, o, t, r in positives:
        if not intended_failure(c, o, t, r):
            raise AssertionError('Oracle positive refused: ' + label)
        result.append({'control':label, 'outcome':'survived'})
    for label, c, o, t, r in faults:
        if intended_failure(c, o, t, r):
            raise AssertionError('Oracle invalid result accepted: ' + label)
        result.append({'control':label, 'outcome':'intended_refusal'})
    return result


def run(repo, out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    source = repo / 'workers/odm_worker/retained_task_observation.py'
    helper = repo / 'workers/odm_worker/retained_source.py'
    tests = repo / 'workers/odm_worker/test_retained_task_observation.py'
    originals = {p: p.read_bytes() for p in (source, helper, tests)}
    census = {n.name for n in ast.walk(ast.parse(originals[tests]))
              if isinstance(n, ast.FunctionDef) and n.name.startswith('test_')}
    cases = []
    def add(label, test, transform, reason, file=source):
        cases.append((label, test, transform, reason, file))
    def changed(before, after):
        return lambda text: swap(text, before, after)
    def omitted(message):
        return lambda text: disabled(text, message)
    add('copied-reply-relabelled', 'test_exact_bytes_reopen_after_private_root_copy',
        changed('return copy.deepcopy(expected)', "return {**expected, 'reportedState':'queued'}"),
        'Copied root must retain the exact checked observation')
    add('replay-replaces-inode', 'test_equal_reply_replay_keeps_original_record_inode_and_bytes',
        changed("            publish(folder, result['bodySha256'] + '.json', payload, json_limit=RECORD_LIMIT)",
                "            old = folder / (result['bodySha256'] + '.json')\n            if old.exists():old.rename(folder / 'superseded-record')\n            publish(folder, result['bodySha256'] + '.json', payload, json_limit=RECORD_LIMIT)"),
        'Equal replay must keep the original inode')
    add('raw-spelling-normalized', 'test_different_raw_spellings_remain_separate_records',
        changed('result = observe(self.plan, status, body)', 'result = observe(self.plan, status, json_bytes(json.loads(body)))'),
        'Distinct reply spellings cannot collapse to one original')
    add('existing-record-difference-ignored', 'test_changed_existing_record_cannot_be_overwritten_by_replay',
        omitted('Existing source custody record differs'), 'ValueError not raised', helper)
    add('interpretation-not-rechecked', 'test_saved_interpretation_and_permissions_are_recomputed',
        omitted('Retained task observation interpretation differs'), 'ValueError not raised')
    add('original-body-digest-unchecked', 'test_changed_response_body_cannot_reuse_the_original_digest',
        omitted('Retained task observation body digest differs'), 'ValueError not raised')
    add('malformed-body-wrong-error-type', 'test_missing_or_invalid_saved_body_refuses',
        changed('except (KeyError, TypeError, ValueError) as error:', 'except KeyError as error:'), 'TypeError:')
    add('saved-plan-unchecked', 'test_changed_plan_refuses_before_record_or_load',
        omitted('Retained task observation original plan differs'), 'ValueError not raised')
    add('constructor-input-alias', 'test_plan_is_detached_from_constructor_input',
        changed('self.plan = original_plan(copy.deepcopy(plan))', 'self.plan = plan'),
        'Retained task observation original plan differs')
    add('missing-root-provisioned', 'test_missing_root_or_plan_is_not_provisioned',
        changed('self.root = absolute(root)', 'self.root = absolute(root)\n        self.root.mkdir(mode=0o700, exist_ok=True)'),
        'Reading observations cannot provision a missing engine root')
    add('public-root-accepted', 'test_alias_and_public_root_refuse',
        lambda text: text.replace('        private(self.root, True)\n', ''), 'ValueError not raised')
    add('public-observation-directory-accepted', 'test_unsafe_observation_directory_and_record_refuse',
        lambda text: text.replace('        private(folder, True)\n', '')
                         .replace('        private(self.records_root, True)\n', ''), 'ValueError not raised')
    add('public-observation-file-accepted', 'test_unsafe_observation_directory_and_record_refuse',
        lambda text: text.replace('or stat.S_IMODE(info.st_mode) & 0o077', 'or False'),
        'ValueError not raised', helper)
    add('invalid-digest-reaches-read', 'test_digest_is_checked_before_any_record_path_read',
        omitted('Retained task observation digest differs'), 'Invalid digest reached record read')
    add('failed-status-accepted', 'test_invalid_reply_does_not_write_observation_root',
        changed('result = observe(self.plan, status, body)', 'result = observe(self.plan, 200, body)'), 'ValueError not raised')
    add('infinite-timeout-accepted', 'test_invalid_timeout_and_shared_deadline_refuse',
        changed('return math.isfinite(value)', 'return True'), 'ValueError not raised')
    add('shared-deadline-type-omitted', 'test_invalid_timeout_and_shared_deadline_refuse',
        omitted('Task observation shared deadline must be finite'), 'TimeoutError: Source custody deadline exceeded')
    add('nested-deadline-extended', 'test_shared_deadline_is_never_extended',
        changed('own = min(own, supplied)', 'own = max(own, supplied)'),
        'Nested observation deadline must retain the actual earlier bound')
    add('publication-size-unbounded', 'test_record_and_load_size_limits_precede_publication_and_json_parse',
        lambda text: text.replace('if len(payload) > RECORD_LIMIT:', 'if False:')
                         .replace('payload, json_limit=RECORD_LIMIT)', 'payload)'), 'ValueError not raised')
    add('load-size-unbounded', 'test_record_and_load_size_limits_precede_publication_and_json_parse',
        lambda text: text.replace('if info.st_size > RECORD_LIMIT:', 'if False:')
                         .replace('stream.read(RECORD_LIMIT + 1)', 'stream.read()'), 'Oversized observation reached JSON parsing')
    add('writer-lock-omitted', 'test_actual_lock_contention_retains_the_deadline',
        lambda text: 'from contextlib import nullcontext\n' + swap(text, 'with writer(folder, deadline):', 'with nullcontext():'),
        'TimeoutError not raised')
    add('concurrent-key-not-immutable', 'test_concurrent_equal_records_retain_one_exact_reply',
        lambda text: 'import threading\n' + swap(text,
            "publish(folder, result['bodySha256'] + '.json', payload, json_limit=RECORD_LIMIT)",
            "publish(folder, result['bodySha256'] + '-' + str(threading.get_ident()) + '.json', payload, json_limit=RECORD_LIMIT)"),
        'Concurrent equal replies must retain one original record')
    add('record-check-before-initial-publication-lock', 'test_record_waits_for_initial_plan_publication',
        changed('        result = observe(self.plan, status, body)',
                '        self._check_plan(allow_empty=True)\n        result = observe(self.plan, status, body)'),
        'ValueError: Retained task observation ledger plan is missing')
    add('constructor-check-before-initial-publication-lock', 'test_constructor_waits_for_initial_plan_publication',
        changed("        try:\n            self._check_plan(allow_empty=True)\n        except ValueError as error:\n            # Wait for an existing writer without provisioning an empty ledger.\n            if str(error) != 'Retained task observation ledger plan is missing' or not (self.records_root / 'writer.lock').exists():\n                raise\n            with writer(self.records_root, time.monotonic() + self.timeout):\n                self._check_plan(allow_empty=True)",
                '        self._check_plan(allow_empty=True)'),
        'ValueError: Retained task observation ledger plan is missing')
    add('publication-directory-sync-omitted', 'test_directory_sync_failure_recovers_the_original_published_record',
        changed('    temporary.rename(target)\n    synchronize(root)', '    temporary.rename(target)'),
        'OSError not raised', helper)
    add('reopened-permission-promoted', 'test_reopened_views_keep_denied_permissions_and_independent_bytes',
        changed('return copy.deepcopy(expected)', "return {**expected, 'publicationPermission':True}"),
        'Reopened observations must keep publication denied')
    add('invalid-original-plan-accepted', 'test_invalid_original_plan_refuses_even_when_saved_bytes_match',
        changed('self.plan = original_plan(copy.deepcopy(plan))', 'self.plan = copy.deepcopy(plan)'), 'ValueError not raised')
    add('alternate-record-encoding-accepted', 'test_alternate_and_duplicate_key_record_encoding_refuses',
        omitted('Retained task observation encoding differs'), 'ValueError not raised')
    add('late-publication-acknowledged', 'test_late_published_record_remains_but_acknowledgment_refuses',
        changed("publish(folder, result['bodySha256'] + '.json', payload, json_limit=RECORD_LIMIT)\n            check_time(deadline)",
                "publish(folder, result['bodySha256'] + '.json', payload, json_limit=RECORD_LIMIT)"), 'TimeoutError not raised')
    add('overlapping-record-root-accepted', 'test_record_root_must_be_separate_from_the_engine_tree',
        omitted('Task observation records must be separate from engine commands'), 'ValueError not raised')
    add('missing-record-root-provisioned', 'test_missing_record_root_is_not_provisioned',
        changed('self.records_root = absolute(records_root)',
                'self.records_root = absolute(records_root)\n        self.records_root.mkdir(mode=0o700, exist_ok=True)'),
        'FileNotFoundError not raised')
    add('lost-ledger-plan-inferred', 'test_original_ledger_plan_is_required_when_records_exist',
        omitted('Retained task observation ledger plan is missing'), 'ValueError not raised')
    add('changed-ledger-plan-accepted', 'test_changed_ledger_plan_refuses_without_replacing_originals',
        omitted('Retained task observation ledger plan differs'), 'ValueError not raised')
    add('metadata-written-inside-engine-journal', 'test_engine_journal_remains_usable_without_added_paths',
        lambda text: text.replace('folder = self.records_root', 'folder = self.root'),
        'Recording task metadata cannot change engine command paths')
    if {c[1] for c in cases} != census:
        raise ValueError('Retention tests lack targeted controls')
    outcomes = []
    oracles = None
    def execute(label, test=None):
        cwd = out / (label + '-cwd')
        cwd.mkdir(mode=0o700)
        result = subprocess.run([sys.executable, '-B', str(tests)] + (['Checks.' + test] if test else []),
            cwd=cwd, capture_output=True, timeout=15, env={**os.environ, 'PYTHONDONTWRITEBYTECODE':'1',
                'PYTHONPATH':str(source.parent)})
        output = (result.stdout + result.stderr).decode(errors='replace')
        (out / (label + '.log')).write_text(output)
        return result.returncode, output
    def restore():
        for path, payload in originals.items():path.write_bytes(payload)
    def positive(label):
        code, output = execute(label)
        if code or 'Ran ' + str(len(census)) + ' tests' not in output:
            raise AssertionError(label + ': baseline failed\n' + output)
        outcomes.append({'control':label, 'outcome':'survived'})
    try:
        positive('baseline')
        source.write_bytes(originals[source] + b'\n# Harmless private observation record control.\n')
        helper.write_bytes(originals[helper] + b'\n# Harmless shared publication control.\n')
        positive('harmless-comments')
        restore();positive('restored-after-harmless')
        for label, test, transform, reason, file in cases:
            try:
                changed_text = transform(originals[file].decode())
                ast.parse(changed_text)
                file.write_text(changed_text)
                code, output = execute(label, test)
                if not intended_failure(code, output, test, reason):
                    raise AssertionError(label + ': target, result or diagnostic differs\n' + output)
                if oracles is None:
                    oracles = oracle_controls(code, output, test, reason)
                outcomes.append({'control':label, 'test':test, 'source':str(file.relative_to(repo)),
                    'outcome':'intended_failure', 'reason':reason})
            finally:
                restore()
        positive('restored-final')
        if any(p.read_bytes() != b for p, b in originals.items()):
            raise AssertionError('Retention source did not restore exactly')
        (out / 'controls.json').write_text(json.dumps(outcomes, indent=2) + '\n')
        (out / 'oracle-controls.json').write_text(json.dumps(oracles, indent=2) + '\n')
        (out / 'source-bindings.json').write_text(json.dumps({str(p.relative_to(repo)):
            hashlib.sha256(p.read_bytes()).hexdigest() for p in originals}, indent=2) + '\n')
        print(json.dumps({'controls':len(outcomes), 'positive':4, 'broken':len(cases), 'testsCovered':len(census)}))
    finally:
        restore()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    run(args.repo.resolve(), args.out.resolve())
