"""Native count/sidecar retention and actual assignment adapter checks."""
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import model_count_inputs as inputs
import model_attempt_writer as managed
import model_command_journal as journal
import test_model_attempt_writer as writer_tests
import test_model_attempt_outputs as output_tests
from test_model_command_client import IDS
from test_model_skip_dispatch import aeq


class CountRetentionTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.source = self.root / 'external.csv'
        self.source.write_bytes(b'station_id,count_year,aadt\nA,2020,123\n')
        self.sidecar = Path(str(self.source) + '.count-source.json')
        self.sidecar.write_text('{"source":{"dataset_id":"synthetic-original","vintage":"2020"}}')
        self.status = self.root / 'count_source_status.json'
        self.status.write_text('{"status":"supplied","dataset_id":"synthetic-original"}')
        self.target = self.root / 'retained'

    def retain(self):
        return inputs.retain(str(self.source), str(self.root), self.target)

    def test_original_bytes_and_sidecars_survive_source_changes(self):
        result = self.retain()
        original = self.source.read_bytes()
        retained = Path(result['counts_path'])
        self.assertEqual(retained.read_bytes(), original)
        self.assertNotEqual(retained.stat().st_ino, self.source.stat().st_ino)
        self.assertEqual(retained.stat().st_mode & 0o777, 0o600)
        manifest = json.loads(Path(result['manifest_path']).read_bytes())
        self.assertEqual(manifest['files']['counts.csv']['sha256'], hashlib.sha256(original).hexdigest())
        for name, source in [('counts.csv.count-source.json', self.sidecar), ('count_source_status.json', self.status)]:
            self.assertEqual((self.target / name).read_bytes(), source.read_bytes())
        self.source.write_bytes(b'changed')
        self.sidecar.write_text('{}')
        self.status.write_text('{}')
        self.assertEqual(retained.read_bytes(), original)
        self.assertEqual(json.loads((self.target / 'counts.csv.count-source.json').read_text())['source']['vintage'], '2020')
        with self.assertRaises(FileExistsError):
            self.retain()
        self.assertEqual(retained.read_bytes(), original)

    def test_missing_source_stays_missing_when_original_later_appears(self):
        self.source.unlink()
        result = self.retain()
        self.assertEqual(result['counts_status'], 'unavailable')
        self.source.write_bytes(b'late data')
        self.assertFalse(Path(result['counts_path']).exists())
        self.assertEqual(json.loads(Path(result['manifest_path']).read_text())['files']['counts.csv']['status'], 'unavailable')

    def test_symlink_hardlink_and_fifo_sources_are_refused(self):
        original = self.root / 'original'
        self.source.rename(original)
        self.source.symlink_to(original)
        real_open = inputs.os.open
        foreign_opened = []
        def observed_open(path, *args, **kwargs):
            descriptor = real_open(path, *args, **kwargs)
            if os.readlink('/proc/self/fd/' + str(descriptor)) == str(original):
                foreign_opened.append(descriptor)
            return descriptor
        with patch.object(inputs.os, 'open', side_effect=observed_open):
            with self.assertRaises((OSError, ValueError)):
                self.retain()
        self.assertEqual(foreign_opened, [], 'Symlink target was opened')
        self.assertFalse((self.target / 'manifest.json').exists())
        self.source.unlink()
        os.link(original, self.source)
        self.target = self.root / 'hardlink-target'
        with self.assertRaisesRegex(ValueError, 'private regular'):
            self.retain()
        self.source.unlink()
        os.mkfifo(self.source)
        self.target = self.root / 'fifo-target'
        with self.assertRaisesRegex(ValueError, 'private regular'):
            self.retain()

    def test_source_replacement_before_manifest_refuses_completion(self):
        original_stat = inputs.os.stat
        changed = False
        def replace_then_stat(path, *args, **kwargs):
            nonlocal changed
            if path == self.source and kwargs.get('follow_symlinks') is False and not changed:
                changed = True
                replacement = self.root / 'replacement'
                replacement.write_bytes(self.source.read_bytes())
                os.replace(replacement, self.source)
            return original_stat(path, *args, **kwargs)
        with patch.object(inputs.os, 'stat', side_effect=replace_then_stat):
            with self.assertRaisesRegex(ValueError, 'changed during retention'):
                self.retain()
        self.assertFalse((self.target / 'manifest.json').exists())

    def test_sidecar_appearance_before_manifest_refuses_completion(self):
        self.sidecar.unlink()
        original_stat = inputs.os.stat
        def add_then_stat(path, *args, **kwargs):
            if path == self.source and kwargs.get('follow_symlinks') is False:
                self.sidecar.write_text('{}')
            return original_stat(path, *args, **kwargs)
        with patch.object(inputs.os, 'stat', side_effect=add_then_stat):
            with self.assertRaisesRegex(ValueError, 'absent count input appeared'):
                self.retain()
        self.assertFalse((self.target / 'manifest.json').exists())

    def test_actual_assignment_retains_inputs_before_opening_engine_project(self):
        from worker_import_for_tests import mock_engine_runtime
        output = self.root / 'run' / 'run_output'
        source = self.source
        class StopBeforeEngine(Exception):
            pass
        class Project:
            def open(self, path):
                self_test.assertEqual((output / 'count_inputs/counts.csv').read_bytes(), source.read_bytes())
                self_test.assertTrue((output / 'count_inputs/manifest.json').is_file())
                raise StopBeforeEngine()
            def close(self):
                pass
        self_test = self
        with mock_engine_runtime(Project), patch.object(aeq, 'sb_get_run', return_value={}), patch.object(
            aeq, 'auto_ingest_counts', return_value=str(self.source)), patch.object(aeq, 'sb_patch_stage'):
            with self.assertRaises(StopBeforeEngine):
                aeq.stage_assignment(IDS[1], IDS[2], str(self.root / 'run'),
                    {'centroid_map': {1: 1}, 'bbox': (-122, 38, -120, 40)}, 'unused-package')


