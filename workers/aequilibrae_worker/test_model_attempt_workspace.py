"""Native local directory ownership; no model engine or predecessor handoff."""
from dataclasses import asdict, replace
import json
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from model_attempt_invocation import AttemptContext
import model_attempt_workspace as workspace
import model_attempt_writer as managed
import test_model_attempt_writer as writer_tests
import test_model_attempt_outputs as output_tests
from test_model_command_client import IDS, URL
from test_model_skip_dispatch import aeq, activity


class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.context = AttemptContext(URL, IDS[4], IDS[1], IDS[2], IDS[3], IDS[0])

    def test_exclusive_identity_and_private_owner_record(self):
        owned = workspace.AttemptWorkspace(self.root, self.context)
        marker = owned.path / 'attempt_owner.json'
        self.assertEqual(json.loads(marker.read_text()), {'schema': 'openplan.attempt-workspace.v1', **asdict(self.context)})
        self.assertEqual(marker.stat().st_mode & 0o777, 0o600)
        self.assertEqual(owned.path.stat().st_mode & 0o777, 0o700)
        owned.publish_state({'stage': 'synthetic'})
        owned.retain_state({'stage': 'synthetic'})
        original = (owned.path / 'predecessor_state.json').read_bytes()
        with self.assertRaises(FileExistsError):
            owned.retain_state({'stage': 'changed'})
        self.assertEqual((owned.path / 'predecessor_state.json').read_bytes(), original)
        with self.assertRaisesRegex(ValueError, 'already exists'):
            workspace.AttemptWorkspace(self.root, self.context)
        self.assertEqual(json.loads((owned.path / 'state.json').read_text()), {'stage': 'synthetic'})
        other = workspace.AttemptWorkspace(self.root, replace(self.context, destination=URL + '/other'))
        self.assertNotEqual(owned.path, other.path)

    def test_symlinked_run_refuses_without_writing_foreign_directory(self):
        foreign = self.root / 'foreign'
        foreign.mkdir()
        (self.root / self.context.run_id).symlink_to(foreign, target_is_directory=True)
        with self.assertRaises(OSError):
            workspace.AttemptWorkspace(self.root, self.context)
        self.assertEqual(list(foreign.iterdir()), [])

    def test_modified_or_linked_owner_refuses_state_publication(self):
        owned = workspace.AttemptWorkspace(self.root, self.context)
        marker = owned.path / 'attempt_owner.json'
        original = marker.read_bytes()
        marker.write_text('{}')
        with self.assertRaisesRegex(ValueError, 'record differs'):
            owned.publish_state({'should_not': 'publish'})
        self.assertFalse((owned.path / 'state.json').exists())
        marker.write_bytes(original)
        os.link(marker, self.root / 'linked-owner')
        with self.assertRaisesRegex(ValueError, 'private regular'):
            owned.verify()

    def test_rename_during_replace_cannot_redirect_state_write(self):
        owned = workspace.AttemptWorkspace(self.root, self.context)
        moved = self.root / 'moved-attempt'
        real_replace = workspace.os.replace
        def rename_then_replace(*args, **kwargs):
            owned.path.rename(moved)
            owned.path.mkdir()
            (owned.path / 'state.json').write_text('{"foreign":true}')
            return real_replace(*args, **kwargs)
        with patch.object(workspace.os, 'replace', side_effect=rename_then_replace):
            owned.publish_state({'owned': True})
        self.assertTrue((moved / 'state.json').is_file(), 'Pinned publication left its owned directory')
        self.assertEqual(json.loads((moved / 'state.json').read_text()), {'owned': True})
        self.assertEqual(json.loads((owned.path / 'state.json').read_text()), {'foreign': True})
        with self.assertRaisesRegex(ValueError, 'directory identity changed'):
            owned.verify()

    def test_two_processes_cannot_adopt_the_same_attempt_directory(self):
        program = '''
import json,sys
from model_attempt_invocation import AttemptContext
from model_attempt_workspace import AttemptWorkspace
try:
 AttemptWorkspace(sys.argv[1],AttemptContext(**json.loads(sys.argv[2])))
except ValueError as error:
 if 'already exists' not in str(error): raise
 sys.exit(2)
'''
        processes = [subprocess.Popen([sys.executable, '-B', '-c', program, str(self.root),
                     json.dumps(asdict(self.context))], cwd=Path(__file__).parent,
                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) for _ in range(2)]
        for process in processes:
            stdout, stderr = process.communicate(timeout=20)
            self.assertIn(process.returncode, (0, 2), stderr)
        self.assertCountEqual([process.returncode for process in processes], [0, 2])


