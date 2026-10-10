"""Bound output adapters use real journals; transport and bytes are synthetic."""
import copy
from unittest.mock import Mock, patch
import unittest

import model_attempt_writer as managed
import model_attempt_invocation as invocation
import model_command_client as client
import model_command_journal as journal
import test_model_attempt_writer as writer_tests
from test_model_command_client import IDS
from test_model_skip_dispatch import aeq, activity


class OutputTests(unittest.TestCase):
    setUp = writer_tests.WriterTests.setUp

    def response(self, url, **kwargs):
        if not url.endswith(('/write_model_attempt_artifact', '/write_model_attempt_kpi')):
            return writer_tests.WriterTests.response(self, url, **kwargs)
        args = kwargs['json']
        saved = journal.pending(self.directory, self.cmd['destination'])
        self.assertEqual(len(saved), 1)
        self.assertEqual(saved[0]['command']['request_id'], args['p_request_id'])
        body = {'id': IDS[4], 'run_id': IDS[1], 'attempt_id': IDS[3], **args['p_payload']}
        if url.endswith('/write_model_attempt_artifact'):
            body.update(stage_id=IDS[2])
            body.setdefault('metadata_json', {})
        return Mock(status_code=200, json=Mock(return_value=body))

    def artifact(self):
        return {'id': IDS[4], 'run_id': IDS[1], 'stage_id': IDS[2], 'artifact_type': 'synthetic',
                'file_url': 'local://synthetic', 'file_size_bytes': 7, 'content_hash': 'a' * 64,
                'metadata_json': {'claim_tier': 'prototype'}}

    def kpi(self):
        return {'run_id': IDS[1], 'kpi_name': 'synthetic', 'kpi_label': 'Unassessed',
                'value': None, 'breakdown_json': {'status': 'unassessed'}}

    def test_both_workers_bind_output_scope_and_reuse_exact_receipts(self):
        with managed.bind(self.writer):
            for worker in (aeq, activity):
                with patch.object(worker, '_confirmed_record_insert', side_effect=AssertionError('Direct insert forbidden')):
                    artifact = worker.sb_post_artifact(self.artifact())
                    kpi = worker.sb_post_kpi(self.kpi())
                    self.assertEqual(artifact['id'], IDS[4])
                    self.assertEqual(artifact['attempt_id'], IDS[3])
                    self.assertIsNone(kpi['value'])
                    self.assertEqual(kpi['breakdown_json'], {'status': 'unassessed'})
            self.assertEqual(aeq.sb_record_retained_artifact(self.artifact(), workspace_id=IDS[4],
                journal_dir='unused-managed-legacy-directory')['id'], IDS[4])
            self.assertIsNone(aeq.sb_record_retained_kpi(self.kpi(), workspace_id=IDS[4], stage_id=IDS[2],
                journal_dir='unused-managed-legacy-directory')['value'])
        self.assertEqual(self.post.call_count, 2)
        for call in self.post.call_args_list:
            self.assertEqual(call.kwargs['json']['p_attempt_id'], IDS[3])
        self.assertEqual(self.artifact()['metadata_json'], {'claim_tier': 'prototype'})

    def test_changed_named_artifact_bytes_do_not_create_another_request(self):
        original = self.artifact()
        self.writer.record_artifact(original, logical_name='prepared-output')
        changed = {**original, 'content_hash': 'b' * 64}
        with self.assertRaisesRegex(ValueError, 'different contents'):
            self.writer.record_artifact(changed, logical_name='prepared-output')
        self.post.assert_called_once()
        self.assertEqual(original['content_hash'], 'a' * 64)

    def test_null_kpi_cannot_be_replaced_with_zero(self):
        self.writer.record_kpi(self.kpi())
        with self.assertRaisesRegex(ValueError, 'different contents'):
            self.writer.record_kpi({**self.kpi(), 'value': 0})
        self.post.assert_called_once()

    def test_lost_output_reply_stops_terminal_write(self):
        self.post.side_effect = TimeoutError('Synthetic lost response')
        with self.assertRaises(client.DeliveryUnconfirmed):
            self.writer.record_artifact(self.artifact())
        saved = journal.pending(self.directory, self.cmd['destination'])[0]['command']
        self.assertEqual(saved['arguments']['attempt_id'], IDS[3])
        self.assertEqual(saved['arguments']['payload']['id'], IDS[4])
        with self.assertRaises(invocation.ReconciliationRequired):
            self.writer.patch_stage(IDS[2], {'status': 'succeeded'})
        self.post.assert_called_once()

    def test_foreign_workspace_refuses_without_transport(self):
        with self.assertRaisesRegex(ValueError, 'workspace scope'):
            self.writer.record_artifact(self.artifact(), workspace_id=IDS[0])
        self.post.assert_not_called()

    def test_prepared_identity_mismatch_leaves_command_pending(self):
        native_response = self.response
        def changed_id(url, **kwargs):
            result = native_response(url, **kwargs)
            result.json.return_value['id'] = IDS[0]
            return result
        self.post.side_effect = changed_id
        with self.assertRaises(client.DeliveryUnconfirmed):
            self.writer.record_artifact(self.artifact())
        self.assertEqual(len(journal.pending(self.directory, self.cmd['destination'])), 1)

    def test_malformed_prepared_identity_refuses_before_transport(self):
        for value in (None, 7, 'not-a-uuid', 'AAAAAAAA-1111-4111-8111-111111111111'):
            payload = self.artifact()
            payload['id'] = value
            cmd = {'request_id': IDS[0], 'destination': self.cmd['destination'],
                   'operation': 'write_model_attempt_artifact', 'arguments': {
                       'run_id': IDS[1], 'stage_id': IDS[2], 'attempt_id': IDS[3],
                       'payload': {k:v for k,v in payload.items() if k not in ('run_id', 'stage_id')}}}
            with self.assertRaises((ValueError, TypeError, AttributeError)):
                client.validate_command(copy.deepcopy(cmd))
        self.post.assert_not_called()


if __name__ == '__main__':
    unittest.main()
