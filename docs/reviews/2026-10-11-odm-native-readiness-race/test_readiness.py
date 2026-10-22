"""Actual file publication with a deterministically paused listener writer."""
import json
import os
from pathlib import Path
import stat
import tempfile
import threading
import unittest
from unittest.mock import patch

import readiness


class Checks(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='odm-readiness-')
        self.root = Path(self.temporary.name)
        self.path = self.root/'listener.json'
        self.payload = {'port': 12345, 'pid': os.getpid(), 'admission': {'heldStarted': 1}}

    def tearDown(self):
        self.temporary.cleanup()

    def test_partial_listener_is_not_visible(self):
        entered, release = threading.Event(), threading.Event()
        original = json.dump
        failures = []
        def paused(payload, stream):
            stream.flush();entered.set()
            if not release.wait(timeout=3):
                raise AssertionError('Owned readiness writer was not released')
            original(payload, stream)
        def write():
            try:
                readiness.publish_readiness(self.path, self.payload)
            except BaseException as error:
                failures.append(error)
        child = threading.Thread(target=write)
        try:
            with patch('readiness.json.dump', side_effect=paused):
                child.start()
                self.assertTrue(entered.wait(timeout=3), 'Probe must reach the open listener writer')
                self.assertFalse(self.path.exists(), 'Readiness must remain invisible before complete JSON')
                release.set();child.join(timeout=3)
            self.assertFalse(child.is_alive(), 'Owned readiness writer must stop')
            if failures:raise failures[0]
            self.assertEqual(json.loads(self.path.read_text()), self.payload)
        finally:
            release.set()
            if child.ident is not None:child.join(timeout=3)

    def test_existing_listener_is_never_replaced(self):
        self.path.write_bytes(b'original owned listener')
        with self.assertRaises(FileExistsError):
            readiness.publish_readiness(self.path, self.payload)
        self.assertEqual(self.path.read_bytes(), b'original owned listener', 'Publication cannot replace an existing listener')

    def test_complete_file_and_parent_are_synchronized(self):
        original = os.fsync
        calls = []
        def synchronized(descriptor):
            calls.append('directory' if stat.S_ISDIR(os.fstat(descriptor).st_mode) else 'file')
            original(descriptor)
        with patch('readiness.os.fsync', side_effect=synchronized):
            readiness.publish_readiness(self.path, self.payload)
        self.assertEqual(calls, ['file', 'directory'], 'Complete listener and parent must synchronize in order')

    def test_failed_file_sync_cannot_publish_readiness(self):
        with patch('readiness.os.fsync', side_effect=OSError('Synthetic listener sync failure')):
            with self.assertRaisesRegex(OSError, 'Synthetic listener sync failure'):
                readiness.publish_readiness(self.path, self.payload)
        self.assertFalse(self.path.exists(), 'Failed synchronization cannot publish readiness')


if __name__ == '__main__':
    unittest.main()
