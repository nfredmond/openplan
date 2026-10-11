"""Exercise selected-set native test oracles, restoring exact source in finally."""
import ast
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

REPO = Path(__file__).resolve().parents[3]
SOURCE = REPO / 'openplan/scripts/ops/worker_root_set_snapshot.py'
TEST = REPO / 'openplan/scripts/ops/tests/test_worker_root_set_snapshot.py'
ORIGINAL = SOURCE.read_bytes()
OUT = Path(sys.argv[1]).absolute()
OUT.mkdir(mode=0o700, parents=True, exist_ok=False)
(OUT / 'original-source.py').write_bytes(ORIGINAL)
(OUT / 'tests-source.py').write_bytes(TEST.read_bytes())
records = []


def run(label, content, method=None, expected=None, busy=False):
    SOURCE.write_bytes(content)
    with SOURCE.open('rb') as stream:os.fsync(stream.fileno())
    arguments = [sys.executable, '-B', str(TEST), '-v']
    if method:arguments.append('WorkerRootSetTests.' + method)
    try:
        result = subprocess.run(arguments, cwd=REPO / 'openplan',
                                env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'},
                                capture_output=True, timeout=4 if busy else 15)
        output = (result.stdout + result.stderr).decode()
        (OUT / (label + '.log')).write_text(output)
        if expected is None:
            if result.returncode != 0:raise AssertionError('Harmless/baseline control failed: ' + label)
        elif result.returncode == 0 or expected not in output or method not in output:
            raise AssertionError('Broken variant missed intended oracle: ' + label)
        record = {'case': label, 'method': method, 'exitCode': result.returncode,
                  'result': 'survived' if expected is None else 'failed intended oracle',
                  'expectedAssertion': expected}
    except subprocess.TimeoutExpired as error:
        (OUT / (label + '.log')).write_bytes((error.stdout or b'') + (error.stderr or b''))
        if not busy:raise
        record = {'case': label, 'method': method, 'result': 'owned busy child exceeds deadline without remaining-budget propagation', 'ownedChildTimeoutSeconds': 4}
    records.append(record)
    (OUT / 'progress.json').write_text(json.dumps(records, indent=2) + '\n')


def replace(old, new):
    text = ORIGINAL.decode()
    if text.count(old) != 1:raise AssertionError('Ambiguous selected-set mutation: ' + old)
    return text.replace(old, new).encode()


def omit(reason):
    tree = ast.parse(ORIGINAL)
    found = []
    for node in ast.walk(tree):
        if isinstance(node, ast.If) and node.body and isinstance(node.body[0], ast.Raise):
            call = node.body[0].exc
            if isinstance(call, ast.Call) and call.args and isinstance(call.args[0], ast.Constant) and call.args[0].value == reason:found.append(node)
    if len(found) != 1:raise AssertionError('Ambiguous selected-set guard: ' + reason)
    found[0].test = ast.Constant(False)
    return (ast.unparse(ast.fix_missing_locations(tree)) + '\n').encode()


def capture_assignment(key, value):
    tree = ast.parse(ORIGINAL)
    function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'capture')
    found = [(node, i) for node in ast.walk(function) if isinstance(node, ast.Dict) for i, name in enumerate(node.keys) if isinstance(name, ast.Constant) and name.value == key]
    if len(found) != 1:raise AssertionError('Ambiguous selected-set metadata assignment')
    node, index = found[0];node.values[index] = ast.Constant(value)
    return (ast.unparse(ast.fix_missing_locations(tree)) + '\n').encode()


