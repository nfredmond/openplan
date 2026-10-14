"""Challenge actual original archive transport boundaries and restore source in finally."""
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
    names = re.findall(r'^' + marker + r' ([^ ]+) \(test_runtime_output_intake.Checks.[^)]*\)', output, re.MULTILINE)
    return type(code) is int and code == 1 and names and set(names) == {test} and diagnostic in output and not re.search(
        r'^' + other, output, re.MULTILINE) and re.search(r'FAILED \(' + kind + r'=\d+\)\s*$', output) is not None


def run(repo, out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    module=repo/'workers/odm_worker/runtime_output_intake.py'
    originals={module:module.read_bytes()};original=originals[module];text=original.decode()
    tests=repo/'workers/odm_worker/test_runtime_output_intake.py';rows=[];oracles=[];cases=[]
    def fault(label,before,after,test,diagnostic='ValueError not raised',kind='failures'):
        if text.count(before)!=1:raise ValueError(label+' binding must be unique')
        cases.append((label,module,text.replace(before,after),test,diagnostic,kind))
    def removed(label,message,test,diagnostic='ValueError not raised',kind='failures'):
        tree=ast.parse(text)
        found=[n for n in ast.walk(tree) if isinstance(n,ast.If) and any(isinstance(c,ast.Raise) and isinstance(c.exc,ast.Call) and c.exc.args and isinstance(c.exc.args[0],ast.Constant) and c.exc.args[0].value==message for c in n.body)]
        if len(found)!=1:raise ValueError(label+' guard must be unique')
        found[0].test=ast.Constant(False);cases.append((label,module,ast.unparse(tree)+'\n',test,diagnostic,kind))
    fault('final-current-access-omitted', "            final = self._access(request_id, deadline)", "            final = {'authorityObservedAt': 'unassessed'}", 'test_exact_download_custody_checks_current_access_and_grants_nothing','Intake must check current access around download and private publication')
    fault('complete-replay-downloads-again', 'receipt = self._receipt(pack, plan_hash)', 'receipt = self._download(pack, plan, plan_hash, request_id, self.limits["max_archive_bytes"], deadline)', 'test_complete_replay_needs_no_incoming_object_or_engine_contact','Original archive credential resolution failed','errors')
    fault('missing-bytes-reported-success', "raise ValueError('Original complete output bytes are missing')", "return {'format': FORMAT, 'scope': 'private_original_output_custody'}", 'test_complete_receipt_with_no_remaining_bytes_refuses_without_refetch')
    removed('changed-byte-hash-unchecked','Original complete output bytes differ','test_changed_incoming_bytes_refuse_even_when_archive_survives','ValueError not raised')
    removed('prepared-archive-receipt-omitted','Prepared output archive has no original byte receipt','test_missing_complete_receipt_cannot_refetch_a_prepared_archive','does not match')
    removed('frozen-plan-omitted','Original output records have no frozen plan','test_missing_frozen_plan_refuses_existing_records','ValueError not raised')
    fault('current-access-silently-granted', 'result = self.observer._access(request_id, deadline)', "result = {'authorityObservedAt': 'unassessed'}", 'test_current_revocation_refuses_before_archive_get','PermissionError not raised')
    fault('post-get-revocation-receipt-published', '        self._access(request_id, deadline)\n        result = {', '        result = {', 'test_revocation_after_get_leaves_no_complete_receipt','Revoked download cannot publish a complete byte receipt')
    fault('owner-silently-restored-after-hash', '    def _access(self, request_id, deadline):\n        self._check', '    def _access(self, request_id, deadline):\n        self.observer.reader.dispatch.runtime._owned = True\n        self._check', 'test_owner_loss_after_hashing_refuses_receipt_publication','ValueError not raised')
    removed('cancellation-type-unchecked','Original output cancellation must be a boolean','test_pre_cancellation_and_nonboolean_decision_refuse','InterruptedError: Original output intake cancelled','errors')
    removed('pre-cancellation-omitted','Original output intake cancelled','test_pre_cancellation_and_nonboolean_decision_refuse','does not match')
    removed('uncompleted-task-accepted','Original output requires retained reported completion','test_uncompleted_observation_cannot_download','does not match')
    fault('changed-frozen-plan-overwritten', "            publish(pack, 'plan.json', json_bytes(original))", "            (pack/'plan.json').write_bytes(json_bytes(original))", 'test_changed_observation_or_limits_cannot_replace_frozen_plan','does not match')
    removed('third-unconfirmed-attempt-allowed','Original output attempt count reached its frozen limit','test_two_unconfirmed_attempts_hold_before_third_get','does not match')
    removed('unknown-attempt-object-accepted','Original output has an unknown attempt object','test_unknown_attempt_object_refuses_before_network')
    removed('constructor-adapters-unchecked','Original output requires a current observer and cancellation adapter','test_constructor_refuses_adapter_budget_and_timeout_types')
    removed('constructor-timeout-unchecked','Original output timeout must be positive and finite','test_constructor_refuses_adapter_budget_and_timeout_types')
    removed('transport-byte-range-unchecked','Original output attempt byte budget exceeds the transport range','test_constructor_refuses_adapter_budget_and_timeout_types')
    removed('insufficient-disk-space-accepted','Insufficient free space for original output and retained archive','test_disk_space_refuses_before_archive_get')
    changed=text.replace('self._limits = tuple(limits.items())','self._limits = limits').replace('return dict(self._limits)','return self._limits')
    if changed==text:raise ValueError('Limits alias mutation differs')
    cases.append(('exposed-limits-alias',module,changed,'test_exposed_limits_cannot_change_the_frozen_operation_by_alias','Original output limits must not retain a mutable exposed alias','failures'))
    fault('whole-download-budget-capped-to-rpc', 'deadline = time.monotonic()+self.timeout', 'deadline = self.observer.reader._deadline(time.monotonic()+self.timeout)', 'test_download_budget_is_not_shortened_to_one_rpc_read_timeout','Whole archive download must retain its stage budget beyond one RPC read','failures')
    fault('budget-probe-transport-bypassed', 'returned = transport(plan, counted, remaining, deadline, owned=owned)',
        "returned = counted.write(__import__('urllib.request', fromlist=['urlopen']).urlopen(plan['engine']['endpoint']+'/task/'+plan['taskUuid']+'/download/all.zip', timeout=5).read())",
        'test_download_budget_is_not_shortened_to_one_rpc_read_timeout', 'Budget probe must delegate one actual original transfer', 'failures')
    fault('budget-probe-returned-hash-corrupted', "            return {'format': FORMAT, 'scope': 'private_original_output_custody',",
        "            archive['archive']['sha256'] = '0'*64\n            return {'format': FORMAT, 'scope': 'private_original_output_custody',",
        'test_download_budget_is_not_shortened_to_one_rpc_read_timeout', 'Configured output budget must preserve actual original bytes', 'failures')
    fault('lost-byte-receipt-reply-refetched', 'receipt = self._receipt(pack, plan_hash)', 'receipt = None', 'test_lost_complete_receipt_reply_recovers_without_another_get','Existing source custody record differs','errors')
    block=text[text.index('            archive = retain('):text.index('            if not same({key: archive')]
    fault('archive-link-recovery-skipped', block, '            if "--owned-child" in __import__("sys").argv:\n'+''.join('    '+line+'\n' for line in block.splitlines())+'            else:\n                archive = {"archive": read_json(target, "plan.json")["archive"]}\n', 'test_link_interruption_recovers_without_incoming_bytes','Interrupted archive publication alias must be removed')
    fault('copied-runtime-needs-old-incoming-object', 'if source.exists() or source.is_symlink():', 'if True:', 'test_copied_runtime_keeps_original_output_under_current_access','FileNotFoundError','errors')
    removed('complete-receipt-shape-unchecked','Original complete output receipt differs','test_complete_receipt_shape_is_not_inferred_from_surviving_bytes','ValueError not raised')
    removed('attempt-storage-limits-unchecked','Original output attempts exceed the frozen storage limit','test_saved_attempt_storage_cannot_exceed_bytes_or_object_limits')
    removed('download-count-unchecked','Original output download count differs from written bytes','test_wrong_download_count_cannot_publish_a_complete_receipt')
    removed('stored-byte-count-unchecked','Original output stored byte count differs','test_changed_stored_size_before_hashing_cannot_publish_receipt','ValueError not raised')
    removed('exhausted-storage-attempt-created','Original output has no remaining attempt byte budget','test_exhausted_byte_budget_does_not_create_another_attempt','Exhausted output storage must not create another attempt')
    removed('retained-summary-does-not-match-download','Retained output archive differs from its original download','test_retained_archive_summary_must_match_original_download_receipt')
    census={node.name for node in ast.walk(ast.parse(tests.read_bytes())) if isinstance(node,ast.FunctionDef) and node.name.startswith('test_')}
    if {row[3] for row in cases}!=census:raise ValueError('Every runtime output case requires a targeted control')
    def execute(label, test=None):
        names = ['test_runtime_output_intake' + ('.Checks.' + test if test else '')]
        result = subprocess.run([sys.executable, '-B', '-m', 'unittest', '-v', *names], cwd=module.parent,
            capture_output=True, text=True, timeout=30 if test else 90,
            env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
        output = result.stdout + result.stderr
        (out / (label + '-private.log')).write_text(output)
        return result.returncode, output
    def positive(label, payload):
        module.write_bytes(payload)
        code, output = execute(label)
        if code or 'Ran 27 tests' not in output or not output.rstrip().endswith('OK'):
            raise AssertionError(label + ' complete runtime output cohort failed')
        rows.append({'control': label, 'outcome': 'survived', 'cases': 27})
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
                        raise AssertionError('Original runtime output failure oracle differs')
                    oracles.append({'control': label + '-' + name, 'accepted': actual})
                rows.append({'control': label, 'outcome': 'intended_failure', 'case': test, 'diagnostic': diagnostic, 'kind': kind})
            finally:
                for path, data in originals.items(): path.write_bytes(data)
        positive('restored-final', original)
        if module.read_bytes() != original:
            raise AssertionError('Original runtime output HTTP source did not restore')
        (out / 'controls.json').write_text(json.dumps(rows, indent=2) + '\n')
        (out / 'oracle-controls.json').write_text(json.dumps(oracles, indent=2) + '\n')
        (out / 'source-bindings.json').write_text(json.dumps({str(p.relative_to(repo)): hashlib.sha256(p.read_bytes()).hexdigest() for p in [module, tests, Path(__file__)]}, indent=2) + '\n')
        print(json.dumps({'positiveCohorts': 4, 'casesPerPositive': 27, 'targetedFaults': len(cases), 'oracleControls': len(oracles), 'sourceRestored': True}))
    finally:
        for path, data in originals.items(): path.write_bytes(data)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    run(args.repo.resolve(), args.out.resolve())
