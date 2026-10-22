"""Native filesystem/SQLite packet checks; opaque archives are not restore proof."""
import copy
from contextlib import closing
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

OPS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(OPS))
import recovery_point_manifest as packet


class RecoveryPacketTests(unittest.TestCase):
    def setUp(self):
        self.old_umask = os.umask(0o077)
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.point = self.base / 'point'
        self.point.mkdir(mode=0o700)
        self.config = self.point / 'configuration'
        self.config.mkdir(mode=0o700)
        (self.config / 'empty').mkdir(mode=0o700)
        for name, data in [('postgres.dump', b'opaque-test-database'), ('storage.tgz', b'opaque-test-storage'),
                           ('configuration/roles.sql', b'opaque-test-roles'),
                           ('configuration/root.key', bytes(range(32))),
                           ('configuration/runtime.env', b'PRIVATE_TEST_MARKER=keep\n')]:
            (self.point / name).write_bytes(data)
        self.source = self.base / 'worker-source'
        self.source.mkdir(mode=0o700)
        (self.source / 'input.bin').write_bytes(bytes(range(256)))
        (self.source / 'empty').mkdir(mode=0o700)
        with closing(sqlite3.connect(self.source / 'state.db')) as db:
            db.execute('CREATE TABLE custody(id INTEGER PRIMARY KEY, payload BLOB)')
            db.execute('INSERT INTO custody VALUES(1,?)', (bytes(range(256)),))
            db.commit()
        selection = self.base / 'worker-selection.json'
        selection.write_text(json.dumps({'format': packet.workers.INVENTORY_FORMAT,
                                         'roots': [{'id': 'native', 'path': str(self.source)}]}))
        packet.workers.capture(selection, self.point / 'workers', writers_quiesced=True)
        self.declared = {'format': packet.DECLARATION_FORMAT, 'privateMetadata': 'PRIVATE_TEST_MARKER',
                         'artifacts': {
                             'databaseArchive': {'kind': 'file', 'path': 'postgres.dump'},
                             'storage': {'kind': 'file', 'path': 'storage.tgz'},
                             'clusterRoles': {'kind': 'file', 'path': 'configuration/roles.sql'},
                             'databaseRootKey': {'kind': 'file', 'path': 'configuration/root.key'},
                             'configuration': {'kind': 'directory', 'path': 'configuration'},
                             'workerRootSet': {'kind': 'directory', 'path': 'workers'}}}
        self.declaration_path = self.point / packet.DECLARATION
        self.write_declaration()

    def tearDown(self):
        try:
            self.temp.cleanup()
        finally:
            os.umask(self.old_umask)

    def write_declaration(self):
        self.declaration_path.write_text(json.dumps(self.declared, indent=4) + '\n')

    def seal(self):
        return packet.seal(self.point, writers_quiesced=True)

    def test_complete_native_packet(self):
        before = packet.workers.root.inventory(self.point, packet.workers.deadline_for(5))
        payload = self.declaration_path.read_bytes()
        with patch.object(packet, 'declaration', wraps=packet.declaration) as parsed:
            record = self.seal()
        self.assertEqual(parsed.call_count, 1, 'packet declaration validation bypassed')
        self.assertEqual(record['entries'], before, 'packet inventory omitted original entries')
        self.assertEqual(self.declaration_path.read_bytes(), payload)
        self.assertEqual(record['installationConsistency'], 'unassessed', 'packet promoted installation acceptance')
        self.assertEqual(packet.verify(self.point), record)
        with closing(sqlite3.connect(self.point / 'workers/roots/native/root/state.db')) as db:
            self.assertEqual(db.execute('SELECT payload FROM custody').fetchone()[0], bytes(range(256)))

    def test_relocated_packet_without_worker_sources(self):
        record = self.seal()
        destination = self.base / 'relocated'
        shutil.copytree(self.point, destination)
        self.source.rename(self.base / 'source-unavailable')
        self.assertEqual(packet.verify(destination), record)

    def test_storage_directory_supported(self):
        (self.point / 'storage.tgz').unlink()
        directory = self.point / 'storage-objects'
        directory.mkdir(mode=0o700)
        (directory / 'empty').mkdir(mode=0o700)
        (directory / 'object.bin').write_bytes(bytes(range(256)))
        self.declared['artifacts']['storage'] = {'kind': 'directory', 'path': 'storage-objects'}
        self.write_declaration()
        record = self.seal()
        self.assertEqual(record['entries']['storage-objects/empty']['kind'], 'directory', 'storage empty path omitted')
        self.assertEqual(packet.verify(self.point), record)

    def test_quiescence_required(self):
        with self.assertRaisesRegex(ValueError, 'Quiesce writers'):
            packet.seal(self.point, writers_quiesced=False)
        self.assertFalse((self.point / packet.RECEIPT).exists())

    def test_declaration_format_refused(self):
        self.declared['format'] = 'foreign'
        self.write_declaration()
        with self.assertRaisesRegex(ValueError, 'declaration format'):
            self.seal()

    def test_duplicate_json_keys_refused(self):
        payload = self.declaration_path.read_text()
        self.declaration_path.write_text(payload.replace('"format":', '"format":"foreign", "format":', 1))
        with self.assertRaisesRegex(ValueError, 'duplicate keys'):
            self.seal()

    def test_missing_category_refused(self):
        del self.declared['artifacts']['databaseRootKey']
        self.write_declaration()
        with self.assertRaisesRegex(ValueError, 'categories differ'):
            self.seal()

    def test_extra_category_refused(self):
        self.declared['artifacts']['unsupported'] = {'path': 'other', 'kind': 'file'}
        self.write_declaration()
        with self.assertRaisesRegex(ValueError, 'categories differ'):
            self.seal()

    def test_unsafe_path_refused(self):
        for value in ('../outside', '/absolute', '.', packet.DECLARATION, packet.RECEIPT, packet.PARTIAL, 'a//b', 'a/./b', 'a/', ''):
            with self.subTest(value=value):
                value_record = copy.deepcopy(self.declared)
                value_record['artifacts']['databaseArchive']['path'] = value
                with self.assertRaisesRegex(ValueError, 'path is unsafe'):
                    packet.declaration(json.dumps(value_record))

    def test_nonscalar_path_refused(self):
        for value in (None, [], {}, 1, '\x00bad'):
            with self.subTest(value=value):
                value_record = copy.deepcopy(self.declared)
                value_record['artifacts']['databaseArchive']['path'] = value
                with self.assertRaisesRegex(ValueError, 'path is unsafe'):
                    packet.declaration(json.dumps(value_record))

    def test_wrong_declared_kind_refused(self):
        for value in ('directory', [], {}, None):
            with self.subTest(value=value):
                value_record = copy.deepcopy(self.declared)
                value_record['artifacts']['databaseArchive']['kind'] = value
                with self.assertRaisesRegex(ValueError, 'kind differs'):
                    packet.declaration(json.dumps(value_record))

    def test_duplicate_artifact_paths_refused(self):
        self.declared['artifacts']['storage']['path'] = 'postgres.dump'
        self.write_declaration()
        with self.assertRaisesRegex(ValueError, 'paths are duplicated'):
            self.seal()

    def test_missing_declared_file_refused(self):
        (self.point / 'postgres.dump').unlink()
        with self.assertRaisesRegex(ValueError, 'missing or differs'):
            self.seal()

    def test_empty_declared_file_refused(self):
        (self.point / 'postgres.dump').write_bytes(b'')
        with self.assertRaisesRegex(ValueError, 'file is empty'):
            self.seal()

    def test_actual_kind_differs_refused(self):
        (self.point / 'postgres.dump').unlink()
        (self.point / 'postgres.dump').mkdir(mode=0o700)
        with self.assertRaisesRegex(ValueError, 'missing or differs'):
            self.seal()

    def test_publication_state_refused(self):
        for name in (packet.RECEIPT, packet.PARTIAL):
            path = self.point / name
            try:
                path.write_bytes(b'retain-failed-state')
                with self.assertRaises((ValueError, OSError)):
                    self.seal()
                self.assertEqual(path.read_bytes(), b'retain-failed-state')
                if name == packet.RECEIPT:
                    self.assertFalse((self.point / packet.PARTIAL).exists(), 'publication began over existing receipt')
            finally:
                path.unlink()

    def test_private_packet_paths_refused(self):
        original = self.point / 'postgres.dump'
        held = self.base / 'original'
        original.rename(held)
        try:
            for kind in ('symlink', 'hardlink', 'access'):
                with self.subTest(kind=kind):
                    if kind == 'symlink': original.symlink_to(held)
                    elif kind == 'hardlink': os.link(held, original)
                    else:
                        original.write_bytes(held.read_bytes())
                        original.chmod(0o644)
                    try:
                        with self.assertRaises(ValueError): self.seal()
                    finally: original.unlink()
        finally:
            held.rename(original)

    def test_changed_declaration_during_read_refused(self):
        original = packet.workers.root.entry
        def changed(path, deadline):
            row = original(path, deadline)
            if path == self.declaration_path: path.write_bytes(path.read_bytes() + b' ')
            return row
        with patch.object(packet.workers.root, 'entry', side_effect=changed):
            with self.assertRaisesRegex(ValueError, 'changed while reading'):
                packet.read_declaration(self.point, packet.workers.deadline_for(5))

    def test_changed_declaration_before_inventory_refused(self):
        original = packet.read_declaration
        def changed(*args):
            result = original(*args)
            self.declaration_path.write_bytes(self.declaration_path.read_bytes() + b' ')
            return result
        with patch.object(packet, 'read_declaration', side_effect=changed):
            with self.assertRaisesRegex(ValueError, 'changed before inventory'): self.seal()

    def test_changed_packet_during_sync_refused(self):
        original = packet.workers.root.journal.sync_file
        def changed(path):
            original(path)
            if path == self.point / 'postgres.dump': path.write_bytes(b'changed-after-sync')
        with patch.object(packet.workers.root.journal, 'sync_file', side_effect=changed):
            with self.assertRaisesRegex(ValueError, 'changed during sealing'): self.seal()
        self.assertFalse((self.point / packet.RECEIPT).exists())

    def test_invalid_worker_set_refused_before_publication(self):
        (self.point / 'workers/snapshot.json').unlink()
        with self.assertRaises(OSError): self.seal()
        self.assertFalse((self.point / packet.RECEIPT).exists())

    def test_worker_set_rechecked_after_sync(self):
        original = packet.workers.verify
        calls = []
        def validate(*args, **kwargs):
            calls.append(True)
            if len(calls) == 2: raise ValueError('reported nested-set failure after sync')
            return original(*args, **kwargs)
        with patch.object(packet.workers, 'verify', side_effect=validate):
            with self.assertRaisesRegex(ValueError, 'reported nested-set failure'): self.seal()
        self.assertFalse((self.point / packet.RECEIPT).exists())

    def test_verify_extra_or_changed_entries_refused(self):
        self.seal()
        path = self.point / 'extra'
        path.write_bytes(b'extra')
        with self.assertRaisesRegex(ValueError, 'retained entries differ'): packet.verify(self.point)
        path.unlink()
        (self.point / 'postgres.dump').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'retained entries differ'): packet.verify(self.point)

    def test_verify_changed_mode_refused(self):
        self.seal()
        (self.point / 'postgres.dump').chmod(0o400)
        with self.assertRaisesRegex(ValueError, 'retained entries differ'): packet.verify(self.point)

    def test_verify_manifest_format_refused(self):
        self.seal()
        original = json.loads((self.point / packet.RECEIPT).read_text())
        for value in ({**original, 'format': 'foreign'}, [], {**original, 'installationConsistency': 'accepted'},
                      {**original, 'scope': 'complete_installation'}, {**original, 'quiescence': 'fenced'}):
            (self.point / packet.RECEIPT).write_text(json.dumps(value))
            with self.assertRaisesRegex(ValueError, 'manifest format differs'): packet.verify(self.point)

    def test_verify_rebound_invalid_worker_set_refused(self):
        self.seal()
        nested = self.point / 'workers/snapshot.json'
        nested_record = json.loads(nested.read_text())
        nested_record['roots'] = []
        nested.write_text(json.dumps(nested_record))
        receipt = self.point / packet.RECEIPT
        outer = json.loads(receipt.read_text())
        entries = packet.workers.root.inventory(self.point, packet.workers.deadline_for(5))
        entries.pop(packet.RECEIPT)
        outer['entries'] = entries
        receipt.write_text(json.dumps(outer))
        with self.assertRaisesRegex(ValueError, 'component bindings differ'): packet.verify(self.point)

    def test_verify_rebound_missing_artifact_refused(self):
        self.seal()
        (self.point / 'postgres.dump').unlink()
        receipt = self.point / packet.RECEIPT
        outer = json.loads(receipt.read_text())
        entries = packet.workers.root.inventory(self.point, packet.workers.deadline_for(5))
        entries.pop(packet.RECEIPT)
        outer['entries'] = entries
        receipt.write_text(json.dumps(outer))
        with self.assertRaisesRegex(ValueError, 'missing or differs'): packet.verify(self.point)

    def test_retained_file_sync_failure_refused(self):
        original = packet.workers.root.journal.sync_file
        def fail(path):
            original(path)
            if path == self.point / 'postgres.dump': raise OSError('reported retained file sync failure')
        with patch.object(packet.workers.root.journal, 'sync_file', side_effect=fail):
            with self.assertRaisesRegex(OSError, 'reported retained file'): self.seal()
        self.assertFalse((self.point / packet.RECEIPT).exists())

    def test_file_and_directory_sync(self):
        sync_file, sync_dir = packet.workers.root.journal.sync_file, packet.workers.root.sync_directory
        with patch.object(packet.workers.root.journal, 'sync_file', wraps=sync_file) as files, patch.object(packet.workers.root, 'sync_directory', wraps=sync_dir) as directories:
            self.seal()
        self.assertIn((self.point / 'postgres.dump',), [call.args for call in files.call_args_list], 'retained database file not synced')
        self.assertIn((self.config / 'empty',), [call.args for call in directories.call_args_list], 'empty configuration directory not synced')
        self.assertEqual([call.args for call in directories.call_args_list][-2:], [(self.point,), (self.point.parent,)], 'final packet and parent not synced')

    def test_manifest_fsynced_before_link(self):
        sync, link = os.fsync, os.link
        synced = []
        def observe(fd):
            synced.append(Path(os.readlink('/proc/self/fd/' + str(fd))))
            return sync(fd)
        def before_link(source, target):
            self.assertIn(Path(source), synced, 'packet manifest not synced before publication')
            return link(source, target)
        with patch.object(packet.os, 'fsync', side_effect=observe), patch.object(packet.os, 'link', side_effect=before_link):
            self.seal()

    def test_failed_final_sync_removes_receipt(self):
        original = packet.workers.root.sync_directory
        def fail(path):
            if path == self.point.parent: raise OSError('reported final parent sync failure')
            return original(path)
        with patch.object(packet.workers.root, 'sync_directory', side_effect=fail):
            with self.assertRaisesRegex(OSError, 'reported final'): self.seal()
        self.assertFalse((self.point / packet.RECEIPT).exists(), 'failed packet published receipt')

    def test_invalid_deadlines_refused(self):
        for value in (float('inf'), 0, -1, float('nan')):
            with self.subTest(value=value):
                with self.assertRaisesRegex(ValueError, 'positive and finite'):
                    packet.seal(self.point, writers_quiesced=True, timeout=value)
                with self.assertRaisesRegex(ValueError, 'positive and finite'):
                    packet.verify(self.point, timeout=value)

    def test_cli_seal_verify_private_stdout(self):
        for mode in (['--seal', '--writers-quiesced'], ['--verify']):
            result = subprocess.run([sys.executable, '-B', str(OPS / 'recovery_point_manifest.py'), '--point', str(self.point), *mode], capture_output=True, text=True, timeout=5)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotIn(str(self.point), result.stdout, 'packet CLI disclosed private path')
            self.assertNotIn('PRIVATE_TEST_MARKER', result.stdout)
            self.assertEqual(json.loads(result.stdout)['installationConsistency'], 'unassessed')

    def test_cli_mixed_or_missing_scope_refused(self):
        self.seal()
        common = [sys.executable, '-B', str(OPS / 'recovery_point_manifest.py'), '--point', str(self.point)]
        for args in ([], ['--seal', '--verify'], ['--verify', '--writers-quiesced']):
            result = subprocess.run(common + args, capture_output=True, timeout=5)
            self.assertEqual(result.returncode, 2, 'mixed or missing packet CLI scope survived')


if __name__ == '__main__':
    unittest.main()
