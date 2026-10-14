"""Native selected-root set custody, global stability and independent verification."""
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

OPS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(OPS))
import worker_root_set_snapshot as snapshot


class WorkerRootSetTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        old_mask = os.umask(0o077)
        self.addCleanup(os.umask, old_mask)
        self.alpha, self.beta = self.base / 'alpha', self.base / 'β root'
        for path in (self.alpha, self.beta):
            path.mkdir(mode=0o700)
            (path / 'input.bin').write_bytes(bytes(range(256)))
            (path / 'empty').mkdir(mode=0o700)
        self.database = sqlite3.connect(self.alpha / 'project.sqlite')
        self.addCleanup(self.database.close)
        self.database.execute('PRAGMA journal_mode=WAL')
        self.database.execute('CREATE TABLE custody(id INTEGER PRIMARY KEY,payload BLOB)')
        self.database.commit()
        self.database.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        self.database.execute('PRAGMA wal_autocheckpoint=0')
        self.database.execute('INSERT INTO custody VALUES(1,?)', (bytes(range(256)),))
        self.database.commit()
        self.inventory = self.base / 'private-inventory.json'
        self.selected = {'format': snapshot.INVENTORY_FORMAT,
                         'metadata': {'label': 'private-test-marker', 'opaque': 'original β bytes'},
                         'roots': [{'id': 'alpha', 'path': str(self.alpha)},
                                   {'id': 'beta', 'path': str(self.beta)}]}
        self.write_inventory()
        self.destination = self.base / 'point'

    def write_inventory(self):
        self.inventory.write_text(json.dumps(self.selected, ensure_ascii=False, indent=4) + '\n')

    def capture(self, **kwargs):
        return snapshot.capture(self.inventory, self.destination, writers_quiesced=True, **kwargs)

    def receipt(self):
        return self.destination / 'snapshot.json'

    def test_complete_native_selected_set(self):
        original = self.inventory.read_bytes()
        with mock.patch.object(snapshot, 'read_inventory', wraps=snapshot.read_inventory) as selection:
            record = self.capture()
        self.assertEqual(selection.call_count, 1, 'selection validation bypassed')
        self.assertEqual(selection.call_args.args, (original,), 'selection validator did not receive original bytes')
        self.assertEqual((self.destination / 'inventory.json').read_bytes(), original, 'selection bytes changed')
        self.assertEqual([item['id'] for item in record['roots']], ['alpha', 'beta'], 'selected roots lost')
        self.assertEqual(record['installationConsistency'], 'unassessed')
        self.assertEqual(record['consistency'], 'selected_worker_root_set')
        for name in ('alpha', 'beta'):
            retained = self.destination / 'roots' / name / 'root'
            self.assertEqual((retained / 'input.bin').read_bytes(), bytes(range(256)), 'selected ordinary input lost')
            self.assertTrue((retained / 'empty').is_dir(), 'selected empty directory lost')
        with closing(sqlite3.connect(self.destination / 'roots/alpha/root/project.sqlite')) as copied:
            self.assertEqual(copied.execute('SELECT * FROM custody').fetchall(), [(1, bytes(range(256)))], 'committed WAL/BLOB records lost')
        self.assertEqual(snapshot.verify(self.destination), record)
        self.assertEqual({path.name for path in self.destination.iterdir()}, {'inventory.json', 'roots', 'snapshot.json'})

    def test_explicit_zero_selection_is_unassessed(self):
        self.selected['roots'] = []
        self.write_inventory()
        record = self.capture()
        self.assertEqual(record['roots'], [])
        self.assertEqual(record['installationConsistency'], 'unassessed', 'zero selection promoted installation acceptance')
        self.assertEqual(snapshot.verify(self.destination), record)

    def test_verify_does_not_require_original_sources(self):
        record = self.capture()
        self.database.close()
        self.alpha.rename(self.base / 'unavailable-alpha')
        self.beta.rename(self.base / 'unavailable-beta')
        self.inventory.rename(self.base / 'unavailable-inventory')
        self.assertEqual(snapshot.verify(self.destination), record, 'verification requires original sources')

    def test_read_only_inventory_mode_retained(self):
        self.inventory.chmod(0o400)
        self.capture()
        self.assertEqual((self.destination / 'inventory.json').stat().st_mode & 0o777, 0o400, 'selection mode changed')
        snapshot.verify(self.destination)

    def test_quiescence_required_before_destination(self):
        with self.assertRaisesRegex(ValueError, 'Quiesce writers'):
            snapshot.capture(self.inventory, self.destination, writers_quiesced=False)
        self.assertFalse(self.destination.exists())

    def test_inventory_format_refused(self):
        for value in ({'format': 'foreign', 'roots': []}, [], {}, {'format': snapshot.INVENTORY_FORMAT, 'roots': None}):
            self.inventory.write_text(json.dumps(value))
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'inventory format differs'):
                snapshot.read_inventory(self.inventory.read_bytes())
            with self.assertRaisesRegex(ValueError, 'inventory format differs'):
                self.capture()
            self.assertFalse(self.destination.exists())

    def test_unsafe_id_refused(self):
        for value in ('../outside', '', '.', '..', '-unsafe', 'x' * 65, None):
            self.selected['roots'][0]['id'] = value
            self.write_inventory()
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'ID is unsafe'):
                snapshot.read_inventory(self.inventory.read_bytes())
            with self.assertRaisesRegex(ValueError, 'ID is unsafe'):
                self.capture()
            self.assertFalse(self.destination.exists())

    def test_duplicate_id_refused(self):
        self.selected['roots'][1]['id'] = 'alpha'
        self.write_inventory()
        with self.assertRaisesRegex(ValueError, 'duplicate IDs'):
            snapshot.read_inventory(self.inventory.read_bytes())
        with self.assertRaisesRegex(ValueError, 'duplicate IDs'):
            self.capture()
        self.assertFalse(self.destination.exists())

    def test_relative_source_refused(self):
        self.selected['roots'][0]['path'] = 'relative-source'
        self.write_inventory()
        with self.assertRaisesRegex(ValueError, 'not absolute'):
            snapshot.read_inventory(self.inventory.read_bytes())
        with self.assertRaisesRegex(ValueError, 'not absolute'):
            self.capture()
        self.assertFalse(self.destination.exists())

    def test_duplicate_or_nested_source_refused(self):
        for value in (self.alpha, self.alpha / 'empty'):
            self.selected['roots'][1]['path'] = str(value)
            self.write_inventory()
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'sources overlap'):
                self.capture()
            self.assertFalse(self.destination.exists())

    def test_destination_inside_any_source_refused(self):
        with self.assertRaisesRegex(ValueError, 'inside or above a source'):
            snapshot.capture(self.inventory, self.beta / 'point', writers_quiesced=True)
        self.assertFalse((self.beta / 'point').exists())

    def test_existing_destination_unchanged(self):
        self.destination.mkdir(mode=0o700)
        (self.destination / 'original').write_bytes(b'original')
        with self.assertRaises(FileExistsError):self.capture()
        self.assertEqual((self.destination / 'original').read_bytes(), b'original')

    def test_private_inventory_aliases_and_access_refused(self):
        alias = self.base / 'alias.json'
        for kind in ('symlink', 'hardlink', 'accessible'):
            try:
                if kind == 'symlink':alias.symlink_to(self.inventory)
                elif kind == 'hardlink':os.link(self.inventory, alias)
                else:alias.write_bytes(self.inventory.read_bytes());alias.chmod(0o644)
                with self.subTest(kind=kind), self.assertRaisesRegex(ValueError, 'symlink|hard-link alias|accessible'):
                    snapshot.capture(alias, self.destination, writers_quiesced=True)
                self.assertFalse(self.destination.exists())
            finally:alias.unlink()

    def test_later_component_failure_has_no_set_receipt(self):
        native = snapshot.root.capture
        def failed(source, destination, **kwargs):
            if source == self.beta:raise OSError('synthetic later component failure')
            return native(source, destination, **kwargs)
        with mock.patch.object(snapshot.root, 'capture', side_effect=failed):
            with self.assertRaisesRegex(OSError, 'later component failure'):
                self.capture()
        self.assertFalse(self.receipt().exists(), 'incomplete selected set published success')
        self.assertTrue((self.destination / 'roots/alpha/snapshot.json').exists())
        self.assertEqual((self.destination / 'inventory.json').read_bytes(), self.inventory.read_bytes(), 'original selection not retained before components')

    def test_earlier_source_change_during_later_capture_refused(self):
        native = snapshot.root.capture
        def changed(source, destination, **kwargs):
            record = native(source, destination, **kwargs)
            if source == self.beta:(self.alpha / 'input.bin').write_bytes(b'changed after earlier capture')
            return record
        with mock.patch.object(snapshot.root, 'capture', side_effect=changed):
            with self.assertRaisesRegex(ValueError, 'source changed'):
                self.capture()
        self.assertFalse(self.receipt().exists(), 'earlier source change published the set')

    def test_component_bound_to_initial_source_even_after_restore(self):
        native = snapshot.root.capture
        def changed(source, destination, **kwargs):
            if source == self.alpha:(self.alpha / 'input.bin').write_bytes(b'changed between initial and component capture')
            try:return native(source, destination, **kwargs)
            finally:
                if source == self.alpha:(self.alpha / 'input.bin').write_bytes(bytes(range(256)))
        with mock.patch.object(snapshot.root, 'capture', side_effect=changed):
            with self.assertRaisesRegex(ValueError, 'source changed'):
                self.capture()
        self.assertFalse(self.receipt().exists(), 'different initial/component source published the set')

    def test_inventory_changes_during_components_refused(self):
        native = snapshot.root.capture
        def changed(*args, **kwargs):
            record = native(*args, **kwargs)
            self.inventory.write_bytes(self.inventory.read_bytes() + b'\n')
            return record
        with mock.patch.object(snapshot.root, 'capture', side_effect=changed):
            with self.assertRaisesRegex(ValueError, 'selection changed'):
                self.capture()
        self.assertFalse(self.receipt().exists(), 'changed selection published success')

    def test_copied_inventory_bytes_checked(self):
        native = snapshot.root.journal.sync_file
        def changed(path):
            native(path)
            if path == self.destination / 'inventory.json':path.write_bytes(b'changed retained inventory')
        with mock.patch.object(snapshot.root.journal, 'sync_file', side_effect=changed):
            with self.assertRaisesRegex(ValueError, 'inventory bytes differ'):
                self.capture()
        self.assertFalse(self.receipt().exists())

    def test_verify_changed_inventory_refused(self):
        self.capture()
        path = self.destination / 'inventory.json'
        path.write_bytes(path.read_bytes() + b'\n')
        with self.assertRaisesRegex(ValueError, 'retained inventory differs'):
            snapshot.verify(self.destination)

    def test_verify_extra_component_refused(self):
        self.capture()
        (self.destination / 'roots/extra').mkdir(mode=0o700)
        with self.assertRaisesRegex(ValueError, 'component paths differ'):
            snapshot.verify(self.destination)

    def test_verify_extra_outer_entry_refused(self):
        self.capture()
        (self.destination / 'extra').write_bytes(b'extra')
        with self.assertRaisesRegex(ValueError, 'extra or incomplete'):
            snapshot.verify(self.destination)

    def test_verify_changed_component_manifest_binding_refused(self):
        self.capture()
        path = self.destination / 'roots/alpha/snapshot.json'
        record = json.loads(path.read_text())
        record['unassessedMetadata'] = 'changed opaque metadata'
        path.write_text(json.dumps(record))
        with self.assertRaisesRegex(ValueError, 'component bindings differ'):
            snapshot.verify(self.destination)

    def test_verify_rebound_invalid_component_source_identity_refused(self):
        self.capture()
        path = self.destination / 'roots/alpha/snapshot.json'
        record = json.loads(path.read_text())
        record['sourceDirectory'] = str(self.beta)
        path.write_text(json.dumps(record))
        set_record = json.loads(self.receipt().read_text())
        set_record['roots'][0]['sourceDirectory'] = str(self.beta)
        set_record['roots'][0]['manifestSha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
        self.receipt().write_text(json.dumps(set_record))
        with self.assertRaisesRegex(ValueError, 'source identity differs'):
            snapshot.verify(self.destination)

    def test_verify_manifest_format_refused(self):
        original = self.capture()
        for value in ([], {**original, 'format': 'foreign'}, {**original, 'installationConsistency': 'complete'}, {**original, 'quiescence': 'live_writers_fenced'}):
            self.receipt().write_text(json.dumps(value))
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'set manifest format differs'):
                snapshot.verify(self.destination)

    def test_invalid_deadlines_refused(self):
        for value in (0, -1, float('nan'), float('inf')):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'positive and finite'):
                self.capture(timeout=value)
        self.assertFalse(self.destination.exists())

    def test_busy_native_later_database_obeys_set_deadline(self):
        with closing(sqlite3.connect(self.beta / 'blocked.sqlite')) as db:
            db.execute('CREATE TABLE blocked(id INTEGER)')
            db.commit()
            db.execute('BEGIN EXCLUSIVE')
            try:
                with self.assertRaisesRegex(TimeoutError, 'exceeded its deadline'):
                    self.capture(timeout=0.2)
            finally:db.rollback()
        self.assertFalse(self.receipt().exists(), 'busy selected set published success')

    def test_set_publication_sync_failure_removes_receipt(self):
        native = snapshot.root.sync_directory
        def failed(path):
            if path == self.destination and self.receipt().exists():raise OSError('synthetic set publication sync failure')
            return native(path)
        with mock.patch.object(snapshot.root, 'sync_directory', side_effect=failed):
            with self.assertRaisesRegex(OSError, 'set publication sync failure'):
                self.capture()
        self.assertFalse(self.receipt().exists(), 'failed set publication retained success receipt')

    def test_inventory_files_components_and_parent_synced(self):
        native_file, native_directory = snapshot.root.journal.sync_file, snapshot.root.sync_directory
        with mock.patch.object(snapshot.root.journal, 'sync_file', wraps=native_file) as file_sync, mock.patch.object(snapshot.root, 'sync_directory', wraps=native_directory) as directory_sync:
            self.capture()
        self.assertIn(self.destination / 'inventory.json', {call.args[0] for call in file_sync.call_args_list}, 'selection file not synced')
        expected = {self.destination, self.destination.parent, self.destination / 'roots'}
        self.assertTrue(expected <= {call.args[0] for call in directory_sync.call_args_list}, 'set directories or parent not synced')
        self.assertEqual([call.args[0] for call in directory_sync.call_args_list][-2:], [self.destination, self.destination.parent], 'final set publication parent not synced')

    def test_set_manifest_synced_before_publication(self):
        native_sync, native_link = os.fsync, os.link
        synced = set()
        def sync(descriptor):
            synced.add(Path(os.readlink('/proc/self/fd/' + str(descriptor))))
            return native_sync(descriptor)
        def link(source, destination, *args, **kwargs):
            if Path(destination) == self.receipt():
                self.assertIn(self.destination / '.snapshot.partial.json', synced, 'set manifest not synced before publication')
            return native_link(source, destination, *args, **kwargs)
        with mock.patch.object(os, 'fsync', side_effect=sync), mock.patch.object(os, 'link', side_effect=link):
            self.capture()

    def test_cli_capture_and_verify_no_private_metadata(self):
        common = [sys.executable, '-B', str(OPS / 'worker_root_set_snapshot.py'), '--destination', str(self.destination)]
        for action in (['--inventory', str(self.inventory), '--writers-quiesced'], ['--verify']):
            result = subprocess.run(common + action, capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            self.assertEqual(json.loads(result.stdout)['selectedRoots'], 2)
            self.assertNotIn(b'private-test-marker', result.stdout, 'private selection metadata printed')
            self.assertNotIn(str(self.alpha).encode(), result.stdout, 'private source path printed')

    def test_cli_scope_refusals(self):
        self.capture()
        common = [sys.executable, '-B', str(OPS / 'worker_root_set_snapshot.py'), '--destination', str(self.destination)]
        for action in ([], ['--verify', '--inventory', str(self.inventory)], ['--verify', '--writers-quiesced']):
            result = subprocess.run(common + action, capture_output=True, timeout=5)
            self.assertEqual(result.returncode, 2, 'invalid set CLI scope accepted')


if __name__ == '__main__':
    unittest.main()