try:
    run('baseline', ORIGINAL)
    run('harmless-comment', b'# Harmless selected-set source comment\n' + ORIGINAL)
    run('harmless-manifest-indentation', replace('json.dump(record, stream, indent=2, sort_keys=True)', 'json.dump(record, stream, indent=4, sort_keys=True)'))
    cases = [
        ('declared-quiescence', 'Quiesce writers before capturing a worker-root set', 'test_quiescence_required_before_destination', 'ValueError not raised'),
        ('inventory-format', 'Worker-root inventory format differs', 'test_inventory_format_refused', 'ValueError not raised'),
        ('inventory-id', 'Worker-root inventory ID is unsafe', 'test_unsafe_id_refused', 'ValueError not raised'),
        ('duplicate-id', 'Worker-root inventory has duplicate IDs', 'test_duplicate_id_refused', 'ValueError not raised'),
        ('relative-source', 'Worker-root inventory source path is not absolute', 'test_relative_source_refused', 'ValueError not raised'),
        ('overlapping-sources', 'Worker-root set sources overlap', 'test_duplicate_or_nested_source_refused', 'ValueError not raised'),
        ('destination-source-boundary', 'Worker-root set destination is inside or above a source', 'test_destination_inside_any_source_refused', 'does not match "Worker-root destination must be outside the source"'),
        ('retained-selection', 'Retained worker-root inventory bytes differ', 'test_copied_inventory_bytes_checked', 'ValueError not raised'),
        ('changed-selection', 'Worker-root selection changed during capture', 'test_inventory_changes_during_components_refused', 'ValueError not raised'),
        ('manifest-format', 'Worker-root set manifest format differs', 'test_verify_manifest_format_refused', 'ValueError not raised'),
        ('outer-layout', 'Worker-root set has extra or incomplete entries', 'test_verify_extra_outer_entry_refused', 'ValueError not raised'),
        ('retained-inventory-binding', 'Worker-root set retained inventory differs', 'test_verify_changed_inventory_refused', 'ValueError not raised'),
        ('component-layout', 'Worker-root set component paths differ', 'test_verify_extra_component_refused', 'ValueError not raised'),
        ('component-bindings', 'Worker-root set component bindings differ', 'test_verify_changed_component_manifest_binding_refused', 'ValueError not raised'),
        ('component-source-identity', 'Worker-root set component source identity differs', 'test_verify_rebound_invalid_component_source_identity_refused', 'ValueError not raised'),
        ('finite-deadline', 'Worker-root set timeout must be positive and finite', 'test_invalid_deadlines_refused', 'TimeoutError'),
    ]
    for label, reason, method, expected in cases:run(label, omit(reason), method, expected)
    run('selection-validation-call', replace('selected = read_inventory(payload)', 'selected = json.loads(payload)'), 'test_complete_native_selected_set', 'selection validation bypassed')
    run('global-final-source-recheck', replace('root.stable_source(before[name], root.inventory(path, deadline), mains[name])', 'pass  # Deliberately omit earlier-root final recheck'), 'test_earlier_source_change_during_later_capture_refused', 'ValueError not raised')
    run('initial-component-source-binding', replace("root.stable_source(before[name], copied['sourceEntries'], mains[name])", 'pass  # Deliberately omit initial/component binding'), 'test_component_bound_to_initial_source_even_after_restore', 'ValueError not raised')
    run('source-required-on-verify', replace("components = destination / 'roots'\n    root.journal.private_path", "for item in selected['roots']:\n        root.journal.private_path(Path(item['path']), directory=True)\n    components = destination / 'roots'\n    root.journal.private_path"), 'test_verify_does_not_require_original_sources', 'FileNotFoundError')
    run('missing-inventory-mode', replace("retained_inventory.chmod(original_inventory['mode'])", 'pass  # Deliberately omit selection mode'), 'test_read_only_inventory_mode_retained', 'Retained worker-root inventory bytes differ')
    run('promote-zero-selection', capture_assignment('installationConsistency', 'complete'), 'test_explicit_zero_selection_is_unassessed', 'zero selection promoted installation acceptance')
    run('redundant-explicit-selection-privacy-selected-survives', replace('root.journal.private_path(inventory_path, directory=False)', 'pass  # Omit redundant source precheck; entry still checks privacy'), 'test_private_inventory_aliases_and_access_refused')
    run('all-selection-privacy-bypassed', replace("FORMAT = 'openplan-worker-root-set-snapshot-v1'", "root.journal.private_path = lambda *args, **kwargs: None  # Deliberately bypass shared privacy in owned test child\nFORMAT = 'openplan-worker-root-set-snapshot-v1'"), 'test_private_inventory_aliases_and_access_refused', 'ValueError not raised')
    run('existing-package-reused', replace('destination.mkdir(mode=0o700)', 'destination.mkdir(mode=0o700, exist_ok=True)'), 'test_existing_destination_unchanged', 'FileExistsError not raised')
    run('false-set-publication-after-sync-refusal', replace('receipt.unlink(missing_ok=True)', 'pass  # Deliberately retain false set receipt'), 'test_set_publication_sync_failure_removes_receipt', 'failed set publication retained success receipt')
    run('missing-selection-fsync', replace('root.journal.sync_file(retained_inventory)', 'pass  # Deliberately omit selection sync'), 'test_inventory_files_components_and_parent_synced', 'selection file not synced')
    run('missing-set-parent-sync', replace("root.sync_directory(destination.parent)\n    except OSError:", 'pass  # Deliberately omit final parent sync\n    except OSError:'), 'test_inventory_files_components_and_parent_synced', 'final set publication parent not synced')
    run('private-path-in-cli', replace("'manifestSha256': hashlib.sha256((args.destination", "'source': record['roots'][0]['sourceDirectory'] if record['roots'] else None,\n                      'manifestSha256': hashlib.sha256((args.destination"), 'test_cli_capture_and_verify_no_private_metadata', 'private source path printed')
    run('invalid-cli-scope', replace('if args.verify and (args.inventory is not None or args.writers_quiesced):', 'if False:'), 'test_cli_scope_refusals', 'invalid set CLI scope accepted')
    run('unbounded-later-native-backup', replace('timeout=deadline - time.monotonic())\n        root.stable_source', 'timeout=3600)\n        root.stable_source'), 'test_busy_native_later_database_obeys_set_deadline', 'TimeoutError', busy=True)
    run('set-receipt-before-later-component-failure', replace('records = []\n    for item', "records = []\n    publish(destination, {'format': FORMAT, 'roots': []}, deadline)  # Deliberately publish before completion\n    for item"), 'test_later_component_failure_has_no_set_receipt', 'incomplete selected set published success')
    tree = ast.parse(ORIGINAL)
    function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'publish')
    stream_block = next(node for node in function.body if isinstance(node, ast.With))
    stream_block.body = [ast.Pass() if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call) and ast.unparse(node.value.func) == 'os.fsync' else node for node in stream_block.body]
    run('set-manifest-not-synced', (ast.unparse(ast.fix_missing_locations(tree)) + '\n').encode(), 'test_set_manifest_synced_before_publication', 'set manifest not synced before publication')
    run('restored', ORIGINAL)
    (OUT / 'result.json').write_text(json.dumps({'sourceSha256': hashlib.sha256(ORIGINAL).hexdigest(), 'testsSha256': hashlib.sha256(TEST.read_bytes()).hexdigest(), 'cases': records, 'scope': 'Selected-root local filesystem/native SQLite/CLI tests. Reported later-component/sync failures cover error branches, not hardware loss. No omitted-root discovery, live-writer fence, database/Storage alignment, scientific or hosted acceptance.'}, indent=2) + '\n')
finally:
    SOURCE.write_bytes(ORIGINAL)
    with SOURCE.open('rb') as stream:os.fsync(stream.fileno())
    if SOURCE.read_bytes() != ORIGINAL:raise AssertionError('Exact selected-set source restoration failed')
print(len(records), 'controls pass; exact selected-set source restored')
