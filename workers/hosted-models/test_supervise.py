"""Exercise real child exits and operator signals without model-engine installs."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class SupervisorTest(unittest.TestCase):
    def run_host(self, root, shutdown=False):
        source = Path(__file__).with_name("supervise.py")
        script = f"""import importlib.util, os, signal, threading
spec=importlib.util.spec_from_file_location('host', {str(source.resolve())!r})
host=importlib.util.module_from_spec(spec);spec.loader.exec_module(host)
if {shutdown!r}: threading.Timer(0.6, lambda: os.kill(os.getpid(),signal.SIGTERM)).start()
raise SystemExit(host.supervise([([{sys.executable!r},'first.py'],{str(root)!r}),([{sys.executable!r},'second.py'],{str(root)!r})],grace_seconds=1))
"""
        return subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, timeout=5)

    def test_unexpected_zero_exit_fails_and_stops_sibling(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root/"first.py").write_text("import time;time.sleep(0.5)\n")
            (root/"second.py").write_text("import signal,time\nfrom pathlib import Path\ndef stop(*args):\n Path('stopped').write_text('yes');raise SystemExit(0)\nsignal.signal(signal.SIGTERM,stop)\nwhile True:time.sleep(0.1)\n")
            result = self.run_host(root)
            self.assertEqual(result.returncode, 1, "an unexpected zero exit must fail the model host")
            self.assertEqual((root/"stopped").read_text(), "yes")

    def test_operator_shutdown_is_successful(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("first.py", "second.py"):
                (root/name).write_text("import time\nwhile True:time.sleep(0.1)\n")
            self.assertEqual(self.run_host(root, shutdown=True).returncode, 0)


if __name__ == "__main__": unittest.main()
