"""Database target, backup and migration failures without touching any real DB."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / "demo_database.py"
db = types.ModuleType("demo_database_under_test")
source = Path(os.environ.get("DEMO_DATABASE_TEST_SOURCE", SOURCE)).read_text()
exec(compile(source, str(SOURCE), "exec"), db.__dict__)


class DatabaseTests(unittest.TestCase):
    def setUp(self):
        self.base = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.app = self.base / "candidate/openplan"
        self.instance = self.base / "demo"
        self.backup = self.base / "private/database.dump"
        self.calls = []
        self.enterContext(patch.object(db, "run", side_effect=AssertionError("unmocked command")))
        self.enterContext(patch.object(db.subprocess, "run", side_effect=AssertionError("unmocked subprocess")))

    def containers(self):
        return [{"Id": "db-id", "State": {"Running": True}, "NetworkSettings": {
            "Ports": {"5432/tcp": [{"HostPort": "54322"}]}, "Networks": {"supabase": {}}}},
                {"Id": "api-id", "State": {"Running": True}, "NetworkSettings": {
            "Ports": {"8000/tcp": [{"HostPort": "54321"}]}, "Networks": {"supabase": {}}}}]

    def target(self, url="http://127.0.0.1:54321", containers=None):
        status = {"API_URL": "http://127.0.0.1:54321", "DB_URL": "postgresql://localhost:54322/postgres"}
        with patch.object(db, "runtime_url", return_value=url), patch.object(db, "run", side_effect=[json.dumps(status), json.dumps(containers or self.containers())]):
            return db.local_database(self.app, self.instance, "demo.service")

    def test_only_matching_local_runtime_and_stack_are_allowed(self):
        self.assertEqual(self.target(), "db-id")
        for url in ("http://remote.example.test:54321", "http://127.0.0.1:55321"):
            with self.assertRaises(db.DatabaseError): self.target(url=url)
        for change in ("port", "network", "stopped"):
            containers = self.containers()
            if change == "port": containers[0]["NetworkSettings"]["Ports"]["5432/tcp"][0]["HostPort"] = "55322"
            if change == "network": containers[1]["NetworkSettings"]["Networks"] = {"foreign": {}}
            if change == "stopped": containers[0]["State"]["Running"] = False
            with self.assertRaises(db.DatabaseError): self.target(containers=containers)

    def test_candidate_cannot_change_runtime_database(self):
        with patch.object(db, "runtime_url", side_effect=["http://127.0.0.1:54321", "http://127.0.0.1:55321"]), patch.object(db, "run", side_effect=[json.dumps({"API_URL":"http://127.0.0.1:54321", "DB_URL":"postgresql://localhost:54322/postgres"}), json.dumps(self.containers())]):
            with self.assertRaises(db.DatabaseError): db.local_database(self.app, self.instance, "demo.service")

    def test_inventory_rejects_foreign_or_missing_history(self):
        migrations = self.app / "supabase/migrations"
        migrations.mkdir(parents=True)
        for version in ("20260101000000", "20260201000000"):
            (migrations / f"{version}_fixture.sql").write_text("-- fixture\n")
        with patch.object(db, "run", return_value="20260101000000"):
            self.assertEqual(db.inventory(self.app, "db-id"), (["20260101000000"], ["20260201000000"]))
        for applied in ("20260201000000", "20200101000000", "20260101000000\n20260101000000"):
            with patch.object(db, "run", return_value=applied), self.assertRaises(db.DatabaseError):
                db.inventory(self.app, "db-id")

    def prepare(self, *, dump_exit=0, restore_exit=0, moved=False, remaining=False, migration_fail=False):
        def process(args, **kwargs):
            self.calls.append(args)
            if "pg_dump" in args:
                kwargs["stdout"].write(b"synthetic archive bytes")
                return types.SimpleNamespace(returncode=dump_exit)
            self.assertIn("pg_restore", args)
            self.assertIn("--list", args)
            return types.SimpleNamespace(returncode=restore_exit)
        def command(args, **kwargs):
            self.calls.append(args)
            self.assertTrue(self.backup.is_file(), "migration preceded backup")
            self.assertEqual(self.backup.stat().st_mode & 0o777, 0o600)
            if migration_fail: raise db.DatabaseError("simulated migration error")
            return ""
        with patch.object(db, "local_database", side_effect=["db-id", "moved-id" if moved else "db-id"]), \
             patch.object(db, "inventory", side_effect=[(["old"], ["new"]), (["old", "new"], ["new"] if remaining else [])]), \
             patch.object(db.subprocess, "run", side_effect=process), patch.object(db, "run", side_effect=command):
            db.prepare(self.app, self.instance, "demo.service", self.backup)

    def test_backup_and_readability_precede_migration_then_inventory_rechecked(self):
        self.prepare()
        self.assertEqual([args[0] for args in self.calls], ["docker", "docker", "npm"])
        self.assertEqual(self.calls[-1], ["npm", "exec", "--", "supabase", "migration", "up", "--local", "--yes"])
        self.assertEqual(json.loads(self.backup.with_suffix(".json").read_text())["phase"], "upgraded")

    def test_backup_failure_or_identity_change_never_migrates(self):
        for mode in ("dump_exit", "restore_exit", "moved"):
            with self.subTest(mode=mode):
                self.backup = self.base / mode / "database.dump"
                self.calls = []
                with self.assertRaises(db.DatabaseError): self.prepare(**{mode: 1})
                self.assertNotIn("npm", [args[0] for args in self.calls])

    def test_failed_or_incomplete_migration_never_claims_upgrade(self):
        for mode in ("remaining", "migration_fail"):
            self.backup = self.base / mode / "database.dump"
            with self.assertRaises(db.DatabaseError): self.prepare(**{mode: True})
            self.assertEqual(json.loads(self.backup.with_suffix(".json").read_text())["phase"], "migration_failed")


def prove_mutations():
    mutations = [
        ("harmless comment", "# Use Next's", "# Load Next's", None, True),
        ("remote URL accepted", 'parsed.hostname not in ("localhost", "127.0.0.1", "::1")', 'False', "test_only_matching_local_runtime_and_stack_are_allowed", False),
        ("different runtime accepted", "configured != active or configured != api", "False", "test_candidate_cannot_change_runtime_database", False),
        ("foreign container accepted", 'not container["State"]["Running"] or not any(int(binding["HostPort"]) == port for binding in bindings)', "False", "test_only_matching_local_runtime_and_stack_are_allowed", False),
        ("unreadable backup accepted", "if result.returncode:\n        raise DatabaseError(\"Database backup is unreadable", "if False:\n        raise DatabaseError(\"Database backup is unreadable", "test_backup_failure_or_identity_change_never_migrates", False),
        ("failed dump accepted", "result.returncode or backup.stat().st_size == 0", "False", "test_backup_failure_or_identity_change_never_migrates", False),
        ("database replacement ignored", "local_database(app, instance, service) != container", "False", "test_backup_failure_or_identity_change_never_migrates", False),
        ("migration left pending", "if remaining:", "if False:", "test_failed_or_incomplete_migration_never_claims_upgrade", False),
        ("history gap ignored", "applied != expected[:len(applied)]", "False", "test_inventory_rejects_foreign_or_missing_history", False),
    ]
    with tempfile.TemporaryDirectory() as temp:
        for name, old, new, test, expected in mutations:
            assert source.count(old) == 1, name
            mutant = Path(temp) / "mutant.py"
            mutant.write_text(source.replace(old, new))
            args = [sys.executable, "-B", __file__] + ([f"DatabaseTests.{test}"] if test else [])
            result = subprocess.run(args, env={**os.environ, "DEMO_DATABASE_TEST_SOURCE":str(mutant)}, capture_output=True, text=True)
            survived = result.returncode == 0
            print(name, "SURVIVED" if survived else "KILLED", flush=True)
            if not survived:
                print(result.stderr, flush=True)
                assert "AssertionError" in result.stderr and "FAILED (" in result.stderr
            assert survived == expected, name


if __name__ == "__main__":
    if sys.argv[1:] == ["--prove-mutations"]: prove_mutations()
    else: unittest.main()
