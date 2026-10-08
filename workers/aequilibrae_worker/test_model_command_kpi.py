"""KPI receipt checks preserve unknown quantities, precision and source metadata."""
import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock
import model_command_client as client
import model_command_journal as journal
from test_model_command_client import command, IDS, URL


def kpi(value):
    cmd = command('write_model_attempt_artifact')
    cmd['operation'] = 'write_model_attempt_kpi'
    cmd['arguments']['payload'] = {'kpi_name': 'synthetic', 'kpi_label': 'Synthetic quantity', 'value': value}
    return cmd


def receipt(cmd):
    args = cmd['arguments']; p = args['payload']
    return {'id': IDS[4], 'run_id': args['run_id'], 'attempt_id': args['attempt_id'],
            'kpi_category': 'accessibility', 'unit': '', 'geometry_ref': None, 'breakdown_json': {}, **p}


class KpiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)

    def deliver(self, cmd, transport):
        return client.deliver(self.directory, cmd, base_url=URL, deployment_id='synthetic', service_key='synthetic-secret', post=transport)

    def test_null_zero_and_fraction_recover_exactly(self):
        root = self.directory
        for index, value in enumerate((None, 0, 1, 1.25, -3.5)):
            with self.subTest(value=value):
                self.directory = root / str(index)
                cmd = kpi(value); good = receipt(cmd)
                if value == 1:
                    good['value'] = 1.0
                first = Mock(side_effect=TimeoutError('Synthetic committed reply lost'))
                with self.assertRaises(client.DeliveryUnconfirmed):
                    self.deliver(cmd, first)
                self.assertEqual(journal.pending(self.directory, cmd['destination'])[0]['command'], cmd)
                response = Mock(status_code=200, json=Mock(return_value=good))
                post = Mock(return_value=response)
                self.assertEqual(self.deliver(cmd, post), good)
                self.assertEqual(post.call_args.args[0], URL + '/rest/v1/rpc/write_model_attempt_kpi')
                self.assertEqual(post.call_args.kwargs['json'], {'p_request_id': cmd['request_id'], 'p_attempt_id': cmd['arguments']['attempt_id'], 'p_payload': cmd['arguments']['payload']})
                self.assertEqual(first.call_args.kwargs['json'], post.call_args.kwargs['json'])
                self.assertEqual(self.deliver(cmd, post), good)
                post.assert_called_once()
                self.assertEqual(journal.pending(self.directory, cmd['destination']), [])

    def test_missing_or_invalid_value_refuses_before_dispatch(self):
        cases = []
        absent = kpi(None); del absent['arguments']['payload']['value']; cases.append(absent)
        cases += [kpi(v) for v in (True, '0', [], float('nan'), float('inf'), 2**53+1, 10**400)]
        for cmd in cases:
            with self.subTest(value=cmd['arguments']['payload'].get('value')):
                post = Mock()
                with self.assertRaises(ValueError):
                    self.deliver(cmd, post)
                post.assert_not_called()

    def test_changed_value_or_binding_stays_pending(self):
        cases = [(None, {'value': 0}), (0, {'value': None}), (0, {'value': False}),
                 (1, {'value': 1.1}), (1, {'attempt_id': IDS[4]}), (1, {'run_id': IDS[4]}),
                 (1, {'kpi_name': 'other'}), (1, {'unit': 'invented'}), (1, {'breakdown_json': {'source': 'other'}})]
        for index, (value, change) in enumerate(cases):
            with self.subTest(change=change):
                self.directory = Path(self.temp.name) / str(index)
                cmd = kpi(value)
                response = Mock(status_code=200, json=Mock(return_value={**receipt(cmd), **change}))
                with self.assertRaises(client.DeliveryUnconfirmed):
                    self.deliver(cmd, Mock(return_value=response))
                response.close.assert_called_once()
                self.assertEqual(len(journal.pending(self.directory, cmd['destination'])), 1)
        cmd = kpi(None); absent = receipt(cmd); del absent['value']
        with self.assertRaises(client.DeliveryUnconfirmed):
            client.checked_receipt(cmd, absent)

    def test_explicit_null_defaults_and_empty_strings_are_not_conflated(self):
        cmd = kpi(None)
        cmd['arguments']['payload'].update(kpi_category=None, unit=None, breakdown_json=None)
        good = {**receipt(cmd), 'kpi_category': 'accessibility', 'unit': ''}
        self.assertEqual(client.checked_receipt(cmd, good), good)
        cmd['arguments']['payload'].update(kpi_category='', unit='')
        good = receipt(cmd)
        self.assertEqual(client.checked_receipt(cmd, good), good)
        cmd['arguments']['payload']['breakdown_json'] = {'source': 'synthetic', 'quantity': 0}
        good = receipt(cmd)
        self.assertEqual(client.checked_receipt(cmd, good), good)
        wrong = copy.deepcopy(good); wrong['breakdown_json']['quantity'] = False
        with self.assertRaises(client.DeliveryUnconfirmed):
            client.checked_receipt(cmd, wrong)

    def test_payload_shape_and_types_refuse_before_dispatch(self):
        for field, value in [('kpi_name', None), ('kpi_label', 4), ('unit', 2), ('geometry_ref', []), ('kpi_category', False), ('breakdown_json', []), ('id', IDS[4])]:
            with self.subTest(field=field):
                cmd = kpi(0); cmd['arguments']['payload'][field] = value
                post = Mock()
                with self.assertRaises(ValueError):
                    self.deliver(cmd, post)
                post.assert_not_called()


if __name__ == '__main__':
    unittest.main()
