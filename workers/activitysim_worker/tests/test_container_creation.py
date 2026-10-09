"""Retain single-use creation records without implying execution authority."""
from dataclasses import replace
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from container_creation import ContainerCreation
import test_container_identity as fixtures


class ContainerCreationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        fixture = fixtures.ContainerIdentityTests()
        fixture.setUp()
        self.plan, self.observed = fixture.plan, fixture.observed
        self.records = self.root / "custody"

    def test_intent_and_reservation_survive_missing_reply_without_retry(self):
        with ContainerCreation(self.records, self.plan, "a" * 64) as creation:
            creation.begin_create()
            with self.assertRaisesRegex(ValueError, "already reserved"):
                creation.begin_create()
        self.assertFalse((self.records / "created.json").exists())
        request = json.loads((self.records / "create-requested.json").read_text())
        self.assertEqual(request["intent_sha256"], hashlib.sha256((self.records / "intent.json").read_bytes()).hexdigest())
        with self.assertRaises(FileExistsError):
            ContainerCreation(self.records, self.plan, "a" * 64)
        self.assertEqual(self.records.stat().st_mode & 0o777, 0o700)
        for path in self.records.iterdir():
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_verified_creation_is_recorded_once_without_start_authority(self):
        with ContainerCreation(self.records, self.plan, "a" * 64) as creation:
            with self.assertRaisesRegex(ValueError, "reserved"):
                creation.record_created(self.plan.daemon_id, self.observed)
            creation.begin_create()
            identity = creation.record_created(self.plan.daemon_id, self.observed)
            self.assertIs(identity["start_authorized"], False)
            with self.assertRaisesRegex(ValueError, "reserved"):
                creation.record_created(self.plan.daemon_id, self.observed)
        self.assertEqual(json.loads((self.records / "created.json").read_text())["identity"], identity)

    def test_custody_inside_writable_mount_is_refused(self):
        plan = replace(self.plan, mounts=((str(self.root), "/work", False),))
        with self.assertRaisesRegex(ValueError, "writable mount"):
            ContainerCreation(self.records, plan, "a" * 64)
        self.assertFalse(self.records.exists())

    def test_changed_intent_refuses_create_and_receipt(self):
        with ContainerCreation(self.records, self.plan, "a" * 64) as creation:
            path = self.records / "intent.json"
            original = path.read_bytes()
            path.write_bytes(original + b" ")
            with self.assertRaisesRegex(ValueError, "intent changed"):
                creation.begin_create()
            self.assertFalse((self.records / "create-requested.json").exists())
            path.write_bytes(original)
            creation.begin_create()
            path.write_bytes(original + b" ")
            with self.assertRaisesRegex(ValueError, "intent changed"):
                creation.record_created(self.plan.daemon_id, self.observed)
            self.assertFalse((self.records / "created.json").exists())

    def test_wrong_container_is_not_retained_as_created(self):
        with ContainerCreation(self.records, self.plan, "a" * 64) as creation:
            creation.begin_create()
            with self.assertRaisesRegex(ValueError, "image differs"):
                creation.record_created(self.plan.daemon_id, {**self.observed, "Image": "sha256:" + "4" * 64})
            self.assertFalse((self.records / "created.json").exists())

    def test_replaced_directory_refuses_receipt(self):
        with ContainerCreation(self.records, self.plan, "a" * 64) as creation:
            creation.begin_create()
            self.records.rename(self.root / "original")
            self.records.mkdir(mode=0o700)
            with self.assertRaisesRegex(ValueError, "directory changed"):
                creation.record_created(self.plan.daemon_id, self.observed)
            self.assertFalse((self.records / "created.json").exists())

    def test_replaced_live_plan_cannot_reserve_original_intent(self):
        with ContainerCreation(self.records, self.plan, "a" * 64) as creation:
            creation.plan = replace(self.plan, command=("unplanned",))
            with self.assertRaisesRegex(ValueError, "live plan"):
                creation.begin_create()
        self.assertFalse((self.records / "create-requested.json").exists())

    def test_replaced_live_plan_cannot_record_a_different_command(self):
        with ContainerCreation(self.records, self.plan, "a" * 64) as creation:
            creation.begin_create()
            creation.plan = replace(self.plan, command=("unplanned",))
            observed = {**self.observed, "Config": {**self.observed["Config"], "Cmd": ["unplanned"]}}
            with self.assertRaisesRegex(ValueError, "live plan"):
                creation.record_created(self.plan.daemon_id, observed)
        self.assertFalse((self.records / "created.json").exists())

    def test_bootstrap_requires_live_creation_and_unchanged_record(self):
        fixture = fixtures.ContainerIdentityTests(); fixture.setUp()
        observed = fixture.bootstrap()
        with ContainerCreation(self.records, self.plan, "a" * 64) as creation:
            with self.assertRaisesRegex(ValueError, "live verified creation"):
                creation.observe_bootstrap(self.plan.daemon_id, observed)
            creation.begin_create()
            created = creation.record_created(self.plan.daemon_id, self.observed)
            result = creation.observe_bootstrap(self.plan.daemon_id, observed)
            self.assertEqual(result["policy_sha256"], created["policy_sha256"])
            self.assertIs(result["start_authorized"], False)
            self.assertEqual(result["bootstrap_pid"], 123)
            creation.recorded = False
            with self.assertRaisesRegex(ValueError, "live verified creation"):
                creation.observe_bootstrap(self.plan.daemon_id, observed)
            creation.recorded = True
            path = self.records / "created.json"
            original = path.read_bytes(); path.write_bytes(original + b" ")
            with self.assertRaisesRegex(ValueError, "record changed"):
                creation.observe_bootstrap(self.plan.daemon_id, observed)
            path.write_bytes(original)
            creation.plan = replace(self.plan, command=("unplanned",))
            with self.assertRaisesRegex(ValueError, "live plan"):
                creation.observe_bootstrap(self.plan.daemon_id, observed)

    def test_bootstrap_cannot_substitute_another_created_id(self):
        fixture = fixtures.ContainerIdentityTests(); fixture.setUp()
        observed = fixture.bootstrap(); observed["Id"] = "4" * 64
        with ContainerCreation(self.records, self.plan, "a" * 64) as creation:
            creation.begin_create(); creation.record_created(self.plan.daemon_id, self.observed)
            with self.assertRaisesRegex(ValueError, "created identity"):
                creation.observe_bootstrap(self.plan.daemon_id, observed)
