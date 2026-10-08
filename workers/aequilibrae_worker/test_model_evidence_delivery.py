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
