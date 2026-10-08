"""Real local transactions and process boundaries; injected database transport.

These checks do not prove native claim locking, filesystem ownership, engine
execution or continuation authorization.
"""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock

import model_attempt_invocation as invocation
import model_command_client as client
import model_command_journal as journal
from test_model_command_client import command, receipt, IDS, URL
from test_model_command_ownership import snapshot


class InvocationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name) / 'journal'
        self.cmd = command()
        self.handler = Mock(return_value='completed synthetic handler')
        self.post = Mock(return_value=Mock(status_code=200, json=Mock(return_value=receipt(self.cmd))))
        self.get = Mock(return_value=Mock(status_code=200, json=Mock(return_value=[snapshot()])))

    def invoke(self):
        return invocation._invoke_fresh_claim(self.directory, self.cmd, workspace_id=IDS[4],
            base_url=URL, deployment_id='synthetic', service_key='synthetic-secret',
            handler=self.handler, post=self.post, get=self.get)

    def entered(self):
        with closing(sqlite3.connect(self.directory / 'model-commands.sqlite3')) as connection:
            return connection.execute('SELECT entered FROM execution_admissions').fetchall()

    def test_claim_and_admission_precede_transport_and_callback(self):
        def post(*args, **kwargs):
            self.assertEqual(self.entered(), [(0,)])
            self.assertEqual(journal.pending(self.directory, self.cmd['destination'])[0]['command'], self.cmd)
            return Mock(status_code=200, json=Mock(return_value=receipt(self.cmd)))
        self.post.side_effect = post
        def handler(context):
            self.assertEqual(self.entered(), [(1,)])
            self.assertEqual(context, invocation.AttemptContext(self.cmd['destination'], IDS[4],
                             IDS[1], IDS[2], IDS[3], IDS[0]))
            return 'completed synthetic handler'
        self.handler.side_effect = handler
        self.assertEqual(self.invoke(), 'completed synthetic handler')
        self.handler.assert_called_once()
        with self.assertRaises(invocation.ReconciliationRequired):
            self.invoke()
        self.post.assert_called_once()
        self.get.assert_called_once()
        self.handler.assert_called_once()

    def test_lost_claim_recovery_never_admits_handler(self):
        self.post.side_effect = TimeoutError('synthetic-secret')
        with self.assertRaises(client.DeliveryUnconfirmed):
            self.invoke()
        self.assertEqual(self.entered(), [(0,)])
        self.get.assert_not_called()
        self.handler.assert_not_called()
        # The existing delivery client may recover the exact receipt. Admission
        # must remain closed even after that recovery makes the journal resolved.
        client.deliver(self.directory, self.cmd, base_url=URL, deployment_id='synthetic',
            service_key='synthetic-secret', post=Mock(return_value=Mock(status_code=200,
            json=Mock(return_value=receipt(self.cmd)))))
        with self.assertRaises(invocation.ReconciliationRequired):
            self.invoke()
        self.handler.assert_not_called()
        self.post.assert_called_once()

    def test_existing_command_without_admission_cannot_be_promoted(self):
        journal.prepare(self.directory, self.cmd)
        with self.assertRaises(invocation.ReconciliationRequired):
            self.invoke()
        self.post.assert_not_called()
        self.handler.assert_not_called()

    def test_declined_claim_has_no_ownership_read_or_execution(self):
        self.post.return_value.json.return_value = {**receipt(self.cmd), 'outcome': 'not_claimed', 'attempt_id': None}
        self.assertIsNone(self.invoke())
        self.get.assert_not_called()
        self.handler.assert_not_called()
        self.assertEqual(self.entered(), [(0,)])

    def test_revoked_or_unconfirmed_ownership_never_runs_or_writes_failure(self):
        revoked = snapshot()
        revoked['active_attempt_id'] = None
        self.get.return_value.json.return_value = [revoked]
        with self.assertRaises(invocation.ReconciliationRequired):
            self.invoke()
        self.handler.assert_not_called()
        self.post.assert_called_once()
        self.assertEqual(self.entered(), [(0,)])
        self.directory = Path(self.temp.name) / 'unconfirmed'
        self.get.side_effect = TimeoutError('synthetic-secret')
        with self.assertRaises(client.OwnershipUnconfirmed):
            self.invoke()
        self.handler.assert_not_called()
        self.assertEqual(self.entered(), [(0,)])

    def test_handler_process_loss_leaves_consumed_admission_for_fresh_process(self):
        self.handler.side_effect = SystemExit('synthetic process loss')
        with self.assertRaises(SystemExit):
            self.invoke()
        self.assertEqual(self.entered(), [(1,)])
        program = '''
import json,sys
from pathlib import Path
from unittest.mock import Mock
import model_attempt_invocation as m
cmd=json.loads(sys.argv[2])
transport=Mock(side_effect=AssertionError('replayed transport'))
handler=Mock(side_effect=AssertionError('replayed computation'))
try:
 m._invoke_fresh_claim(Path(sys.argv[1]),cmd,workspace_id=sys.argv[3],base_url=sys.argv[4],deployment_id='synthetic',service_key='synthetic-secret',handler=handler,post=transport,get=transport)
except m.ReconciliationRequired:
 transport.assert_not_called();handler.assert_not_called()
else:
 raise AssertionError('Fresh process admitted saved claim')
'''
        result = subprocess.run([sys.executable, '-B', '-c', program, str(self.directory),
            json.dumps(self.cmd), IDS[4], URL], cwd=Path(__file__).parent, text=True,
            capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.post.assert_called_once()

    def test_competing_local_invocations_have_one_transport_and_handler(self):
        def compete():
            try:
                return self.invoke()
            except invocation.ReconciliationRequired:
                return 'refused'
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: compete(), range(2)))
        self.assertCountEqual(results, ['completed synthetic handler', 'refused'])
        self.post.assert_called_once()
        self.handler.assert_called_once()
        self.assertEqual(self.entered(), [(1,)])

    def test_invalid_destination_refuses_without_local_or_remote_changes(self):
        self.cmd['destination'] = client.destination(URL, 'different-installation')
        with self.assertRaises(ValueError):
            self.invoke()
        self.assertFalse(self.directory.exists())
        self.post.assert_not_called()
        self.handler.assert_not_called()

    def test_new_attempt_never_reuses_retained_claim_identity(self):
        journal.prepare(self.directory, self.cmd)
        journal.resolve(self.directory, self.cmd, receipt(self.cmd))
        requests = []
        def post(*args, **kwargs):
            request_id = kwargs['json']['p_request_id']
            requests.append(request_id)
            return Mock(status_code=200, json=Mock(return_value={
                'request_id': request_id, 'run_id': IDS[1], 'stage_id': IDS[2],
                'outcome': 'not_claimed', 'attempt_id': None}))
        for _ in range(2):
            self.assertIsNone(invocation.invoke_new_attempt(self.directory, run_id=IDS[1],
                stage_id=IDS[2], worker_id='synthetic-worker', workspace_id=IDS[4],
                base_url=URL, deployment_id='synthetic', service_key='synthetic-secret',
                handler=self.handler, post=post, get=self.get))
        self.assertEqual(len(set(requests)), 2)
        self.assertNotIn(self.cmd['request_id'], requests)
        self.get.assert_not_called()
        self.handler.assert_not_called()


if __name__ == '__main__':
    unittest.main()
