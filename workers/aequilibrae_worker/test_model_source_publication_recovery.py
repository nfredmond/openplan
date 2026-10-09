"""Saved publication reconciliation does not reenter the stopped model writer."""
import json
from pathlib import Path
import sqlite3
import unittest
from unittest.mock import Mock, patch

import model_source_publication_recovery as recovery
import model_command_client as client
import model_command_journal as journal
from model_attempt_invocation import ReconciliationRequired
import test_model_validation_source_writer as source_writer
from test_model_validation_source_publication import MultiPeer
from test_model_command_ownership import snapshot
from test_model_command_client import command, IDS


class RecoveryTests(unittest.TestCase):
    setUp = source_writer.BoundSourceTests.setUp
    response = source_writer.BoundSourceTests.response
    prepare = source_writer.BoundSourceTests.prepare

    def interrupt(self):
        self.writer.retain_validation_sources(**self.prepare())
        self.peer = MultiPeer(); self.peer.lose_once = True
        with patch('model_storage_resumable.requests.request', side_effect=self.peer.request):
            with self.assertRaises(RuntimeError): self.writer.publish_validation_sources(method='aequilibrae')
        self.assertTrue(self.writer.stopped)
        self.args = dict(base_url=self.writer.base_url, deployment_id=self.writer.deployment_id,
                         claim_request_id=self.writer.context.claim_request_id, method='aequilibrae',
                         service_key=self.writer.service_key, post=self.post, get=self.get, request=self.peer.request)

    def recover(self):
        return recovery.reconcile(self.writer.files.root,self.directory,**self.args)

    def admissions(self):
        with sqlite3.connect(self.directory/'model-commands.sqlite3') as connection:
            return connection.execute('SELECT * FROM execution_admissions ORDER BY request_id').fetchall()

    def test_interrupted_publication_reconciles_without_model_reentry(self):
        self.interrupt(); before = self.admissions()
        result = self.recover()
        self.assertEqual(result['outcome'], 'source_publication_reconciled')
        self.assertFalse(result['model_resumed'])
        self.assertFalse(result['stage_status_changed'])
        self.assertFalse(result['execution_admission_created'])
        self.assertEqual(self.admissions(), before)
        self.assertTrue(self.writer.stopped)
        with self.assertRaises(ReconciliationRequired): self.writer.require_open()
        self.assertEqual(self.post.call_count, 2)
        self.assertEqual(self.post.call_args.kwargs['json']['p_payload']['artifact_type'], 'model_validation_source_publication')
        self.assertEqual(self.get.call_count, 2)
        before_creations = list(self.peer.creations)
        self.assertEqual(self.recover(), result)
        self.assertEqual(self.peer.creations, before_creations)
        self.assertEqual(self.post.call_count, 2)

    def test_normal_writer_and_recovery_share_the_exact_artifact_slot(self):
        self.writer.retain_validation_sources(**self.prepare())
        peer=MultiPeer()
        with patch('model_storage_resumable.requests.request',side_effect=peer.request):
            self.writer.publish_validation_sources(method='aequilibrae')
        request_id=self.post.call_args.kwargs['json']['p_request_id']
        result=recovery.reconcile(self.writer.files.root,self.directory,base_url=self.writer.base_url,
            deployment_id=self.writer.deployment_id,claim_request_id=self.writer.context.claim_request_id,
            method='aequilibrae',service_key=self.writer.service_key,post=self.post,get=self.get,request=peer.request)
        self.assertEqual(result['request_id'],request_id)
        self.assertEqual(self.post.call_count,2)

    def test_revoked_attempt_refuses_before_more_uploads(self):
        self.interrupt(); before = list(self.peer.creations)
        row=snapshot();row['active_attempt_id']=None
        self.get.return_value.json.return_value=[row]
        with self.assertRaises(client.OwnershipUnconfirmed): self.recover()
        self.assertEqual(self.peer.creations, before)
        self.assertEqual(self.post.call_count, 1)

    def test_revocation_before_registration_leaves_remote_artifact_unregistered(self):
        self.interrupt()
        inactive=snapshot();inactive['status']='cancelled'
        self.get.side_effect=[Mock(status_code=200,json=Mock(return_value=[snapshot()])),
                              Mock(status_code=200,json=Mock(return_value=[inactive]))]
        with self.assertRaises(client.OwnershipUnconfirmed): self.recover()
        self.assertEqual(self.post.call_count, 1)
        self.assertTrue(any(name.endswith('/manifest.json') for name in self.peer.objects))

    def test_changed_recovery_record_refuses_before_network(self):
        self.interrupt();self.get.reset_mock();before=list(self.peer.creations)
        path=self.writer.files.path/'source_publication_aequilibrae/recovery.json'
        value=json.loads(path.read_text());value['retained']['manifest_sha256']='f'*64
        path.write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError, 'Local source receipt differs'): self.recover()
        self.get.assert_not_called();self.assertEqual(self.peer.creations,before)

    def test_changed_workspace_owner_refuses(self):
        self.interrupt();self.get.reset_mock()
        path=self.writer.files.path/'attempt_owner.json'
        value=json.loads(path.read_text());value['attempt_id']=IDS[4]
        path.write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError,'Attempt owner differs'):self.recover()
        self.get.assert_not_called()

    def test_missing_plan_and_wrong_method_do_not_create_a_new_plan(self):
        self.interrupt()
        self.args['method']='activitysim'
        with self.assertRaises(FileNotFoundError): self.recover()
        self.assertFalse((self.writer.files.path/'source_publication_activitysim').exists())

    def test_unrelated_pending_command_blocks_publication(self):
        self.interrupt();self.get.reset_mock()
        pending=command('write_model_stage_attempt');pending['request_id']=IDS[4]
        journal.prepare(self.directory,pending)
        try: self.recover()
        except ValueError as error: self.assertIn('Unrelated pending',str(error))
        except Exception as error: self.fail('Unrelated command reached later work: '+type(error).__name__)
        else: self.fail('Unrelated pending command was accepted')
        self.get.assert_not_called()

    def test_local_artifact_command_cannot_cross_attempt_scope(self):
        self.interrupt();self.get.reset_mock()
        identity=recovery._request_id(self.writer.context,'validation-sources-aequilibrae')
        with sqlite3.connect(self.directory/'model-commands.sqlite3') as connection:
            request,response=connection.execute('SELECT request_json,response_json FROM commands WHERE request_id=?',(identity,)).fetchone()
            request=json.loads(request);response=json.loads(response)
            request['arguments']['run_id']=IDS[0];response['run_id']=IDS[0]
            connection.execute('UPDATE commands SET request_json=?,response_json=? WHERE request_id=?',
                               (journal.canonical(request),journal.canonical(response),identity))
        with self.assertRaisesRegex(ValueError,'Local artifact command scope differs'):self.recover()
        self.get.assert_not_called()

    def test_missing_consumed_admission_refuses(self):
        self.interrupt();self.get.reset_mock()
        with sqlite3.connect(self.directory/'model-commands.sqlite3') as connection:
            connection.execute('UPDATE execution_admissions SET entered=0')
        with self.assertRaisesRegex(ValueError,'Consumed original admission'):self.recover()
        self.get.assert_not_called()

    def test_lost_recovery_registration_reply_keeps_exact_command(self):
        self.interrupt();self.post.side_effect=TimeoutError('synthetic reply loss')
        with self.assertRaises(client.DeliveryUnconfirmed):self.recover()
        pending=journal.pending(self.directory,self.writer.context.destination)
        self.assertEqual(len(pending),1)
        payload=pending[0]['command']['arguments']['payload']
        self.assertEqual(payload['artifact_type'],'model_validation_source_publication')
        self.assertTrue(payload['file_url'].startswith('storage://run-artifacts/'))
        self.assertTrue(self.writer.stopped)


if __name__=='__main__':unittest.main()
