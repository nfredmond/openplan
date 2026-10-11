"""Run native targeted mutations on a private copy; restore it in finally."""
import ast
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

REPO = Path(__file__).resolve().parents[3]
SOURCE = REPO / 'openplan/scripts/ops/worker_journal_snapshot.py'
TESTS = REPO / 'openplan/scripts/ops/tests'
original = SOURCE.read_bytes()
text = original.decode()

# Each case changes the protected behavior, not the assertion or its fixture.
backup = 'original.backup(copied, pages=128, progress=progress, sleep=0.05)'
cases = [
    ('main-file-only', backup, "__import__('shutil').copyfile(source, target)", 'test_committed_wal_records_and_receipts_survive', 'missing committed WAL records'),
    ('ignore-wal', "'?mode=ro'", "'?mode=ro&immutable=1'", 'test_committed_wal_records_and_receipts_survive', 'missing committed WAL records'),
    ('lose-receipt', backup, backup + "\n            copied.execute('UPDATE commands SET response_json=NULL'); copied.commit()", 'test_committed_wal_records_and_receipts_survive', 'missing committed WAL records'),
    ('lose-start', backup, backup + "\n            copied.execute('DELETE FROM stage_computations WHERE result_json IS NULL'); copied.commit()", 'test_interrupted_start_refuses_replay_and_saved_result_needs_no_computation', 'ComputationUnconfirmed not raised'),
    ('writable-source', "'?mode=ro'", "'?mode=rw'", 'test_source_connection_refuses_database_writes', 'OperationalError not raised'),
    ('omit-quiescence', 'if writers_quiesced is not True:', 'if False:', 'test_requires_declared_quiescence_before_destination_creation', 'ValueError not raised'),
    ('omit-timeout-validation', 'if not math.isfinite(timeout) or timeout <= 0:', 'if False:', 'test_requires_positive_finite_deadline', 'ValueError not raised'),
    ('omit-symlink-refusal', 'if any(part.is_symlink() for part in (path, *path.parents)):', 'if False:', 'test_refuses_source_alias_before_destination_creation', 'ValueError not raised'),
    ('omit-private-mode', 'if info.st_mode & 0o077:', 'if False:', 'test_refuses_accessible_journal', 'ValueError not raised'),
    ('omit-owner', 'if info.st_uid != os.getuid():', 'if False:', 'test_refuses_foreign_owner_predicate', 'ValueError not raised'),
    ('omit-file-type', 'if not valid_type:', 'if False:', 'test_refuses_wrong_source_file_type', 'invalid source type created a destination'),
    ('omit-hard-link-refusal', 'if stat.S_ISREG(info.st_mode) and info.st_nlink != 1:', 'if False:', 'test_refuses_hard_link_before_destination_creation', 'ValueError not raised'),
    ('omit-journal-name', "if source.name != 'model-commands.sqlite3':", 'if False:', 'test_refuses_another_database_name', 'ValueError not raised'),
    ('nested-output', 'if source.parent == destination or source.parent in destination.parents:', 'if False:', 'test_refuses_output_inside_source_directory', 'ValueError not raised'),
    ('disguised-destination', 'destination = destination.parent.resolve(strict=True) / destination.name', 'destination = destination', 'test_normalizes_destination_parent_before_nested_refusal', 'ValueError not raised'),
    ('disguised-source', 'source = source.resolve(strict=True)', 'source = source', 'test_normalizes_source_before_nested_refusal', 'ValueError not raised'),
    ('reuse-destination', 'destination.mkdir(mode=0o700)', 'destination.mkdir(mode=0o700, exist_ok=True)', 'test_preserves_an_existing_destination', 'FileExistsError not raised'),
    ('omit-integrity', "if copied.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:", 'if False:', 'test_rejects_native_index_corruption_without_completion_receipt', 'ValueError not raised'),
    ('omit-command-schema', "if columns != ['request_id', 'destination', 'request_json', 'response_json']:", 'if False:', 'test_rejects_valid_sqlite_without_command_schema', 'ValueError not raised'),
    ('omit-deadline', 'if time.monotonic() >= deadline:', 'if False:', 'test_locked_source_cli_exits_at_deadline_without_receipt', 'backup did not enforce its deadline'),
    ('false-digest', "'sha256': digest.hexdigest(),", "'sha256': '0' * 64,", 'test_committed_wal_records_and_receipts_survive', 'snapshot digest does not match bytes'),
    ('false-size', "'sizeBytes': target.stat().st_size,", "'sizeBytes': target.stat().st_size + 1,", 'test_committed_wal_records_and_receipts_survive', 'snapshot size does not match bytes'),
    ('omit-database-sync', 'sync_file(target)', 'pass', 'test_failed_database_sync_never_publishes_receipt', 'OSError not raised'),
    ('omit-receipt-sync', '        stream.flush()\n        os.fsync(stream.fileno())', '        stream.flush()\n        pass', 'test_syncs_database_then_receipt_then_both_directories', 'snapshot durability order changed'),
    ('omit-directory-sync', 'os.fsync(directory_fd)', 'pass', 'test_syncs_database_then_receipt_then_both_directories', 'snapshot durability order changed'),
    ('omit-parent-sync', 'os.fsync(parent_fd)', 'pass', 'test_syncs_database_then_receipt_then_both_directories', 'snapshot durability order changed'),
    ('non-atomic-publication', 'os.link(partial, receipt)', "__import__('shutil').copyfile(partial, receipt)", 'test_failed_atomic_publication_never_returns_completed_snapshot', 'OSError not raised'),
    ('keep-failed-receipt', 'receipt.unlink(missing_ok=True)', 'pass', 'test_failed_directory_sync_removes_completion_receipt', 'failed directory durability retained a completion receipt'),
    ('disclose-command', 'print(json.dumps(record, sort_keys=True))', "print(json.dumps({**record, 'command': 'synthetic-unresolved'}, sort_keys=True))", 'test_completed_cli_emits_only_snapshot_metadata', 'CLI disclosed command contents'),
]


