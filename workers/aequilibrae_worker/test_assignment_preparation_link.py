"""Real preparation files and receipts; synthetic solver and database transport."""
from pathlib import Path
import unittest
from unittest.mock import patch

import model_attempt_writer as managed
import model_assignment_input_snapshot as snapshot
import model_assignment_preparation_link as link
import test_model_preparation_handoff as handoff
import test_assignment_input_snapshot as inputs


class PreparationLinkTests(unittest.TestCase):
    response = handoff.HandoffTests.response

    def setUp(self):
        handoff.HandoffTests.setUp(self)
        with managed.bind(self.writer):
            self.retained = handoff.aeq.retain_managed_validation_preparation('aequilibrae')
        self.get.return_value.json.return_value[0]['stage_name'] = 'Network Assignment'
        self.writer.get = self.get
        self.post.reset_mock()
        fixture = inputs.SnapshotTests(); fixture.setUp(); self.addCleanup(fixture.doCleanups)
        self.engine = fixture.engine; self.profile = fixture.profile
        self.output = self.writer.files.path / 'run_output'; self.output.mkdir()

    def execute(self):
        with managed.bind(self.writer):
            return snapshot.retain_and_execute(self.engine,
                directory=self.output / 'initial_assignment_inputs',
                context={'run_id': self.writer.context.run_id, 'stage_id': self.writer.context.stage_id,
                         'demand_method': 'aequilibrae'},
                profile=self.profile, network_state={}, network_settings={})

    def test_parent_links_confirmed_consumption_before_solver(self):
        def verify():
            metadata = self.post.call_args.kwargs['json']['p_payload']['metadata_json']
            record = metadata['preparation_link']
            self.assertEqual(record['status'], 'retained')
            self.assertEqual(record['producer'], self.retained['producer'])
            self.assertEqual(record['manifest_sha256'], self.retained['manifest_sha256'])
            self.assertEqual(record['solver_input_equivalence'], 'unassessed')
            self.assertEqual(metadata['scientific_acceptance'], 'unassessed')
            self.assertEqual(metadata['preparation_independence'], 'unassessed')
        self.engine.execute.side_effect = verify
        self.execute(); self.engine.execute.assert_called_once()

    def test_changed_source_stops_before_snapshot_registration_or_solver(self):
        path = next(iter(self.retained['source_paths'].values()))
        Path(path).write_bytes(b'changed after consumption confirmation')
        with self.assertRaisesRegex(ValueError, 'source bytes differ'): self.execute()
        self.engine.execute.assert_not_called(); self.post.assert_not_called()
        self.assertTrue(self.writer.stopped)

    def test_changed_consumer_manifest_stops_before_solver(self):
        Path(self.retained['manifest_path']).write_text('{}')
        with self.assertRaisesRegex(ValueError, 'file bytes differ'): self.execute()
        self.engine.execute.assert_not_called(); self.post.assert_not_called()

    def test_wrong_method_is_not_treated_as_missing(self):
        with self.assertRaisesRegex(ValueError, 'method, location or claims'):
            link.retained_preparation(self.writer, 'activitysim')

    def test_changed_preserved_documents_refuse(self):
        directory = Path(self.retained['manifest_path']).parent
        for name in ('producer_manifest.json', 'validation_input_bundle.json'):
            path = directory / name
            original = path.read_bytes()
            try:
                path.write_bytes(original + b' ')
                with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'file bytes differ'):
                    link.retained_preparation(self.writer, 'aequilibrae')
            finally:
                path.write_bytes(original)

    def test_other_attempt_cannot_supply_this_assignments_link(self):
        read = link.journal.read_existing
        def foreign(*args, **kwargs):
            saved = read(*args, **kwargs)
            for row in saved:
                if row['command']['operation'] == 'write_model_attempt_artifact':
                    row['command']['arguments']['attempt_id'] = self.producer['active_attempt_id']
            return saved
        with patch.object(link.journal, 'read_existing', foreign):
            self.assertEqual(link.retained_preparation(self.writer, 'aequilibrae'),
                {'status': 'not_retained', 'solver_input_equivalence': 'unassessed'})

    def test_duplicate_consumption_refuses(self):
        read = link.journal.read_existing
        def duplicate(*args, **kwargs):
            saved = read(*args, **kwargs)
            return saved + [row for row in saved if row['command']['operation'] == 'write_model_attempt_artifact']
        with patch.object(link.journal, 'read_existing', duplicate):
            with self.assertRaisesRegex(ValueError, 'one confirmed consumption'): self.execute()
        self.engine.execute.assert_not_called(); self.post.assert_not_called()

    def test_corrupt_saved_receipt_refuses(self):
        read = link.journal.read_existing
        def corrupt(*args, **kwargs):
            saved = read(*args, **kwargs)
            for row in saved:
                if row['command']['operation'] == 'write_model_attempt_artifact':
                    row['response']['content_hash'] = '0' * 64
            return saved
        with patch.object(link.journal, 'read_existing', corrupt):
            with self.assertRaises(link.client.DeliveryUnconfirmed): self.execute()
        self.engine.execute.assert_not_called(); self.post.assert_not_called()


if __name__ == '__main__': unittest.main()
