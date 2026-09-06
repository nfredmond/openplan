#!/usr/bin/env python3
"""Exercise start/stop against disposable HTTP services on ephemeral ports.

No application server, database, existing listener or desktop browser is used.
This proves Linux ownership behavior, not OpenPlan application readiness.
"""
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
import types
import unittest
from unittest.mock import Mock, patch

SOURCE = Path(__file__).resolve().parents[1] / "openplan-control-panel.py"
sys.path.insert(0, str(SOURCE.parent))
tk_stub = types.ModuleType("tkinter")
tk_stub.scrolledtext = types.SimpleNamespace()
tk_stub.ttk = types.SimpleNamespace()
sys.modules["tkinter"] = tk_stub
panel = types.ModuleType("process_panel")
panel.__file__ = str(SOURCE)
sys.modules[panel.__name__] = panel
exec(compile(Path(os.environ.get("CONTROL_PANEL_TEST_SOURCE", SOURCE)).read_text(), str(SOURCE), "exec"), panel.__dict__)


class ProcessTests(unittest.TestCase):
    def test_owned_start_stop_restart_and_foreign_refusal(self):
        with tempfile.TemporaryDirectory(prefix="openplan-process-exercise-") as temp:
            app = Path(temp)
            (app / "package.json").write_text(json.dumps({"scripts": {"dev": "python3 server.py"}}))
            (app / "server.py").write_text('''import http.server, json, sys
class Handler(http.server.BaseHTTPRequestHandler):
 def do_GET(self):
  self.send_response(200); self.end_headers()
  self.wfile.write(json.dumps({"deployment":{"commit":"fixture-only"}}).encode())
 def log_message(self,*args): pass
http.server.HTTPServer(("127.0.0.1", int(sys.argv[-1])), Handler).serve_forever()
''')
            with socket.socket() as sock:
                sock.bind(("127.0.0.1", 0))
                port = sock.getsockname()[1]
            obj = panel.ControlPanel.__new__(panel.ControlPanel)
            obj.dev_proc = obj.dev_owner = None
            obj.root = Mock()
            obj.root.after.side_effect = lambda delay, fn: fn()
            obj._open_in_chrome = Mock()
            obj.say = Mock()
            obj._work = lambda label, fn: fn()
            created = []
            real_popen = subprocess.Popen

            def launch(*args, **kwargs):
                proc = real_popen(*args, **kwargs)
                if kwargs.get("start_new_session"):
                    created.append(proc)
                return proc

            try:
                with patch.object(panel, "APP_DIR", app), patch.object(panel, "DEV_LOG", app / "dev.log"), \
                     patch.object(panel, "DEV_PORT", port), patch.object(panel, "DEV_URL", f"http://127.0.0.1:{port}"), \
                     patch.object(panel.subprocess, "Popen", side_effect=launch):
                    # Stop, restart and stop again using the real controller paths.
                    for _ in range(2):
                        obj.start_dev()
                        self.assertTrue(panel.owned_session_alive(obj.dev_proc, obj.dev_owner))
                        self.assertEqual(panel.http_health(panel.DEV_URL)["commit"], "fixture-only")
                        self.assertEqual(Path(panel.port_owner_dir(port)), app)
                        obj.stop_dev()
                        # The HTTP child can close before npm exits after TERM.
                        self.wait_for(lambda: panel.port_in_use(port) is False
                                      and not panel.owned_session_alive(obj.dev_proc, obj.dev_owner))
                        self.assertFalse(panel.owned_session_alive(obj.dev_proc, obj.dev_owner))
                    self.assertEqual(obj._open_in_chrome.call_count, 2)
                    foreign = launch([sys.executable, str(app / "server.py"), str(port)], cwd=app, start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    self.wait_for(lambda: panel.http_health(panel.DEV_URL) is not None)
                    count = len(created)
                    obj.start_dev()
                    obj.stop_dev()
                    self.assertEqual(len(created), count, "occupied port launched another process")
                    self.assertIsNone(foreign.poll(), "controller stopped a service it did not own")
                    self.assertIsNotNone(panel.http_health(panel.DEV_URL))
            finally:
                # Every process group here was started by this exercise.
                for proc in created:
                    if proc.poll() is None:
                        os.killpg(proc.pid, signal.SIGTERM)
                    proc.wait(timeout=5)

    def wait_for(self, predicate):
        for _ in range(50):
            if predicate():
                return
            time.sleep(0.1)
        self.fail("isolated service did not reach the requested state")


if __name__ == "__main__":
    unittest.main()
