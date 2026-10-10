"""Actual runtime launch and owner loss with a synthetic host command."""
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

WORKER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER))
from runtime import run_activitysim_runtime
from test_runtime import build_bundle
from host_supervision import ScopeLimits
from model_engine_supervision import inspect_saved_scope


def wait_for(check, timeout=10):
    deadline = time.monotonic() + timeout
    while not check():
        if time.monotonic() > deadline:
            raise AssertionError("Owned runtime readiness or exit timed out")
        time.sleep(.02)


class HostPolicyTests(unittest.TestCase):
    def test_partial_limits_and_container_backend_refused(self):
        for options in ({"host_tasks": 16}, {"host_memory_bytes": 134217728},
                        {"host_tasks": 16, "host_memory_bytes": 134217728, "container_image": "synthetic"}):
            with self.subTest(options=options), patch("runtime.resolve_bundle_paths", side_effect=AssertionError("Host policy reached bundle access")):
                with self.assertRaisesRegex(ValueError, "Host supervision"):
                    run_activitysim_runtime(**options)


@unittest.skipUnless(os.getenv("OPENPLAN_LIVE_ENGINE_SCOPE") == "1", "Requires owned live scope opt-in")
class HostRuntimeTests(unittest.TestCase):
    def exercise(self, kill_owner):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            bundle = build_bundle(root)
            (bundle / "configs/settings.yaml").write_text("models: []\n")
            cli = root / "cli.py"
            # Detached child demonstrates why waiting for the CLI alone is insufficient.
            child = "import time;from pathlib import Path;Path('child-ready').touch();end=time.monotonic()+15\nwhile not Path('child-release').exists() and time.monotonic()<end:time.sleep(.01)\nPath('child-output').touch()"
            cli.write_text("import subprocess,sys,time;from pathlib import Path\n"
                           f"subprocess.Popen([sys.executable,'-B','-c',{child!r}],start_new_session=True)\n"
                           "print('host command running',flush=True)\n"
                           "Path('command-ready').touch()\n"
                           "end=time.monotonic()+15\n"
                           "while not Path('release').exists() and time.monotonic()<end:time.sleep(.01)\n"
                           "Path('command-output').touch()\n")
            command = shlex.join([sys.executable, "-B", str(cli)])
            owner = subprocess.Popen([sys.executable, "-B", str(WORKER / "main.py"),
                                      "--bundle-path", str(bundle), "--runtime-dir", str(root / "runtime"),
                                      "--activitysim-cli-template", command,
                                      "--host-memory-bytes", "134217728", "--host-tasks", "16"],
                                     env=dict(os.environ, PYTHONPATH=str(WORKER)), stdout=subprocess.DEVNULL,
                                     stderr=subprocess.PIPE)
            records = root / "runtime/stages/030-run-activitysim/host_supervision"
            work = root / "runtime/workdir"
            identity = None
            try:
                wait_for(lambda: (work / "command-ready").exists() and (work / "child-ready").exists())
                identity = json.loads((records / "scope-started.json").read_text())
                self.assertTrue(inspect_saved_scope(identity["scope"])["scope_has_live_processes"])
                self.assertFalse((records / "observed-exit.json").exists())
                if kill_owner:
                    owner.kill()
                    owner.wait(timeout=5)
                    wait_for(lambda: inspect_saved_scope(identity["scope"])["scope_has_live_processes"] is False)
                    self.assertFalse((work / "command-output").exists())
                    self.assertFalse((work / "child-output").exists())
                    self.assertFalse((records / "observed-exit.json").exists())
                    self.assertFalse((root / "runtime/runtime_summary.json").exists())
                else:
                    (work / "release").touch()
                    wait_for(lambda: (work / "command-output").exists())
                    time.sleep(.2)
                    self.assertIsNone(owner.poll(), "Runtime completed while detached child remained live")
                    self.assertFalse((records / "observed-exit.json").exists())
                    (work / "child-release").touch()
                    self.assertEqual(owner.wait(timeout=10), 0, owner.stderr.read().decode())
                    receipt = json.loads((records / "observed-exit.json").read_text())
                    self.assertTrue(receipt["scope"]["observed_scope_empty"])
                    self.assertEqual(receipt["scientific_acceptance"], "unassessed")
                    self.assertTrue((work / "command-output").exists())
                    self.assertTrue((work / "child-output").exists())
                log = records.parent / "activitysim_stdout.log"
                self.assertIn("host command running", log.read_text())
            finally:
                if work.exists():
                    (work / "release").touch()
                    (work / "child-release").touch()
                if owner.poll() is None:
                    owner.kill()
                owner.wait(timeout=5)
                owner.stderr.close()
                if identity is not None:
                    wait_for(lambda: inspect_saved_scope(identity["scope"])["scope_has_live_processes"] is False, timeout=20)

    def test_owner_loss_stops_host_command_and_detached_child(self):
        self.exercise(True)

    def test_live_owner_completes_after_descendant_exit(self):
        self.exercise(False)
