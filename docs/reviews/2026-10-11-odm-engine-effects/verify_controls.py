"""Exercise every new effect test with harmless and restored source controls."""
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
    if value.count(before) != 1:
        raise ValueError('Effect mutation anchor must be unique')
    return value.replace(before, after, 1)


def guard(value, message):
    lines = value.splitlines(keepends=True)
    indexes = [index for index, line in enumerate(lines) if "raise ValueError('"+message+"')" in line]
    if len(indexes) != 1:
        raise ValueError('Effect guard anchor must be unique')
    index = indexes[0]-1
    lines[index] = lines[index][:len(lines[index])-len(lines[index].lstrip())]+'if False:\n'
    return ''.join(lines)


def run(repo, out):
    os.umask(0o077);out.mkdir(mode=0o700)
    source = repo/'workers/odm_worker/engine_effects.py'
    tests = repo/'workers/odm_worker/test_engine_effects.py'
    original = source.read_bytes();test_bytes = tests.read_bytes();text = original.decode()
    census = {node.name for node in ast.walk(ast.parse(test_bytes)) if isinstance(node, ast.FunctionDef) and node.name.startswith('test_')}
    cases = []
    def add(label, test, transform, reason, kind='broken_behavior'):
        cases.append((label, test, transform, reason, kind))
    def disable(message): return lambda value: guard(value, message)
    def swap(before, after): return lambda value: replace(value, before, after)
    add('photo-format-changed', 'test_original_plan_and_commands', swap("'format': ZIP_FORMAT if custody is not None else FORMAT", "'format': ZIP_FORMAT"), 'photo plan format must remain original')
    add('photo-field-added', 'test_original_plan_and_commands', swap("    if custody is not None:\n        plan['sourceCustody'] = custody", "    if True:\n        plan['sourceCustody'] = custody"), 'photo plan fields must remain original')
    add('wrong-original-plan-hash', 'test_original_plan_and_commands', swap("self.plan_hash = checksum(self.plan_bytes)", "self.plan_hash = '0'*64"), 'intent must bind exact saved plan bytes')
    add('uncertain-init-reissued', 'test_unresolved_intent_never_issues_again', swap('not existed\n', 'True\n'), 'uncertain init must not issue twice')
    add('wrong-command-hash', 'test_all_commands_have_independent_once_only_intents', swap("'commandSha256': checksum(json_bytes(command))", "'commandSha256': '0'*64"), 'each command must bind its exact descriptor')
    add('omit-name-from-identity', 'test_changed_original_plan_refuses', swap("'taskUuid': task_uuid, 'name': name,", "'taskUuid': task_uuid, 'name': 'Synthetic original task',"), 'ValueError not raised')
    add('unknown-engine-fields', 'test_engine_descriptor_refuses_unknown_fields_credentials_and_digests', disable('Exact engine identity and credential reference are required'), 'ValueError not raised')
    add('endpoint-credentials', 'test_engine_descriptor_refuses_unknown_fields_credentials_and_digests', disable('Engine endpoint must not carry credentials or query state'), 'ValueError not raised')
    add('mutable-engine-digest', 'test_engine_descriptor_refuses_unknown_fields_credentials_and_digests', disable('Engine protocol or immutable digest is unsupported'), 'ValueError not raised')
    add('noncanonical-task-uuid', 'test_task_name_options_and_filename_guards', disable('Original engine task UUID must be canonical'), 'ValueError not raised')
    add('invalid-task-name', 'test_task_name_options_and_filename_guards', disable('Original engine task name is invalid'), 'ValueError not raised')
    add('missing-option-shape-check', 'test_task_name_options_and_filename_guards', disable('Explicit ordered engine options are required'), 'ValueError not raised')
    add('unsafe-upload-name', 'test_task_name_options_and_filename_guards', disable('Exact ordered upload filenames are required'), 'ValueError not raised')
    add('zip-as-upload-image', 'test_zip_is_not_an_upload_image', disable('ZIP source requires original derived-image custody'), 'does not match', 'diagnostic_refusal')
    add('source-not-rechecked', 'test_original_source_bytes_rechecked_before_issue', swap('        receipt = self._source_receipt(end)\n        if receipt[', '        receipt = {"manifestSha256": self.plan["sourceManifestSha256"]}\n        if receipt['), 'ValueError not raised')
    add('altered-intent-accepted', 'test_saved_plan_and_intent_corruption_refuse', disable('Saved engine command intent differs'), 'ValueError not raised')
    add('altered-plan-accepted', 'test_saved_plan_and_intent_corruption_refuse', disable('Saved engine plan differs from original identity'), 'ValueError not raised')
    add('orphan-reply-diagnostic', 'test_orphan_and_unknown_records_refuse', disable('Saved engine reply has no original intent'), 'does not match', 'diagnostic_refusal')
    add('unknown-command-record', 'test_orphan_and_unknown_records_refuse', disable('Engine journal contains unknown effect records'), 'ValueError not raised')
    add('orphan-plan-rebuilt', 'test_missing_plan_never_recreates_command_identity', disable('Engine effect records have no original plan'), 'ValueError not raised')
    add('reply-before-intent', 'test_reply_requires_original_intent', disable('Engine reply requires a durably issued intent'), 'ValueError not raised')
    add('raw-reply-hash-lost', 'test_exact_reply_preserved_without_custody_promotion', swap("'bodySha256': checksum(body)", "'bodySha256': '0'*64"), 'reply must bind exact original raw bytes')
    add('acknowledgment-promotes-custody', 'test_exact_reply_preserved_without_custody_promotion', swap("'parsed': value,\n                'engineCustodyVerification': 'unassessed'}", "'parsed': value,\n                'engineCustodyVerification': 'verified'}"), 'HTTP acknowledgment must not promote custody')
    add('upload-one-success-unchecked', 'test_upload_reply_success_is_exact_boolean', swap("value.get('success') is not True", "(value.get('success') is not True and operation != 'upload:1')"), 'ValueError not raised')
    add('old-commit-upload-reply-rule', 'test_commit_reply_requires_original_uuid', swap("operation in ('init', 'commit')", "operation == 'init'"), 'ValueError not raised')
    add('native-commit-uuid-rejected', 'test_actual_commit_uuid_reply_is_retained', swap("operation in ('init', 'commit')", "operation == 'init'"), 'Engine reply does not establish original command acknowledgment')
    add('commit-raw-reply-hash-lost', 'test_actual_commit_uuid_reply_is_retained', swap("'bodySha256': checksum(body)", "'bodySha256': '0'*64"), 'Commit reply must preserve exact original bytes')
    add('commit-acknowledgment-promotes-custody', 'test_actual_commit_uuid_reply_is_retained', swap("'parsed': value,\n                'engineCustodyVerification': 'unassessed'}", "'parsed': value,\n                'engineCustodyVerification': 'verified'}"), 'Commit acknowledgement cannot promote engine custody')
    add('legacy-mock-commit-granted', 'test_invalid_legacy_commit_receipt_is_not_rewritten', swap("value.get('uuid') != plan['taskUuid']", "(value.get('uuid') != plan['taskUuid'] and not (operation == 'commit' and value.get('success') is True))"), 'ValueError not raised')
    add('nonboolean-success', 'test_upload_reply_success_is_exact_boolean', swap("value.get('success') is not True", "value.get('success') != True"), 'ValueError not raised')
    add('response-status-type-or-bound', 'test_response_bounds_types_json_and_uuid', disable('Engine reply status, byte type or bound is invalid'), 'ValueError not raised')
    add('duplicate-json-keys', 'test_response_bounds_types_json_and_uuid', disable('Engine reply has duplicate JSON keys'), 'ValueError not raised')
    add('nonfinite-json-diagnostic', 'test_response_bounds_types_json_and_uuid', swap("        raise ValueError('Engine reply contains nonfinite JSON')", '        return None'), 'ValueError not raised')
    add('wrong-original-uuid', 'test_response_bounds_types_json_and_uuid', swap("value.get('uuid') != plan['taskUuid']", 'False'), 'ValueError not raised')
    add('saved-reply-hash-ignored', 'test_stored_reply_revalidated', disable('Saved engine reply identity differs'), 'ValueError not raised')
    add('malformed-saved-reply-diagnostic', 'test_stored_reply_revalidated', disable('Saved engine reply encoding differs'), 'bytes-like object', 'diagnostic_refusal')
    add('actual-manifest-receipt-ignored', 'test_changed_actual_manifest_receipt_refuses', disable('Actual retained engine source identity differs'), 'ValueError not raised')
    add('first-flag-before-publication', 'test_first_issue_waits_for_durable_publication', swap('            publish(self.root, name, json_bytes(intent))', '            pass # intent publication omitted'), 'OSError not raised')
    add('reply-flag-before-publication', 'test_reply_sync_interruption_recovers_exact_bytes', swap('            publish(self.root, reply_name, json_bytes(reply))', '            pass # reply publication omitted'), 'OSError not raised')
    add('concurrent-command-reissued', 'test_concurrent_callers_only_one_first_issue', swap('not existed\n', 'True\n'), 'concurrent callers must have one first issue')
    add('path-bound-engine-receipt', 'test_relocated_copy_replays_without_original_source', swap('self.plan_hash = checksum(self.plan_bytes)', 'self.plan_hash = checksum(self.plan_bytes+str(self.root).encode())'), 'Saved engine command intent differs', 'diagnostic_refusal')
    add('returned-intent-alias', 'test_mutable_caller_and_returned_values_do_not_alias', swap('return json.loads(encoded(intent, canonical=True)), not existed', 'return intent, not existed'), 'Saved engine command intent differs', 'diagnostic_refusal')
    add('source-root-overlap', 'test_private_root_alias_and_overlap_guards', disable('Engine journal and retained source roots must not overlap'), 'ValueError not raised')
    add('invalid-journal-timeout', 'test_busy_lock_timeout_and_unknown_operation', disable('Engine journal timeout must be positive and finite'), 'ValueError not raised')
    add('unsupported-operation-diagnostic', 'test_busy_lock_timeout_and_unknown_operation', disable('Original engine command is unsupported'), 'does not match', 'diagnostic_refusal')
    add('erase-interrupted-partials', 'test_partial_records_preserved_and_files_private', swap('            self._check()\n            name, _reply_name', '            self._check()\n            for partial in self.root.glob(".partial-*"): partial.unlink()\n            name, _reply_name'), 'No such file', 'diagnostic_refusal')
    if {row[1] for row in cases} != census:
        raise ValueError('New effect tests lack targeted controls')
    outcomes = []
    def execute(label, test=None):
        cwd = out/(label+'-cwd');cwd.mkdir(mode=0o700)
        args = [sys.executable, '-B', str(tests)]+(['Checks.'+test] if test else [])
        result = subprocess.run(args, cwd=cwd, capture_output=True, timeout=15, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
        output = (result.stdout+result.stderr).decode(errors='replace');(out/(label+'.log')).write_text(output)
        return result.returncode, output
    def positive(label, payload):
        source.write_bytes(payload);code, output = execute(label)
        if code or 'Ran '+str(len(census))+' tests' not in output: raise AssertionError(label+': baseline failed\n'+output)
        outcomes.append({'control': label, 'outcome': 'survived'})
    try:
        positive('baseline', original)
        positive('harmless-comment', original+b'\n# Harmless original-effect control.\n')
        positive('restored-after-harmless', original)
        for label, test, transform, reason, kind in cases:
            try:
                changed = transform(text);ast.parse(changed);source.write_text(changed)
                code, output = execute(label, test)
                if code == 0 or ('FAIL: '+test not in output and 'ERROR: '+test not in output): raise AssertionError(label+': target did not fail')
                lines = output.splitlines();starts = [i for i, line in enumerate(lines) if re.match(r'^[A-Za-z_][\w.]*Error:', line)]
                diagnostic = ''
                if starts:
                    end = next((i for i in range(starts[-1]+1, len(lines)) if lines[i].startswith('-----')), len(lines))
                    diagnostic = '\n'.join(lines[starts[-1]:end])
                if reason not in diagnostic: raise AssertionError(label+': wrong diagnostic '+repr(diagnostic))
                outcomes.append({'control': label, 'test': test, 'kind': kind, 'outcome': 'intended_failure', 'reason': reason})
            finally: source.write_bytes(original)
        positive('restored-final', original)
        if source.read_bytes() != original or tests.read_bytes() != test_bytes: raise AssertionError('Effect source and tests changed')
        (out/'controls.json').write_text(json.dumps(outcomes, indent=2)+'\n')
        (out/'source-bindings.json').write_text(json.dumps({str(path.relative_to(repo)): hashlib.sha256(path.read_bytes()).hexdigest() for path in (source, tests)}, indent=2)+'\n')
        print(json.dumps({'controls': len(outcomes), 'positive': 4, 'broken': len(cases), 'testsCovered': len(census)}))
    finally:
        source.write_bytes(original)
        with source.open('rb') as stream: os.fsync(stream.fileno())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True);parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args();run(args.repo.resolve(), args.out.absolute())