class BoundCountRetentionTests(unittest.TestCase):
    setUp = writer_tests.WriterTests.setUp
    response = output_tests.OutputTests.response

    def prepare(self):
        self.source = self.directory / 'external.csv'
        self.source.write_text('station_id,count_year,aadt\nA,2020,123\n')
        path = self.writer.workspace(self.directory / 'runs', IDS[1]) / 'run_output'
        path.mkdir()
        return path

    def test_bound_helper_registers_manifest_of_consumed_bytes(self):
        output = self.prepare()
        with managed.bind(self.writer):
            result = aeq.retain_assignment_counts(str(self.source), str(output), status_directory=str(self.directory))
        payload = self.post.call_args.kwargs['json']['p_payload']
        content = Path(result['manifest_path']).read_bytes()
        self.assertEqual(payload['artifact_type'], 'model_count_inputs')
        self.assertEqual(payload['content_hash'], hashlib.sha256(content).hexdigest())
        self.assertEqual(payload['file_size_bytes'], len(content))
        self.assertEqual(Path(result['counts_path']).read_bytes(), self.source.read_bytes())
        self.post.assert_called_once()

    def test_uncertain_manifest_registration_stops_before_engine_work(self):
        output = self.prepare()
        self.post.side_effect = TimeoutError('Synthetic lost reply')
        with managed.bind(self.writer):
            with self.assertRaises(aeq.WorkerStateWriteUnconfirmed):
                aeq.retain_assignment_counts(str(self.source), str(output), status_directory=str(self.directory))
            self.assertTrue(self.writer.stopped)
            pending = journal.pending(self.directory, self.writer.context.destination)
            self.assertEqual(len(pending), 1)
            self.assertEqual(pending[0]['command']['arguments']['payload']['artifact_type'], 'model_count_inputs')
        self.post.assert_called_once()

    def test_bound_helper_refuses_foreign_destination(self):
        self.prepare()
        foreign = self.directory / 'foreign'
        foreign.mkdir()
        with managed.bind(self.writer):
            with self.assertRaisesRegex(aeq.WorkerStateWriteUnconfirmed, 'reconciliation'):
                aeq.retain_assignment_counts(str(self.source), str(foreign), status_directory=str(self.directory))
        self.assertTrue(self.writer.stopped)
        self.assertEqual(list(foreign.iterdir()), [])
        self.post.assert_not_called()


    def test_bound_artifact_consumer_registers_verified_copy(self):
        output = self.prepare()
        original = inputs.retain(str(self.source), str(self.directory), self.directory / 'original-counts')
        with managed.bind(self.writer):
            retained = aeq.retain_assignment_counts(original['counts_path'], str(output),
                status_directory=str(self.directory), retained_record=original, artifact_consumer=True)
        self.assertEqual(retained['counts_input_directory'], str(output / 'artifact_count_inputs'))
        payload = self.post.call_args.kwargs['json']['p_payload']
        self.assertEqual(payload['file_url'], 'local://' + retained['manifest_path'])
        self.assertEqual(payload['content_hash'], hashlib.sha256(Path(retained['manifest_path']).read_bytes()).hexdigest())
        self.assertNotEqual(Path(original['counts_path']).stat().st_ino, Path(retained['counts_path']).stat().st_ino)

    def test_bound_artifact_consumer_stops_before_registration_on_tampering(self):
        output = self.prepare()
        original = inputs.retain(str(self.source), str(self.directory), self.directory / 'original-counts')
        Path(original['counts_path']).write_bytes(b'changed')
        with managed.bind(self.writer):
            with self.assertRaises(aeq.WorkerStateWriteUnconfirmed):
                aeq.retain_assignment_counts(original['counts_path'], str(output),
                    status_directory=str(self.directory), retained_record=original, artifact_consumer=True)
        self.assertTrue(self.writer.stopped)
        self.post.assert_not_called()


if __name__ == '__main__':
    unittest.main()
