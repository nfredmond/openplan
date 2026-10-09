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
