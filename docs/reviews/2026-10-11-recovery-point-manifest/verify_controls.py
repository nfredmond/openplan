"""Exercise packet oracles with exact production-source restoration in finally."""
import ast
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

REPO = Path(__file__).resolve().parents[3]
SOURCE = REPO / 'openplan/scripts/ops/recovery_point_manifest.py'
TEST = REPO / 'openplan/scripts/ops/tests/test_recovery_point_manifest.py'
ORIGINAL = SOURCE.read_bytes()
OUT = Path(sys.argv[1]).absolute()
OUT.mkdir(mode=0o700, parents=True, exist_ok=False)
(OUT / 'original-source.py').write_bytes(ORIGINAL)
(OUT / 'tests-source.py').write_bytes(TEST.read_bytes())
records = []


def run(label, content, method=None, expected=None):
    SOURCE.write_bytes(content)
    with SOURCE.open('rb') as stream: os.fsync(stream.fileno())
    arguments = [sys.executable, '-B', str(TEST), '-v']
    if method: arguments.append('RecoveryPacketTests.' + method)
    result = subprocess.run(arguments, cwd=REPO / 'openplan',
                            env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'},
                            capture_output=True, timeout=15)
    output = (result.stdout + result.stderr).decode()
    (OUT / (label + '.log')).write_text(output)
    if expected is None:
        if result.returncode: raise AssertionError('Baseline or harmless variant failed: ' + label)
    elif result.returncode == 0 or method not in output or expected not in output:
        raise AssertionError('Broken packet variant missed intended oracle: ' + label)
    records.append({'case': label, 'method': method, 'exitCode': result.returncode,
                    'result': 'survived' if expected is None else 'failed intended oracle',
                    'expectedAssertion': expected})
    (OUT / 'progress.json').write_text(json.dumps(records, indent=2) + '\n')


def replace(old, new, count=1):
    text = ORIGINAL.decode()
    if text.count(old) != count: raise AssertionError('Ambiguous packet mutation: ' + old)
    return text.replace(old, new).encode()


def omit(reason):
    tree = ast.parse(ORIGINAL)
    found = []
    for node in ast.walk(tree):
        if isinstance(node, ast.If) and node.body and isinstance(node.body[0], ast.Raise):
            call = node.body[0].exc
            if isinstance(call, ast.Call) and call.args and isinstance(call.args[0], ast.Constant) and call.args[0].value == reason:
                found.append(node)
    if len(found) != 1: raise AssertionError('Ambiguous packet guard: ' + reason)
    found[0].test = ast.Constant(False)
    return (ast.unparse(ast.fix_missing_locations(tree)) + '\n').encode()


def function_edit(name, edit):
    tree = ast.parse(ORIGINAL)
    function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == name)
    edit(function)
    return (ast.unparse(ast.fix_missing_locations(tree)) + '\n').encode()


def remove_call(function, name, occurrence=0):
    calls = [node for node in function.body if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call) and ast.unparse(node.value.func) == name]
    function.body.remove(calls[occurrence])


