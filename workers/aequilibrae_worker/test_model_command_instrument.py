"""Instrument delivery checks prove receipt custody, not scientific acceptance."""
import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock
import model_command_client as client
import model_command_journal as journal
from test_model_command_client import command, IDS, URL


def instrument(method='aequilibrae'):
    cmd = command('write_model_attempt_artifact')
    cmd['operation'] = 'record_model_attempt_instrument'
    cmd['arguments']['workspace_id'] = IDS[4]
    payload = {'demand_method': method, 'scientific_outcome': 'inconclusive'}
    for index, role in enumerate(client.INSTRUMENT_ROLES):
        payload[role + '_artifact_id'] = f'{index + 10:08d}-1111-4111-8111-111111111111'
        payload[role + '_sha256'] = str(index) * 64
    cmd['arguments']['payload'] = payload
    return cmd


def receipt(cmd):
    args = cmd['arguments']
    return {'id': '00000099-1111-4111-8111-111111111111', 'workspace_id': args['workspace_id'],
            'model_run_id': args['run_id'], 'stage_id': args['stage_id'], 'attempt_id': args['attempt_id'], **args['payload']}


class InstrumentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)

    def deliver(self, cmd, post):
        return client.deliver(self.directory, cmd, base_url=URL, deployment_id='synthetic', service_key='synthetic-secret', post=post)

    def test_separate_methods_retain_exact_requests_and_recover(self):
        for method in ('aequilibrae', 'activitysim'):
            with self.subTest(method=method):
                self.directory = Path(self.temp.name) / method
                cmd = instrument(method)
                first = Mock(side_effect=TimeoutError('Synthetic receipt lost'))
                with self.assertRaises(client.DeliveryUnconfirmed):
                    self.deliver(cmd, first)
                self.assertEqual(journal.pending(self.directory, cmd['destination'])[0]['command'], cmd)
                good = receipt(cmd)
                response = Mock(status_code=200, json=Mock(return_value=good))
                retry = Mock(return_value=response)
                self.assertEqual(self.deliver(cmd, retry), good)
                self.assertEqual(retry.call_args.args[0], URL + '/rest/v1/rpc/record_model_attempt_instrument')
                self.assertEqual(retry.call_args.kwargs['json'], {'p_request_id': cmd['request_id'], 'p_attempt_id': cmd['arguments']['attempt_id'], 'p_payload': cmd['arguments']['payload']})
                self.assertEqual(first.call_args.kwargs['json'], retry.call_args.kwargs['json'])
                self.assertEqual(self.deliver(cmd, retry), good)
                retry.assert_called_once()
                self.assertEqual(journal.pending(self.directory, cmd['destination']), [])

    def test_each_receipt_binding_and_required_field_is_checked(self):
        cmd = instrument(); good = receipt(cmd)
        for field in good:
            for missing in (False, True):
                with self.subTest(field=field, missing=missing), tempfile.TemporaryDirectory() as directory:
                    self.directory = Path(directory)
                    wrong = copy.deepcopy(good)
                    if missing:
                        del wrong[field]
                    else:
                        wrong[field] = 'different'
                    response = Mock(status_code=200, json=Mock(return_value=wrong))
                    with self.assertRaises(client.DeliveryUnconfirmed):
                        self.deliver(cmd, Mock(return_value=response))
                    response.close.assert_called_once()
                    self.assertEqual(len(journal.pending(self.directory, cmd['destination'])), 1)

    def test_incomplete_reused_or_promoted_instrument_refuses_dispatch(self):
        mutations = []
        for key in instrument()['arguments']['payload']:
            cmd = instrument(); del cmd['arguments']['payload'][key]; mutations.append(cmd)
        for key, value in [('demand_method', 'combined'), ('scientific_outcome', 'pass'), ('model_output_sha256', 'not-a-hash'), ('model_output_artifact_id', 'bad'), ('unexpected', None)]:
            cmd = instrument(); cmd['arguments']['payload'][key] = value; mutations.append(cmd)
        cmd = instrument(); cmd['arguments']['payload']['assessment_artifact_id'] = cmd['arguments']['payload']['diagnosis_artifact_id']; mutations.append(cmd)
        cmd = instrument(); cmd['arguments']['workspace_id'] = None; mutations.append(cmd)
        for index, cmd in enumerate(mutations):
            with self.subTest(index=index):
                post = Mock()
                with self.assertRaises(ValueError):
                    self.deliver(cmd, post)
                post.assert_not_called()


if __name__ == '__main__':
    unittest.main()
