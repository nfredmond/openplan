#!/usr/bin/env python3
"""Update/recovery integration with real Git, files and disposable HTTP services.

npm and the service manager are isolated fixtures. This does not compile Next,
query a database or operate any installed systemd service.
"""
import importlib.util
import fcntl
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

OPS = Path(__file__).resolve().parents[1]
SOURCE = OPS / "safe-refresh-walkthrough.py"


class SafeRefreshTests(unittest.TestCase):
    def setUp(self):
        self.temp = self.enterContext(tempfile.TemporaryDirectory(prefix="openplan-update-exercise-"))
        self.base = Path(self.temp)
        ops = self.base / "ops"
        ops.mkdir()
        target = ops / SOURCE.name
        target.write_text(Path(os.environ.get("SAFE_REFRESH_TEST_SOURCE", SOURCE)).read_text())
        shutil.copy2(OPS / "refresh-walkthrough-instance.sh", ops)
        spec = importlib.util.spec_from_file_location("safe_refresh_test", target)
        self.module = importlib.util.module_from_spec(spec)
        exec(compile(target.read_text(), str(target), "exec"), self.module.__dict__)
        self.origin = self.base / "origin"
        self.origin.mkdir()
        self.git(self.origin, "init", "-b", "main")
        self.git(self.origin, "config", "user.name", "Isolated test")
        self.git(self.origin, "config", "user.email", "test@example.invalid")
        app = self.origin / "openplan"
        migrations = app / "supabase/migrations"
        migrations.mkdir(parents=True)
        (migrations / "20260101000000_fixture.sql").write_text("-- never applied\n")
        (app / "version.txt").write_text("predecessor\n")
        (self.origin / ".gitignore").write_text(".env.local\n.next/\nnode_modules/\n")
        self.git(self.origin, "add", ".")
        self.git(self.origin, "commit", "-qm", "Fixture predecessor")
        self.old_sha = self.git(self.origin, "rev-parse", "HEAD")
        self.instance = self.base / "instance"
        self.git(self.base, "clone", "--quiet", str(self.origin), str(self.instance))
        (self.instance / "openplan/.env.local").write_text(f"OPENPLAN_COMMIT_SHA={self.old_sha}\nEXERCISE_SETTING=retained\n")
        (app / "version.txt").write_text("candidate\n")
        self.git(self.origin, "commit", "-qam", "Fixture candidate")
        self.new_sha = self.git(self.origin, "rev-parse", "HEAD")
        bindir = self.base / "bin"
        bindir.mkdir()
        npm = bindir / "npm"
        npm.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
if "migration" in sys.argv:
 print(json.dumps({"migrations":[{"local":"20260101000000","remote":"20260101000000"}]}))
if "build" in sys.argv:
 if pathlib.Path(os.environ["EXERCISE_BUILD_FAILURE"]).exists(): sys.exit(7)
 pathlib.Path(".next").mkdir(exist_ok=True)
 pathlib.Path(".next/fixture").write_text("built")
''')
        npm.chmod(0o700)
        self.enterContext(patch.dict(os.environ, {"PATH": str(bindir) + os.pathsep + os.environ["PATH"], "EXERCISE_BUILD_FAILURE": str(self.base / "fail-build")}))
        self.server_file = self.base / "server.py"
        self.server_file.write_text('''import http.server,json,sys
class Handler(http.server.BaseHTTPRequestHandler):
 def do_GET(self):
  self.send_response(200); self.end_headers()
  self.wfile.write(json.dumps({"deployment":{"commit":sys.argv[2][:12]}}).encode())
 def log_message(self,*args): pass
