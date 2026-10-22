"""Run targeted native-test mutations, restoring exact source bytes in finally."""
import ast
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

REPO = Path(__file__).resolve().parents[3]
SOURCE = REPO / 'openplan/scripts/ops/worker_root_snapshot.py'
TEST = REPO / 'openplan/scripts/ops/tests/test_worker_root_snapshot.py'
ORIGINAL = SOURCE.read_bytes()
OUT = Path(sys.argv[1]).absolute()
OUT.mkdir(mode=0o700, parents=True, exist_ok=False)
records = []
(OUT / "original-source.py").write_bytes(ORIGINAL)
(OUT / "tests-source.py").write_bytes(TEST.read_bytes())


def execute(label, content, method=None, expected=None, timeout=False):
    SOURCE.write_bytes(content)
    with SOURCE.open('rb') as stream:
        os.fsync(stream.fileno())
    arguments = [sys.executable, '-B', str(TEST), '-v']
    if method:
        arguments.append('WorkerRootSnapshotTests.' + method)
    try:
        result = subprocess.run(arguments, cwd=REPO / 'openplan',
                                env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'},
                                capture_output=True, timeout=4 if timeout else 15)
        output = (result.stdout + result.stderr).decode()
        (OUT / (label + '.log')).write_text(output)
        if expected is None:
            if result.returncode != 0:
                raise AssertionError('Positive control failed: ' + label)
        elif result.returncode == 0 or expected not in output or method not in output:
            raise AssertionError('Mutation missed its intended oracle: ' + label)
        record = {'case': label, 'result': 'survived' if expected is None else 'failed intended oracle',
                  'method': method, 'exitCode': result.returncode, 'expectedAssertion': expected}
    except subprocess.TimeoutExpired as error:
        (OUT / (label + '.log')).write_bytes((error.stdout or b'') + (error.stderr or b''))
        if not timeout:
            raise
        record = {'case': label, 'result': 'owned native lock exceeds wrapper deadline without callback guard',
                  'method': method, 'ownedChildTimeoutSeconds': 4}
    records.append(record)
    (OUT / 'progress.json').write_text(json.dumps(records, indent=2) + '\n')


def omit(reason, function=None):
    tree = ast.parse(ORIGINAL)
    subject = next((n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == function), tree) if function else tree
    found = []
    for node in ast.walk(subject):
        if isinstance(node, ast.If) and node.body and isinstance(node.body[0], ast.Raise):
            expression = node.body[0].exc
            if isinstance(expression, ast.Call) and expression.args and isinstance(expression.args[0], ast.Constant) and expression.args[0].value == reason:
                found.append(node)
    if len(found) != 1:
        raise AssertionError('Guard selection is ambiguous: ' + reason)
    found[0].test = ast.Constant(False)
    return (ast.unparse(ast.fix_missing_locations(tree)) + '\n').encode()


def replace(old, new):
    text = ORIGINAL.decode()
    if text.count(old) != 1:
        raise AssertionError('Mutation selection is ambiguous: ' + old)
    return text.replace(old, new).encode()


