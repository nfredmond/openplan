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
        (app / "retired.txt").write_text("removed by the next version\n")
        (self.origin / ".claude/skills").mkdir(parents=True)
        (self.origin / ".claude/skills/example.md").write_text("fixture skill\n")
        (self.origin / ".agents").mkdir()
        (self.origin / ".agents/skills").symlink_to("../.claude/skills")
        (self.origin / ".gitignore").write_text(".env.local\n.next/\nnode_modules/\n")
        self.git(self.origin, "add", ".")
        self.git(self.origin, "commit", "-qm", "Fixture predecessor")
        self.old_sha = self.git(self.origin, "rev-parse", "HEAD")
        self.instance = self.base / "instance"
        self.git(self.base, "clone", "--quiet", str(self.origin), str(self.instance))
        (self.instance / "openplan/.env.local").write_text(f"OPENPLAN_COMMIT_SHA={self.old_sha}\nEXERCISE_SETTING=retained\n")
        for name in (".next", "node_modules"):
            retained_runtime = self.instance / "openplan" / name
            retained_runtime.mkdir()
            (retained_runtime / "predecessor").write_text("original runtime bytes\n")
        (app / "version.txt").write_text("candidate\n")
        (app / "retired.txt").unlink()
        (app / "added.txt").write_text("new source\n")
        self.git(self.origin, "add", "openplan/added.txt")
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
if "ci" in sys.argv: pathlib.Path("node_modules").mkdir(exist_ok=True)
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
            if "stop" in args:
                self.assertEqual(args, ["systemctl", "--user", "stop", "isolated-test.service"])
                self.stop_server()
                return ""
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
        self.assertEqual(self.git(self.instance, "status", "--porcelain", "--untracked-files=no"), "")
        self.assertFalse((self.instance / "openplan/retired.txt").exists())
        self.assertEqual((self.instance / "openplan/added.txt").read_text(), "new source\n")
        self.assertTrue(self.updater.health_matches(self.new_sha))
        backup = Path(self.record()["backup"])
        self.assertEqual(self.git(backup, "rev-parse", "HEAD"), self.old_sha)
        self.assertIn("EXERCISE_SETTING=retained", (self.instance / "openplan/.env.local").read_text())
        self.updater.recover(self.record())
        self.assertTrue(self.updater.health_matches(self.old_sha))
        self.assertEqual(self.git(self.instance, "rev-parse", "HEAD"), self.old_sha)
        self.assertEqual(self.record()["phase"], "recovered")
        self.assertEqual(self.git(self.instance, "status", "--porcelain", "--untracked-files=no"), "")
        self.assertTrue((self.instance / "openplan/retired.txt").exists())
        self.assertFalse((self.instance / "openplan/added.txt").exists())
        for name in (".next", "node_modules"):
            self.assertEqual((self.instance / "openplan" / name / "predecessor").read_text(), "original runtime bytes\n")

    def test_tracked_symlink_survives_candidate_and_update(self):
        try:
            self.updater.update()
        except self.module.UpdateError as exc:
            self.fail(f"Tracked symbolic link prevented update: {exc}")
        candidate = Path(self.record()["candidate"])
        for root in (candidate, self.instance):
            self.assertTrue((root / ".agents/skills").is_symlink())
            self.assertEqual(str((root / ".agents/skills").readlink()), "../.claude/skills")
            self.assertEqual(self.git(root, "status", "--porcelain", "--untracked-files=no"), "")
        self.assertTrue(self.updater.health_matches(self.new_sha))

    def test_failed_build_keeps_a_durable_reason_and_log(self):
        (self.base / "fail-build").touch()
        with self.assertRaisesRegex(self.module.UpdateError, "Candidate preparation failed"):
            self.updater.update()
        record = self.record()
        self.assertIn("exit 7", record["error"])
        self.assertIn("Building", Path(record["log"]).read_text())
        self.assertIn("T", record["started_at"])
        self.assertTrue(self.updater.health_matches(self.old_sha))

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

    def test_interrupted_partial_promotion_recovers_and_retry_is_idempotent(self):
        def partial_install(record):
            first = "openplan/version.txt"
            self.updater.copy_file(Path(record["candidate"]) / first, self.instance / first)
            raise self.module.UpdateError("injected interruption after first source file")

        with patch.object(self.updater, "install", side_effect=partial_install), patch.object(self.updater, "recover", side_effect=SystemExit("simulate interrupted recovery")):
            with self.assertRaises(SystemExit):
                self.updater.update()
        self.assertEqual(self.record()["phase"], "promoting")
        self.updater.recover(self.record())
        self.assertTrue(self.updater.health_matches(self.old_sha))
        self.assertTrue(self.instance.is_dir())
        self.assertEqual((self.instance / "openplan/version.txt").read_text(), "predecessor\n")
        self.updater.recover(self.record())
        self.assertEqual(self.restart_count, 1, "duplicate recovery restarted an already recovered demo")

    def test_local_artifacts_written_during_and_after_build_stay_at_active_paths(self):
        original = self.module.shutil.copytree
        artifact = self.instance / "data/screening-runs/exercise/new-output.bin"
        inode = self.instance.stat().st_ino

        def copy(*args, **kwargs):
            result = original(*args, **kwargs)
            artifact.parent.mkdir(parents=True, exist_ok=True)
            artifact.write_bytes(b"written during candidate preparation")
            return result

        with patch.object(self.module.shutil, "copytree", side_effect=copy):
            self.updater.update()
        self.assertEqual(self.instance.stat().st_ino, inode, "active root was replaced")
        self.assertTrue(artifact.exists(), "a concurrent local artifact left the active path")
        self.assertEqual(artifact.read_bytes(), b"written during candidate preparation")
        artifact.write_bytes(b"updated after promotion")
        self.updater.recover(self.record())
        self.assertEqual(artifact.read_bytes(), b"updated after promotion")
        self.assertEqual(self.instance.stat().st_ino, inode)

    def test_new_tracked_source_cannot_replace_an_existing_local_file(self):
        local = self.instance / "openplan/added.txt"
        local.write_text("local work must remain\n")
        with (self.instance / ".git/info/exclude").open("a") as stream:
            stream.write("\nopenplan/added.txt\n")
        with self.assertRaisesRegex(self.module.UpdateError, "overwrite an existing local file"):
            self.updater.update()
        self.assertEqual(local.read_text(), "local work must remain\n")
        self.assertEqual(self.restart_count, 0)
        self.assertTrue(self.updater.health_matches(self.old_sha))

    def test_recovery_refuses_newer_settings_without_overwriting_them(self):
        self.updater.update()
        settings = self.instance / "openplan/.env.local"
        settings.write_text("EXERCISE_SETTING=newer local configuration\n")
        with self.assertRaisesRegex(self.module.UpdateError, "settings changed after preparation"):
            self.updater.recover(self.record())
        self.assertEqual(settings.read_text(), "EXERCISE_SETTING=newer local configuration\n")
        self.assertTrue(self.updater.health_matches(self.new_sha))

    def test_changed_recovery_source_refuses_before_stopping_the_demo(self):
        self.updater.update()
        backup = Path(self.record()["backup"])
        (backup / "openplan/version.txt").write_text("corrupted recovery source\n")
        with self.assertRaisesRegex(self.module.UpdateError, "Retained recovery source"):
            self.updater.recover(self.record())
        self.assertTrue(self.updater.health_matches(self.new_sha))
        self.assertEqual(self.restart_count, 1)

    def test_managed_settings_symlink_is_preserved_and_update_refused(self):
        settings = self.instance / "openplan/.env.local"
        managed = self.base / "managed-settings"
        settings.rename(managed)
        settings.symlink_to(managed)
        with self.assertRaisesRegex(self.module.UpdateError, "Managed settings symlinks"):
            self.updater.update()
        self.assertTrue(settings.is_symlink())
        self.assertEqual(settings.resolve(), managed)
        self.assertEqual(self.restart_count, 0)

    def test_file_mode_and_symlink_changes_restore_the_predecessor(self):
        version = self.origin / "openplan/version.txt"
        version.unlink()
        version.symlink_to("added.txt")
        (self.origin / "openplan/added.txt").chmod(0o755)
        self.git(self.origin, "commit", "-qam", "Fixture symlink and executable mode")
        self.new_sha = self.git(self.origin, "rev-parse", "HEAD")
        self.updater.update()
        installed = self.instance / "openplan/version.txt"
        self.assertTrue(installed.is_symlink())
        self.assertEqual(os.readlink(installed), "added.txt")
        self.assertTrue((self.instance / "openplan/added.txt").stat().st_mode & 0o111)
        self.updater.recover(self.record())
        self.assertFalse(installed.is_symlink())
        self.assertEqual(installed.read_text(), "predecessor\n")

    def test_source_paths_reject_escape_and_symlink_ancestors(self):
        alias = self.instance / "alias"
        alias.symlink_to(self.base, target_is_directory=True)
        for relative in ("../outside", "/tmp/outside", "alias/outside"):
            with self.subTest(relative=relative), self.assertRaises(self.module.UpdateError):
                self.updater.source_path(self.instance, relative)


