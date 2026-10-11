"""Exercise inventory refusal/binding oracles with production restoration in finally."""
import ast
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

REPO = Path(__file__).resolve().parents[3]
SOURCE = REPO / 'openplan/scripts/ops/installation_worker_inventory.py'
TEST = REPO / 'openplan/scripts/ops/tests/test_installation_worker_inventory.py'
ORIGINAL = SOURCE.read_bytes()
OUT = Path(sys.argv[1]).absolute()
OUT.mkdir(mode=0o700, exist_ok=False)
(OUT / 'original-source.py').write_bytes(ORIGINAL)
(OUT / 'tests-source.py').write_bytes(TEST.read_bytes())
records = []


def run(label, content, method=None, expected=None):
    SOURCE.write_bytes(content)
    with SOURCE.open('rb') as stream:
        os.fsync(stream.fileno())
    args = [sys.executable, '-B', str(TEST), '-v']
    if method:
        args.append('InstallationWorkerInventoryTests.' + method)
    result = subprocess.run(args, cwd=REPO / 'openplan', capture_output=True, timeout=15,
                            env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
    output = (result.stdout + result.stderr).decode()
    (OUT / (label + '.log')).write_text(output)
    if expected is None:
        if result.returncode:
            raise AssertionError('Positive inventory control failed: ' + label)
    elif result.returncode == 0 or method not in output or expected not in output:
        raise AssertionError('Broken inventory control missed intended oracle: ' + label)
    records.append({'case': label, 'method': method, 'exitCode': result.returncode,
                    'result': 'survived' if expected is None else 'failed intended oracle',
                    'expectedFailure': expected})
    (OUT / 'progress.json').write_text(json.dumps(records, indent=2) + '\n')


def replace(old, new, count=1):
    text = ORIGINAL.decode()
    if text.count(old) != count:
        raise AssertionError('Ambiguous inventory mutation: ' + old)
    return text.replace(old, new).encode()


def omit(message):
    found = []
    for node in ast.walk(ast.parse(ORIGINAL)):
        if isinstance(node, ast.If) and node.body and isinstance(node.body[0], ast.Raise):
            call = node.body[0].exc
            if isinstance(call, ast.Call) and call.args and isinstance(call.args[0], ast.Constant) and call.args[0].value == message:
                found.append(node)
    if len(found) != 1:
        raise AssertionError('Ambiguous inventory refusal: ' + message)
    lines = ORIGINAL.decode().splitlines(keepends=True)
    node = found[0]
    lines[node.lineno - 1:node.end_lineno] = [' ' * node.col_offset + 'pass\n']
    return ''.join(lines).encode()


def in_function(function, old, new):
    tree = ast.parse(ORIGINAL)
    node = next(item for item in tree.body if isinstance(item, ast.FunctionDef) and item.name == function)
    lines = ORIGINAL.decode().splitlines(keepends=True)
    fragment = ''.join(lines[node.lineno - 1:node.end_lineno])
    if fragment.count(old) != 1:
        raise AssertionError('Ambiguous function mutation')
    lines[node.lineno - 1:node.end_lineno] = [fragment.replace(old, new)]
    return ''.join(lines).encode()


guards = [
    ('Worker entrypoint catalogue needs review', 'test_unknown_npm_entrypoint', 'ValueError not raised'),
    ('Worker entrypoint catalogue needs review', 'test_unknown_python_entrypoint', 'ValueError not raised'),
    ('Worker software package scripts are invalid', 'test_invalid_software_scripts_diagnostic', 'AttributeError'),
    ('Worker software package scripts are invalid', 'test_non_string_software_command', 'package scripts are invalid'),
    ('Worker inventory JSON has duplicate keys', 'test_duplicate_json_keys', 'ValueError not raised'),
    ('Worker inventory JSON has duplicate keys', 'test_nested_duplicate_json_keys', 'ValueError not raised'),
    ('Worker installation profile format differs', 'test_profile_shape_and_id', 'ValueError not raised'),
    ('Worker inventory ID is unsafe', 'test_configuration_id', 'ValueError not raised'),
    ('Worker configuration selection shape differs', 'test_configuration_shape', 'ValueError not raised'),
    ('Worker configuration IDs are duplicated', 'test_duplicate_configuration_ids', 'ValueError not raised'),
    ('Worker configuration path is not absolute', 'test_configuration_path', 'ValueError not raised'),
    ('Every known worker family requires an assessment', 'test_every_family_assessed', 'ValueError not raised'),
    ('Worker assessment shape differs', 'test_assessment_shape', 'ValueError not raised'),
    ('Worker assessment state differs', 'test_assessment_state', 'ValueError not raised'),
    ('Worker custody assessment differs', 'test_assessment_custody', 'ValueError not raised'),
    ('Worker assessment needs an explanation', 'test_assessment_explanation', 'ValueError not raised'),
    ('Worker assessment references differ', 'test_assessment_references', 'references differ'),
    ('Configured worker needs retained configuration', 'test_configured_configuration_required', 'ValueError not raised'),
    ('Local worker custody needs a selected root', 'test_local_custody_root_required', 'ValueError not raised'),
    ('Unconfigured worker custody must remain unassessed', 'test_unassessed_custody_not_promoted', 'ValueError not raised'),
    ('Selected worker state has no assessment reference', 'test_unreferenced_selections', 'ValueError not raised'),
    ('Worker configuration selection is not a list', 'test_configuration_list', 'not a list'),
    ('Retained worker catalogue format differs', 'test_retained_catalogue_format', 'ValueError not raised'),
    ('Quiesce configuration writers before inventory capture', 'test_declared_quiescence', 'ValueError not raised'),
    ('Worker configuration must be a private file', 'test_source_directory_not_configuration_file', 'IsADirectoryError'),
    ('Selected worker roots overlap', 'test_selected_roots_overlap', 'ValueError not raised'),
    ('Worker inventory destination overlaps a selected root', 'test_destination_overlaps_root', 'ValueError not raised'),
    ('Worker configuration changed during capture', 'test_configuration_changes_during_capture', 'ValueError not raised'),
    ('Worker profile changed during capture', 'test_profile_changes_during_capture', 'ValueError not raised'),
    ('Worker software catalogue changed during capture', 'test_software_changes_during_capture', 'ValueError not raised'),
    ('Retained worker configuration bytes differ', 'test_copied_configuration_checked', 'ValueError not raised'),
    ('Retained worker profile bytes differ', 'test_copied_profile_checked', 'ValueError not raised'),
    ('Worker profile must be a private file below one MiB', 'test_profile_size_bound', 'below one MiB'),
    ('Worker profile must be a private file below one MiB', 'test_profile_directory_diagnostic', 'IsADirectoryError'),
    ('Retained worker inventory bytes or layout differ', 'test_verifier_refuses_changed_bytes', 'selection binding differs'),
    ('Worker root selection binding differs', 'test_selection_binding_even_with_rewritten_census', 'ValueError not raised'),
    ('Worker inventory manifest format differs', 'test_manifest_cannot_promote_coverage', 'ValueError not raised'),
    ('Worker inventory package layout differs', 'test_package_layout_even_with_rewritten_census', 'ValueError not raised'),
    ('Worker inventory configuration layout differs', 'test_configuration_layout_even_with_rewritten_census', 'ValueError not raised'),
]

try:
    run('baseline', ORIGINAL)
    run('harmless-comment', ORIGINAL + b'\n# Harmless inventory-control comment.\n')
    run('harmless-json-spacing', replace('indent=2, sort_keys=True', 'indent=4, sort_keys=True'))
    for number, (reason, method, expected) in enumerate(guards):
        run(f'guard-{number:02d}', omit(reason), method, expected)
    run('retargeted-alias-accepted', replace(' or scripts != KNOWN_NPM_COMMANDS', ''), 'test_retargeted_known_npm_command', 'ValueError not raised')
    run('library-instead-of-executable', replace('workers/planner_agent_connector/connector.mjs', 'workers/planner_agent_connector/connector-worker.mjs'), 'test_current_software_catalogue', 'AssertionError')
    run('wrong-source-hash', replace('digest.hexdigest()', "'0' * 64"), 'test_current_software_catalogue', 'AssertionError')
    run('lost-private-mode', replace("target.chmod(before[item['id']]['mode'])", 'target.chmod(0o600)'), 'test_exact_private_configuration', 'configuration bytes differ')
    run('duplicate-shared-root', in_function('selection', "'roots': profile['roots']", "'roots': profile['roots'] * 2"), 'test_shared_and_historical_roots', 'AssertionError')
    run('lost-worker-assessments', replace("'workerAssessments': profile['workers']", "'workerAssessments': {}"), 'test_empty_selection_remains_unassessed', 'AssertionError')
    run('verify-reads-original-roots', replace("expected_configs = {item['id'] for item in profile['configuration']}",
        "[root.journal.private_path(Path(item['path']), directory=True) for item in profile['roots']]\n    expected_configs = {item['id'] for item in profile['configuration']}"),
        'test_relocated_verify_without_original_paths', 'FileNotFoundError')
    run('skip-root-syntax', replace("root_set.read_inventory(json_bytes({'format': root_set.INVENTORY_FORMAT, 'roots': profile['roots']}))", 'pass'), 'test_root_selection_syntax', 'ValueError not raised')
    run('privacy-bypass', replace('import worker_root_set_snapshot as root_set', 'import worker_root_set_snapshot as root_set\nroot.journal.private_path = lambda *args, **kwargs: None'), 'test_private_inputs', 'ValueError not raised')
    run('reuse-empty-destination', replace('destination.mkdir(mode=0o700)', 'destination.mkdir(mode=0o700, exist_ok=True)'), 'test_existing_destination_refused', 'FileExistsError not raised')
    run('selection-before-configuration', replace('folder.mkdir(mode=0o700)', "folder.mkdir(mode=0o700)\n    write_private(destination / 'inventory.json', b'{}', deadline)"), 'test_profile_and_configuration_precede_selection', 'Configuration must precede root selection')
    run('receipt-before-selection', replace("write_private(destination / 'inventory.json', json_bytes(chosen), deadline)", "write_private(destination / 'snapshot.json', b'{}', deadline)\n    write_private(destination / 'inventory.json', json_bytes(chosen), deadline)"), 'test_profile_and_configuration_precede_selection', 'Receipt must publish last')
    run('omit-directory-sync', replace('root.sync_directory(folder)', 'pass'), 'test_directory_sync_required', 'not found in')
    run('omit-file-sync', replace('os.fsync(stream.fileno())', 'pass'), 'test_file_sync_required', 'Every retained file must be synced')
    run('omit-publication', replace('root_set.publish(destination, record, deadline)', 'pass'), 'test_publication_failure_no_receipt', 'OSError not raised')
    run('ignore-capture-deadline', in_function('capture', 'root_set.deadline_for(timeout)', 'root_set.deadline_for(120)'), 'test_deadline_bounds', 'ValueError not raised')
    run('ignore-verify-deadline', in_function('verify', 'root_set.deadline_for(timeout)', 'root_set.deadline_for(120)'), 'test_verifier_deadline_bounds', 'ValueError not raised')
    run('leak-private-diagnostic', replace("print('Worker inventory unavailable: ' + type(error).__name__)", "print('Worker inventory unavailable: ' + str(error))"), 'test_cli_scope_and_diagnostics', 'unexpectedly found')
    run('mixed-cli-scope', replace("parser.error('Verification cannot select capture arguments')", 'pass'), 'test_cli_scope_and_diagnostics', 'SystemExit not raised')
    run('missing-cli-arguments', replace("parser.error('Capture requires profile and destination')", 'pass'), 'test_cli_capture_arguments_required', 'SystemExit not raised')
finally:
    SOURCE.write_bytes(ORIGINAL)
    with SOURCE.open('rb') as stream:
        os.fsync(stream.fileno())
    if SOURCE.read_bytes() != ORIGINAL:
        raise AssertionError('Worker inventory source was not restored')

run('restored', ORIGINAL)
tests = {node.name for node in ast.walk(ast.parse(TEST.read_bytes())) if isinstance(node, ast.FunctionDef) and node.name.startswith('test_')}
covered = {case['method'] for case in records if case['method']}
if tests != covered:
    raise AssertionError('Inventory methods lack selected controls: ' + str(tests - covered))
(OUT / 'result.json').write_text(json.dumps({'sourceSha256': hashlib.sha256(ORIGINAL).hexdigest(),
    'testSha256': hashlib.sha256(TEST.read_bytes()).hexdigest(), 'sourceRestored': SOURCE.read_bytes() == ORIGINAL,
    'coveredMethods': sorted(covered), 'cases': records}, indent=2) + '\n')