try:
    execute('baseline', ORIGINAL)
    execute('harmless-comment', b'# Harmless operator source comment\n' + ORIGINAL)
    execute('harmless-enumeration-order', replace('for child in sorted(path.iterdir()):', 'for child in sorted(path.iterdir(), reverse=True):'))
    execute('harmless-manifest-formatting', replace('json.dump(record, stream, indent=2, sort_keys=True)', 'json.dump(record, stream, indent=4, sort_keys=True)'))
    guard_cases = [
        ('quiescence', 'Quiesce writers before capturing a worker root', 'test_requires_declared_quiescence', 'ValueError not raised'),
        ('outside-source', 'Worker-root destination must be outside the source', 'test_nested_destination_refused', 'does not match "Worker source changed during capture"'),
        ('retained-path-set', 'Retained worker-root paths differ', 'test_extra_retained_path_refuses_publication', 'ValueError not raised'),
        ('copied-sqlite-mode', 'Retained SQLite file mode or type differs', 'test_copied_sqlite_mode_change_refused', 'ValueError not raised'),
        ('source-stability', 'Worker source changed during capture', 'test_observed_source_mutation_refused', 'ValueError not raised'),
        ('orphan-sidecar', 'Worker root has an orphan SQLite sidecar', 'test_orphan_sidecar_refused', 'ValueError not raised'),
        ('named-header', 'Model command journal has no SQLite header', 'test_named_journal_requires_sqlite_header', 'ValueError not raised'),
        ('model-schema', 'Retained model command schema differs', 'test_named_journal_requires_command_schema', 'ValueError not raised'),
        ('sqlite-integrity', 'Retained SQLite integrity check failed', 'test_native_copy_reports_bad_integrity_or_mode_refused', 'ValueError not raised'),
        ('sqlite-mode', 'Retained SQLite mode is not DELETE', 'test_native_copy_reports_bad_integrity_or_mode_refused', 'ValueError not raised'),
        ('copied-sqlite-type', 'Retained SQLite file mode or type differs', 'test_changed_copied_sqlite_header_refused', 'ValueError not raised'),
        ('ordinary-byte-comparison', 'Retained ordinary bytes or directories differ', 'test_copy_byte_corruption_refuses_publication', 'ValueError not raised'),
        ('verify-sqlite-mappings', 'Worker-root SQLite mappings differ', 'test_verify_missing_or_changed_sqlite_mappings_refused', 'ValueError not raised'),
        ('cli-mapping-refusal', 'Worker-root SQLite mappings differ', 'test_cli_missing_sqlite_mapping_has_controlled_refusal', 'manifest refusal was not controlled'),
        ('verify-format', 'Worker-root manifest format differs', 'test_verify_foreign_manifest_format_refused', 'ValueError not raised'),
        ('verify-extra-entry', 'Worker-root package has extra or incomplete entries', 'test_verify_changed_file_missing_directory_and_extra_entry', 'ValueError not raised'),
        ('verify-root-comparison', 'Worker-root package content differs from its manifest', 'test_verify_changed_file_missing_directory_and_extra_entry', 'ValueError not raised'),
        ('deadline', 'Worker-root capture exceeded its deadline', 'test_copy_deadline_refuses_publication', 'TimeoutError not raised'),
    ]
    for label, reason, method, assertion in guard_cases:
        execute(label, omit(reason), method, assertion)
    execute('capture-finite-timeout', omit('Worker-root timeout must be positive and finite', function='capture'), 'test_capture_infinite_timeout_refused', 'ValueError not raised')
    execute('verify-finite-timeout', omit('Worker-root timeout must be positive and finite', function='verify'), 'test_verify_infinite_timeout_refused', 'ValueError not raised')
    execute('existing-destination', replace('destination.mkdir(mode=0o700)', 'destination.mkdir(mode=0o700, exist_ok=True)'), 'test_existing_destination_not_reused', 'FileExistsError not raised')
    execute('source-privacy', replace('journal.private_path(path, directory=directory)', 'pass  # Deliberately omit source entry privacy'), 'test_aliases_and_accessible_sources_refused', 'ValueError not raised')
    execute('read-only-source', replace("source.as_uri() + '?mode=ro'", "source.as_uri() + '?mode=rw'"), 'test_read_only_sqlite_connections', 'source connection is writable')
    execute('missing-manifest-fsync', replace('os.fsync(stream.fileno())', 'pass  # Deliberately omit manifest sync'), 'test_manifest_file_is_synced_before_publication', 'manifest bytes were not synced')
    execute('cli-mixed-scope', replace('if args.verify and (args.source is not None or args.writers_quiesced):', 'if False:'), 'test_cli_missing_source_and_mixed_verify_refused', 'invalid CLI scope accepted')
    execute('cli-missing-source', replace('if not args.verify and args.source is None:', 'if False:'), 'test_cli_missing_source_and_mixed_verify_refused', 'invalid CLI scope accepted')
    execute('missing-file-fsync', replace('journal.sync_file(target)', 'pass  # Deliberately omit file sync'), 'test_files_and_directories_and_parent_are_synced', 'retained files were not all synced')
    execute('missing-parent-fsync', replace('sync_directory(destination.parent)', 'pass  # Deliberately omit parent sync'), 'test_files_and_directories_and_parent_are_synced', 'directories or parent were not synced')
    execute('false-publication-on-sync-error', replace('receipt.unlink(missing_ok=True)', 'pass  # Deliberately leave published receipt after sync refusal'), 'test_directory_sync_failure_refuses_success_receipt', 'failed publication retained a success receipt')
    execute('unbounded-native-busy-backup', replace('check_deadline(deadline)\n    remaining', 'pass  # Deliberately omit backup callback deadline\n    remaining'), 'test_busy_native_sqlite_backup_deadline_refused', 'TimeoutError not raised', timeout=True)
    execute('ignore-populated-new-wal', replace("row.get('sizeBytes') == 0 and row.get('sha256') == hashlib.sha256(b'').hexdigest()", 'True'), 'test_new_nonempty_wal_cannot_be_ignored_as_reader_artifact', 'ValueError not raised')
    execute('redundant-predicate-selected-case-survives', replace("name not in before and row is not None", "row is not None"), 'test_existing_populated_wal_change_refused')
    execute('ignore-original-wal-changes', replace("transient = {name + '-shm' for name in mains}", "transient = {name + suffix for name in mains for suffix in ('-shm', '-wal')}"), 'test_existing_populated_wal_change_refused', 'ValueError not raised')
    execute('cli-private-path-disclosure', replace("'manifestSha256': hashlib.sha256", "'sourceDirectory': record['sourceDirectory'],\n                      'manifestSha256': hashlib.sha256"), 'test_cli_capture_and_verify_do_not_print_private_metadata', 'private source path was printed')
    tree = ast.parse(ORIGINAL)
    function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'copy_database')
    function.body = ast.parse("target.write_bytes(source.read_bytes())\nwith closing(sqlite3.connect(target)) as copied:\n    copied.execute('PRAGMA journal_mode=DELETE')").body
    execute('main-file-only-loses-wal', (ast.unparse(ast.fix_missing_locations(tree)) + '\n').encode(), 'test_complete_root_and_committed_wal_records', 'lost SQLite logical records')
    text = replace('for child in sorted(path.iterdir()):\n                visit(child)', 'for child in sorted(path.iterdir()):\n                if child.name == "empty" and child.is_dir():\n                    continue\n                visit(child)')
    execute('missing-empty-directory-scope', text, 'test_complete_root_and_committed_wal_records', 'empty directory lost')
    text = replace('for child in sorted(path.iterdir()):\n                visit(child)', "for child in sorted(path.iterdir()):\n                if child.name == 'state.json':\n                    continue\n                visit(child)")
    execute('missing-state-file-scope', text, 'test_complete_root_and_committed_wal_records', 'state file lost')
    execute('closed-wal-reader-empty-policy', replace("name not in before and row is not None", "False and row is not None"), 'test_closed_wal_databases_allow_only_reader_sidecars', 'ValueError: Worker source changed during capture')
    execute('crashed-main-only-loses-blob', (ast.unparse(ast.fix_missing_locations(tree)) + '\n').encode(), 'test_crashed_writer_committed_wal_and_blob_survive', 'crashed committed blob lost')
    execute('nonobject-manifest-validation', omit('Worker-root manifest format differs'), 'test_verify_nonobject_manifest_refused', "AttributeError: 'list' object has no attribute 'get'")
    execute('ordinary-private-mode-preservation', replace("target.chmod(row['mode'])", 'pass  # Deliberately omit copied mode preservation'), 'test_private_modes_and_read_only_subdirectory_preserved', 'ValueError: Retained ordinary bytes or directories differ')
    execute('sqlite-private-mode-preservation', replace("target.chmod(row['mode'])", 'pass  # Deliberately omit copied mode preservation'), 'test_private_sqlite_mode_preserved', 'ValueError: Retained SQLite file mode or type differs')
    execute('all-invalid-deadline-parameters', omit('Worker-root timeout must be positive and finite', function='capture'), 'test_finite_positive_deadline_required', 'TimeoutError: Worker-root capture exceeded its deadline')
    execute('restored', ORIGINAL)
    (OUT / 'result.json').write_text(json.dumps({'sourceSha256': hashlib.sha256(ORIGINAL).hexdigest(), 'testsSha256': hashlib.sha256(TEST.read_bytes()).hexdigest(), 'cases': records, 'scope': 'Actual local private-directory/SQLite/CLI tests and targeted source mutations. Fake SQLite reports cover response-guard branches, not native corrupt-file acceptance. No host-loss, live-writer fence, complete installation or scientific acceptance.'}, indent=2) + '\n')
finally:
    SOURCE.write_bytes(ORIGINAL)
    with SOURCE.open('rb') as stream:
        os.fsync(stream.fileno())
    if SOURCE.read_bytes() != ORIGINAL:
        raise AssertionError('Exact worker-root source restoration failed')
print(len(records), 'controls pass; exact source restored')
