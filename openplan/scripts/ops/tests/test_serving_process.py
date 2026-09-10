#!/usr/bin/env python3
"""Process fixtures distinguish next dev from an unstamped built listener."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / "serving-process.py"
spec = importlib.util.spec_from_file_location("serving_process", SOURCE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ServingProcessTests(unittest.TestCase):
    def test_only_exact_local_hosts_supply_a_port(self):
        for url, expected in [("http://localhost:3277", 3277), ("http://127.0.0.1", 80),
                              ("https://[::1]", 443), ("http://localhost.evil:3277", None),
                              ("https://remote/127.0.0.1:3277", None), ("http://localhost:bad", None)]:
            with self.subTest(url=url):
                self.assertEqual(module.local_port(url), expected)

    def fixture(self, root, pid, parent, cwd, args):
        proc = root / str(pid)
        proc.mkdir()
        (proc / "cwd").symlink_to(cwd, target_is_directory=True)
        fields = ["S", str(parent)] + ["0"] * 17 + ["12345"]
        (proc / "stat").write_text(f"{pid} (next-server (fixture)) " + " ".join(fields))
        (proc / "cmdline").write_bytes(b"\0".join(arg.encode() for arg in args) + b"\0")

    def test_dev_launch_is_required_even_when_directory_matches(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            app = root / "app"
            app.mkdir()
            for command, expected in [("dev", True), ("start", False)]:
                with self.subTest(command=command):
                    proc = root / command
                    proc.mkdir()
                    self.fixture(proc, 101, 100, app, ["next-server (v16)"])
                    self.fixture(proc, 100, 1, app, ["/usr/bin/node", str(app / "node_modules/next/dist/bin/next"), command])
                    self.assertEqual(module.describe_listener(101, proc), {"directory": str(app), "nextDev": expected})

    def test_word_dev_or_another_next_install_does_not_prove_dev(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            app = root / "app"
            app.mkdir()
            for index, args in enumerate([
                ["node", "/another/app/node_modules/next/dist/bin/next", "dev"],
                ["node", str(app / "node_modules/next/dist/bin/next"), "start", "dev"],
                ["bash", "-c", "next dev"],
            ]):
                proc = root / str(index)
                proc.mkdir()
                self.fixture(proc, 101, 1, app, args)
                self.assertFalse(module.describe_listener(101, proc)["nextDev"])

    def test_disappeared_or_reused_listener_is_unknown(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            self.assertEqual(module.describe_listener(101, root), {})
            app = root / "app"
            app.mkdir()
            self.fixture(root, 101, 1, app, ["next-server"])
            with patch.object(module, "process_state", side_effect=[(1, "old"), (1, "old"), (1, "new")]):
                self.assertEqual(module.describe_listener(101, root), {})

    def test_multiple_listeners_refuse_ambiguous_provenance(self):
        with patch.object(module.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, 'users:(("node",pid=10,fd=3)) users:(("node",pid=11,fd=4))')):
            with patch.object(module, "describe_listener") as describe:
                self.assertEqual(module.identify("http://127.0.0.1:3277"), {})
                describe.assert_not_called()
        with patch.object(module.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, 'users:(("node",pid=10,fd=3))')):
            with patch.object(module, "describe_listener", return_value={"directory": "/owned", "nextDev": False}) as describe:
                self.assertEqual(module.identify("http://127.0.0.1:3277")["directory"], "/owned")
                describe.assert_called_once_with(10)


if __name__ == "__main__":
    unittest.main()