class Server(http.server.HTTPServer): allow_reuse_address=True
Server(("127.0.0.1",int(sys.argv[1])),Handler).serve_forever()
''')
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            self.port = sock.getsockname()[1]
        self.server = None
        self.addCleanup(self.stop_server)
        self.restart_count = 0
        self.fail_restart = False
        self.wrong_target = False
        self.updater = self.module.DemoUpdate(self.instance, "isolated-test.service", f"http://127.0.0.1:{self.port}")
        real_command = self.module.command

        def command(args, cwd=None):
            if args[0] != "systemctl":
                return real_command(args, cwd)
            if "show" in args:
                return str(self.base / "foreign" if self.wrong_target else self.instance / "openplan")
            self.assertEqual(args, ["systemctl", "--user", "restart", "isolated-test.service"])
            self.restart_count += 1
            if self.fail_restart:
                self.fail_restart = False
                raise self.module.UpdateError("Injected restart failure")
            self.start_server(self.git(self.instance, "rev-parse", "HEAD"))
            return ""

        self.enterContext(patch.object(self.module, "command", side_effect=command))
        self.start_server(self.old_sha)

    def git(self, directory, *args):
        result = subprocess.run(["git", "-C", str(directory), *args], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def stop_server(self):
        if self.server is not None:
            self.server.terminate()
            self.server.wait(timeout=5)
            self.server = None

    def start_server(self, sha):
        self.stop_server()
        self.server = subprocess.Popen([sys.executable, str(self.server_file), str(self.port), sha], cwd=self.instance, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(50):
            if self.updater.health_matches(sha):
                return
            time.sleep(0.02)
        self.fail("isolated HTTP server did not become ready")

    def record(self):
        return json.loads(self.updater.receipt.read_text())

    def test_prepare_promote_and_manual_recover(self):
        self.updater.update()
        self.assertEqual(self.record()["phase"], "ready")
        self.assertTrue(self.updater.health_matches(self.new_sha))
        backup = Path(self.record()["backup"])
        self.assertEqual(self.git(backup, "rev-parse", "HEAD"), self.old_sha)
        self.assertIn("EXERCISE_SETTING=retained", (self.instance / "openplan/.env.local").read_text())
        self.updater.recover(self.record())
        self.assertTrue(self.updater.health_matches(self.old_sha))
        self.assertEqual(self.git(self.instance, "rev-parse", "HEAD"), self.old_sha)
        self.assertEqual(self.record()["phase"], "recovered")

    def test_failed_build_keeps_running_predecessor(self):
        (self.base / "fail-build").touch()
        with self.assertRaisesRegex(self.module.UpdateError, "preparation failed"):
            self.updater.update()
        self.assertEqual(self.restart_count, 0)
        self.assertEqual(self.git(self.instance, "rev-parse", "HEAD"), self.old_sha)
        self.assertTrue(self.updater.health_matches(self.old_sha))
        self.assertEqual(self.record()["phase"], "preparation_failed")

    def test_failed_restart_restores_previous_and_preserves_failed_candidate(self):
        self.fail_restart = True
        with self.assertRaisesRegex(self.module.UpdateError, "Injected restart failure"):
            self.updater.update()
        self.assertTrue(self.updater.health_matches(self.old_sha))
        self.assertEqual(self.record()["phase"], "recovered")
        self.assertEqual(self.restart_count, 2)
        self.assertEqual(len(list(Path(self.record()["backup"]).parent.glob("displaced-*"))), 1)

    def test_foreign_service_target_refuses_before_preparation(self):
        self.wrong_target = True
        with self.assertRaisesRegex(self.module.UpdateError, "working directory"):
            self.updater.update()
        self.assertEqual(self.restart_count, 0)
        self.assertFalse(self.updater.receipt.exists())

    def test_unverified_current_identity_refuses_before_preparation(self):
        self.start_server("b" * 40)
        with self.assertRaisesRegex(self.module.UpdateError, "identity is unverified"):
            self.updater.update()
        self.assertEqual(self.restart_count, 0)
        self.assertFalse(self.updater.receipt.exists())

    def test_changed_settings_during_build_refuse_promotion(self):
        original = self.module.shutil.copytree

        def copy(*args, **kwargs):
            result = original(*args, **kwargs)
            (self.instance / "openplan/.env.local").write_text("EXERCISE_SETTING=changed\n")
            return result

        with patch.object(self.module.shutil, "copytree", side_effect=copy):
            with self.assertRaisesRegex(self.module.UpdateError, "changed during preparation"):
                self.updater.update()
        self.assertEqual(self.restart_count, 0)
        self.assertIn("changed", (self.instance / "openplan/.env.local").read_text())

    def test_retained_predecessor_identity_must_match(self):
        self.updater.update()
        record = self.record()
        record["previous_sha"] = "b" * 40
        with self.assertRaisesRegex(self.module.UpdateError, "predecessor identity changed"):
            self.updater.recover(record)
        self.assertTrue(self.updater.health_matches(self.new_sha))

    def test_interrupted_update_blocks_another_update(self):
        self.updater.save({"phase": "promoting"})
        with self.assertRaisesRegex(self.module.UpdateError, "interrupted update"):
            self.updater.update()
        self.assertEqual(self.restart_count, 0)

    def test_concurrent_command_refuses_under_held_lock(self):
        with (self.updater.state / "update.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = subprocess.run([sys.executable, "-B", self.module.__file__, str(self.instance)], capture_output=True, text=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Resource temporarily unavailable", result.stderr)
        self.assertFalse(self.updater.receipt.exists())

    def test_interrupted_promotion_recovers_when_instance_path_is_absent(self):
        transaction = self.updater.state / "interrupted"
        transaction.mkdir()
        backup = transaction / "previous"
        self.instance.rename(backup)
        record = {"instance": str(self.instance), "service": self.updater.service, "url": self.updater.url,
                  "backup": str(backup), "previous_sha": self.old_sha, "phase": "promoting"}
        self.updater.save(record)
        self.updater.recover(record)
        self.assertTrue(self.updater.health_matches(self.old_sha))
        self.assertTrue(self.instance.is_dir())
        self.updater.recover(self.record())
        self.assertEqual(self.restart_count, 1, "duplicate recovery restarted an already recovered demo")


def prove_mutations():
    source = SOURCE.read_text()
    cases = [
        ("comment", "# Persist the recovery paths", "# Retain the recovery paths", None, True),
        ("foreign target", 'if Path(configured).absolute() != self.instance / "openplan":', 'if False:', "test_foreign_service_target_refuses_before_preparation", False),
        ("unverified predecessor", 'if not self.health_matches(previous):', 'if False:', "test_unverified_current_identity_refuses_before_preparation", False),
        ("failed build promoted", 'if result.returncode:\n                raise UpdateError(f"Candidate preparation', 'if False:\n                raise UpdateError(f"Candidate preparation', "test_failed_build_keeps_running_predecessor", False),
        ("rollback omitted", 'if backup.exists():\n                self.recover(record)', 'if False:\n                self.recover(record)', "test_failed_restart_restores_previous_and_preserves_failed_candidate", False),
        ("backup identity ignored", 'if command(["git", "rev-parse", "HEAD"], backup) != record["previous_sha"]:', 'if False:', "test_retained_predecessor_identity_must_match", False),
        ("settings conflict ignored", 'or current_settings_hash != settings_hash', 'or False', "test_changed_settings_during_build_refuse_promotion", False),
        ("interruption ignored", 'if prior["phase"] not in ("ready", "recovered", "preparation_failed"):', 'if False:', "test_interrupted_update_blocks_another_update", False),
        ("lock omitted", 'fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)', 'pass  # lock removed', "test_concurrent_command_refuses_under_held_lock", False),
    ]
    with tempfile.TemporaryDirectory(prefix="openplan-safe-refresh-mutations-") as temp:
        for label, old, new, test, expected in cases:
            assert source.count(old) == 1, label
            mutant = Path(temp) / "updater.py"
            mutant.write_text(source.replace(old, new))
            args = [sys.executable, "-B", __file__]
            if test:
                args.append("SafeRefreshTests." + test)
            result = subprocess.run(args, env={**os.environ, "SAFE_REFRESH_TEST_SOURCE": str(mutant), "PYTHONDONTWRITEBYTECODE": "1"}, capture_output=True, text=True, timeout=45)
            survived = result.returncode == 0
            print(f"{label}: {'SURVIVED' if survived else 'KILLED'}", flush=True)
            if not survived:
                print(result.stderr, flush=True)
                assert "AssertionError" in result.stderr and "FAILED (" in result.stderr
            assert survived == expected, label


if __name__ == "__main__":
    if sys.argv[1:] == ["--prove-mutations"]:
        prove_mutations()
    else:
        unittest.main()
