"""A storage acknowledgement must identify the submitted validation assessment."""
import copy
import unittest
from unittest.mock import Mock, patch
from worker_import_for_tests import import_worker_main

main = import_worker_main()
IDS = [f'{n:08d}-1111-4111-8111-111111111111' for n in range(1, 10)]


def fixture():
    payload = {
        'p_workspace_id': IDS[0], 'p_model_run_id': IDS[1], 'p_stage_id': IDS[2],
        'p_track': 'assignment', 'p_model_output_artifact_id': IDS[3],
        'p_comparison_basis_sha256': 'a' * 64, 'p_partition': {'count': 1},
        'p_planning_use': 'synthetic test only', 'p_scientific_outcome': 'inconclusive',
        'p_reasons': ['Synthetic unresolved evidence'],
    }
    for kind in ('validation_input', 'comparison_basis', 'assessment'):
        payload.update({f'p_{kind}_file_url': f'storage://run-artifacts/synthetic/{kind}.json',
                        f'p_{kind}_size': 2, f'p_{kind}_sha256': 'a' * 64,
                        f'p_{kind}_metadata': {}})
    row = {
        'id': IDS[4], 'workspace_id': IDS[0], 'model_run_id': IDS[1], 'track': 'assignment',
        'model_output_artifact_id': IDS[3], 'validation_input_bundle_artifact_id': IDS[5],
        'comparison_basis_artifact_id': IDS[6], 'model_validation_assessment_artifact_id': IDS[7],
        'comparison_basis_sha256': 'a' * 64, 'validation_rules_version': 4,
        'partition_json': {'count': 1}, 'planning_use': 'synthetic test only',
        'scientific_outcome': 'inconclusive', 'reasons_json': ['Synthetic unresolved evidence'],
    }
    return payload, row


class AssessmentReceiptTests(unittest.TestCase):
    def send(self, payload, result, status=200):
        with patch.object(main.requests, 'post', return_value=Mock(status_code=status, json=Mock(return_value=result))) as post:
            value = main.sb_record_modeling_validation_assessment(payload)
        return value, post

    def test_exact_single_receipt_and_transport(self):
        for track in ('assignment', 'behavioral_demand'):
            for outcome in ('pass', 'fail', 'inconclusive'):
                payload, row = fixture()
                payload.update(p_track=track, p_scientific_outcome=outcome)
                row.update(track=track, scientific_outcome=outcome)
                for result in (row, [row]):
                    value, post = self.send(payload, result)
                    self.assertEqual(value, row)
                    kwargs = post.call_args.kwargs
                    self.assertEqual(kwargs['json'], payload)
                    self.assertIs(kwargs['allow_redirects'], False)
                    self.assertEqual(kwargs['timeout'], 30)

    def test_unrelated_or_missing_receipt_fields_are_unconfirmed(self):
        payload, row = fixture()
        for key in row:
            for replacement in (None, 'unrelated'):
                with self.subTest(key=key, replacement=replacement):
                    altered = copy.deepcopy(row)
                    altered[key] = replacement
                    with self.assertRaises(main.WorkerStateWriteUnconfirmed):
                        self.send(payload, altered)
            missing = copy.deepcopy(row)
            del missing[key]
            with self.subTest(missing=key), self.assertRaises(main.WorkerStateWriteUnconfirmed):
                self.send(payload, missing)

    def test_ambiguous_shape_types_and_artifact_reuse_are_unconfirmed(self):
        payload, row = fixture()
        invalid = [True, 'recorded', 1, {}, [], [row, row], [True],
                   {**row, 'partition_json': {'count': True}},
                   {**row, 'comparison_basis_artifact_id': row['model_output_artifact_id']}]
        for result in invalid:
            with self.subTest(result=result), self.assertRaises(main.WorkerStateWriteUnconfirmed):
                self.send(payload, result)

    def test_rejected_or_lost_response_is_unconfirmed(self):
        payload, row = fixture()
        for status in (202, 204, 302, 401, 409, 500):
            with self.subTest(status=status), self.assertRaises(main.WorkerStateWriteUnconfirmed):
                self.send(payload, row, status)
        for response in (Mock(side_effect=main.requests.Timeout('private')), Mock(return_value=Mock(status_code=200, json=Mock(side_effect=ValueError('private'))))):
            with patch.object(main.requests, 'post', response), self.assertRaises(main.WorkerStateWriteUnconfirmed) as caught:
                main.sb_record_modeling_validation_assessment(payload)
            self.assertNotIn('private', str(caught.exception))


if __name__ == '__main__':
    unittest.main()