def prove_mutations():
    source = SOURCE.read_text()
    cases = [
        ("comment", "# Persist all owned paths", "# Retain all owned paths", None, True),
        ("tracked links flattened", "symlinks=True, ignore=ignore", "symlinks=False, ignore=ignore", "test_tracked_symlink_survives_candidate_and_update", False),
        ("failure reason discarded", 'record["error"] = str(exc)', 'record["error"] = ""', "test_failed_build_keeps_a_durable_reason_and_log", False),

        ("foreign target", 'if Path(configured).absolute() != self.instance / "openplan":', 'if False:', "test_foreign_service_target_refuses_before_preparation", False),
        ("unverified predecessor", 'if not self.health_matches(previous):', 'if False:', "test_unverified_current_identity_refuses_before_preparation", False),
        ("failed build promoted", 'if code:\n                raise UpdateError(f"Candidate preparation', 'if False:\n                raise UpdateError(f"Candidate preparation', "test_failed_build_keeps_running_predecessor", False),
        ("rollback omitted", 'except BaseException:\n            self.recover(record)\n            raise', 'except BaseException:\n            pass\n            raise', "test_failed_restart_restores_previous_and_preserves_failed_candidate", False),
        ("backup identity ignored", 'if command(["git", "rev-parse", "HEAD"], backup) != record["previous_sha"]:', 'if False:', "test_retained_predecessor_identity_must_match", False),
        ("settings conflict ignored", 'or current_settings_hash != settings_hash', 'or False', "test_changed_settings_during_build_refuse_promotion", False),
        ("local artifact detached", 'backup = Path(record["backup"])\n        command(["systemctl", "--user", "stop", self.service])', 'backup = Path(record["backup"])\n        if (self.instance / "data").exists():\n            (self.instance / "data").rename(backup / "detached-data")\n        command(["systemctl", "--user", "stop", self.service])', "test_local_artifacts_written_during_and_after_build_stay_at_active_paths", False),
        ("local file collision ignored", 'if relative != "openplan/.env.local" and relative not in old_paths and before is not None:', 'if False:', "test_new_tracked_source_cannot_replace_an_existing_local_file", False),
        ("managed settings flattened", 'if settings.is_symlink():', 'if False:', "test_managed_settings_symlink_is_preserved_and_update_refused", False),
        ("retained file corruption ignored", 'if self.fingerprint(self.source_path(backup, entry["path"])) != entry["before"]:', 'if False:', "test_changed_recovery_source_refuses_before_stopping_the_demo", False),
        ("newer settings overwritten", 'if self.fingerprint(current) not in (entry["before"], entry["after"]):', 'if False:', "test_recovery_refuses_newer_settings_without_overwriting_them", False),
        ("symlink ancestor followed", 'if parent.is_symlink() or (parent.exists() and not parent.is_dir()):', 'if False:', "test_source_paths_reject_escape_and_symlink_ancestors", False),
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
