"""Native file-copy races and byte checks; producer authorization is separate."""
import hashlib
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import model_handoff_files as handoff
import model_attempt_writer as managed
import test_model_attempt_writer as writer_tests
from test_model_command_client import IDS
from test_model_skip_dispatch import activity

RUN = '00000001-1111-4111-8111-111111111111'


class HandoffFileTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.parent = self.root / 'runs' / RUN / 'inputs'
        self.parent.mkdir(parents=True)
        self.source = self.parent / 'input.bin'
        self.data = b'registered synthetic bytes'
        self.source.write_bytes(self.data)
        self.target = self.root / 'execution'
        self.target.mkdir()
        self.destination = self.target / 'input.retained'

    def copy(self, digest=None):
        return handoff.copy_registered(self.root, RUN, self.source, self.destination,
            sha256=digest or hashlib.sha256(self.data).hexdigest(), size_bytes=len(self.data))

    def test_verified_copy_is_private_and_never_overwrites(self):
        self.assertEqual(self.copy(), str(self.destination))
        self.assertEqual(self.destination.read_bytes(), self.data)
        self.assertEqual(self.destination.stat().st_mode & 0o777, 0o600)
        self.assertNotEqual(self.destination.stat().st_ino, self.source.stat().st_ino)
        self.source.write_bytes(b'changed')
        self.assertEqual(self.destination.read_bytes(), self.data)
        self.source.write_bytes(self.data)
        with self.assertRaises(FileExistsError):
            self.copy()
        self.assertEqual(list(self.target.iterdir()), [self.destination])

    def test_wrong_hash_never_publishes_a_destination(self):
        with self.assertRaisesRegex(ValueError, 'bytes differ'):
            self.copy('b' * 64)
        self.assertEqual(list(self.target.iterdir()), [])

    def test_source_symlink_swap_is_refused_before_foreign_open(self):
        foreign = self.root / 'foreign.bin'
        foreign.write_bytes(self.data)
        original_open = handoff.os.open
        foreign_opened = []
        swapped = False
        def swap_then_open(path, *args, **kwargs):
            nonlocal swapped
            if path == 'input.bin' and not swapped:
                swapped = True
                self.source.unlink()
                self.source.symlink_to(foreign)
            descriptor = original_open(path, *args, **kwargs)
            if os.readlink('/proc/self/fd/' + str(descriptor)) == str(foreign):
                foreign_opened.append(descriptor)
            return descriptor
        with patch.object(handoff.os, 'open', side_effect=swap_then_open):
            with self.assertRaises((OSError, ValueError)):
                self.copy()
        self.assertEqual(foreign_opened, [], 'Foreign file was opened after source-path validation')
        self.assertEqual(list(self.target.iterdir()), [])

    def test_parent_symlink_swap_is_refused_before_foreign_open(self):
        foreign = self.root / 'foreign'
        foreign.mkdir()
        (foreign / 'input.bin').write_bytes(self.data)
        original_open = handoff.os.open
        swapped = False
        def swap_then_open(path, *args, **kwargs):
            nonlocal swapped
            if path == 'inputs' and not swapped:
                swapped = True
                self.parent.rename(self.parent.with_name('original-inputs'))
                self.parent.symlink_to(foreign, target_is_directory=True)
            return original_open(path, *args, **kwargs)
        with patch.object(handoff.os, 'open', side_effect=swap_then_open):
            with self.assertRaises(OSError):
                self.copy()
        self.assertFalse(self.destination.exists())

    def test_source_replacement_after_read_refuses_publication(self):
        original_snapshot = handoff._snapshot
        changed = False
        def replace_after_read(info):
            nonlocal changed
            if not changed:
                changed = True
                replacement = self.parent / 'replacement'
                replacement.write_bytes(self.data)
                os.replace(replacement, self.source)
            return original_snapshot(info)
        # Replace before the helper's final named stat, after all bytes were read.
        original_stat = handoff.os.stat
        def replacement_stat(path, *args, **kwargs):
            if path == 'input.bin' and kwargs.get('dir_fd') is not None:
                replace_after_read(self.source.stat())
            return original_stat(path, *args, **kwargs)
        with patch.object(handoff.os, 'stat', side_effect=replacement_stat):
            with self.assertRaisesRegex(ValueError, 'changed during copy'):
                self.copy()
        self.assertEqual(list(self.target.iterdir()), [])

    def test_destination_rename_does_not_write_into_replacement(self):
        moved = self.root / 'moved-execution'
        original_link = handoff.os.link
        def rename_then_link(*args, **kwargs):
            self.target.rename(moved)
            self.target.mkdir()
            self.destination.write_bytes(b'foreign destination')
            return original_link(*args, **kwargs)
        with patch.object(handoff.os, 'link', side_effect=rename_then_link):
            with self.assertRaisesRegex(ValueError, 'destination directory changed'):
                self.copy()
        self.assertEqual(self.destination.read_bytes(), b'foreign destination')
        self.assertEqual((moved / self.destination.name).read_bytes(), self.data)

    def test_hard_link_and_fifo_sources_are_refused(self):
        os.link(self.source, self.parent / 'second-name')
        with self.assertRaisesRegex(ValueError, 'private regular'):
            self.copy()
        self.source.unlink()
        os.mkfifo(self.source)
        with self.assertRaisesRegex(ValueError, 'private regular'):
            self.copy()
        self.assertEqual(list(self.target.iterdir()), [])