def run(out: Path) -> dict:
    records = []
    out.mkdir(mode=0o700, parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='snapshot-mutation-', dir=out) as root:
        changed = Path(root) / 'worker_journal_snapshot.py'
        def check(name, source, *, test=None, expected=None):
            ast.parse(source)
            changed.write_text(source)
            env = {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1', 'WORKER_JOURNAL_SNAPSHOT_TEST_SOURCE': str(changed)}
            target = 'test_worker_journal_snapshot' + ('.WorkerJournalSnapshotTests.' + test if test else '')
            try:
                result = subprocess.run([sys.executable, '-B', '-m', 'unittest', target, '-v'], cwd=TESTS, env=env, capture_output=True, text=True, timeout=15)
                (out / (name + '.log')).write_text(result.stdout + result.stderr)
                if expected is None:
                    if result.returncode != 0:
                        raise RuntimeError('Positive control failed: ' + name)
                elif result.returncode == 0 or expected not in result.stderr or test not in result.stderr:
                    raise RuntimeError('Mutation did not fail its intended oracle: ' + name)
                records.append({'case': name, 'exitCode': result.returncode, 'test': target, 'intendedOracle': expected, 'sourceSha256': hashlib.sha256(source.encode()).hexdigest()})
            finally:
                changed.write_bytes(original)
                if changed.read_bytes() != original or SOURCE.read_bytes() != original:
                    raise RuntimeError('Mutation source restoration failed')
        check('baseline', text)
        check('harmless-comment', text.replace('Failed destination directories remain private', 'Incomplete destination directories remain private'))
        check('harmless-json-whitespace', text.replace('indent=2', 'indent=4'))
        for name, before, after, test, expected in cases:
            if text.count(before) != 1:
                raise RuntimeError('Mutation target is not unique: ' + name)
            check(name, text.replace(before, after), test=test, expected=expected)
        check('restored', text)
    result = {'cases': records, 'targetedBrokenVariants': len(cases), 'positiveControls': 4,
              'sourceSha256': hashlib.sha256(original).hexdigest(),
              'testSha256': hashlib.sha256((TESTS / 'test_worker_journal_snapshot.py').read_bytes()).hexdigest(),
              'blindCategory': 'Local Linux SQLite and filesystem behavior only. Owner mismatch uses a mocked UID predicate. Fsync ordering and injected failures do not establish power-loss recovery, race-proof host fencing, installation-wide consistency, server reconciliation or scientific acceptance.'}
    (out / 'controls.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


if __name__ == '__main__':
    result = run(Path(sys.argv[1]))
    print(json.dumps({'positiveControls': result['positiveControls'], 'targetedBrokenVariants': result['targetedBrokenVariants']}))
