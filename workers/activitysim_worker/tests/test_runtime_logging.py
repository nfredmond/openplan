"""Live log persistence and bounded tail memory, separate from process supervision."""
import json,os,select,shlex,subprocess,sys,tempfile,time,tracemalloc,unittest
from pathlib import Path

WORKER=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(WORKER))
from runtime import _tail_text
from test_runtime import build_bundle

class RuntimeLoggingTests(unittest.TestCase):
    def test_large_log_tail_has_bounded_python_memory(self):
        with tempfile.TemporaryDirectory() as root:
            path=Path(root)/'large.log'
            path.write_bytes(b'old log line\n'*700000+b'last line\n')
            tracemalloc.start()
            try:
                result=_tail_text(path,4000)
                _,peak=tracemalloc.get_traced_memory()
            finally:tracemalloc.stop()
            self.assertEqual(len(result),4000)
            self.assertTrue(result.endswith('last line\n'))
            self.assertLess(peak,256*1024,'Reading a tail allocated the whole log')

    def test_tail_preserves_unicode_and_empty_file_behavior(self):
        with tempfile.TemporaryDirectory() as root:
            path=Path(root)/'log'
            self.assertIsNone(_tail_text(path))
            path.touch();self.assertIsNone(_tail_text(path))
            value=('Aé界🙂'*3000)+'final\n';path.write_text(value)
            self.assertEqual(_tail_text(path,2001),value[-2001:])

    def test_invalid_tail_limit_is_refused(self):
        with tempfile.TemporaryDirectory() as root:
            path=Path(root)/'log';path.write_text('log')
            for value in (0,-1,True,1.5):
                with self.subTest(value=value),self.assertRaises(ValueError):_tail_text(path,value)

    @unittest.skipUnless(sys.platform=='linux' and hasattr(os,'pidfd_open'),'Requires Linux pidfd for owned child cleanup')
    def test_command_log_survives_runtime_owner_loss(self):
        with tempfile.TemporaryDirectory() as root:
            root=Path(root);bundle=build_bundle(root)
            (bundle/'configs/settings.yaml').write_text('models: []\n')
            cli=root/'cli.py'
            cli.write_text("import os,sys,time;from pathlib import Path\nr=Path(sys.argv[1]);print('stdout before exit',flush=True);print('stderr before exit',file=sys.stderr,flush=True);(r/'ready').write_text(str(os.getpid()));end=time.monotonic()+20\nwhile not (r/'release').exists() and time.monotonic()<end:time.sleep(.01)\n")
            template=shlex.join([sys.executable,'-u',str(cli),str(root)])
            code="from runtime import run_activitysim_runtime;import sys;run_activitysim_runtime(bundle_path=sys.argv[1],runtime_dir=sys.argv[2],cli_template=sys.argv[3])"
            owner=subprocess.Popen([sys.executable,'-B','-c',code,str(bundle),str(root/'runtime'),template],
                env=dict(os.environ,PYTHONPATH=str(WORKER)),stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
            child_fd=None
            try:
                deadline=time.monotonic()+5
                while not (root/'ready').exists():
                    if owner.poll() is not None:self.fail('Runtime exited before command readiness')
                    if time.monotonic()>deadline:self.fail('Command readiness deadline exceeded')
                    time.sleep(.01)
                child_fd=os.pidfd_open(int((root/'ready').read_text()))
                log=root/'runtime/stages/030-run-activitysim/activitysim_stdout.log'
                self.assertTrue(log.exists(),'Runtime buffered command output instead of retaining its log')
                self.assertEqual(log.read_text(),'stdout before exit\nstderr before exit\n')
                owner.kill();owner.wait(timeout=5)
                self.assertEqual(log.read_text(),'stdout before exit\nstderr before exit\n')
                self.assertFalse((root/'runtime/runtime_summary.json').exists())
            finally:
                (root/'release').touch()
                if child_fd is not None:
                    self.assertTrue(select.select([child_fd],[],[],5)[0],'Owned synthetic command did not exit')
                    os.close(child_fd)
                if owner.poll() is None:owner.wait(timeout=5)
                if owner.stderr is not None:owner.stderr.close()

if __name__=='__main__':unittest.main()