class BoundHandoffTests(unittest.TestCase):
    setUp = writer_tests.WriterTests.setUp
    response = writer_tests.WriterTests.response

    def source(self):
        root = self.directory / 'aeq'
        source = root / 'runs' / IDS[1] / 'source.bin'
        source.parent.mkdir(parents=True)
        source.write_bytes(b'synthetic verified input')
        row = {'id': IDS[0], 'run_id': IDS[1], 'stage_id': IDS[4], 'attempt_id': IDS[0],
               'artifact_type': 'skim_matrix', 'file_url': 'local://' + str(source),
               'content_hash': hashlib.sha256(source.read_bytes()).hexdigest(),
               'file_size_bytes': source.stat().st_size,
               'model_run_stages': {'id': IDS[4], 'run_id': IDS[1], 'status': 'succeeded',
                                   'attempt_managed': True, 'active_attempt_id': IDS[0]}}
        return root, source, row

    def test_actual_bound_handoff_copies_into_owned_attempt(self):
        root, source, row = self.source()
        with patch.dict(os.environ, {'AEQ_WORK_DIR': str(root)}), patch.object(
            activity, 'ACTIVITYSIM_WORK_DIR', str(self.directory / 'activity')), managed.bind(self.writer):
            destination = activity.create_run_workspace(IDS[1])
            result = Path(activity._retain_handoff_file([row], 'skim_matrix', IDS[1], destination))
            self.assertEqual(result.read_bytes(), source.read_bytes())
            self.assertEqual(result.parent, self.writer.files.path)
            self.assertNotEqual(result.stat().st_ino, source.stat().st_ino)
        self.post.assert_not_called()

    def test_bound_handoff_refuses_unowned_destination_and_stops_writer(self):
        root, source, row = self.source()
        with patch.dict(os.environ, {'AEQ_WORK_DIR': str(root)}), managed.bind(self.writer):
            self.writer.workspace(self.directory / 'activity', IDS[1])
            foreign = self.directory / 'foreign'
            foreign.mkdir()
            with self.assertRaisesRegex(RuntimeError, 'not the owned attempt'):
                activity._retain_handoff_file([row], 'skim_matrix', IDS[1], str(foreign))
            self.assertEqual(list(foreign.iterdir()), [])
            self.assertTrue(self.writer.stopped)
        self.post.assert_not_called()


    def agreement_fixture(self):
        import test_activitysim_assignment_handoff as agreement
        root, source, row = self.source()
        row['artifact_type'] = 'link_volumes'
        metadata = agreement.main.assignment_artifact_metadata(agreement.identity_record(0.0004), 'link_volumes.csv')
        row['metadata_json'] = metadata
        keys = ('assignment_profile', 'assignment_profile_payload_json', 'assignment_profile_digest',
                'network_settings', 'network_settings_payload_json', 'network_settings_digest',
                'network_state_record', 'network_state_digest')
        return agreement.main, root, source, row, {'expected_' + key: metadata[key] for key in keys}

    def test_actual_bound_agreement_retains_owned_independent_bytes(self):
        worker, root, source, row, kwargs = self.agreement_fixture()
        with patch.object(worker, 'RUN_WORK_ROOT', str(root)), patch.object(
            worker, 'sb_get_run_artifacts', return_value=[row]), managed.bind(self.writer):
            destination = self.writer.workspace(root / 'runs', IDS[1])
            result = Path(worker.verified_latest_local_artifact(IDS[1], 'link_volumes',
                retained_directory=str(destination), **kwargs))
            self.assertEqual(result.parent, self.writer.files.path)
            expected = source.read_bytes()
            source.write_bytes(b'changed predecessor')
            self.assertEqual(result.read_bytes(), expected)
            self.assertFalse(self.writer.stopped)
        self.post.assert_not_called()

    def test_bound_agreement_refuses_another_directory_and_stops(self):
        worker, root, source, row, kwargs = self.agreement_fixture()
        with patch.object(worker, 'RUN_WORK_ROOT', str(root)), patch.object(
            worker, 'sb_get_run_artifacts', return_value=[row]), managed.bind(self.writer):
            self.writer.workspace(root / 'runs', IDS[1])
            other = root / 'runs' / IDS[1] / 'other'
            other.mkdir()
            with self.assertRaisesRegex(RuntimeError, 'not the owned attempt'):
                worker.verified_latest_local_artifact(IDS[1], 'link_volumes',
                    retained_directory=str(other), **kwargs)
            self.assertTrue(self.writer.stopped)
            self.assertEqual(list(other.iterdir()), [])
        self.post.assert_not_called()


if __name__ == '__main__':
    unittest.main()
