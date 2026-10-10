"""Refuse unsafe controller inputs before starting an owner guard or Docker."""
from dataclasses import replace
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from container_supervision import run_container_command
import test_container_identity as fixtures


class ContainerSupervisionBoundaryTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        fixture = fixtures.ContainerIdentityTests(); fixture.setUp()
        self.plan = replace(fixture.plan, user=f'{os.getuid()}:{os.getgid()}')
        self.records = self.root / 'records'; self.log = self.root / 'command.log'
        self.guard = self.enterContext(patch('container_supervision.OwnerGuard', side_effect=AssertionError('Unexpected supervisor startup')))

    def run_plan(self, plan):
        return run_container_command(plan, socket_path=self.root / 'unused.sock', records=self.records, log_path=self.log)

    def test_other_user_cannot_start_controller(self):
        with self.assertRaisesRegex(ValueError, 'Local owner user'):
            self.run_plan(replace(self.plan, user='987654:987654'))
        self.assertFalse(self.records.exists()); self.guard.assert_not_called()

    def test_writable_mount_cannot_contain_execution_records(self):
        with self.assertRaisesRegex(ValueError, 'writable mount'):
            self.run_plan(replace(self.plan, mounts=((str(self.root), '/work', False),)))
        self.assertFalse(self.records.exists()); self.guard.assert_not_called()

    def test_existing_command_log_is_not_reused(self):
        self.log.write_text('retained earlier command')
        with self.assertRaises(FileExistsError):
            self.run_plan(self.plan)
        self.assertEqual(self.log.read_text(), 'retained earlier command'); self.guard.assert_not_called()
