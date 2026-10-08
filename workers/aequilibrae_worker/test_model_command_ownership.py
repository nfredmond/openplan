"""Recovery reads current stage and parent together; receipts alone are historical."""
import unittest
from unittest.mock import Mock
import model_command_client as client
from test_model_command_client import command, receipt, IDS, URL


def snapshot():
    return {'id': IDS[2], 'run_id': IDS[1], 'status': 'running', 'attempt_managed': True,
            'active_attempt_id': IDS[3], 'model_runs': {'id': IDS[1], 'workspace_id': IDS[4],
                                                     'status': 'running', 'attempt_managed': True}}


class OwnershipTests(unittest.TestCase):
    def inspect(self, get, cmd=None, retained=None):
        cmd = cmd or command()
        return client.inspect_ownership(cmd, retained or receipt(cmd), workspace_id=IDS[4],
                                        base_url=URL, deployment_id='synthetic', service_key='synthetic-secret', get=get)

    def test_owned_snapshot_uses_one_scoped_query_with_required_projection(self):
        response = Mock(status_code=200, json=Mock(return_value=[snapshot()]))
        get = Mock(return_value=response)
        result = self.inspect(get)
        self.assertTrue(result['owns_stage'])
        get.assert_called_once()
        self.assertEqual(get.call_args.args[0], URL + '/rest/v1/model_run_stages')
        self.assertEqual(get.call_args.kwargs['params'], {
            'id': 'eq.' + IDS[2], 'run_id': 'eq.' + IDS[1], 'model_runs.workspace_id': 'eq.' + IDS[4],
            'select': 'id,run_id,status,attempt_managed,active_attempt_id,model_runs!inner(id,workspace_id,status,attempt_managed)'})
        self.assertFalse(get.call_args.kwargs['allow_redirects'])
        self.assertEqual(get.call_args.kwargs['timeout'], (5, 30))
        response.close.assert_called_once()

    def test_retained_receipt_does_not_authorize_inactive_attempt(self):
        cases = []
        for field, value in [('status', 'succeeded'), ('status', 'queued'), ('attempt_managed', False), ('active_attempt_id', None), ('active_attempt_id', IDS[4])]:
            row = snapshot(); row[field] = value; cases.append(row)
        for field, value in [('status', 'failed'), ('status', 'queued'), ('attempt_managed', False)]:
            row = snapshot(); row['model_runs'][field] = value; cases.append(row)
        for row in cases:
            with self.subTest(row=row):
                response = Mock(status_code=200, json=Mock(return_value=[row]))
                self.assertFalse(self.inspect(Mock(return_value=response))['owns_stage'])
                response.close.assert_called_once()

    def test_missing_or_mismatched_snapshot_is_unconfirmed_not_inactive(self):
        rows = [[], None, [snapshot(), snapshot()]]
        for scope in ('stage', 'run'):
            for field in (snapshot() if scope == 'stage' else snapshot()['model_runs']):
                row = snapshot(); selected = row if scope == 'stage' else row['model_runs']
                del selected[field]; rows.append([row])
        for field, value in [('id', IDS[4]), ('run_id', IDS[4]), ('active_attempt_id', 'bad'), ('status', 'unknown'), ('attempt_managed', 1)]:
            row = snapshot(); row[field] = value; rows.append([row])
        for field, value in [('id', IDS[4]), ('workspace_id', IDS[3]), ('status', 'unknown'), ('attempt_managed', 1)]:
            row = snapshot(); row['model_runs'][field] = value; rows.append([row])
        for body in rows:
            with self.subTest(body=body):
                response = Mock(status_code=200, json=Mock(return_value=body))
                with self.assertRaises(client.OwnershipUnconfirmed):
                    self.inspect(Mock(return_value=response))
                response.close.assert_called_once()

    def test_invalid_claim_refuses_before_read(self):
        invalid = []
        cmd = command(); cmd['destination'] = client.destination(URL, 'other'); invalid.append((cmd, receipt(cmd)))
        cmd = command(); lost = receipt(cmd); lost.update(outcome='not_claimed', attempt_id=None); invalid.append((cmd, lost))
        cmd = command('write_model_stage_attempt'); invalid.append((cmd, receipt(cmd)))
        cmd = command(); wrong = receipt(cmd); wrong['run_id'] = IDS[4]; invalid.append((cmd, wrong))
        for cmd, retained in invalid:
            get = Mock()
            with self.assertRaises((ValueError, client.DeliveryUnconfirmed)):
                self.inspect(get, cmd, retained)
            get.assert_not_called()

    def test_failed_transport_does_not_become_false_ownership(self):
        get = Mock(side_effect=TimeoutError('synthetic-secret'))
        with self.assertRaises(client.OwnershipUnconfirmed) as caught:
            self.inspect(get)
        self.assertNotIn('synthetic-secret', str(caught.exception))
        for response in [Mock(status_code=403), Mock(status_code=302), Mock(status_code=200, json=Mock(side_effect=ValueError('synthetic-secret')))]:
            with self.assertRaises(client.OwnershipUnconfirmed):
                self.inspect(Mock(return_value=response))
            response.close.assert_called_once()


if __name__ == '__main__':
    unittest.main()
