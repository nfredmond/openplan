"""Actual POSIX process descendants, synthetic files, no models or services."""
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from workers.county_onramp_worker import main as worker


@unittest.skipUnless(os.name == "posix", "worker requires POSIX process groups")
class CancellationTests(unittest.TestCase):
    def test_group_termination_stops_inherited_pipe_holder_and_releases_queue(self):
        for ignore, close_pipes in ((False, False), (True, False), (True, True)):
            with self.subTest(ignore=ignore, close_pipes=close_pipes), tempfile.TemporaryDirectory() as temp:
                root = Path(temp); ready = root / "ready"; marker = root / "late"
                child = root / "child.py"; parent = root / "parent.py"
                child.write_text("import os,signal,time\nfrom pathlib import Path\n" +
                    ("signal.signal(signal.SIGTERM,signal.SIG_IGN)\n" if ignore else "") +
                    ("os.close(1); os.close(2)\n" if close_pipes else "") +
                    f"Path({str(ready)!r}).write_text('ready')\ntime.sleep(0.8)\nPath({str(marker)!r}).write_text('late')\n")
                parent.write_text(f"import subprocess,sys\nsubprocess.run([sys.executable,{str(child)!r}],check=True)\n")
                process = subprocess.Popen([sys.executable, str(parent)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
                unrelated = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(10)"], start_new_session=True)
                try:
                    deadline = time.monotonic() + 5
                    while not ready.exists() and time.monotonic() < deadline:
                        time.sleep(.01)
                    self.assertTrue(ready.exists(), "synthetic child readiness")
                    started = time.monotonic()
                    with patch.object(worker, "CANCEL_GRACE_SECONDS", .10):
                        worker._stop_owned_process_group(process)
                    self.assertLess(time.monotonic() - started, .6, "cancellation waited for surviving descendant")
                    time.sleep(.85)
                    self.assertFalse(marker.exists(), "cancelled descendant wrote output")
                    self.assertIsNone(unrelated.poll(), "cancellation stopped an unrelated process")
                    # Actual helper returned, so a single execution slot can run its next job.
                    next_job = subprocess.run([sys.executable, "-c", "print('next')"], capture_output=True, text=True, timeout=2)
                    self.assertEqual(next_job.stdout.strip(), "next")
                finally:
                    for owned in (process, unrelated):
                        if owned.returncode is None:
                            try: os.killpg(owned.pid, signal.SIGKILL)
                            except ProcessLookupError: pass
                        owned.communicate(timeout=2)

    def test_job_launch_owns_a_new_session(self):
        # Inspect the real orchestration call while avoiding a second process suite.
        captured = {}
        class Process:
            returncode = 0
            def __init__(self, *args, **kwargs): captured.update(kwargs)
            def communicate(self, timeout=None): return "", ""
        with tempfile.TemporaryDirectory() as temp:
            manifest = Path(temp) / "manifest.json"; manifest.write_text("{}")
            job = {"jobId": "synthetic-session"}
            worker._jobs[job["jobId"]] = {"cancelEvent": threading.Event()}
            try:
                with patch.object(worker, "_build_bootstrap_command", return_value=(["synthetic"], manifest)), patch.object(worker, "_post_callback"), patch.object(worker.subprocess, "Popen", Process):
                    worker._run_job(job)
                self.assertIs(captured.get("start_new_session"), True)
            finally: worker._jobs.pop(job["jobId"], None)


if __name__ == "__main__": unittest.main()
