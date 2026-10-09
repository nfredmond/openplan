"""Owned scope cancellation uses disposable processes and explicit live opt-in."""
import json,os,subprocess,sys,time
from pathlib import Path
import unittest
from unittest.mock import patch
import model_engine_process as engine
import test_model_engine_supervision as scopes

@unittest.skipUnless(os.environ.get('OPENPLAN_LIVE_ENGINE_SCOPE')=='1','Requires explicit owned Linux user-scope opt-in')
class ScopeCancellationTests(unittest.TestCase):
    setUp=scopes.LiveEngineScopeTests.setUp
    response=scopes.LiveEngineScopeTests.response
    prepared=scopes.LiveEngineScopeTests.prepared
    start=scopes.LiveEngineScopeTests.start

    def alive(self,detached=False):
        child="import time;from pathlib import Path;Path('cancel-ready').touch();end=time.monotonic()+15\nwhile not Path('release').exists() and time.monotonic()<end:time.sleep(.02)"
        body=child
        if detached:
            body=f"import subprocess,sys,time;from pathlib import Path;subprocess.Popen([sys.executable,'-B','-c',{child!r}],start_new_session=True);end=time.monotonic()+5\nwhile not Path('cancel-ready').exists():\n if time.monotonic()>end:raise RuntimeError('No descendant readiness')\n time.sleep(.02)"
        handle=self.start(body);deadline=time.monotonic()+5
        while not (self.writer.files.path/'cancel-ready').exists():
            if time.monotonic()>deadline:raise RuntimeError('No cancellation readiness')
            time.sleep(.02)
        if detached:self.assertEqual(handle.process.wait(timeout=5),0)
        return handle

    def observed(self,handle):
        handle.process.wait(timeout=5);deadline=time.monotonic()+5
        while True:
            try:return handle.confirm_cancelled()
            except engine.EngineStillRunning:
                if time.monotonic()>deadline:raise
                time.sleep(.02)

    def test_detached_child_stops_without_database_success(self):
        handle=self.alive(detached=True);calls=self.post.call_count
        sent=handle.cancel();self.assertTrue(sent['signal_written']);self.assertFalse(sent['termination_observed'])
        receipt=self.observed(handle)
        self.assertTrue(receipt['termination_observed']);self.assertFalse(receipt['execution_ready'])
        self.assertFalse(receipt['database_status_changed']);self.assertTrue(self.writer.stopped)
        self.assertEqual(self.post.call_count,calls)
        self.assertFalse((handle.directory/'observed-exit.json').exists())
        self.assertEqual(json.loads((handle.directory/'cancellation-observed.json').read_text()),receipt)
        with patch.object(handle.scope,'kill_owned',side_effect=AssertionError('Repeated cancellation signaled')):
            self.assertEqual(handle.cancel(),sent);self.assertEqual(handle.confirm_cancelled(),receipt)

    def test_stopped_writer_can_stop_its_own_engine(self):
        handle=self.alive();self.writer.stopped=True
        handle.cancel();self.assertTrue(self.observed(handle)['termination_observed'])

    def test_failed_intent_record_never_signals(self):
        handle=self.alive();record=engine._record
        def fail(descriptor,name,payload):
            if name=='cancellation-requested.json':raise OSError('Synthetic cancellation record failure')
            return record(descriptor,name,payload)
        with patch.object(engine,'_record',side_effect=fail):
            with self.assertRaisesRegex(OSError,'cancellation record failure'):handle.cancel()
        with self.assertRaises(subprocess.TimeoutExpired,msg='Engine signaled before cancellation record'):handle.process.wait(timeout=.2)
        self.assertFalse((handle.directory/'cancellation-signal-written.json').exists())

    def test_identity_change_refuses_signal(self):
        handle=self.alive();changed=handle.scope.state();changed['InvocationID']='0'*32
        with patch.object(handle.scope,'state',return_value=changed):
            with self.assertRaisesRegex(ValueError,'identity changed before cancellation'):handle.cancel()
        self.assertIsNone(handle.process.poll());self.assertFalse((handle.directory/'cancellation-requested.json').exists())

    def test_cgroup_directory_change_refuses_signal(self):
        handle=self.alive();original=handle.scope.identity['cgroup_inode'];handle.scope.identity['cgroup_inode']=original+1
        try:
            with self.assertRaisesRegex(ValueError,'directory changed before cancellation'):handle.cancel()
        finally:handle.scope.identity['cgroup_inode']=original
        self.assertIsNone(handle.process.poll());self.assertFalse((handle.directory/'cancellation-requested.json').exists())

    def test_foreign_thread_refuses_signal(self):
        handle=self.alive();original=self.writer.thread_id;self.writer.thread_id=-1
        try:
            with self.assertRaisesRegex(ValueError,'another invocation thread'):handle.cancel()
        finally:self.writer.thread_id=original
        self.assertIsNone(handle.process.poll());self.assertFalse(self.writer.stopped)

    def test_unrequested_termination_observation_refused(self):
        handle=self.alive()
        with self.assertRaisesRegex(RuntimeError,'signal has not been confirmed'):handle.confirm_cancelled()
        self.assertFalse((handle.directory/'cancellation-observed.json').exists())
        self.assertFalse(self.writer.stopped)

    def test_unscoped_handle_refuses_cancel(self):
        self.prepared()
        handle=engine.EngineProcess(self.writer,[sys.executable,'-B','-c','pass'],env=dict(os.environ))
        try:
            with self.assertRaisesRegex(ValueError,'requires an owned engine scope'):handle.cancel()
            self.assertFalse(self.writer.stopped)
        finally:handle.process.wait(timeout=5)

    def test_confirmed_exit_refuses_cancel(self):
        handle=self.start('pass');scopes.LiveEngineScopeTests.finish(self,handle)
        with self.assertRaisesRegex(ValueError,'exit was already observed'):handle.cancel()
        self.assertFalse(self.writer.stopped)

    def test_lost_signal_receipt_never_sends_again(self):
        handle=self.alive();record=engine._record
        def fail(descriptor,name,payload):
            if name=='cancellation-signal-written.json':raise OSError('Synthetic cancellation receipt failure')
            return record(descriptor,name,payload)
        with patch.object(engine,'_record',side_effect=fail):
            with self.assertRaisesRegex(OSError,'cancellation receipt failure'):handle.cancel()
        handle.process.wait(timeout=5)
        with patch.object(handle.scope,'kill_owned',side_effect=AssertionError('Uncertain cancellation resent')):
            with self.assertRaisesRegex(RuntimeError,'requires reconciliation'):handle.cancel()
        self.assertTrue(self.writer.stopped);self.assertTrue((handle.directory/'cancellation-requested.json').exists())
        self.assertFalse((handle.directory/'cancellation-observed.json').exists())

if __name__=='__main__':unittest.main()