try:
    run('baseline', ORIGINAL)
    run('harmless-comment', ORIGINAL + b'\n# Harmless retained-packet control.\n')
    run('harmless-manifest-indentation', replace('indent=2, sort_keys=True', 'indent=4, sort_keys=True'))
    guards = [
        ('quiescence', 'Quiesce writers before sealing a recovery packet', 'test_quiescence_required', 'ValueError not raised'),
        ('declaration-format', 'Recovery packet declaration format differs', 'test_declaration_format_refused', 'ValueError not raised'),
        ('duplicate-json-binding', 'Recovery packet JSON has duplicate keys', 'test_duplicate_json_keys_refused', 'ValueError not raised'),
        ('required-categories', 'Recovery packet artifact categories differ', 'test_missing_category_refused', 'ValueError not raised'),
        ('unsupported-category-diagnostic', 'Recovery packet artifact categories differ', 'test_extra_category_refused', 'KeyError'),
        ('declared-kind', 'Recovery packet declared artifact kind differs', 'test_wrong_declared_kind_refused', 'ValueError not raised'),
        ('duplicate-artifact-path', 'Recovery packet declared artifact paths are duplicated', 'test_duplicate_artifact_paths_refused', 'ValueError not raised'),
        ('existing-publication', 'Recovery packet publication state already exists', 'test_publication_state_refused', 'publication began over existing receipt'),
        ('declaration-read-binding', 'Recovery packet declaration changed while reading', 'test_changed_declaration_during_read_refused', 'ValueError not raised'),
        ('initial-declaration-binding', 'Recovery packet declaration changed before inventory', 'test_changed_declaration_before_inventory_refused', 'ValueError not raised'),
        ('final-packet-binding', 'Recovery packet changed during sealing', 'test_changed_packet_during_sync_refused', 'ValueError not raised'),
        ('verify-content-binding', 'Recovery packet retained entries differ', 'test_verify_extra_or_changed_entries_refused', 'ValueError not raised'),
        ('verify-mode-binding', 'Recovery packet retained entries differ', 'test_verify_changed_mode_refused', 'ValueError not raised'),
        ('verify-manifest-format', 'Recovery packet manifest format differs', 'test_verify_manifest_format_refused', 'ValueError not raised')]
    for label, reason, method, oracle in guards:
        run(label, omit(reason), method, oracle)
    # Select the two path guards independently, including malformed-value diagnostics.
    for label, index, method, oracle in [('unsafe-relative-path', 1, 'test_unsafe_path_refused', 'ValueError not raised'),
                                         ('nonscalar-path-diagnostic', 0, 'test_nonscalar_path_refused', 'TypeError')]:
        def disable(function, index=index):
            loop = next(node for node in function.body if isinstance(node, ast.For))
            choices = [node for node in loop.body if isinstance(node, ast.If) and node.body and isinstance(node.body[0], ast.Raise) and 'path is unsafe' in ast.unparse(node.body[0])]
            choices[index].test = ast.Constant(False)
        run(label, function_edit('declaration', disable), method, oracle)
    run('declaration-call-bypassed', replace('return declaration(payload), before', 'return json.loads(payload), before'), 'test_complete_native_packet', 'packet declaration validation bypassed')
    def promote(function):
        found = [(node, i) for node in ast.walk(function) if isinstance(node, ast.Dict) for i, key in enumerate(node.keys) if isinstance(key, ast.Constant) and key.value == 'installationConsistency']
        if len(found) != 1: raise AssertionError('Ambiguous installation-acceptance mutation')
        node, index = found[0]
        node.values[index] = ast.Constant('accepted')
    run('installation-acceptance-promoted', function_edit('seal', promote), 'test_complete_native_packet', 'packet promoted installation acceptance')
    run('storage-directory-support-removed', replace("'storage': {'file', 'directory'}", "'storage': {'file'}"), 'test_storage_directory_supported', 'declared artifact kind differs')
    for label, method in [('missing-declared-file', 'test_missing_declared_file_refused'), ('wrong-actual-kind', 'test_actual_kind_differs_refused')]:
        run(label, function_edit('seal', lambda function: remove_call(function, 'require_artifacts')), method, 'ValueError not raised')
    run('empty-declared-file', omit('Recovery packet declared artifact file is empty'), 'test_empty_declared_file_refused', 'ValueError not raised')
    run('all-private-path-checks-bypassed', replace('    declared, original = read_declaration(point, deadline)', '    workers.root.journal.private_path = lambda *args, **kwargs: None\n    declared, original = read_declaration(point, deadline)'), 'test_private_packet_paths_refused', 'ValueError not raised')
    def remove_capture_validation(function):
        function.body = [node for node in function.body if not (isinstance(node, ast.Expr) and isinstance(node.value, ast.Call) and ast.unparse(node.value.func) == 'validate_worker_set')]
    run('nested-set-capture-validation-bypassed', function_edit('seal', remove_capture_validation), 'test_invalid_worker_set_refused_before_publication', 'OSError not raised')
    run('nested-set-final-validation-bypassed', function_edit('seal', lambda function: remove_call(function, 'validate_worker_set', 1)), 'test_worker_set_rechecked_after_sync', 'ValueError not raised')
    run('nested-set-verify-validation-bypassed', function_edit('verify', lambda function: remove_call(function, 'validate_worker_set')), 'test_verify_rebound_invalid_worker_set_refused', 'ValueError not raised')
    run('verify-artifact-validation-bypassed', function_edit('verify', lambda function: remove_call(function, 'require_artifacts')), 'test_verify_rebound_missing_artifact_refused', 'ValueError not raised')
    original_required = "    declared, _original = read_declaration(point, deadline)"
    source_check = original_required + "\n    selection = json.loads((point / declared['artifacts']['workerRootSet']['path'] / 'inventory.json').read_text())\n    workers.root.journal.private_path(Path(selection['roots'][0]['path']), directory=True)"
    run('original-worker-source-required', replace(original_required, source_check), 'test_relocated_packet_without_worker_sources', 'FileNotFoundError')
    run('retained-file-sync-omitted', replace('            workers.root.journal.sync_file(point / name)', '            pass'), 'test_file_and_directory_sync', 'retained database file not synced')
    run('retained-directory-sync-omitted', replace("        workers.root.sync_directory(point if name == '.' else point / name)", '        pass'), 'test_file_and_directory_sync', 'empty configuration directory not synced')
    run('final-parent-sync-omitted', replace('        workers.root.sync_directory(point.parent)', '        pass'), 'test_file_and_directory_sync', 'final packet and parent not synced')
    def remove_manifest_sync(function):
        block = next(node for node in function.body if isinstance(node, ast.With))
        block.body = [ast.Pass() if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call) and ast.unparse(node.value.func) == 'os.fsync' else node for node in block.body]
    run('manifest-sync-omitted', function_edit('publish', remove_manifest_sync), 'test_manifest_fsynced_before_link', 'packet manifest not synced before publication')
    run('failed-publication-retains-success-receipt', replace('        receipt.unlink(missing_ok=True)', '        pass'), 'test_failed_final_sync_removes_receipt', 'failed packet published receipt')
    def swallow_file_sync(function):
        loop = next(node for node in function.body if isinstance(node, ast.For) and ast.unparse(node.target) == '(name, row)')
        branch = next(node for node in loop.body if isinstance(node, ast.If))
        branch.body = [ast.Try(body=branch.body, handlers=[ast.ExceptHandler(type=ast.Name(id='OSError', ctx=ast.Load()), body=[ast.Pass()])], orelse=[], finalbody=[])]
    run('retained-file-sync-failure-swallowed', function_edit('seal', swallow_file_sync), 'test_retained_file_sync_failure_refused', 'OSError not raised')
    run('caller-deadline-ignored', replace('deadline = workers.deadline_for(timeout)', 'deadline = workers.deadline_for(3600)', count=2), 'test_invalid_deadlines_refused', 'ValueError not raised')
    run('cli-private-path-disclosure', replace("print(json.dumps({'format': FORMAT", "print(json.dumps({'privatePath': str(args.point), 'format': FORMAT"), 'test_cli_seal_verify_private_stdout', 'packet CLI disclosed private path')
    run('cli-mixed-scope-guard-omitted', replace('if args.verify and args.writers_quiesced:', 'if False:'), 'test_cli_mixed_or_missing_scope_refused', 'mixed or missing packet CLI scope survived')
    run('restored', ORIGINAL)
    (OUT / 'result.json').write_text(json.dumps({'sourceSha256': hashlib.sha256(ORIGINAL).hexdigest(), 'testsSha256': hashlib.sha256(TEST.read_bytes()).hexdigest(), 'cases': records, 'scope': 'Native private filesystem/SQLite packet fixtures; opaque database/Storage test bytes are not native restore evidence. Some malformed-value controls establish controlled diagnostics. Reported failures do not establish hardware loss. No installation discovery, live fence, coordinated live cut, encryption, browser, scientific or hosted acceptance.'}, indent=2) + '\n')
finally:
    SOURCE.write_bytes(ORIGINAL)
    with SOURCE.open('rb') as stream: os.fsync(stream.fileno())
    if SOURCE.read_bytes() != ORIGINAL: raise AssertionError('Exact packet source restoration failed')
print(len(records), 'controls pass; exact packet source restored')
