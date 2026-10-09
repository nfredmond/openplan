"""Read-only host inspection with synthetic retained identities."""
import copy
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import host_recovery as recovery


class HostRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        boot = "00000000-0000-4000-8000-000000000001"
        unit = "openplan-owner-" + "1" * 32 + ".scope"
        self.launch = {"schema": "openplan.activitysim-host-command.v1", "command_sha256": "a" * 64,
            "scope_unit": "openplan-engine-" + "2" * 32 + ".scope", "scientific_acceptance": "unassessed",
            "owner_guard": {"schema": "openplan.owner-guard.v1", "unit": unit,
                "pid": 123, "owner_pid": 122, "invocation_id": "3" * 32, "cgroup_device": 1,
                "cgroup_inode": 2, "boot_id": boot,
                "cgroup": f"/user.slice/user-{os.getuid()}.slice/user@{os.getuid()}.service/app.slice/" + unit}}
        self.scope = {"unit": self.launch["scope_unit"], "boot_id": boot}
        self.started = {**self.launch, "scope": self.scope}
        self.write("launch-reserved.json", self.launch)
        self.write("scope-started.json", self.started)
        self.scope_patch = patch.object(recovery, "inspect_saved_scope", return_value={"outcome": "scope_absent_observed", "scope_has_live_processes": False})
        self.guard_patch = patch.object(recovery, "inspect_guard", return_value={"outcome": "guard_absent_observed", "guard_has_live_processes": False})
        self.inspect_scope = self.scope_patch.start()
        self.guard_patch.start()
        self.addCleanup(self.scope_patch.stop)
        self.addCleanup(self.guard_patch.stop)

    def write(self, name, value):
        path = self.root / name
        path.write_text(json.dumps(value))
        path.chmod(0o600)

    def test_absence_does_not_authorize_restart_or_infer_cause(self):
        before = {p.name: p.read_bytes() for p in self.root.iterdir()}
        result = recovery.inspect_host(self.root)
        self.assertFalse(result["scope_has_live_processes"])
        for key in ("model_resumed", "signal_sent", "continuation_authorized", "database_status_changed", "server_ownership_checked", "completion_record_present"):
            self.assertIs(result[key], False)
        self.assertEqual(result["termination_cause"], "unconfirmed")
        self.assertEqual(result["scientific_acceptance"], "unassessed")
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.root.iterdir()})

    def test_missing_startup_remains_unconfirmed(self):
        (self.root / "scope-started.json").unlink()
        self.assertEqual(recovery.inspect_host(self.root)["outcome"], "scope_startup_unconfirmed")
        self.inspect_scope.assert_not_called()

    def test_changed_startup_is_refused_before_observation(self):
        changed = copy.deepcopy(self.started)
        changed["command_sha256"] = "b" * 64
        self.write("scope-started.json", changed)
        with self.assertRaisesRegex(ValueError, "startup differs"):
            recovery.inspect_host(self.root)
        self.inspect_scope.assert_not_called()

    def test_inconsistent_exit_is_refused(self):
        record = {**self.launch, "scope": {**self.scope, "observed_scope_empty": True},
                  "returncode": 0, "database_status_changed": False}
        self.write("observed-exit.json", record)
        result = recovery.inspect_host(self.root)
        self.assertTrue(result["completion_record_present"])
        self.assertEqual(result["reported_returncode"], 0)
        record["returncode"] = False
        self.write("observed-exit.json", record)
        with self.assertRaisesRegex(ValueError, "exit differs"):
            recovery.inspect_host(self.root)

    def test_nonprivate_file_is_refused(self):
        (self.root / "scope-started.json").chmod(0o644)
        with self.assertRaisesRegex(ValueError, "private bounded regular file"):
            recovery.inspect_host(self.root)

    def test_change_during_live_observation_is_refused(self):
        def change(_):
            self.write("scope-started.json", {**self.started, "changed": True})
            return {"scope_has_live_processes": False}
        self.inspect_scope.side_effect = change
        with self.assertRaisesRegex(ValueError, "changed during inspection"):
            recovery.inspect_host(self.root)
