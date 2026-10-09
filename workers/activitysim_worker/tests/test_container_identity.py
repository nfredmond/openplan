"""Reject mismatched daemon/container facts before any startup admission."""
import copy
from dataclasses import replace
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from container_identity import ContainerPlan, verify_created_container, verify_bootstrap_container


class ContainerIdentityTests(unittest.TestCase):
    def setUp(self):
        self.plan = ContainerPlan(daemon_id="synthetic-daemon", image_id="sha256:" + "1" * 64,
            request_id="2" * 32, command=("python", "job.py"), entrypoint=(), environment=("HOME=/work",),
            user="1000:1000", working_dir="/work", memory_bytes=67108864, tasks=16, network="none",
            mounts=(("/owned/input", "/input", True), ("/owned/output", "/work", False)))
        self.observed = {"Id": "3" * 64, "Image": self.plan.image_id,
            "Config": {"Labels": {"openplan.execution-request": self.plan.request_id},
                "Cmd": ["python", "job.py"], "Entrypoint": None, "Env": ["HOME=/work"], "User": "1000:1000", "WorkingDir": "/work"},
            "HostConfig": {"Memory": 67108864, "MemorySwap": 67108864, "PidsLimit": 16,
                "NetworkMode": "none", "AutoRemove": False, "Privileged": False, "RestartPolicy": {"Name": "no"}},
            "State": {"Status": "created", "Pid": 0, "Running": False, "Paused": False, "Restarting": False, "Dead": False},
            "Mounts": [{"Type": "bind", "Source": source, "Destination": destination, "RW": not ro}
                for source, destination, ro in self.plan.mounts]}

    def inspect(self, observed=None):
        return verify_created_container(self.plan, self.plan.daemon_id, observed or self.observed)

    def test_verified_observation_does_not_authorize_execution(self):
        before = copy.deepcopy(self.observed)
        result = self.inspect()
        self.assertEqual(result["container_id"], self.observed["Id"])
        for key in ("start_authorized", "signal_authorized", "continuation_authorized"):
            self.assertIs(result[key], False)
        self.assertEqual(self.observed, before)
        self.observed["Mounts"].reverse()
        self.assertEqual(self.inspect(), result)

    def test_other_daemon_is_refused(self):
        with self.assertRaisesRegex(ValueError, "daemon differs"):
            verify_created_container(self.plan, "other-daemon", self.observed)

    def test_policy_and_identity_changes_are_refused(self):
        changes = [("Image", None, "sha256:" + "4" * 64), ("Id", None, "short-id"),
            ("Config", "WorkingDir", "/other"), ("Config", "User", "0:0"), ("Config", "Cmd", ["different"]),
            ("Config", "Env", ["HOME=/elsewhere"]), ("Config", "Entrypoint", ["different"]),
            ("Config", "Labels", {"openplan.execution-request": "4" * 32}),
            ("HostConfig", "Memory", 1), ("HostConfig", "MemorySwap", -1),
            ("HostConfig", "PidsLimit", 1), ("HostConfig", "Privileged", True),
            ("HostConfig", "AutoRemove", True), ("HostConfig", "RestartPolicy", {"Name": "always"}),
            ("HostConfig", "NetworkMode", "host"), ("HostConfig", "CapAdd", ["SYS_ADMIN"]),
            ("State", "Running", True), ("State", "Pid", 123)]
        for section, key, value in changes:
            observed = copy.deepcopy(self.observed)
            if key is None:
                observed[section] = value
            else:
                observed[section][key] = value
            with self.subTest(section=section, key=key), self.assertRaises(ValueError):
                self.inspect(observed)

    def test_changed_or_additional_mount_is_refused(self):
        for change in ("writable-input", "additional", "other-source"):
            observed = copy.deepcopy(self.observed)
            if change == "writable-input":
                observed["Mounts"][0]["RW"] = True
            elif change == "additional":
                observed["Mounts"].append({"Type": "volume", "Source": "extra", "Destination": "/extra", "RW": True})
            else:
                observed["Mounts"][0]["Source"] = "/unrelated"
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.inspect(observed)

    def test_mutable_plan_and_tag_only_image_are_refused(self):
        for change in ({"mounts": (["/owned", "/input", True],)}, {"command": ["python"]}, {"image_id": "python:latest"}, {"memory_bytes": True}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                replace(self.plan, **change)

    def bootstrap(self):
        observed = copy.deepcopy(self.observed)
        observed["State"].update(Status="running", Pid=123, Running=True)
        observed["HostConfig"].update(PidMode="", Init=False, CapDrop=["ALL"], SecurityOpt=["no-new-privileges"])
        return observed

    def test_bootstrap_retains_identity_without_execution_authority(self):
        observed = self.bootstrap()
        result = verify_bootstrap_container(self.plan, self.plan.daemon_id, observed, observed["Id"])
        self.assertEqual(result["policy_sha256"], self.inspect()["policy_sha256"])
        self.assertEqual(result["bootstrap_pid"], 123)
        self.assertEqual(result["observed_state"], "bootstrap_running")
        for key in ("start_authorized", "signal_authorized", "continuation_authorized"):
            self.assertIs(result[key], False)

    def test_bootstrap_rechecks_exact_id_and_configuration(self):
        observed = self.bootstrap()
        with self.assertRaisesRegex(ValueError, "created identity"):
            verify_bootstrap_container(self.plan, self.plan.daemon_id, observed, "4" * 64)
        observed["Config"]["Cmd"] = ["unplanned"]
        with self.assertRaisesRegex(ValueError, "command or user"):
            verify_bootstrap_container(self.plan, self.plan.daemon_id, observed, observed["Id"])

    def test_bootstrap_requires_live_private_namespace_and_restricted_privileges(self):
        changes = [("State", "Pid", 0), ("State", "Running", False), ("State", "Paused", True),
                   ("HostConfig", "PidMode", "host"), ("HostConfig", "Init", True),
                   ("HostConfig", "CapDrop", []), ("HostConfig", "SecurityOpt", [])]
        for section, key, value in changes:
            observed = self.bootstrap(); observed[section][key] = value
            with self.subTest(section=section, key=key), self.assertRaises(ValueError):
                verify_bootstrap_container(self.plan, self.plan.daemon_id, observed, observed["Id"])
