"""Capture the exact admitted dispatch without starting input or engine work."""
import time
import unittest
from unittest.mock import patch

import test_application_draft_authority as fixtures


class Checks(unittest.TestCase):
    def setUp(self):
        self.f=fixtures.Checks();self.f.setUp();self.addCleanup(self.f.tearDown)
    def capture(self,**kwargs):
        with self.f.runtime.owner():
            self.f.f.started();return self.f.pipeline.capture_original(self.f.request['requestId'],**kwargs)
    def test_capture_has_no_input_or_engine_effect(self):
        result=self.capture()
        self.assertEqual(result['payloadText'],self.f.f.payload,'Capture retains exact original dispatch bytes')
        self.assertEqual(self.f.fetches,[],'Capture cannot start input fetch')
        self.assertEqual(self.f.sends,[],'Capture cannot issue an engine command')
        self.assertFalse(list(self.f.f.root.glob('preparation-*')),'Capture cannot prepare engine work')
    def test_equal_replay_never_calls_capture_again(self):
        first=self.capture();path=self.f.f.custody.folder(self.f.request['requestId'])/'receipt.json';inode=path.stat().st_ino
        with patch.object(self.f.pipeline,'capture',side_effect=AssertionError('Saved capture cannot requery dispatch')):
            replay=self.capture()
        self.assertEqual(replay,first,'Capture replay preserves original receipt')
        self.assertEqual(path.stat().st_ino,inode,'Capture replay cannot replace original receipt')
    def test_public_deadline_reaches_capture_transport(self):
        deadline=time.monotonic()+2;self.capture(deadline=deadline)
        self.assertEqual(self.f.f.calls[0][1],deadline,'Public capture preserves supplied earlier deadline')
    def test_invalid_deadline_refuses_before_capture_transport(self):
        for deadline in (True,float('nan'),float('inf')):
            with self.subTest(deadline=deadline),self.assertRaisesRegex(ValueError,'deadline must be finite'):
                self.capture(deadline=deadline)
        self.assertEqual(self.f.f.calls,[],'Invalid capture deadline cannot reach transport')


if __name__=='__main__':unittest.main()
