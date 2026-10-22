"""Supplied synthetic archives prove custody, not backend or raster quality."""
import hashlib
import io
import json
import os
import shutil
import stat
import unittest
from unittest.mock import patch
import zipfile

from retained_source import json_bytes
import retained_output_archive as module
import test_retained_task_observation as fixtures


class Checks(unittest.TestCase):
    def setUp(self):
        self.f = fixtures.Checks()
        self.f.setUp()
        self.addCleanup(self.f.tearDown)
        self.f.value['status'] = {'code': 40}
        self.store = self.f.store()
        self.observed = self.store.record(200, self.f.body())
        self.source = self.f.fixture.base / 'provided-output'
        self.source.mkdir(mode=0o700)
        self.target = self.f.fixture.base / 'retained-output'
        self.raw = self.pack([('odm_orthophoto/ortho.tif', b'Synthetic raster bytes'),
            ('odm_texturing/model.obj', b'Synthetic mesh bytes')])
        self.input = self.source / 'all.zip'
        self.input.write_bytes(self.raw)
        self.input.chmod(0o600)

    @staticmethod
    def pack(rows):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            for name, data in rows:
                archive.writestr(name, data)
        return buffer.getvalue()

    def call(self, **changes):
        options = {'source_root': self.source, 'source_name': 'all.zip', 'destination': self.target,
            'max_archive_bytes': 4096, 'max_expanded_bytes': 4096, 'max_entries': 10,
            'max_directory_bytes': 4096, 'timeout': 2}
        options.update(changes)
        return module.retain(self.store, self.observed['bodySha256'], **options)

    def test_exact_archive_and_all_members_remain_private_and_unassessed(self):
        result = self.call()
        self.assertEqual((self.target / 'archive.zip').read_bytes(), self.raw, 'Retention must preserve exact complete archive bytes')
        self.assertEqual(result['archive']['sha256'], hashlib.sha256(self.raw).hexdigest())
        self.assertEqual([x['name'] for x in result['archive']['members']],
            ['odm_orthophoto/ortho.tif', 'odm_texturing/model.obj'], 'Every regular archive member must be inventoried')
        self.assertEqual(stat.S_IMODE((self.target / 'archive.zip').stat().st_mode), 0o600)
        for name in ['archiveTaskProvenanceVerification', 'requestedDeliverableCompletenessVerification', 'processingQualityVerification']:
            self.assertEqual(result[name], 'unassessed', 'Supplied archive cannot promote ' + name)
        self.assertIs(result['callbackPermission'], False)
        self.assertIs(result['publicationPermission'], False)

    def test_completed_replay_needs_no_original_source_and_preserves_inode(self):
        first = self.call()
        inode = (self.target / 'archive.zip').stat().st_ino
        shutil.rmtree(self.source)
        self.assertEqual(self.call(), first, 'Completed archive must recover without supplied source')
        self.assertEqual((self.target / 'archive.zip').stat().st_ino, inode)

    def test_private_root_copy_preserves_original_receipt(self):
        first = self.call()
        copied = self.f.fixture.base / 'copied-output'
        shutil.copytree(self.target, copied)
        shutil.rmtree(self.source)
        self.assertEqual(self.call(destination=copied), first, 'Local copied archive must retain original byte and context receipt')

    def test_raw_archive_bound_refuses_before_plan(self):
        with patch.object(module, 'directory', side_effect=AssertionError('Raw bound must precede ZIP directory parsing')), self.assertRaisesRegex(ValueError, 'raw byte budget'):
            self.call(max_archive_bytes=1)
        self.assertFalse((self.target / 'plan.json').exists())

    def test_expanded_member_bound_refuses_before_plan(self):
        with patch.object(zipfile.ZipFile, 'open', side_effect=AssertionError('Expanded bound must precede member inflation')), self.assertRaisesRegex(ValueError, 'expanded byte budget'):
            self.call(max_expanded_bytes=1)
        self.assertFalse((self.target / 'plan.json').exists())

    def test_directory_and_entry_bounds_precede_zip_loading(self):
        with patch.object(zipfile, 'ZipFile', side_effect=AssertionError('Directory bounds must precede ZIP loading')):
            with self.assertRaisesRegex(ValueError, 'directory exceeds'):
                self.call(max_entries=1)
            with self.assertRaisesRegex(ValueError, 'directory exceeds'):
                self.call(max_directory_bytes=1)

    def test_unsafe_and_duplicate_names_refuse_before_receipt(self):
        for rows in [[('../outside.tif', b'x')], [('same.tif', b'a'), ('same.tif', b'b')]]:
            with self.subTest(rows=rows):
                self.input.write_bytes(self.pack(rows))
                with self.assertRaisesRegex(ValueError, 'unsafe or repeated'):
                    self.call()
                self.assertFalse((self.target / 'receipt.json').exists())

    def test_special_members_and_empty_archives_refuse(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as archive:
            info = zipfile.ZipInfo('link')
            info.create_system = 3
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(info, b'outside')
        self.input.write_bytes(buffer.getvalue())
        with self.assertRaisesRegex(ValueError, 'special member'):
            self.call()
        self.input.write_bytes(self.pack([]))
        with self.assertRaisesRegex(ValueError, 'no regular output members'):
            self.call()

    def test_noncompleted_original_observation_refuses_before_output_directory(self):
        self.f.value['status'] = {'code': 30, 'errorMessage': 'Synthetic failure'}
        self.observed = self.store.record(200, self.f.body())
        with self.assertRaisesRegex(ValueError, 'reported completion'):
            self.call()
        self.assertFalse(self.target.exists())

    def test_changed_plan_or_receipt_cannot_replace_original_custody(self):
        self.call()
        path = self.target / 'plan.json'
        original = path.read_bytes()
        value = json.loads(original)
        value['observationSha256'] = '0' * 64
        path.write_bytes(json_bytes(value))
        with self.assertRaisesRegex(ValueError, 'original plan differs'):
            self.call()
        path.write_bytes(original)
        receipt = self.target / 'receipt.json'
        value = json.loads(receipt.read_bytes())
        value['publicationPermission'] = True
        receipt.write_bytes(json_bytes(value))
        with self.assertRaisesRegex(ValueError, 'Existing source custody record differs'):
            self.call()

    def test_corrupt_retained_archive_refuses_without_recopied_source(self):
        self.call()
        raw = bytearray(self.raw)
        raw[-1] ^= 1
        (self.target / 'archive.zip').write_bytes(raw)
        with self.assertRaises((ValueError, zipfile.BadZipFile)):
            self.call()
        self.assertEqual((self.target / 'archive.zip').read_bytes(), raw, 'Corrupt completed archive cannot be silently replaced')

    def test_missing_original_plan_refuses_before_reconstructing_existing_archive(self):
        self.call()
        (self.target / 'plan.json').unlink()
        with patch.object(module, 'inventory', side_effect=AssertionError('Missing original plan cannot be reconstructed from a source path')):
            with self.assertRaisesRegex(ValueError, 'original plan is missing'):
                self.call()
        self.assertFalse((self.target / 'plan.json').exists())
        self.assertEqual((self.target / 'archive.zip').read_bytes(), self.raw)

    def test_owned_unpublished_metadata_does_not_accumulate_on_recovery(self):
        self.call()
        partial = self.target / ('.partial-' + 'a' * 32)
        partial.write_bytes(b'Interrupted unpublished metadata')
        partial.chmod(0o600)
        receipt = (self.target / 'receipt.json').read_bytes()
        self.call()
        self.assertFalse(partial.exists(), 'Owned unpublished metadata must be removed without changing original receipt')
        self.assertEqual((self.target / 'receipt.json').read_bytes(), receipt)

    def test_unknown_unpublished_file_is_preserved_and_refused(self):
        self.call()
        partial = self.target / '.partial-unknown'
        partial.write_bytes(b'Unrecognized record')
        partial.chmod(0o600)
        with self.assertRaisesRegex(ValueError, 'unknown unpublished record'):
            self.call()
        self.assertEqual(partial.read_bytes(), b'Unrecognized record')

    def test_interrupted_alias_publication_recovers_exact_original_bytes(self):
        self.call()
        (self.target / 'receipt.json').unlink()
        os.link(self.target / 'archive.zip', self.target / '.archive-partial')
        shutil.rmtree(self.source)
        result = self.call()
        self.assertEqual(result['archive']['sha256'], hashlib.sha256(self.raw).hexdigest())
        self.assertEqual((self.target / 'archive.zip').stat().st_nlink, 1, 'Own interrupted alias must be reconciled without re-download')
        self.assertFalse((self.target / '.archive-partial').exists())

    def test_changed_source_after_frozen_plan_refuses_original_version(self):
        original = module.digest
        def changed(root, name, limit, deadline, output=None):
            self.input.write_bytes(self.pack([('changed.tif', b'Changed source bytes')]))
            return original(root, name, limit, deadline, output=output)
        with patch.object(module, 'digest', changed), self.assertRaisesRegex(ValueError, 'frozen original bytes'):
            self.call()
        self.assertFalse((self.target / 'archive.zip').exists())
        self.assertFalse((self.target / 'receipt.json').exists())

    def test_expired_copy_never_publishes_archive_receipt(self):
        original = module.digest
        timer = patch.object(module.time, 'monotonic', return_value=1e12)
        def expired(*args, **kwargs):
            result = original(*args, **kwargs)
            timer.start()
            return result
        try:
            with patch.object(module, 'digest', expired), self.assertRaises(TimeoutError):
                self.call()
        finally:
            timer.stop()
        self.assertFalse((self.target / 'archive.zip').exists(), 'Expired copy cannot publish archive bytes')
        self.assertFalse((self.target / 'receipt.json').exists())

    def test_limits_types_and_separate_private_roots_are_required(self):
        for field, value, reason in [('max_archive_bytes', False, 'positive integer'), ('max_entries', 0, 'positive integer'), ('timeout', float('nan'), 'finite timeout')]:
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, reason):
                self.call(**{field: value})
        with self.assertRaisesRegex(ValueError, 'original observations'):
            saved = self.store
            try:
                self.store = None
                self.call()
            finally:
                self.store = saved
        with self.assertRaisesRegex(ValueError, 'must not overlap'):
            self.call(destination=self.source)


if __name__ == '__main__':
    unittest.main()
