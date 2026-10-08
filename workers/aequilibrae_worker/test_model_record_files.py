"""Local record retries preserve exact bytes and refuse partial or changed files."""
from pathlib import Path
import os
import tempfile
import unittest
from unittest.mock import patch
import model_record_files as records


class RecordFilesTests(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup);self.root=Path(temp.name)/'records'
        self.values={'assessment.json':b'{"status":"inconclusive"}','basis.json':b'{}','volumes.geojson':b'{"type":"FeatureCollection","features":[]}'}

    def test_exact_retry_preserves_inodes_and_repairs_only_missing_files(self):
        paths=records.materialize(self.root,self.values)
        identity=(self.root/'assessment.json').stat().st_ino
        (self.root/'basis.json').unlink()
        self.assertEqual(records.materialize(self.root,self.values),paths)
        self.assertEqual((self.root/'assessment.json').stat().st_ino,identity)
        self.assertEqual((self.root/'basis.json').read_bytes(),b'{}')
        self.assertEqual(sorted(p.name for p in self.root.iterdir()),sorted(self.values))

    def test_changed_or_partial_existing_bytes_are_never_overwritten(self):
        self.root.mkdir()
        target=self.root/'assessment.json';target.write_bytes(b'partial')
        with self.assertRaisesRegex(ValueError,'differs'):records.materialize(self.root,self.values)
        self.assertEqual(target.read_bytes(),b'partial')
        self.assertFalse((self.root/'basis.json').exists())

    def test_refuses_symlink_and_nonregular_target(self):
        self.root.mkdir();outside=self.root.parent/'outside';outside.write_bytes(self.values['assessment.json'])
        target=self.root/'assessment.json';target.symlink_to(outside)
        with self.assertRaises(OSError):records.materialize(self.root,self.values)
        self.assertTrue(target.is_symlink());target.unlink();os.mkfifo(target)
        with self.assertRaisesRegex(ValueError,'regular file'):records.materialize(self.root,self.values)

    def test_interruption_before_publish_leaves_no_partial_target(self):
        with patch.object(records.os,'link',side_effect=OSError('synthetic interruption')):
            with self.assertRaises(OSError):records.materialize(self.root,self.values)
        self.assertEqual(list(self.root.iterdir()),[])
        records.materialize(self.root,self.values)
        self.assertEqual((self.root/'assessment.json').read_bytes(),self.values['assessment.json'])

    def test_competing_different_file_is_refused(self):
        original=records.os.link
        def competing(source,target,**kwargs):
            Path(target).write_bytes(b'different competing bytes')
            return original(source,target,**kwargs)
        with patch.object(records.os,'link',side_effect=competing):
            with self.assertRaisesRegex(ValueError,'differs'):records.materialize(self.root,self.values)
        self.assertEqual((self.root/'assessment.json').read_bytes(),b'different competing bytes')

    def test_invalid_names_do_not_create_directory(self):
        for name in ('../assessment.json','/absolute.json','nested/file.json','volumes.geojson.bak','run.sh',''):
            with self.assertRaises(ValueError):records.materialize(self.root,{name:b'{}'})
        self.assertFalse(self.root.exists())

if __name__=='__main__':unittest.main()
