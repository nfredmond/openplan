"""Transport fixtures prove command/receipt boundaries, not live HTTP or RLS."""
from pathlib import Path
import copy
import tempfile
import unittest
from unittest.mock import Mock
import artifact_rpc as rpc
import request_journal as journal

URL = 'http://127.0.0.1:54321'
COMMAND = {'request_id': '11111111-1111-4111-8111-111111111111', 'destination': rpc.destination(URL, 'synthetic-deployment'), 'operation': 'write_model_attempt_artifact', 'arguments': {
    'run_id': '22222222-2222-4222-8222-222222222222', 'stage_id': '33333333-3333-4333-8333-333333333333', 'attempt_id': '44444444-4444-4444-8444-444444444444',
    'payload': {'artifact_type': 'synthetic', 'file_url': 'local://synthetic', 'file_size_bytes': 1, 'content_hash': 'a' * 64}}}
RECEIPT = {'id': '55555555-5555-4555-8555-555555555555', **{key: COMMAND['arguments'][key] for key in ('run_id', 'stage_id', 'attempt_id')}, **COMMAND['arguments']['payload'], 'metadata_json': {}}


class Delivery(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name) / 'journal'

    def deliver(self, post, command=COMMAND, deployment='synthetic-deployment'):
        return rpc.deliver(self.directory, command, base_url=URL, deployment_id=deployment, service_key='synthetic-secret', post=post)

    def response(self, body=RECEIPT, status=200):
        return Mock(status_code=status, json=Mock(return_value=copy.deepcopy(body)))

    def test_prepared_before_dispatch_exact_receipt_then_no_second_post(self):
        def post(url, **kwargs):
            if transport.call_count == 1:
                self.assertEqual(journal.pending(self.directory, COMMAND['destination'])[0]['command'], COMMAND)
            self.assertEqual(url, URL + '/rest/v1/rpc/write_model_attempt_artifact')
            self.assertEqual(kwargs['json'], {'p_request_id': COMMAND['request_id'], 'p_attempt_id': COMMAND['arguments']['attempt_id'], 'p_payload': COMMAND['arguments']['payload']})
            self.assertEqual(kwargs['timeout'], (5, 30))
            self.assertFalse(kwargs['allow_redirects'])
            return self.response()
        transport = Mock(side_effect=post)
        self.assertEqual(self.deliver(transport), RECEIPT)
        self.assertEqual(self.deliver(transport), RECEIPT)
        self.assertEqual(transport.call_count, 1)
        self.assertEqual(journal.pending(self.directory, COMMAND['destination']), [])
        self.assertNotIn(b'synthetic-secret', (self.directory / 'model-commands.sqlite3').read_bytes())

    def test_lost_ack_keeps_exact_request_for_retry(self):
        transport = Mock(side_effect=TimeoutError('synthetic-secret'))
        with self.assertRaises(rpc.DeliveryUnconfirmed) as caught:
            self.deliver(transport)
        self.assertNotIn('synthetic-secret', str(caught.exception))
        self.assertEqual(journal.pending(self.directory, COMMAND['destination'])[0]['command'], COMMAND)
        retry = Mock(return_value=self.response())
        self.assertEqual(self.deliver(retry), RECEIPT)
        self.assertEqual(transport.call_args.kwargs['json'], retry.call_args.kwargs['json'])

    def test_uncertain_receipts_stay_pending(self):
        cases = [([], 200), (RECEIPT, 201), ({**RECEIPT, 'attempt_id': COMMAND['arguments']['run_id']}, 200), ({**RECEIPT, 'file_size_bytes': True}, 200), ({**RECEIPT, 'content_hash': 'b' * 64}, 200), ({key: value for key, value in RECEIPT.items() if key != 'metadata_json'}, 200)]
        base = self.directory
        for index, (body, status) in enumerate(cases):
            self.directory = base / str(index)
            with self.subTest(body=body, status=status):
                response = self.response(body, status)
                with self.assertRaises(rpc.DeliveryUnconfirmed):
                    self.deliver(Mock(return_value=response))
                response.close.assert_called_once()
                self.assertEqual(len(journal.pending(self.directory, COMMAND['destination'])), 1)

    def test_wrong_destination_or_changed_request_never_dispatches(self):
        transport = Mock(return_value=self.response())
        with self.assertRaisesRegex(ValueError, 'another deployment'):
            self.deliver(transport, deployment='other')
        journal.prepare(self.directory, COMMAND)
        changed = copy.deepcopy(COMMAND)
        changed['arguments']['payload']['file_size_bytes'] = 2
        with self.assertRaisesRegex(ValueError, 'different contents'):
            self.deliver(transport, command=changed)
        transport.assert_not_called()

    def test_invalid_json_stays_pending(self):
        response = self.response()
        response.json.side_effect = ValueError('synthetic-secret')
        with self.assertRaisesRegex(rpc.DeliveryUnconfirmed, 'invalid JSON'):
            self.deliver(Mock(return_value=response))
        response.close.assert_called_once()
        self.assertEqual(len(journal.pending(self.directory, COMMAND['destination'])), 1)


if __name__ == '__main__':
    unittest.main()
