#!/usr/bin/env python3
"""Controller and refresh regressions. All process/network effects use fakes."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

OPS = Path(__file__).resolve().parents[1]
SOURCE = OPS / "openplan-control-panel.py"
sys.path.insert(0, str(OPS))
# CI's Python need not have Tk installed. These tests exercise controller calls,
# not native rendering; every widget is deliberately inert.
tk_stub = types.ModuleType("tkinter")
tk_stub.Toplevel = Mock()
tk_stub.Label = Mock()
tk_stub.TclError = RuntimeError
tk_stub.ttk = types.SimpleNamespace(Frame=Mock(), Button=Mock())
tk_stub.scrolledtext = types.SimpleNamespace()
sys.modules["tkinter"] = tk_stub
panel = types.ModuleType("control_panel_under_test")
panel.__file__ = str(SOURCE)
sys.modules[panel.__name__] = panel
# Compile source explicitly so mutation tests never reuse stale Python bytecode.
source = Path(os.environ.get("CONTROL_PANEL_TEST_SOURCE", SOURCE)).read_text()
exec(compile(source, str(SOURCE), "exec"), panel.__dict__)


class ControllerTests(unittest.TestCase):
    def setUp(self):
        temp = self.enterContext(tempfile.TemporaryDirectory(prefix="openplan-controller-test-"))
        self.enterContext(patch.object(panel, "LOG_DIR", Path(temp)))
        self.enterContext(patch.object(panel, "DEV_LOG", Path(temp) / "dev-server.log"))
        self.enterContext(patch.object(panel.Path, "iterdir", side_effect=AssertionError("live process inventory forbidden")))
        # A missed fake must fail rather than signal a real process or launch a command.
        for name in ("kill", "killpg", "pidfd_open"):
            self.enterContext(patch.object(panel.os, name, side_effect=AssertionError("live signal forbidden")))
        self.enterContext(patch.object(panel.signal, "pidfd_send_signal", side_effect=AssertionError("live signal forbidden")))
        self.enterContext(patch.object(panel.subprocess, "Popen", side_effect=AssertionError("live process forbidden")))
        self.enterContext(patch.object(panel, "run_quiet", side_effect=AssertionError("live command forbidden")))
        self.enterContext(patch.object(panel, "http_health", side_effect=AssertionError("live HTTP forbidden")))
        self.owner = panel.ProcessIdentity(12001, 12001, 500)
        self.proc = Mock(pid=12001)
        self.proc.poll.return_value = None

    def controller(self):
        obj = panel.ControlPanel.__new__(panel.ControlPanel)
        obj.root = Mock()
        obj.dev_proc = None
        obj.dev_owner = None
        obj.busy = False
        obj.say = Mock()
        obj._work = lambda label, fn: fn()
        return obj

    def test_foreign_stop_and_close_never_signal(self):
        obj = self.controller()
        with patch.object(panel, "port_pid", return_value=45678), patch.object(panel, "port_owner_dir", return_value=str(panel.APP_DIR)):
            obj.stop_dev()
            obj._on_close()
        self.assertIn("refused", obj.say.call_args.args[0])
        obj.root.destroy.assert_called_once()
        panel.os.kill.assert_not_called()
        panel.os.killpg.assert_not_called()
        panel.os.pidfd_open.assert_not_called()

    def test_busy_close_does_not_orphan_action(self):
        obj = self.controller()
        obj.busy = True
        obj._on_close()
        obj.root.destroy.assert_not_called()

    def test_close_revalidates_owned_session_before_signalling(self):
        obj = self.controller()
        obj.dev_proc, obj.dev_owner = self.proc, self.owner
        buttons = {}
        def button(parent, **kwargs):
            buttons[kwargs["text"]] = kwargs["command"]
            return Mock()
        with patch.object(panel, "process_identity", return_value=self.owner), patch.object(panel.tk, "Toplevel"), patch.object(panel.tk, "Label"), patch.object(panel.ttk, "Frame"), patch.object(panel.ttk, "Button", side_effect=button):
            obj._on_close()
        with patch.object(panel, "process_identity", return_value=None):
            buttons["Stop it and close"]()
        obj.root.destroy.assert_not_called()
        panel.os.pidfd_open.assert_not_called()
        self.assertIn("ownership changed", obj.say.call_args.args[0])

    def test_reused_or_exited_leader_refuses_stop(self):
        for identity in (None, panel.ProcessIdentity(12001, 12001, 501)):
            with patch.object(panel, "process_identity", return_value=identity), patch.object(panel.Path, "iterdir", return_value=[]):
                self.assertFalse(panel.stop_owned_session(self.proc, self.owner))
        self.proc.poll.return_value = 0
        with patch.object(panel, "process_identity", return_value=self.owner):
            self.assertFalse(panel.stop_owned_session(self.proc, self.owner))
        panel.os.pidfd_open.assert_not_called()

    def test_owned_children_only_and_stable_handles(self):
        child = panel.ProcessIdentity(12002, 12001, 510)
        foreign = panel.ProcessIdentity(45678, 45678, 50)
        identities = {12001: self.owner, 12002: child, 45678: foreign}
        with patch.object(panel.Path, "iterdir", return_value=[Path(str(pid)) for pid in identities]), patch.object(panel, "process_identity", side_effect=identities.get), patch.object(panel.os, "pidfd_open", side_effect=lambda pid: pid + 100) as opened, patch.object(panel.signal, "pidfd_send_signal") as sent, patch.object(panel.os, "close") as closed:
            self.assertTrue(panel.stop_owned_session(self.proc, self.owner))
        self.assertEqual([c.args[0] for c in opened.call_args_list], [12002, 12001])
        self.assertEqual([c.args for c in sent.call_args_list], [(12102, signal.SIGTERM), (12101, signal.SIGTERM)])
        self.assertEqual(closed.call_count, 2)

    def test_child_pid_reused_after_open_is_not_signalled(self):
        child = panel.ProcessIdentity(12002, 12001, 510)
        child_reads = iter([child, panel.ProcessIdentity(12002, 99999, 900)])
        def identity(pid):
            return self.owner if pid == 12001 else next(child_reads)
        with patch.object(panel.Path, "iterdir", return_value=[Path("12002")]), patch.object(panel, "process_identity", side_effect=identity), patch.object(panel.os, "pidfd_open", return_value=77), patch.object(panel.signal, "pidfd_send_signal") as sent, patch.object(panel.os, "close") as closed:
            panel.stop_owned_session(self.proc, self.owner)
        sent.assert_not_called()
        closed.assert_called_once_with(77)

    def test_leader_changes_before_signal_refuses_and_closes_handle(self):
        reads = iter([self.owner, self.owner, panel.ProcessIdentity(12001, 12001, 999)])
        with patch.object(panel.Path, "iterdir", return_value=[Path("12001")]), patch.object(panel, "process_identity", side_effect=lambda pid: next(reads)), patch.object(panel.os, "pidfd_open", return_value=77), patch.object(panel.signal, "pidfd_send_signal") as sent, patch.object(panel.os, "close") as closed:
            self.assertFalse(panel.stop_owned_session(self.proc, self.owner))
        sent.assert_not_called()
        closed.assert_called_once_with(77)

    def test_pinned_children_still_stop_when_first_term_exits_leader(self):
        identities = {12001: self.owner,
                      12002: panel.ProcessIdentity(12002, 12001, 510),
                      12003: panel.ProcessIdentity(12003, 12001, 511)}
        sent = []
        def send(fd, sig):
            self.assertEqual(opened.call_count, 3, "every handle must precede the first signal")
            sent.append((fd, sig))
            self.proc.poll.return_value = 0
            if fd == 12101:
                raise ProcessLookupError("leader exited after child's TERM")
        with patch.object(panel.Path, "iterdir", return_value=[Path(str(pid)) for pid in identities]), patch.object(panel, "process_identity", side_effect=identities.get), patch.object(panel.os, "pidfd_open", side_effect=lambda pid: pid + 100) as opened, patch.object(panel.signal, "pidfd_send_signal", side_effect=send), patch.object(panel.os, "close") as closed:
            self.assertTrue(panel.stop_owned_session(self.proc, self.owner))
        self.assertEqual(sent, [(12102, signal.SIGTERM), (12103, signal.SIGTERM), (12101, signal.SIGTERM)])
        self.assertEqual([call.args[0] for call in closed.call_args_list], [12102, 12103, 12101])

    def test_later_handle_failure_closes_prior_handles_without_signals(self):
        identities = {12001: self.owner, 12002: panel.ProcessIdentity(12002, 12001, 510)}
        with patch.object(panel.Path, "iterdir", return_value=[Path(str(pid)) for pid in identities]), patch.object(panel, "process_identity", side_effect=identities.get), patch.object(panel.os, "pidfd_open", side_effect=[77, PermissionError("fake denial")]), patch.object(panel.signal, "pidfd_send_signal") as sent, patch.object(panel.os, "close") as closed:
            with self.assertRaises(PermissionError):
                panel.stop_owned_session(self.proc, self.owner)
        sent.assert_not_called()
        closed.assert_called_once_with(77)

    def test_proc_stat_spaces_and_parentheses(self):
        fields = ["S", "1", "12001", "12001"] + ["0"] * 15 + ["500"]
        with patch.object(panel.Path, "read_text", return_value="12001 (node (worker)) " + " ".join(fields)):
            self.assertEqual(panel.process_identity(12001), self.owner)

    def test_unknown_and_occupied_ports_refuse_start(self):
        for occupied in (None, True):
            obj = self.controller()
            with patch.object(panel, "port_in_use", return_value=occupied):
                obj.start_dev()
            self.assertIn("external", obj.say.call_args.args[0])
        panel.subprocess.Popen.assert_not_called()

    def test_socket_query_failure_is_unknown(self):
        with patch.object(panel, "run_quiet", return_value=(1, "permission denied")):
            self.assertIsNone(panel.port_in_use(3200))

    def test_external_listener_during_start_does_not_open_browser(self):
        obj = self.controller()
        proc = Mock(pid=12001)
        proc.poll.side_effect = [None, None, 1]
        foreign = panel.ProcessIdentity(45678, 45678, 50)
        with patch.object(panel, "port_in_use", return_value=False), patch.object(panel.Path, "open", unittest.mock.mock_open()), patch.object(panel.subprocess, "Popen", return_value=proc) as started, patch.object(panel, "process_identity", side_effect=lambda pid: self.owner if pid == 12001 else foreign), patch.object(panel, "port_pid", return_value=45678), patch.object(panel.time, "sleep"):
            obj.start_dev()
        self.assertTrue(started.call_args.kwargs["start_new_session"])
        panel.http_health.assert_not_called()
        obj.root.after.assert_not_called()
        self.assertIn("stopped on its own", obj.say.call_args.args[0])

    def test_one_poll_schedule_and_one_status_worker(self):
        obj = self.controller()
        obj._status_timer = None
        obj._status_running = False
        obj.root.after.side_effect = ["first", "second"]
        with patch.object(panel.threading, "Thread") as thread:
            obj._refresh_status()
            obj._refresh_status()
        self.assertEqual(thread.call_count, 1)
        obj.root.after_cancel.assert_called_once_with("first")
        self.assertEqual(obj._status_timer, "second")

    def test_refresh_exit_zero_does_not_claim_readiness(self):
        obj = self.controller()
        obj._stream = Mock(return_value=0)
        with patch.object(panel.Path, "exists", return_value=True), patch.object(panel, "run_quiet", return_value=(0, "a" * 40)), patch.object(panel, "http_health", return_value={"commit": "b" * 12}):
            obj.refresh_demo()
        messages = "\n".join(c.args[0] for c in obj.say.call_args_list)
        self.assertIn("BUILD IDENTITY UNVERIFIED", messages)
        self.assertNotIn("Open demo to continue", messages)
        self.assertNotIn("latest code", messages)
        self.assertNotIn("Nothing was lost", messages)

    def test_refresh_failed_command_reports_recovery(self):
        obj = self.controller()
        obj._stream = Mock(return_value=1)
        with patch.object(panel.Path, "exists", return_value=True):
            obj.refresh_demo()
        self.assertIn("recovery", obj.say.call_args.args[0])
        panel.http_health.assert_not_called()

    def test_update_and_recovery_use_the_safe_coordinator(self):
        obj = self.controller()
        obj._stream = Mock(return_value=1)
        with patch.object(panel.Path, "exists", return_value=True):
            obj.refresh_demo()
            obj.recover_demo()
        calls = [call.args[0] for call in obj._stream.call_args_list]
        script = str(panel.APP_DIR / "scripts/ops/safe-refresh-walkthrough.py")
        self.assertEqual(calls, [[sys.executable, script], [sys.executable, script, "--recover"]])

    def test_diverged_demo_not_called_current(self):
        with patch.object(panel, "run_quiet", side_effect=[(0, ""), (1, "")]):
            self.assertIsNone(panel.commits_behind("a" * 12))

    def test_main_fetch_is_fresh_and_does_not_move_checkout(self):
        with patch.object(panel, "run_quiet", side_effect=[(0, ""), (0, "b" * 40)]) as run:
            sha, _ = panel.github_main()
        self.assertEqual(sha, "b" * 40)
        self.assertEqual(run.call_args_list[0].args[0], ["git", "fetch", "--quiet", "origin", "refs/heads/main:refs/remotes/origin/main"])
        with patch.object(panel, "run_quiet", return_value=(1, "offline")) as run:
            sha, reason = panel.github_main()
        self.assertIsNone(sha)
        self.assertIn("unavailable", reason)
        self.assertEqual(run.call_count, 1, "failed fetch must not reuse stale origin/main")

    def test_demo_summary_names_served_commit_and_main_when_comparison_unknown(self):
        demo = {"version":"0.46.0", "commit":"a" * 12}
        with patch.object(panel, "commits_behind", return_value=None):
            colour, text = panel.demo_status(demo, "b" * 40, "Checked now")
        self.assertEqual(colour, panel.WARN)
        self.assertIn("aaaaaaaaaaaa", text)
        self.assertIn("bbbbbbbbbbbb", text)
        self.assertIn("Comparison unavailable", text)
        self.assertNotIn("Up to date", text)
        with patch.object(panel, "commits_behind", return_value=7) as behind:
            _, text = panel.demo_status(demo, "b" * 40, "Checked now")
        behind.assert_called_once_with("a" * 12, "b" * 40)
        self.assertIn("7 commits behind main", text)
        with patch.object(panel, "commits_behind", return_value=0):
            colour, text = panel.demo_status(demo, "a" * 40, "Checked now")
        self.assertEqual(colour, panel.OK)
        self.assertIn("Up to date with main", text)
        _, offline = panel.demo_status(demo, None, "GitHub unavailable")
        self.assertIn("aaaaaaaaaaaa", offline)
        self.assertIn("GitHub unavailable", offline)

    def ci(self, records, nightly=None):
        sha = "a" * 40
        if nightly is None:
            nightly = [{"headSha": "b" * 40, "status": "completed", "conclusion": "success", "updatedAt": "2026-09-05T12:00:00Z", "url": "https://github.com/test/runs/2"}]
        with patch.object(panel, "run_quiet", side_effect=[(0, sha), (0, json.dumps(records)), (0, json.dumps(nightly))]) as run:
            answer = panel.automated_checks()
        ci_args = run.call_args_list[1].args[0]
        self.assertEqual(ci_args[ci_args.index("--commit") + 1], sha)
        self.assertIn("ci.yml", ci_args)
        return answer

    def record(self, status="completed", conclusion="success", sha=None):
        return {"headSha": sha or "a" * 40, "status": status, "conclusion": conclusion, "updatedAt": "2026-09-06T12:00:00Z", "url": "https://github.com/test/runs/1"}

    def test_current_running_beats_older_success(self):
        colour, text = self.ci([self.record("in_progress", ""), self.record(sha="c" * 40)])
        self.assertEqual(colour, panel.WARN)
        self.assertIn("in_progress", text)
        self.assertIn("2026-09-06T12:00:00Z", text)
        self.assertIn("https://github.com/test/runs/1", text)

    def test_missing_wrong_commit_malformed_and_skip_are_not_green(self):
        for records in ([], [self.record(sha="c" * 40)], {}, [None], [self.record(conclusion="skipped")], [self.record(conclusion="future_status")]):
            colour, _ = self.ci(records)
            self.assertNotEqual(colour, panel.OK)

    def test_success_is_commit_scoped_not_release_acceptance(self):
        colour, text = self.ci([self.record()])
        self.assertEqual(colour, panel.OK)
        self.assertIn("CI for aaaaaaaaaaaa", text)
        self.assertIn("Other workflows and uncommitted edits are not assessed", text)
        self.assertIn("Latest nightly (separate evidence)", text)
        self.assertNotIn("all", text)


class RefreshScriptTests(unittest.TestCase):
    def refresh(self, migrations='{"migrations":[{"local":"20260101000000","remote":"20260101000000"}]}', reported="a" * 12, migration_exit=0, status_exit=0, prepare_only=False, coordinated=False):
        with tempfile.TemporaryDirectory(prefix="openplan-refresh-test-") as temp:
            base = Path(temp)
            app = base / "instance" / "openplan"
            ops = app / "scripts" / "ops"
            ops.mkdir(parents=True)
            migration_dir = app / "supabase" / "migrations"
            migration_dir.mkdir(parents=True)
            (migration_dir / "20260101000000_fixture.sql").write_text("-- fixture only; never executed\n")
            source = Path(os.environ.get("REFRESH_TEST_SOURCE", OPS / "refresh-walkthrough-instance.sh"))
            script = ops / source.name
            script.write_text(source.read_text())
            bindir = base / "bin"
            bindir.mkdir()
            fake = '''#!/usr/bin/env python3
import json, os, pathlib, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
with open(os.environ["FAKE_CALL_LOG"], "a") as f: f.write(name + " " + " ".join(args) + "\\n")
if name == "git":
    if "status" in args: sys.exit(int(os.environ["FAKE_STATUS_EXIT"]))
    elif "rev-list" in args: print("0")
    elif "rev-parse" in args: print("a" * 40)
elif name == "npm" and "migration" in args:
    print(os.environ["FAKE_MIGRATIONS_AFTER"] if pathlib.Path(os.environ["FAKE_UPGRADED"]).exists() else os.environ["FAKE_MIGRATIONS"])
    sys.exit(int(os.environ["FAKE_MIGRATION_EXIT"]))
elif name == "curl": print(json.dumps({"deployment":{"commit":os.environ["FAKE_REPORTED"]}}, separators=(",", ":")))
'''
            for name in ("git", "npm", "systemctl", "curl", "sleep"):
                tool = bindir / name
                tool.write_text(fake)
                tool.chmod(0o700)
            env = {**os.environ, "PATH": str(bindir) + os.pathsep + os.environ["PATH"], "PYTHONDONTWRITEBYTECODE": "1", "FAKE_CALL_LOG": str(base / "calls"), "FAKE_MIGRATIONS": migrations, "FAKE_REPORTED": reported, "FAKE_MIGRATION_EXIT": str(migration_exit), "FAKE_STATUS_EXIT": str(status_exit)}
            env["FAKE_UPGRADED"] = str(base / "upgraded")
            env["FAKE_MIGRATIONS_AFTER"] = '{"migrations":[{"local":"20260101000000","remote":"20260101000000"}]}'
            if coordinated:
                env.update(OPENPLAN_REFRESH_DATABASE_BACKUP=str(base / "backup.dump"), OPENPLAN_REFRESH_ACTIVE_INSTANCE=str(base / "active"), OPENPLAN_REFRESH_SERVICE="fixture.service")
                (ops / "demo_database.py").write_text('import os,pathlib,sys\nassert sys.argv[3] == "fixture.service"\npathlib.Path(os.environ["FAKE_UPGRADED"]).touch()\nwith open(os.environ["FAKE_CALL_LOG"],"a") as f: f.write("database-upgrade\\n")\n')
            env["OPENPLAN_REFRESH_PREPARE_ONLY"] = "1" if prepare_only else "0"
            result = subprocess.run(["bash", str(script), str(app.parent)], env=env, capture_output=True, text=True, timeout=15)
            return result, (base / "calls").read_text()

    def test_coordinator_applies_pending_schema_before_build(self):
        pending = '{"migrations":[{"local":"20260101000000","remote":""}]}'
        result, calls = self.refresh(migrations=pending, coordinated=True, prepare_only=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("database-upgrade", calls)
        self.assertLess(calls.index("database-upgrade"), calls.index("npm ci"))
        self.assertEqual(calls.count("migration list"), 2, "the upgraded inventory must be checked again")
        self.assertNotIn("systemctl", calls)

    def test_unreadable_empty_malformed_and_pending_schema_stop_before_build(self):
        for migrations in ("not JSON", '{"migrations":[]}', '{"migrations":[{}]}', '{"migrations":[{"local":"20260101000000","remote":""}]}'):
            with self.subTest(migrations=migrations):
                result, calls = self.refresh(migrations=migrations)
                self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertNotIn("npm ci", calls)
                self.assertNotIn("systemctl", calls)
                self.assertIn("refresh aborted", result.stderr)

    def test_failed_migration_command_cannot_supply_success_json(self):
        result, calls = self.refresh(migration_exit=1)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("npm ci", calls)
        self.assertNotIn("systemctl", calls)

    def test_failed_checkout_status_stops_before_fetch(self):
        result, calls = self.refresh(status_exit=1)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("git fetch", calls)
        self.assertNotIn("npm", calls)

    def test_migration_response_must_match_actual_file_versions(self):
        for rows in ([{"local": "", "remote": "20260101000000"}],
                     [{"local": "nonsense", "remote": "nonsense"}],
                     [{"local": "20260201000000", "remote": "20260201000000"}],
                     [{"local": "20260101000000", "remote": "20260101000000"},
                      {"local": "", "remote": "20260201000000"}]):
            with self.subTest(rows=rows):
                result, calls = self.refresh(migrations=json.dumps({"migrations": rows}))
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("npm ci", calls)
                self.assertNotIn("systemctl", calls)

    def test_mismatched_or_missing_runtime_identity_fails_after_restart(self):
        for reported in ("", "b" * 12):
            result, calls = self.refresh(reported=reported)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("systemctl --user restart", calls)
            self.assertIn("build identity does not match", result.stderr)
            self.assertNotIn("==> Done", result.stdout)

    def test_matching_schema_and_identity_can_complete(self):
        result, calls = self.refresh()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("npm run build", calls)
        self.assertIn("systemctl --user restart", calls)
        self.assertIn("matches the checkout", result.stdout)

    def test_candidate_preparation_never_restarts_a_service(self):
        result, calls = self.refresh(prepare_only=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("npm run build", calls)
        self.assertNotIn("systemctl", calls)
        self.assertNotIn("curl", calls)


def prove_mutations():
    """Mutate disposable source copies, never a shared checkout or live service."""
    controller = SOURCE.read_text()
    refresh = (OPS / "refresh-walkthrough-instance.sh").read_text()
    mutations = [
        ("database preparation disconnected", "REFRESH_TEST_SOURCE", refresh,
         'python3 "$SCRIPT_DIR/demo_database.py"', 'echo "$SCRIPT_DIR/demo_database.py"',
         "RefreshScriptTests.test_coordinator_applies_pending_schema_before_build", False),

        ("served commit hidden", "CONTROL_PANEL_TEST_SOURCE", controller,
         '{commit[:12]}\\n{main}', 'hidden\\n{main}',
         "ControllerTests.test_demo_summary_names_served_commit_and_main_when_comparison_unknown", False),
        ("fetch failure ignored", "CONTROL_PANEL_TEST_SOURCE", controller,
         'if code:\n        return None, "GitHub main unavailable.', 'if False:\n        return None, "GitHub main unavailable.',
         "ControllerTests.test_main_fetch_is_fresh_and_does_not_move_checkout", False),

        ("harmless comment", "CONTROL_PANEL_TEST_SOURCE", controller,
         "# Small helpers.", "# Plain-data helpers.", None, True),
        ("preparation restarted service", "REFRESH_TEST_SOURCE", refresh,
         'if [ "${OPENPLAN_REFRESH_PREPARE_ONLY:-0}" = "1" ]; then', 'if false; then',
         "RefreshScriptTests.test_candidate_preparation_never_restarts_a_service", False),
        ("update bypassed coordinator", "CONTROL_PANEL_TEST_SOURCE", controller,
         'script = APP_DIR / "scripts" / "ops" / "safe-refresh-walkthrough.py"\n        if not script.exists():',
         'script = APP_DIR / "scripts" / "ops" / "refresh-walkthrough-instance.sh"\n        if not script.exists():',
         "ControllerTests.test_update_and_recovery_use_the_safe_coordinator", False),
        ("foreign session included", "CONTROL_PANEL_TEST_SOURCE", controller,
         "identity is not None and identity.session == owner.pid", "identity is not None",
         "ControllerTests.test_owned_children_only_and_stable_handles", False),
        ("PID reuse ignored", "CONTROL_PANEL_TEST_SOURCE", controller,
         "if process_identity(identity.pid) != identity:", "if False:",
         "ControllerTests.test_child_pid_reused_after_open_is_not_signalled", False),
        ("leader identity ignored", "CONTROL_PANEL_TEST_SOURCE", controller,
         "and process_identity(owner.pid) == owner", "and True",
         "ControllerTests.test_reused_or_exited_leader_refuses_stop", False),
        ("port conflict allowed", "CONTROL_PANEL_TEST_SOURCE", controller,
         "if port_in_use(DEV_PORT) is not False:", "if False:",
         "ControllerTests.test_unknown_and_occupied_ports_refuse_start", False),
        ("CI wrong commit accepted", "CONTROL_PANEL_TEST_SOURCE", controller,
         "if exact_commit and sha != target:", "if False:",
         "ControllerTests.test_missing_wrong_commit_malformed_and_skip_are_not_green", False),
        ("CI running ignored", "CONTROL_PANEL_TEST_SOURCE", controller,
         "if run[\"status\"] != \"completed\":", "if False:",
         "ControllerTests.test_current_running_beats_older_success", False),
        ("duplicate polling allowed", "CONTROL_PANEL_TEST_SOURCE", controller,
         "if self._status_running:", "if False:",
         "ControllerTests.test_one_poll_schedule_and_one_status_worker", False),
        ("refresh mismatch promoted", "CONTROL_PANEL_TEST_SOURCE", controller,
         'self.say("BUILD IDENTITY UNVERIFIED: the demo did not report its checkout commit.")',
         'self.say("DONE: latest code is ready.")',
         "ControllerTests.test_refresh_exit_zero_does_not_claim_readiness", False),
        ("unreadable schema continued", "REFRESH_TEST_SOURCE", refresh,
         'fail "could not verify the instance database migration state;',
         'echo "could not verify the instance database migration state;',
         "RefreshScriptTests.test_unreadable_empty_malformed_and_pending_schema_stop_before_build", False),
        ("failed schema query continued", "REFRESH_TEST_SOURCE", refresh,
         'fail "could not query migration state;', 'echo "could not query migration state;',
         "RefreshScriptTests.test_failed_migration_command_cannot_supply_success_json", False),
        ("wrong build continued", "REFRESH_TEST_SOURCE", refresh,
         'fail "running build identity does not match', 'echo "running build identity does not match',
         "RefreshScriptTests.test_mismatched_or_missing_runtime_identity_fails_after_restart", False),
        ("leader required after requested termination", "CONTROL_PANEL_TEST_SOURCE", controller,
         "for fd in handles:\n            try:",
         "for fd in handles:\n            if not owned_session_alive(proc, owner):\n                return False\n            try:",
         "ControllerTests.test_pinned_children_still_stop_when_first_term_exits_leader", False),
        ("handle cleanup omitted", "CONTROL_PANEL_TEST_SOURCE", controller,
         "os.close(fd)", "pass  # leaked handle",
         "ControllerTests.test_later_handle_failure_closes_prior_handles_without_signals", False),
        ("failed checkout inspection continued", "REFRESH_TEST_SOURCE", refresh,
         'fail "could not inspect the instance checkout;', 'echo "could not inspect the instance checkout;',
         "RefreshScriptTests.test_failed_checkout_status_stops_before_fetch", False),
        ("file migration inventory ignored", "REFRESH_TEST_SOURCE", refresh,
         "!expected.length || rows.length !== expected.length || new Set(expected).size !== expected.length ||\n      local.length !== expected.length || new Set(local).size !== local.length ||\n      expected.some((version) => !local.includes(version))",
         "false",
         "RefreshScriptTests.test_migration_response_must_match_actual_file_versions", False),
    ]
    with tempfile.TemporaryDirectory(prefix="openplan-control-mutations-") as temp:
        for label, envkey, original, old, new, test, should_survive in mutations:
            if original.count(old) != 1:
                raise AssertionError(f"{label}: mutation target is ambiguous or missing")
            mutant = Path(temp) / ("mutant.py" if envkey == "CONTROL_PANEL_TEST_SOURCE" else "mutant.sh")
            mutant.write_text(original.replace(old, new, 1))
            args = [sys.executable, "-B", str(Path(__file__).resolve())]
            if test:
                args.append(test)
            result = subprocess.run(args, env={**os.environ, envkey: str(mutant), "PYTHONDONTWRITEBYTECODE": "1"}, capture_output=True, text=True, timeout=30)
            survived = result.returncode == 0
            print(f"{'SURVIVED' if survived else 'KILLED'}: {label}", flush=True)
            if not survived:
                # Keep the actual assertion/traceback available for inspection.
                print(result.stderr, flush=True)
                if "AssertionError" not in result.stderr or "FAILED (" not in result.stderr:
                    raise AssertionError(f"{label}: did not fail through the expected assertion")
            if survived != should_survive:
                raise AssertionError(f"{label}: unexpected mutation outcome")


if __name__ == "__main__":
    if sys.argv[1:] == ["--prove-mutations"]:
        prove_mutations()
    else:
        unittest.main()
