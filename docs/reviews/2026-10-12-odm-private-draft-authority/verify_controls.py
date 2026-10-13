"""Private draft authority controls with exact restoration and failure checks."""
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
    source = repo/'workers/odm_worker/application_draft_authority.py'
    tests = source.with_name('test_application_draft_authority.py')
    original = source.read_bytes();test_bytes = tests.read_bytes()
    helper_path = repo/'docs/reviews/2026-10-11-odm-url-transport/verify_controls.py'
    spec = importlib.util.spec_from_file_location('authority_fault_helper', helper_path)
    helper = importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    census = {node.name for node in ast.walk(ast.parse(test_bytes)) if isinstance(node, ast.FunctionDef) and node.name.startswith('test_')}
    cases = []
    def add(label, test, change, reason, kind='broken_behavior'):
        cases.append((label, 'test_'+test, change, reason, kind))
    swap = lambda before, after: lambda text: helper.replace(text, before, after)
    guard = lambda reason: lambda text: helper.disable(text, reason)
    add('current-read-omitted', 'actual_pipeline_reads_current_access_before_each_original_command',
        swap('current = self.reader.observe(request_id, deadline=deadline)', "current = {'authorizedNow': True}"), 'Each original draft command must read current access')
    add('revoked-access-promoted', 'revoked_access_refuses_before_upload_intent_and_preserves_original',
        swap("if current['authorizedNow'] is not True:", 'if False:'), 'PermissionError not raised')
    add('unattested-engine-permitted', 'engine_refusal_cannot_issue_or_send_next_command',
        swap('return attested is True', 'return True'), 'PermissionError not raised')
    add('attestation-type-unchecked', 'attestation_requires_boolean',
        guard('Private draft engine attestation must return a boolean'), 'ValueError not raised')
    add('command-guard-omitted', 'exact_command_and_commit_refuse_before_private_read',
        guard('Only the exact original draft command can be authorized'), 'ValueError not raised')
    add('plan-shape-unchecked', 'plan_shape_refuses_before_private_read',
        swap('plan = original_plan(plan)', 'plan = copy.deepcopy(plan)'), 'ValueError not raised')
    add('engine-identity-unchecked', 'engine_changes_refuse_before_private_read',
        guard('Private draft engine differs from the configured original'), 'ValueError not raised')
    add('saved-scope-unchecked', 'binding_changes_refuse_before_current_read',
        guard('Private draft scope differs from the saved application original'), 'ValueError not raised')
    add('binding-shape-late-refusal', 'binding_shape_refuses_before_saved_read',
        guard('Private draft original binding is required'), 'does not match', 'diagnostic_refusal')
    add('constructor-adapters-unchecked', 'constructor_requires_reader_attestor_and_engine',
        guard('Private reader and explicit engine attestation are required'), 'ValueError not raised')
    add('missing-shared-deadline-accepted', 'missing_or_invalid_shared_deadline_refuses_before_read',
        guard('Private draft authority requires its actual shared deadline'), 'ValueError not raised')
    add('deadline-replaced', 'attestation_receives_detached_engine_and_actual_deadline',
        swap('deadline = self.reader._deadline(deadline)', 'deadline = self.reader._deadline(None)'), 'Attestation must receive the exact shared deadline and original engine')
    add('attestation-engine-alias', 'attestation_receives_detached_engine_and_actual_deadline',
        swap('self.attest(copy.deepcopy(self.engine), deadline,', 'self.attest(self.engine, deadline,'), 'Attestation cannot change the configured engine')
    add('post-attestation-expiry-unchecked', 'expiry_during_attestation_refuses_before_intent',
        swap('        dispatch._check(request_id, deadline)\n        if type(attested)', '        if type(attested)'), 'TimeoutError not raised')
    add('post-attestation-owner-unchecked', 'owner_loss_after_attestation_refuses',
        swap('        dispatch._check(request_id, deadline)\n        if type(attested)', '        if type(attested)'), 'ValueError not raised')
    if {row[1] for row in cases} != census:raise ValueError('Private authority tests lack selected controls')
    rows = [];oracles = []
    def restore():
        source.write_bytes(original)
        with source.open('rb') as stream:os.fsync(stream.fileno())
    def execute(label, test=None):
        result = subprocess.run([sys.executable, '-B', str(tests)]+(['Checks.'+test] if test else []),
            cwd=repo, capture_output=True, timeout=20, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
        diagnostic = (result.stdout+result.stderr).decode(errors='replace')
        (out/(label+'-private.log')).write_text(diagnostic)
        return result.returncode, diagnostic
    def positive(label, harmless=False):
        restore()
        if harmless:source.write_bytes(original+b'\n# Harmless original authority comment.\n')
        code, diagnostic = execute(label)
        assert code == 0 and 'Ran '+str(len(census))+' tests' in diagnostic, 'Private authority positive control failed: '+label
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
        positive('restored-final')
        assert source.read_bytes() == original and tests.read_bytes() == test_bytes
        (out/'controls.json').write_text(json.dumps(rows, indent=2)+'\n')
        (out/'oracle-controls.json').write_text(json.dumps(oracles, indent=2)+'\n')
        (out/'source-bindings.json').write_text(json.dumps({str(path.relative_to(repo)):hashlib.sha256(path.read_bytes()).hexdigest() for path in (source, tests, Path(__file__))}, indent=2)+'\n')
        print(json.dumps({'tests': len(census), 'controls': len(rows), 'faults': len(cases), 'survivors': 4, 'oracleControls': len(oracles)}))
    finally:restore()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True);parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args();run(args.repo.resolve(), args.out.resolve())
