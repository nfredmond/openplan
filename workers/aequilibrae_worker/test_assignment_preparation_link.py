"""Real preparation files and receipts; synthetic solver and database transport."""
from pathlib import Path
import shutil
import sqlite3
import unittest
from unittest.mock import patch

import model_attempt_writer as managed
import model_assignment_input_snapshot as snapshot
import model_assignment_preparation_link as link
import assignment_settings
import model_assignment_network_source as network_source
import test_model_preparation_handoff as handoff
import test_assignment_input_snapshot as inputs


class PreparationLinkTests(unittest.TestCase):
    response = handoff.HandoffTests.response

    def setUp(self):
        fixture = inputs.SnapshotTests(); fixture.setUp(); self.addCleanup(fixture.doCleanups)
        self.engine = fixture.engine
        with patch.object(assignment_settings, 'installed_assignment_engine_version', return_value='1.6.2'):
            self.profile = assignment_settings.resolve_assignment_profile({'AEQ_CORES': '1'})
        self.engine.rgap_target = self.profile['target_gap']
        self.engine.max_iter = self.profile['max_iterations']
        handoff.HandoffTests.setUp(self, assignment_profile=self.profile)
        with managed.bind(self.writer):
            self.retained = handoff.aeq.retain_managed_validation_preparation('aequilibrae')
        self.get.return_value.json.return_value[0]['stage_name'] = 'Network Assignment'
        self.writer.get = self.get
        self.post.reset_mock()
        self.output = self.writer.files.path / 'run_output'; self.output.mkdir()
        self.network_database = self.writer.files.path / 'assignment-network.sqlite'
        shutil.copyfile(self.retained['source_paths']['network'],self.network_database)

    def execute(self):
        with managed.bind(self.writer):
            return snapshot.retain_and_execute(self.engine,
                directory=self.output / 'initial_assignment_inputs',
                context={'run_id': self.writer.context.run_id, 'stage_id': self.writer.context.stage_id,
                         'demand_method': 'aequilibrae'},
                profile=self.profile, network_state={}, network_settings={},network_database=self.network_database)

    def test_parent_links_confirmed_consumption_before_solver(self):
        def verify():
            metadata = self.post.call_args.kwargs['json']['p_payload']['metadata_json']
            record = metadata['preparation_link']
            self.assertEqual(record['status'], 'retained')
            self.assertEqual(record['producer'], self.retained['producer'])
            self.assertEqual(record['manifest_sha256'], self.retained['manifest_sha256'])
            self.assertEqual(record['solver_input_equivalence'], 'unassessed')
            self.assertEqual(record['assignment_profile']['status'], 'matched')
            self.assertEqual(record['assignment_profile']['scope'], 'declared_assignment_profile')
            self.assertEqual(record['network_source']['status'], 'matched')
            self.assertEqual(record['network_source']['scope'], 'source_node_link_records')
            self.assertEqual(record['assignment_profile']['canonical_sha256'], assignment_settings.assignment_profile_digest(self.profile))
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
            link.retained_preparation(self.writer, 'activitysim', assignment_profile=self.profile)

    def test_changed_preserved_documents_refuse(self):
        directory = Path(self.retained['manifest_path']).parent
        for name in ('producer_manifest.json', 'validation_input_bundle.json'):
            path = directory / name
            original = path.read_bytes()
            try:
                path.write_bytes(original + b' ')
                with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'file bytes differ'):
                    link.retained_preparation(self.writer, 'aequilibrae', assignment_profile=self.profile,
                        network_source=network_source.identity(self.network_database))
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
            self.assertEqual(link.retained_preparation(self.writer, 'aequilibrae', assignment_profile=self.profile),
                {'status': 'not_retained', 'solver_input_equivalence': 'unassessed'})

    def test_changed_profile_stops_before_solver_even_when_engine_matches_it(self):
        self.profile['target_gap'] /= 2
        self.engine.rgap_target = self.profile['target_gap']
        self.engine.assignment.rgap_target = self.profile['target_gap']
        with self.assertRaisesRegex(ValueError, 'Prepared assignment profile differs'): self.execute()
        self.engine.execute.assert_not_called(); self.post.assert_not_called()
        self.assertTrue(self.writer.stopped)

    def test_engine_version_and_core_changes_refuse(self):
        for key, value in (('engine_version', '1.6.3'), ('cores', 2), ('max_iterations', 4000)):
            changed = {**self.profile, key: value}
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, 'Prepared assignment profile differs'):
                link.retained_preparation(self.writer, 'aequilibrae', assignment_profile=changed)

    def test_incomplete_profile_refuses(self):
        with self.assertRaises(assignment_settings.AssignmentSettingsError):
            link.retained_preparation(self.writer, 'aequilibrae', assignment_profile={})

    def test_incomplete_prepared_profile_refuses(self):
        fixture = handoff.HandoffTests(); fixture.setUp(); self.addCleanup(fixture.doCleanups)
        with managed.bind(fixture.writer):
            handoff.aeq.retain_managed_validation_preparation('aequilibrae')
        with self.assertRaises(assignment_settings.AssignmentSettingsError):
            link.retained_preparation(fixture.writer, 'aequilibrae', assignment_profile=self.profile)

    def test_changed_working_network_refuses_before_registration_and_solver(self):
        with sqlite3.connect(self.network_database) as connection:
            connection.execute('UPDATE links SET capacity_ab=999')
        with self.assertRaisesRegex(ValueError,'Prepared network source differs'):self.execute()
        self.post.assert_not_called();self.engine.execute.assert_not_called()
        self.assertTrue(self.writer.stopped)

    def test_missing_working_network_identity_is_not_assumed_equal(self):
        with self.assertRaisesRegex(ValueError,'Prepared network source differs'):
            link.retained_preparation(self.writer,'aequilibrae',assignment_profile=self.profile)

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
