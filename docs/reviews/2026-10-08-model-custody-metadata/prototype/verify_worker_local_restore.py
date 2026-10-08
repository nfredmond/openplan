"""Synthetic local restore proof. No database, Storage, or model acceptance claim.

SQLite backup must include committed WAL records. The owner must quiesce all
writers before coordinating this local snapshot with a PostgreSQL backup.
"""
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile
import uuid

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / 'workers/aequilibrae_worker'))
import model_command_client as client
import model_command_journal as journal
import model_legacy_kpi_command as kpi
import model_stage_computation as computation


def snapshot(source, target, *, naive=False):
    """Copy this known synthetic fixture with a SQLite online backup."""
    target.mkdir(mode=0o700)
    shutil.copytree(source / 'files', target / 'files')
    source_db = source / 'model-commands.sqlite3'
    target_db = target / 'model-commands.sqlite3'
    if naive:
        shutil.copyfile(source_db, target_db)
    else:
        with closing(sqlite3.connect(source_db.as_uri() + '?mode=ro', uri=True)) as reader:
            with closing(sqlite3.connect(target_db)) as writer:
                reader.backup(writer)
    target_db.chmod(0o600)


def verify():
    records = []
    with tempfile.TemporaryDirectory(prefix='openplan-local-restore-') as temporary:
        root = Path(temporary)
        source = root / 'source'
        source.mkdir(mode=0o700)
        files = source / 'files'
        files.mkdir()
        (files / 'input.json').write_bytes(b'{"synthetic":true}\n')
        (files / 'output.bin').write_bytes(bytes(range(256)))
        expected_files = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in files.iterdir()}
        run, stage, workspace = (str(uuid.uuid4()) for _ in range(3))
        scope = dict(base_url='http://127.0.0.1:54321', deployment_id='synthetic-restored-installation')
        bound = client.destination(**scope)
        args = dict(**scope, run_id=run, stage_id=stage, name='protected', inputs={'synthetic': True})
        # Keep the WAL open. A plain copy of the main database must miss the
        # subsequent committed rows, not accidentally pass after auto-checkpoint.
        with closing(journal.connect(source)) as keeper:
            keeper.execute('PRAGMA wal_checkpoint(TRUNCATE)')
            keeper.execute('PRAGMA wal_autocheckpoint=0')
            command = kpi.prepare(source, workspace, {
                'run_id': run, 'stage_id': stage, 'kpi_name': 'probe',
                'kpi_label': 'Synthetic probe', 'kpi_category': 'assignment',
                'value': 12.5, 'unit': 'vehicles', 'geometry_ref': None,
                'breakdown_json': None,
            }, name='probe', **scope)
            class Interrupted(Exception):
                pass
            def interrupted():
                raise Interrupted()
            try:
                computation.compute_once(source, **args, compute=interrupted)
            except Interrupted:
                pass
            else:
                raise AssertionError('Fixture did not interrupt computation')
            wal = source / 'model-commands.sqlite3-wal'
            if not wal.exists() or wal.stat().st_size == 0:
                raise AssertionError('Fixture has no committed WAL bytes')
            expected_command = journal.read_existing(source, bound, command['request_id'])
            if len(expected_command) != 1 or expected_command[0]['resolved']:
                raise AssertionError('Fixture does not contain one pending command')
            for variant in ('baseline', 'harmless', 'naive-main-file', 'missing-output', 'missing-start', 'restored'):
                target = root / variant
                snapshot(source, target, naive=variant == 'naive-main-file')
                if variant == 'harmless':
                    # Filesystem metadata has no role in byte identity.
                    os.utime(target / 'files/input.json', (1, 1))
                if variant == 'missing-output':
                    (target / 'files/output.bin').unlink()
                if variant == 'missing-start':
                    with closing(sqlite3.connect(target / 'model-commands.sqlite3')) as db, db:
                        db.execute('DELETE FROM stage_computations')
                try:
                    actual = journal.read_existing(target, bound, command['request_id'])
                    if actual != expected_command:
                        raise AssertionError('Pending command was not restored')
                    actual_files = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (target / 'files').iterdir()}
                    if actual_files != expected_files:
                        raise AssertionError('Local file bytes were not restored')
                    starts = computation.summaries(target, **scope)
                    if len(starts) != 1 or starts[0]['state'] != 'started_without_result':
                        raise AssertionError('Interrupted computation start was not restored')
                    called = []
                    def forbidden():
                        called.append(True)
                        return {'synthetic': True}
                    try:
                        computation.compute_once(target, **args, compute=forbidden)
                    except computation.ComputationUnconfirmed:
                        pass
                    else:
                        raise AssertionError('Restored computation replay was accepted')
                    if called:
                        raise AssertionError('Restored computation executed again')
                except AssertionError as error:
                    expected = {
                        'naive-main-file': 'Pending command was not restored',
                        'missing-output': 'Local file bytes were not restored',
                        'missing-start': 'Interrupted computation start was not restored',
                    }
                    if expected.get(variant) != str(error):
                        raise
                    records.append({'case': variant, 'detected': str(error)})
                else:
                    if variant not in ('baseline', 'harmless', 'restored'):
                        raise AssertionError('Adverse control survived')
                    records.append({'case': variant, 'pending_command_exact': True,
                                    'local_bytes_exact': True, 'computation_replay_refused': True})
    return {'cases': records, 'scope': 'Synthetic local SQLite backup with committed WAL, exact pending command and file bytes, interrupted-start preservation. No PostgreSQL restore, server receipt reconciliation, live-worker quiescence, Storage, real model or scientific acceptance.'}


if __name__ == '__main__':
    print(json.dumps(verify(), indent=2))
