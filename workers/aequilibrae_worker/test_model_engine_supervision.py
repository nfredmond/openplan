"""Opt-in live user-scope checks; portable policy checks always run."""
import json,os,sys,time,subprocess,tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
import model_engine_process as engine
from model_engine_supervision import ScopeLimits,OwnedEngineScope,SupervisionUnavailable
import test_model_engine_process as fixtures

class ScopePolicyTests(unittest.TestCase):
    def test_invalid_policy_is_refused(self):
        for value in (0,-1,True,1.5,'128'):
            with self.assertRaises(ValueError):ScopeLimits(value,16)
            with self.assertRaises(ValueError):ScopeLimits(128*1024*1024,value)
    def test_missing_manager_is_explicit(self):
        with patch('model_engine_supervision.shutil.which',return_value=None):
            with self.assertRaises(SupervisionUnavailable):OwnedEngineScope(ScopeLimits(128*1024*1024,16))

@unittest.skipUnless(os.environ.get('OPENPLAN_LIVE_ENGINE_SCOPE')=='1','Requires explicit owned Linux user-scope opt-in')
class LiveEngineScopeTests(unittest.TestCase):
    setUp=fixtures.EngineProcessTests.setUp
    response=fixtures.EngineProcessTests.response
    prepared=fixtures.EngineProcessTests.prepared
    def start(self,body,progress=False):
        self.prepared();self.writer.get=self.get
        handle=engine.EngineProcess(self.writer,[sys.executable,'-B','-c',body],env=dict(os.environ,PYTHONPATH=str(Path(__file__).parent)),progress=progress,scope_limits=ScopeLimits(128*1024*1024,16))
        def cleanup():
            (self.writer.files.path/'release').touch()
            if handle.process.poll() is None:handle.process.terminate()
            handle.process.wait(timeout=10)
            deadline=time.monotonic()+10
            while handle.scope.state()['ActiveState'] not in ('inactive','failed'):
                if time.monotonic()>deadline:raise RuntimeError('Owned test scope still active')
                time.sleep(.02)
            if handle.progress is not None:handle.progress.stop()
            handle.scope.close_gate()
            if handle.owner_guard is not None:handle.owner_guard.stop()
        self.addCleanup(cleanup);return handle
    def finish(self,handle):
        self.assertEqual(handle.process.wait(timeout=10),0);deadline=time.monotonic()+5
        while True:
            try:return handle.confirm_exit()
            except engine.EngineStillRunning:
                if time.monotonic()>deadline:raise
                time.sleep(.02)
    def test_identity_is_retained_before_engine_and_channel_survives_exec(self):
        body="""
import json
from pathlib import Path
from model_engine_channel import inherited_progress_client
receipt=json.loads(Path('engine_process/scope-started.json').read_text())
assert receipt['scope']['bootstrap_pid']>0
guard=json.loads(Path('engine_process/owner-guard-started.json').read_text())
assert guard['guard']['schema']=='openplan.owner-guard.v1'
assert guard['guard']['owner_pid']>0
client=inherited_progress_client();client.progress('Scope identity retained before engine');client.stop()
Path('started').write_text(receipt['scope']['invocation_id'])
"""
        handle=self.start(body,progress=True)
        self.assertTrue((handle.directory/'owner-guard-started.json').is_file(),'Owner guard identity not retained')
        handle.progress.connection.settimeout(5);handle.progress.serve_one()
        receipt=self.finish(handle)
        self.assertTrue(receipt['scope']['observed_scope_empty']);self.assertIs(receipt['execution_ready'],False)
        self.assertEqual((self.writer.files.path/'started').read_text(),receipt['scope']['invocation_id'])
    def test_record_failure_never_executes_engine(self):
        self.prepared();marker=self.writer.files.path/'forbidden-engine';record=engine._record
        def fail(descriptor,name,payload):
            if name=='scope-started.json':
                deadline=time.monotonic()+2
                while not marker.exists() and time.monotonic()<deadline:time.sleep(.01)
                raise OSError('Synthetic retained scope record failure')
            return record(descriptor,name,payload)
        with patch.object(engine,'_record',side_effect=fail):
            with self.assertRaisesRegex(OSError,'retained scope record failure'):
                engine.EngineProcess(self.writer,[sys.executable,'-B','-c',"from pathlib import Path;Path('forbidden-engine').touch()"],env=dict(os.environ),scope_limits=ScopeLimits(128*1024*1024,16))
        self.assertFalse(marker.exists(),'Engine ran before scope identity was retained');self.assertTrue(self.writer.stopped)
        self.assertFalse((self.writer.files.path/'engine_process/scope-started.json').exists())
    def test_detached_descendant_prevents_exit_receipt(self):
        descendant="import time;from pathlib import Path;Path('ready').touch();end=time.monotonic()+15\nwhile not Path('release').exists() and time.monotonic()<end:time.sleep(.02)"
        body=f"import subprocess,sys,time;from pathlib import Path;subprocess.Popen([sys.executable,'-B','-c',{descendant!r}],start_new_session=True);end=time.monotonic()+5\nwhile not Path('ready').exists():\n if time.monotonic()>end:raise RuntimeError('No descendant readiness')\n time.sleep(.02)"
        handle=self.start(body);self.assertEqual(handle.process.wait(timeout=10),0)
        with self.assertRaisesRegex(engine.EngineStillRunning,'live descendants'):handle.confirm_exit()
        self.assertFalse((handle.directory/'observed-exit.json').exists());self.assertFalse(self.writer.stopped)
        (self.writer.files.path/'release').touch();self.assertTrue(self.finish(handle)['scope']['observed_scope_empty'])
    def test_scope_removal_race_is_retryable(self):
        handle=self.start('pass');handle.process.wait(timeout=10)
        state={'LoadState':'loaded','ActiveState':'active','InvocationID':handle.scope.identity['invocation_id'],'ControlGroup':handle.scope.identity['cgroup']}
        original_open=os.open
        def removed(path,*args,**kwargs):
            if str(path)=='/sys/fs/cgroup'+handle.scope.identity['cgroup']:raise FileNotFoundError('Scope just removed')
            return original_open(path,*args,**kwargs)
        with patch.object(handle.scope,'state',return_value=state), patch('model_engine_supervision.os.open',side_effect=removed):
            with self.assertRaisesRegex(engine.EngineStillRunning,'removal observation'):handle.confirm_exit()
        self.assertFalse(self.writer.stopped)
        self.assertFalse((handle.directory/'observed-exit.json').exists())
        self.assertTrue(self.finish(handle)['scope']['observed_scope_empty'])
    def test_nonzero_scoped_engine_stops_writer(self):
        handle=self.start('raise SystemExit(7)');self.assertEqual(handle.process.wait(timeout=10),7)
        deadline=time.monotonic()+5
        while True:
            try:
                with self.assertRaisesRegex(RuntimeError,'unsuccessfully'):handle.confirm_exit()
                break
            except engine.EngineStillRunning:
                if time.monotonic()>deadline:raise
                time.sleep(.02)
        self.assertTrue(self.writer.stopped)
        self.assertEqual(json.loads((handle.directory/'observed-exit.json').read_text())['returncode'],7)
    def test_changed_scope_identity_stops_writer(self):
        handle=self.start('pass');handle.process.wait(timeout=10)
        changed={'LoadState':'loaded','ActiveState':'active','InvocationID':'0'*32,'ControlGroup':handle.scope.identity['cgroup']}
        with patch.object(handle.scope,'state',return_value=changed):
            with self.assertRaisesRegex(ValueError,'scope identity changed'):handle.confirm_exit()
        self.assertTrue(self.writer.stopped);self.assertFalse((handle.directory/'observed-exit.json').exists())

    def test_owner_death_stops_independent_guard(self):
        with tempfile.TemporaryDirectory() as root:
            record=Path(root)/'guard.json'
            body="from model_engine_owner_guard import OwnerGuard;import json,sys,time;from pathlib import Path;g=OwnerGuard();Path(sys.argv[1]).write_text(json.dumps(g.identity));time.sleep(30)"
            owner=subprocess.Popen([sys.executable,'-B','-c',body,str(record)],env=dict(os.environ,PYTHONPATH=str(Path(__file__).parent)))
            try:
                deadline=time.monotonic()+5
                while not record.exists():
                    if owner.poll() is not None:self.fail('Owner failed before guard startup')
                    if time.monotonic()>deadline:self.fail('Guard startup timed out')
                    time.sleep(.02)
                identity=json.loads(record.read_text())
                owner.kill();owner.wait(timeout=5)
                deadline=time.monotonic()+5
                while True:
                    state=subprocess.run(['systemctl','--user','show',identity['unit'],'-p','ActiveState','--value'],capture_output=True,text=True,check=True).stdout.strip()
                    if state in ('inactive','failed'):break
                    if time.monotonic()>deadline:self.fail('Guard survived owner death')
                    time.sleep(.02)
            finally:
                if owner.poll() is None:owner.kill()
                owner.wait(timeout=5)

    def test_guard_loss_stops_busy_engine_and_detached_descendant(self):
        from model_engine_owner_guard import OwnerGuardUnavailable
        descendant="import time;from pathlib import Path;Path('guard-child-ready').touch();time.sleep(30)"
        body=f"import subprocess,sys,time;subprocess.Popen([sys.executable,'-B','-c',{descendant!r}],start_new_session=True);time.sleep(30)"
        handle=self.start(body)
        deadline=time.monotonic()+5
        while not (self.writer.files.path/'guard-child-ready').exists():
            if time.monotonic()>deadline:self.fail('Detached child did not start')
            time.sleep(.02)
        self.assertTrue(handle.owner_guard.process.poll() is None)
        handle.owner_guard.process.kill()
        handle.owner_guard.process.wait(timeout=5)
        self.assertEqual(handle.process.wait(timeout=5),-9)
        deadline=time.monotonic()+5
        while handle.scope.state()['ActiveState'] not in ('inactive','failed'):
            if time.monotonic()>deadline:self.fail('Engine scope survived guard loss')
            time.sleep(.02)
        self.assertTrue(handle.scope.require_empty()['observed_scope_empty'])
        with self.assertRaises(OwnerGuardUnavailable):handle.confirm_exit()
        self.assertTrue(self.writer.stopped)
        self.assertFalse((handle.directory/'observed-exit.json').exists())

    def test_live_guard_remains_until_detached_work_finishes(self):
        descendant="import time;from pathlib import Path;Path('ready').touch();end=time.monotonic()+15\nwhile not Path('release').exists() and time.monotonic()<end:time.sleep(.02)"
        body=f"import subprocess,sys;subprocess.Popen([sys.executable,'-B','-c',{descendant!r}],start_new_session=True)"
        handle=self.start(body)
        handle.process.wait(timeout=5)
        with self.assertRaises(engine.EngineStillRunning):handle.confirm_exit()
        handle.owner_guard.require_alive()
        (self.writer.files.path/'release').touch()
        self.finish(handle)
        self.assertIsNotNone(handle.owner_guard.process.poll())

if __name__=='__main__':unittest.main()