class WorkspaceBindingTests(unittest.TestCase):
    setUp = writer_tests.WriterTests.setUp
    response = output_tests.OutputTests.response

    def test_aequilibrae_uses_attempt_directory_and_pinned_state(self):
        with patch.object(aeq, 'RUN_WORK_ROOT', str(self.directory / 'work')), managed.bind(self.writer):
            path = aeq.run_work_directory(IDS[1])
            self.assertEqual(Path(path), self.writer.files.path)
            self.assertIn(IDS[3], Path(path).parts)
            aeq.write_run_state(path, {'setup': {'synthetic': True}})
            self.assertEqual(json.loads((Path(path) / 'state.json').read_text()), {'setup': {'synthetic': True}})
            self.assertEqual(aeq.run_work_directory(IDS[1]), path)
            with self.assertRaises(aeq.WorkerStateWriteUnconfirmed):
                aeq.write_run_state(str(self.directory), {'foreign': True})
        self.assertFalse((self.directory / 'state.json').exists())

    def test_bound_state_registers_exact_original_bytes_before_completion(self):
        state = {'package': {'package_dir': '/original/package'},
                 'assignment': {'counts_path': '/original/counts.json',
                                'network_state_record': {'source': '/frozen/reference'}}}
        with patch.object(aeq, 'RUN_WORK_ROOT', str(self.directory / 'work')), managed.bind(self.writer):
            path = Path(aeq.run_work_directory(IDS[1]))
            aeq.write_run_state(str(path), state)
            retained = (path / 'predecessor_state.json').read_bytes()
            self.assertTrue(self.post.called, 'Retained state was not registered')
            payload = self.post.call_args.kwargs['json']['p_payload']
            self.assertEqual(payload['artifact_type'], 'model_predecessor_state')
            self.assertEqual(payload['file_url'], 'local://' + str(path / 'predecessor_state.json'))
            self.assertEqual(payload['content_hash'], hashlib.sha256(retained).hexdigest())
            self.assertEqual(payload['file_size_bytes'], len(retained))
            self.assertEqual(json.loads(retained), state)
            (path / 'state.json').write_text('{}')
            self.assertEqual((path / 'predecessor_state.json').read_bytes(), retained)
            self.assertFalse(self.writer.stopped)
        self.post.assert_called_once()

    def test_lost_state_registration_stops_before_terminal_update(self):
        import model_command_journal as journal
        self.post.side_effect = TimeoutError('Synthetic state registration lost reply')
        with patch.object(aeq, 'RUN_WORK_ROOT', str(self.directory / 'work')), managed.bind(self.writer):
            path = Path(aeq.run_work_directory(IDS[1]))
            with self.assertRaises(aeq.WorkerStateWriteUnconfirmed):
                aeq.write_run_state(str(path), {'setup': {'synthetic': True}})
            self.assertTrue((path / 'predecessor_state.json').is_file())
            self.assertTrue(self.writer.stopped)
            pending = journal.pending(self.directory, self.writer.context.destination)
            self.assertEqual(len(pending), 1)
            self.assertEqual(pending[0]['command']['operation'], 'write_model_attempt_artifact')
            with self.assertRaises(aeq.WorkerStateWriteUnconfirmed):
                aeq.sb_patch_stage(IDS[2], {'status': 'succeeded'})
        self.post.assert_called_once()

    def test_activitysim_uses_attempt_directory_and_refuses_other_run(self):
        with patch.object(activity, 'ACTIVITYSIM_WORK_DIR', str(self.directory / 'work')), managed.bind(self.writer):
            path = activity.create_run_workspace(IDS[1])
            self.assertEqual(Path(path), self.writer.files.path)
            self.assertEqual(activity.create_run_workspace(IDS[1]), path)
            with self.assertRaises(activity.WorkerStateWriteUnconfirmed):
                activity.create_run_workspace(IDS[0])

    def test_changed_owner_stops_later_database_write(self):
        path = self.writer.workspace(self.directory / 'work', IDS[1])
        (path / 'attempt_owner.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'record differs'):
            self.writer.patch_stage(IDS[2], {'status': 'succeeded'})
        self.post.assert_not_called()


if __name__ == '__main__':
    unittest.main()
