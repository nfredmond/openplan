"""Check delivery semantics with injected transport, not database authorization."""
import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock
import model_command_client as client
import model_command_journal as journal

URL = 'http://127.0.0.1:54321'
IDS = [f'{n:08d}-1111-4111-8111-111111111111' for n in range(1, 6)]
STAMP = '2026-10-08T10:00:00+00:00'


def command(operation='claim_model_stage_attempt', status='running'):
    args = {'run_id': IDS[1], 'stage_id': IDS[2]}
    if operation == 'claim_model_stage_attempt':
        args['worker_id'] = 'synthetic-worker'
    elif operation == 'write_model_stage_attempt':
        args.update(attempt_id=IDS[3], status=status, log_tail='synthetic log', error='synthetic failure' if status == 'failed' else None)
    else:
        args.update(attempt_id=IDS[3], payload={'artifact_type': 'synthetic', 'file_url': 'local://synthetic', 'content_hash': 'a' * 64, 'file_size_bytes': 7})
    return {'request_id': IDS[0], 'destination': client.destination(URL, 'synthetic'), 'operation': operation, 'arguments': args}


def receipt(cmd):
    args = cmd['arguments']
    if cmd['operation'] == 'write_model_attempt_artifact':
        return {'id': IDS[4], **{key: args[key] for key in ('run_id', 'stage_id', 'attempt_id')}, **args['payload'], 'metadata_json': {}}
    base = {'request_id': cmd['request_id'], 'stage_id': args['stage_id'], 'attempt_id': IDS[3]}
    if cmd['operation'] == 'claim_model_stage_attempt':
        return {**base, 'outcome': 'claimed', 'run_id': args['run_id']}
    status = args['status']
    return {**base, 'status': status, 'completed_at': None if status == 'running' else STAMP,
            'run_status': status, 'run_completed_at': None if status == 'running' else STAMP}


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name) / 'journal'

    def deliver(self, cmd, post):
        return client.deliver(self.directory, cmd, base_url=URL, deployment_id='synthetic', service_key='synthetic-secret', post=post)

    def response(self, body, status=200):
        return Mock(status_code=status, json=Mock(return_value=copy.deepcopy(body)))

    def test_all_commands_prepare_before_post_resolve_and_reuse_receipt(self):
        cases = [command(), command('write_model_attempt_artifact')]
        cases += [command('write_model_stage_attempt', status) for status in ('running', 'succeeded', 'failed')]
        base = self.directory
        for i, cmd in enumerate(cases):
            with self.subTest(operation=cmd['operation'], args=cmd['arguments']):
                self.directory = base / str(i)
                expected = receipt(cmd)
                def post(url, **kwargs):
                    self.assertEqual(journal.pending(self.directory, cmd['destination'])[0]['command'], cmd)
                    self.assertEqual(url, URL + '/rest/v1/rpc/' + cmd['operation'])
                    args = cmd['arguments']
                    expected_args = {'p_request_id': cmd['request_id']}
                    if cmd['operation'] == 'claim_model_stage_attempt':
                        expected_args.update(p_stage_id=args['stage_id'], p_worker_id=args['worker_id'])
                    elif cmd['operation'] == 'write_model_stage_attempt':
                        expected_args.update(p_attempt_id=args['attempt_id'], p_status=args['status'], p_log_tail=args['log_tail'], p_error=args['error'])
                    else:
                        expected_args.update(p_attempt_id=args['attempt_id'], p_payload=args['payload'])
                    self.assertEqual(kwargs['json'], expected_args)
                    self.assertFalse(kwargs['allow_redirects'])
                    self.assertEqual(kwargs['timeout'], (5, 30))
                    return self.response(expected)
                transport = Mock(side_effect=post)
                self.assertEqual(self.deliver(cmd, transport), expected)
                self.assertEqual(self.deliver(cmd, transport), expected)
                self.assertEqual(transport.call_count, 1)
                self.assertEqual(journal.pending(self.directory, cmd['destination']), [])

    def test_lost_ack_retry_retains_exact_identity_and_no_secret(self):
        for i, op in enumerate(('claim_model_stage_attempt', 'write_model_stage_attempt', 'write_model_attempt_artifact')):
            with self.subTest(op=op):
                self.directory = Path(self.temp.name) / str(i)
                cmd = command(op)
                transport = Mock(side_effect=TimeoutError('synthetic-secret'))
                with self.assertRaises(client.DeliveryUnconfirmed) as caught:
                    self.deliver(cmd, transport)
                self.assertNotIn('synthetic-secret', str(caught.exception))
                self.assertEqual(journal.pending(self.directory, cmd['destination'])[0]['command'], cmd)
                retry = Mock(return_value=self.response(receipt(cmd)))
                self.deliver(cmd, retry)
                self.assertEqual(transport.call_args.kwargs['json'], retry.call_args.kwargs['json'])
                self.assertNotIn(b'synthetic-secret', (self.directory / 'model-commands.sqlite3').read_bytes())

    def test_invalid_claim_receipts_remain_pending(self):
        cmd = command()
        good = receipt(cmd)
        invalid = [[], {}, {**good, 'request_id': IDS[4]}, {**good, 'run_id': IDS[4]},
                   {**good, 'stage_id': IDS[4]}, {**good, 'attempt_id': None},
                   {**good, 'outcome': 'not_claimed'}, {**good, 'outcome': 'unknown'}]
        self.assert_bad_receipts(cmd, invalid)

    def test_invalid_stage_receipts_remain_pending(self):
        cmd = command('write_model_stage_attempt', 'failed')
        good = receipt(cmd)
        invalid = [{**good, 'request_id': IDS[4]}, {**good, 'stage_id': IDS[4]},
                   {**good, 'attempt_id': IDS[4]}, {**good, 'status': 'succeeded'},
                   {**good, 'completed_at': None}, {**good, 'completed_at': '2026-10-08T10:00:00'},
                   {**good, 'run_status': 'running', 'run_completed_at': None}, {**good, 'run_completed_at': None}]
        self.assert_bad_receipts(cmd, invalid)
        running = command('write_model_stage_attempt')
        self.assert_bad_receipts(running, [{**receipt(running), 'completed_at': STAMP},
                                         {**receipt(running), 'run_completed_at': STAMP}])

    def test_artifact_receipt_checks_exact_bytes_and_attempt(self):
        cmd = command('write_model_attempt_artifact')
        good = receipt(cmd)
        self.assert_bad_receipts(cmd, [{**good, 'content_hash': 'b' * 64}, {**good, 'attempt_id': IDS[4]},
                                       {**good, 'file_size_bytes': True}, {**good, 'metadata_json': None},
                                       {**good, 'metadata_json': {'invalid': float('nan')}}])

    def assert_bad_receipts(self, cmd, bodies):
        for body in bodies:
            with self.subTest(body=body), tempfile.TemporaryDirectory() as directory:
                self.directory = Path(directory)
                response = self.response(body)
                with self.assertRaises(client.DeliveryUnconfirmed):
                    self.deliver(cmd, Mock(return_value=response))
                response.close.assert_called_once()
                self.assertEqual(len(journal.pending(self.directory, cmd['destination'])), 1)

    def test_not_claimed_and_intermediate_success_are_valid(self):
        cmd = command()
        lost = {**receipt(cmd), 'outcome': 'not_claimed', 'attempt_id': None}
        self.assertEqual(client.checked_receipt(cmd, lost), lost)
        cmd = command('write_model_stage_attempt', 'succeeded')
        mid = {**receipt(cmd), 'run_status': 'running', 'run_completed_at': None}
        self.assertEqual(client.checked_receipt(cmd, mid), mid)

    def test_invalid_command_refuses_before_any_transport(self):
        cases = []
        for key, value in (('worker_id', ''), ('worker_id', 'x' * 201), ('run_id', 'bad'), ('stage_id', None)):
            cmd = command(); cmd['arguments'][key] = value; cases.append(cmd)
        for key, value in (('status', 'skipped'), ('error', 'contradiction'), ('log_tail', 'x' * 20001), ('attempt_id', 'bad')):
            cmd = command('write_model_stage_attempt'); cmd['arguments'][key] = value; cases.append(cmd)
        cmd = command(); cmd['operation'] = 'unknown'; cases.append(cmd)
        cmd = command(); cmd['destination'] = client.destination(URL, 'other'); cases.append(cmd)
        for cmd in cases:
            with self.subTest(cmd=cmd['operation']):
                post = Mock()
                with self.assertRaises((ValueError, TypeError)):
                    self.deliver(cmd, post)
                post.assert_not_called()

    def test_changed_request_cannot_reuse_id(self):
        cmd = command()
        journal.prepare(self.directory, cmd)
        changed = copy.deepcopy(cmd); changed['arguments']['worker_id'] = 'other'
        post = Mock(return_value=self.response(receipt(changed)))
        with self.assertRaisesRegex(ValueError, 'different contents'):
            self.deliver(changed, post)
        post.assert_not_called()

    def test_http_and_json_failure_remain_pending(self):
        cmd = command()
        for response in (self.response(receipt(cmd), 500), self.response(receipt(cmd), 302),
                         Mock(status_code=200, json=Mock(side_effect=ValueError('synthetic-secret')))):
            with self.assertRaises(client.DeliveryUnconfirmed):
                self.deliver(cmd, Mock(return_value=response))
            response.close.assert_called_once()
            self.assertEqual(len(journal.pending(self.directory, cmd['destination'])), 1)


if __name__ == '__main__':
    unittest.main()
