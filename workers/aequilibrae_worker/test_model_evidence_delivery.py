"""Contain uncertain legacy writes without claiming atomic publication."""
import unittest
from unittest import mock
from types import SimpleNamespace
from worker_import_for_tests import import_worker_main

main = import_worker_main()
VALIDATION = {
    'stations_matched': 1, 'median_ape': 20, 'max_ape': 20,
    'validation_rules_version': 4,
    'model_validation_assessment': {'scientific_outcome': 'inconclusive'},
}

class EvidenceDeliveryTests(unittest.TestCase):
    def deliver(self, statuses, *, failure_at=None, workspace='workspace-fixture'):
        calls = []
        def transport(method):
            def send(url, **kwargs):
                index = len(calls)
                calls.append((method, url, kwargs))
                if failure_at == index:
                    raise main.requests.Timeout('private transport detail')
                return SimpleNamespace(status_code=statuses[index])
            return send
        with mock.patch.object(main.requests, 'post', side_effect=transport('POST')), \
             mock.patch.object(main.requests, 'delete', side_effect=transport('DELETE')):
            try:
                main.write_model_run_modeling_evidence(
                    'run-fixture', workspace, VALIDATION, track='behavioral_demand',
                )
            except main.WorkerStateWriteUnconfirmed as error:
                return calls, error
        return calls, None

    def test_rejected_write_stops_before_any_later_write(self):
        for position in range(3):
            for rejected in (202, 302, 401, 403, 409, 500, 503):
                with self.subTest(position=position, rejected=rejected):
                    statuses = [201, 204, 201]
                    statuses[position] = rejected
                    calls, error = self.deliver(statuses)
                    self.assertIsInstance(error, main.WorkerStateWriteUnconfirmed)
                    self.assertEqual(len(calls), position + 1)

    def test_lost_reply_remains_unconfirmed_without_more_writes(self):
        for position in range(3):
            with self.subTest(position=position):
                calls, error = self.deliver([201, 204, 201], failure_at=position)
                self.assertIsInstance(error, main.WorkerStateWriteUnconfirmed)
                self.assertEqual(len(calls), position + 1)
                self.assertNotIn('private transport detail', str(error))

    def test_missing_workspace_does_not_report_success(self):
        calls, error = self.deliver([], workspace=None)
        self.assertIsInstance(error, main.WorkerStateWriteUnconfirmed)
        self.assertEqual(calls, [])

    def test_acknowledged_sequence_preserves_separate_track_and_bounded_transport(self):
        for statuses in ([200, 200, 200], [201, 204, 201]):
            calls, error = self.deliver(statuses)
            self.assertIsNone(error)
            self.assertEqual([call[0] for call in calls], ['POST', 'DELETE', 'POST'])
            self.assertEqual(calls[0][2]['json']['track'], 'behavioral_demand')
            self.assertIn('track=eq.behavioral_demand', calls[1][1])
            self.assertTrue(all(row['track'] == 'behavioral_demand' for row in calls[2][2]['json']))
            self.assertEqual(calls[0][2]['json']['claim_status'], 'prototype_only')
            for _, _, kwargs in calls:
                self.assertEqual(kwargs['timeout'], 20)
                self.assertIs(kwargs['allow_redirects'], False)

    def test_rules_v4_pass_requires_explicit_recorded_evidence(self):
        import copy
        for track in ('assignment', 'behavioral_demand'):
            for state in ('missing', None, '', 'pending', 'validation evidence write failed', True, 1, {}, []):
                with self.subTest(track=track, state=state):
                    source = copy.deepcopy(VALIDATION)
                    assessment = source['model_validation_assessment']
                    assessment['scientific_outcome'] = 'pass'
                    if state != 'missing':
                        assessment['validation_evidence_write'] = state
                    publication = main.build_model_run_modeling_evidence(
                        'run-fixture', 'workspace-fixture', source, track=track)
                    self.assertEqual(publication['claim']['claim_status'], 'prototype_only')
                    self.assertIn('not confirmed', publication['claim']['status_reason'])
            source = copy.deepcopy(VALIDATION)
            source['model_validation_assessment'].update(
                scientific_outcome='pass', validation_evidence_write='recorded')
            publication = main.build_model_run_modeling_evidence(
                'run-fixture', 'workspace-fixture', source, track=track)
            self.assertEqual(publication['claim']['claim_status'], 'screening_grade')
            self.assertIn('recorded planning use and partition', publication['claim']['status_reason'])

    def test_all_calculation_finishes_before_first_write(self):
        validation = dict(VALIDATION, validation_rules_version=3,
                          zone_resolution={'supports_link_level_validation': True})
        with mock.patch.object(main.count_validation, 'metric_status_for_gate', side_effect=ValueError('synthetic invalid metric')), \
             mock.patch.object(main.requests, 'post') as post, \
             mock.patch.object(main.requests, 'delete') as delete:
            with self.assertRaises(main.WorkerStateWriteUnconfirmed):
                main.write_model_run_modeling_evidence('run-fixture', 'workspace-fixture', validation)
            post.assert_not_called()
            delete.assert_not_called()

    def test_prepared_payload_is_detached_and_keeps_both_method_identities(self):
        import copy
        source = copy.deepcopy(VALIDATION)
        source['model_validation_assessment']['reasons'] = ['synthetic unresolved basis']
        with mock.patch.object(main.requests, 'post') as post, mock.patch.object(main.requests, 'delete') as delete:
            first = main.build_model_run_modeling_evidence('run-fixture', 'workspace-fixture', source)
            second = main.build_model_run_modeling_evidence('run-fixture', 'workspace-fixture', source, track='behavioral_demand')
            post.assert_not_called()
            delete.assert_not_called()
        source['model_validation_assessment']['reasons'].clear()
        for publication, track in ((first, 'assignment'), (second, 'behavioral_demand')):
            self.assertEqual(publication['claim']['validation_summary_json']['model_validation_assessment']['reasons'], ['synthetic unresolved basis'])
            self.assertEqual(publication['claim']['track'], track)
            self.assertEqual(publication['claim']['claim_status'], 'prototype_only')
            self.assertEqual(len(publication['metrics']), 2)
            self.assertTrue(all(row['track'] == track for row in publication['metrics']))

    def test_nonfinite_preparation_never_starts_publication(self):
        with mock.patch.object(main.requests, 'post') as post, mock.patch.object(main.requests, 'delete') as delete:
            with self.assertRaises(main.WorkerStateWriteUnconfirmed):
                main.write_model_run_modeling_evidence('run-fixture', 'workspace-fixture', dict(VALIDATION, median_ape=float('nan')))
            post.assert_not_called()
            delete.assert_not_called()

    def test_artifact_caller_propagates_uncertainty_before_success_log(self):
        # Execute the actual publication try block without running a model.
        import ast
        from pathlib import Path
        tree = ast.parse(Path(main.__file__).read_text())
        blocks = [node for node in ast.walk(tree) if isinstance(node, ast.Try)
                  and any(isinstance(statement, ast.Expr)
                          and isinstance(statement.value, ast.Call)
                          and isinstance(statement.value.func, ast.Name)
                          and statement.value.func.id == 'write_model_run_modeling_evidence'
                          for statement in node.body)]
        self.assertEqual(len(blocks), 1)
        def uncertain(*args):
            raise main.WorkerStateWriteUnconfirmed('synthetic lost reply')
        namespace = {
            'write_model_run_modeling_evidence': uncertain,
            'WorkerStateWriteUnconfirmed': main.WorkerStateWriteUnconfirmed,
            'run_id': 'run-fixture', '_ws_id': 'workspace-fixture',
            'validation': VALIDATION, 'calibration_result': None,
            'independent_validation_result': None, 'log': '',
        }
        with self.assertRaises(main.WorkerStateWriteUnconfirmed):
            exec(compile(ast.Module(body=blocks, type_ignores=[]), main.__file__, 'exec'), namespace)
        self.assertEqual(namespace['log'], '')

if __name__ == '__main__':
    unittest.main()
