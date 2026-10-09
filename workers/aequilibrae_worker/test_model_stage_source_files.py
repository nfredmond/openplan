"""Stage preparation measures files and refuses races before journal creation."""
import hashlib
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import model_stage_preparation as preparation


class SourceFileTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.path=self.root/'volumes.csv';self.path.write_bytes(b'original\n')
        self.directory=self.root/'journal'
        self.arguments=dict(base_url='http://127.0.0.1:54321',deployment_id='synthetic',run_id='11111111-1111-4111-8111-111111111111',stage_id='22222222-2222-4222-8222-222222222222',inputs={})

    def prepare(self):
        return preparation.prepare_files(self.directory,source_paths={'volumes':self.path},**self.arguments)

    def test_hash_size_and_harmless_access_time(self):
        expected={'sha256':hashlib.sha256(b'original\n').hexdigest(),'size_bytes':9}
        first=self.prepare()
        self.assertEqual(first['source_files'],{'volumes':expected})
        state=self.path.stat();os.utime(self.path,ns=(state.st_atime_ns+1000000,state.st_mtime_ns))
        self.assertEqual(self.prepare(),first)
        self.path.write_bytes(b'changed!\n')
        with self.assertRaisesRegex(ValueError,'inputs changed'):self.prepare()

    def test_changed_or_replaced_file_during_read_stays_unprepared(self):
        real=hashlib.sha256
        for replace in (False,True):
            with self.subTest(replace=replace):
                self.path.write_bytes(b'original\n')
                class Digest:
                    def __init__(inner):inner.digest=real()
                    def update(inner,data):
                        inner.digest.update(data)
                        if replace:
                            other=self.root/'replacement';other.write_bytes(b'original\n');other.replace(self.path)
                        else:self.path.write_bytes(b'modified\n')
                    def hexdigest(inner):return inner.digest.hexdigest()
                with patch.object(hashlib,'sha256',Digest):
                    with self.assertRaisesRegex(ValueError,'changed while reading'):self.prepare()
                self.assertFalse(self.directory.exists())

    def test_missing_and_nonregular_sources_stay_unprepared(self):
        self.path.unlink()
        with self.assertRaises(FileNotFoundError):self.prepare()
        os.mkfifo(self.path)
        with self.assertRaisesRegex(ValueError,'regular file'):self.prepare()
        self.assertFalse(self.directory.exists())


if __name__=='__main__':unittest.main()
