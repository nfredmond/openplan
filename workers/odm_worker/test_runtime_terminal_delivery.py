"""Original terminal bodies from actual retained observation/product fixtures."""
import copy
import hashlib
import json
import stat
import unittest
from unittest.mock import patch
import application_delivery_authority as authority_module
import runtime_terminal_delivery as module
from retained_source import json_bytes
import test_runtime_artifact_access as fixtures

class Checks(unittest.TestCase):
    def setUp(self):
        self.f=fixtures.Checks();self.f.setUp();self.addCleanup(self.f.doCleanups)
        self.runtime=self.f.runtime;self.request=self.f.request;self.observation=self.f.observation
        self.lease=self.f.prepare();self.observer=self.f.f.f.f.f.observer
        self.allowed=True;self.access_calls=[];self.calls=[];self.replies=[(200,b'{"ok":true,"status":"succeeded"}')]*6
        binding=self.f.original['manifest']['binding']
        def access(arguments,deadline,*,owned):
            self.access_calls.append(copy.deepcopy(arguments))
            self.assertEqual(arguments['p_reference'],binding['jobReference'],'Terminal authority keeps original worker reference')
            return json.dumps({'format':authority_module.FORMAT,'installationId':binding['installationId'],
                'targetId':binding['targetId'],'operation':authority_module.TERMINAL,
                'applicationJob':binding['originalApplicationJob'],'payloadSha256':binding['originalDispatchSha256'],
                'authorizedNow':self.allowed,'authorityObservedAt':'2026-10-14T14:00:00Z','engineTransportPermission':False}).encode()
        self.authority=authority_module.Authority(self.f.access.dispatch,access,timeout=4)
        def transport(url,credential,body,deadline,*,owned):
            self.calls.append((url,credential,body,owned()))
            value=self.replies.pop(0)
            if isinstance(value,BaseException):raise value
            return value
        self.transport=transport
        self.delivery=module.Delivery(self.observer,self.authority,transport,'original-callback-credential',access=self.f.access,timeout=4)
        self.root=self.delivery.folder(self.request)
    def prepare(self):
        with self.runtime.owner():return self.delivery.prepare_original(self.request,self.observation)
    def advance(self):
        with self.runtime.owner():return self.delivery.advance(self.request)
    def reported(self,code):
        native=self.f.f.f.f.f;native.value['status']={'code':code}
        with self.runtime.owner():observed=native.observer.observe(self.request)
        self.observation=observed['task']['bodySha256']
    def test_exact_terminal_body_scope_and_separate_records(self):
        command=self.prepare();body=json.loads(command['bodyText'])
        self.assertEqual(command['format'],module.FORMAT,'Terminal command has its separate format')
        self.assertEqual(command['binding']['observationSha256'],self.observation,'Terminal body binds the original observation')
        self.assertEqual(command['binding']['leaseSha256'],hashlib.sha256(json_bytes(self.lease)).hexdigest(),'Terminal body binds the original lease')
        self.assertEqual(body['status'],'succeeded','Native40 reports processing completion')
        self.assertEqual(len(body['artifacts']),3,'Only retained original products enter the body')
        self.assertTrue(all('boundsWgs84' not in row for row in body['artifacts']),'Unassessed placement cannot become coordinates')
        self.assertEqual(self.calls,[],'Preparation sends no POST')
        result=self.advance()
        self.assertEqual(result['state'],'acknowledged','Matching receiver status is acknowledged')
        self.assertEqual(self.calls[0][2],command['bodyText'].encode(),'Terminal POST keeps exact original bytes')
        self.assertIs(result['publicationPermission'],False,'Acknowledgement grants no publication')
        self.assertEqual(result['applicationAcceptanceVerification'],'unassessed','Receiver acknowledgement is not human acceptance')
        for path in self.root.iterdir():self.assertEqual(stat.S_IMODE(path.stat().st_mode),0o600,'Terminal records stay private')
        self.assertEqual(json.loads((self.root/'attempt-000000.json').read_bytes())['format'],module.FORMAT,'Intent uses terminal format')
        self.assertEqual(json.loads((self.root/'reply-000000.json').read_bytes())['format'],module.FORMAT,'Reply uses terminal format')
    def test_restart_keeps_original_identity_time_urls_and_body(self):
        first=self.prepare()
        with patch.object(module.secrets,'token_urlsafe',side_effect=AssertionError('Replay cannot invent terminal identity')):
            self.assertEqual(self.prepare(),first,'Restart keeps exact original terminal command')
    def test_uncertain_send_retries_same_bytes(self):
        command=self.prepare();self.replies=[TimeoutError('Acknowledgement lost'),(200,b'{"ok":true,"status":"succeeded"}')]
        with self.assertRaisesRegex(TimeoutError,'Acknowledgement lost'):self.advance()
        self.assertEqual(self.advance()['state'],'acknowledged')
        self.assertEqual([row[2] for row in self.calls],[command['bodyText'].encode()]*2,'Uncertain replay cannot change terminal bytes')
    def test_acknowledged_replay_does_not_post_again(self):
        self.prepare();first=self.advance();second=self.advance()
        self.assertEqual(len(self.calls),1,'Saved terminal acknowledgement prevents another POST')
        self.assertEqual(second,first)
    def test_expired_lease_keeps_saved_command_and_ack_replay(self):
        first=self.prepare();self.f.now=1100
        self.assertEqual(self.prepare(),first,'Saved terminal command remains readable after lease expiry')
        self.assertEqual(self.advance()['state'],'acknowledged','Expired original URLs do not prevent exact applied replay')
    def test_expired_lease_refuses_first_preparation(self):
        self.f.now=1100
        with self.assertRaisesRegex(PermissionError,'original lease expired'):self.prepare()
        self.assertFalse((self.root/'command.json').exists(),'Expired lease cannot create an unsendable first command')
    def test_failed_observation_needs_no_success_lease(self):
        self.reported(30);self.delivery.access=None;command=self.prepare();body=json.loads(command['bodyText'])
        self.assertEqual(body['status'],'failed','Native30 remains failed')
        self.assertNotIn('artifacts',body,'Failed completion invents no artifacts')
        self.assertIsNone(command['binding']['leaseSha256'],'Failure needs no success lease')
    def test_canceled_observation_needs_no_success_lease(self):
        self.reported(50);self.delivery.access=None;body=json.loads(self.prepare()['bodyText'])
        self.assertEqual(body['status'],'canceled','Native50 remains canceled')
        self.assertNotIn('artifacts',body,'Cancellation invents no artifacts')
    def test_running_observation_refuses_terminal_preparation(self):
        self.reported(20)
        with self.assertRaisesRegex(ValueError,'no reported terminal observation'):self.prepare()
    def test_wrong_reported_status_refuses(self):
        command=self.prepare();body=json.loads(command['bodyText']);body['status']='failed';del body['artifacts']
        with self.runtime.owner(),self.assertRaisesRegex(ValueError,'differs from original reported engine state'):
            self.delivery._command(self.request,module.EVENT,json_bytes(body),__import__('time').monotonic()+4,observation_hash=self.observation)
    def test_changed_artifact_url_refuses(self):
        command=self.prepare();body=json.loads(command['bodyText']);body['artifacts'][0]['downloadUrl']='https://other.example/changed'
        with self.runtime.owner(),self.assertRaisesRegex(ValueError,'artifact projection differs from original lease'):
            self.delivery._command(self.request,module.EVENT,json_bytes(body),__import__('time').monotonic()+4,observation_hash=self.observation)
    def test_changed_callback_identity_cannot_replace_saved_command(self):
        command=self.prepare();body=json.loads(command['bodyText']);body['callbackId']='different-terminal'
        with self.runtime.owner(),self.assertRaisesRegex(ValueError,'Existing source custody record differs'):
            self.delivery.prepare(self.request,self.observation,json_bytes(body))
    def test_revoked_actor_refuses_before_preparation(self):
        self.allowed=False
        with self.assertRaisesRegex(PermissionError,'current original actor refused'):self.prepare()
        self.assertFalse(self.root.exists(),'Current access precedes terminal records')
    def test_ignored_receiver_is_not_applied_completion(self):
        self.prepare();self.replies=[(200,b'{"ok":true,"ignored":"superseded"}')]
        self.assertEqual(self.advance()['state'],'receiver_ignored','Ignored callback is not completion acknowledgement')
    def test_wrong_receiver_status_remains_retry_pending(self):
        self.prepare();self.replies=[(200,b'{"ok":true,"status":"running"}'),(200,b'{"ok":true,"status":"succeeded"}')]
        self.assertEqual(self.advance()['state'],'retry_pending','Other receiver status cannot acknowledge terminal completion')
        self.assertEqual(self.advance()['state'],'acknowledged');self.assertEqual(len(self.calls),2,'Wrong status remains recoverable')
    def test_another_event_key_refuses(self):
        with self.assertRaisesRegex(ValueError,'one original event key'):self.delivery.folder(self.request,'other-terminal')
    def test_lost_command_with_attempt_refuses_recreation(self):
        self.prepare();self.advance();(self.root/'command.json').unlink()
        with self.assertRaisesRegex(ValueError,'records require their original command'):self.prepare()
    def test_lost_context_refuses_saved_replay(self):
        self.prepare();(self.root/'context.json').unlink()
        with self.assertRaises(FileNotFoundError):self.advance()
    def test_changed_context_refuses_observation_substitution(self):
        self.prepare();(self.root/'context.json').write_bytes(json_bytes({'observationSha256':'0'*64}))
        with self.assertRaises(FileNotFoundError):self.advance()

    def test_malformed_ignored_reply_remains_retry_pending(self):
        self.prepare()
        for value in (None,False,'unknown'):
            self.replies=[(200,json.dumps({'ok':True,'ignored':value}).encode())]
            self.assertEqual(self.advance()['state'],'retry_pending','Malformed ignored reply cannot stop original replay')
        self.assertEqual(len(self.calls),3,'Malformed ignored replies stay retryable')
    def test_first_preparation_refuses_transport_too_small(self):
        self.transport.max_body=1
        with self.assertRaisesRegex(ValueError,'actual transport allowance'):self.prepare()
        self.assertFalse((self.root/'command.json').exists(),'Unsendable body cannot freeze a command')
    def test_known_partial_metadata_recovers_before_first_command(self):
        self.root.mkdir(mode=0o700);partial=self.root/('.partial-'+'a'*32);partial.write_bytes(b'Interrupted metadata');partial.chmod(0o600)
        self.prepare()
        self.assertFalse(partial.exists(),'Known incomplete metadata does not prevent original preparation')
        self.assertTrue((self.root/'command.json').exists(),'Original command is recoverable after partial metadata')
    def test_lease_change_refuses_saved_terminal_replay(self):
        self.prepare();self.f.alter('lease.json',lambda r:r.update(expiresAt=1200))
        with self.assertRaisesRegex(ValueError,'original artifact lease receipt differs'):self.advance()
    def test_saved_reply_from_progress_namespace_refuses(self):
        self.prepare();self.advance();p=self.root/'reply-000000.json';r=json.loads(p.read_bytes());r['format']='openplan.odm-progress-delivery.v1';p.write_bytes(json_bytes(r))
        with self.assertRaisesRegex(ValueError,'receiver reply binding differs'):self.advance()
    def test_saved_intent_from_progress_namespace_refuses(self):
        self.prepare();self.advance();p=self.root/'attempt-000000.json';r=json.loads(p.read_bytes());r['format']='openplan.odm-progress-delivery.v1';p.write_bytes(json_bytes(r))
        with self.assertRaisesRegex(ValueError,'attempt binding differs'):self.advance()
    def test_revocation_after_intent_prevents_post(self):
        self.prepare()
        import runtime_progress_delivery as journal
        publish=journal.publish
        def revoke(root,name,raw):
            publish(root,name,raw)
            if root==self.root and name.startswith('attempt-'):self.allowed=False
        with patch.object(journal,'publish',side_effect=revoke),self.assertRaisesRegex(PermissionError,'current original actor refused'):self.advance()
        self.assertEqual(self.calls,[],'Current access after intent precedes terminal POST')
    def test_revocation_after_reply_keeps_receiver_fact(self):
        self.prepare()
        def revoke(url,credential,body,deadline,*,owned):
            self.allowed=False
            return 200,b'{"ok":true,"status":"succeeded"}'
        self.delivery.transport=revoke
        with self.assertRaisesRegex(PermissionError,'current original actor refused'):self.advance()
        self.assertTrue((self.root/'reply-000000.json').exists(),'Received terminal reply survives later refusal')
    def test_interrupted_command_recovers_exact_body(self):
        publish=module.publish
        def interrupt(root,name,raw):
            publish(root,name,raw)
            if root==self.root and name=='command.json':raise InterruptedError('Original terminal body already saved')
        with patch.object(module,'publish',side_effect=interrupt),self.assertRaisesRegex(InterruptedError,'Original terminal body already saved'):self.prepare()
        saved=(self.root/'command.json').read_bytes()
        with patch.object(module.secrets,'token_urlsafe',side_effect=AssertionError('Recovery cannot create callback identity')):self.prepare()
        self.assertEqual((self.root/'command.json').read_bytes(),saved,'Interrupted command replay preserves exact bytes')


    def test_ignored_receipt_remains_historical_after_current_authority_refuses(self):
        self.prepare()
        def ignored(*args,**kwargs):
            self.allowed=False;self.calls.append(args)
            return 200,b'{"ok":true,"ignored":"terminal"}'
        self.delivery.transport=ignored
        with self.assertRaisesRegex(PermissionError,'current original actor refused'):self.advance()
        count=len(self.access_calls)
        with self.runtime.owner():receipt=self.delivery.historical_receiver_receipt(self.request)
        self.assertEqual(receipt['historicalReceiverOutcome'],'receiver_ignored','Historical ignored receipt remains observable')
        self.assertIs(receipt['transportPermission'],False,'Historical receipt cannot authorize POST')
        self.assertEqual(receipt['currentAccess'],'unassessed','Historical receipt makes no current access claim')
        self.assertEqual(len(self.access_calls),count,'Historical read cannot ask for current POST authority')
        with self.assertRaisesRegex(PermissionError,'current original actor refused'):self.advance()
        self.assertEqual(len(self.calls),1,'Refused current authority cannot send another callback')
    def test_historical_receipt_requires_original_ownership(self):
        self.prepare();self.advance()
        with self.assertRaisesRegex(ValueError,'lifetime owner'):self.delivery.historical_receiver_receipt(self.request)
    def test_historical_receipt_refuses_changed_intent(self):
        self.prepare();self.advance();path=self.root/'attempt-000000.json'
        row=json.loads(path.read_bytes());row['commandSha256']='0'*64;path.write_bytes(json_bytes(row))
        with self.runtime.owner(),self.assertRaisesRegex(ValueError,'historical attempt binding differs'):
            self.delivery.historical_receiver_receipt(self.request)
    def test_historical_receipt_refuses_orphan_reply(self):
        self.prepare();self.advance();(self.root/'attempt-000000.json').unlink()
        with self.runtime.owner(),self.assertRaisesRegex(ValueError,'historical reply requires'):
            self.delivery.historical_receiver_receipt(self.request)
    def test_historical_receipt_refuses_attempt_gap(self):
        self.prepare();self.advance();(self.root/'attempt-000000.json').rename(self.root/'attempt-000001.json')
        with self.runtime.owner(),self.assertRaisesRegex(ValueError,'historical attempt sequence differs'):
            self.delivery.historical_receiver_receipt(self.request)
    def test_historical_receipt_does_not_publish_attempt_or_apply_current_lease_expiry(self):
        self.prepare();self.advance();self.allowed=False;self.f.now=1100
        before={p.name:p.read_bytes() for p in self.root.iterdir()}
        with self.runtime.owner():receipt=self.delivery.historical_receiver_receipt(self.request)
        self.assertEqual(receipt['historicalReceiverOutcome'],'acknowledged','Historical fact survives current expiry')
        self.assertEqual({p.name:p.read_bytes() for p in self.root.iterdir()},before,'Historical receipt publishes no new records')

    def test_historical_and_cached_ack_survive_smaller_current_transport(self):
        self.prepare();first=self.advance();self.transport.max_body=1
        with self.runtime.owner():receipt=self.delivery.historical_receiver_receipt(self.request)
        self.assertEqual(receipt['historicalReceiverOutcome'],'acknowledged','Historical receipt ignores current transport allowance')
        self.assertEqual(self.advance(),first,'Cached acknowledgement ignores current transport allowance')
        self.assertEqual(len(self.calls),1,'Cached receipt does not POST through smaller transport')
    def test_new_post_refuses_smaller_current_transport_before_intent(self):
        self.prepare();self.transport.max_body=1
        with self.assertRaisesRegex(ValueError,'actual transport allowance'):self.advance()
        self.assertFalse((self.root/'attempt-000000.json').exists(),'Unsendable replacement transport cannot retain a new intent')
        self.assertEqual(self.calls,[],'Unsendable replacement transport cannot POST')
    def test_large_original_body_remains_readable_with_progress_size_transport(self):
        self.reported(30);self.transport.max_body=module.BODY_LIMIT
        with self.runtime.owner():
            entry=self.runtime.journal.get(self.request)
            body={'schemaVersion':entry.request['schemaVersion'],'requestId':self.request,
                'jobReference':entry.job_reference,'callbackId':'🚀'*15000,'status':'failed','occurredAt':'2026-10-14T14:00:00Z'}
            command=self.delivery.prepare(self.request,self.observation,json_bytes(body))
        self.replies=[(200,b'{"ok":true,"status":"failed"}')];self.advance()
        self.transport.max_body=16*1024
        with self.runtime.owner():receipt=self.delivery.historical_receiver_receipt(self.request)
        self.assertGreater(command['bodyBytes'],16*1024,'Original terminal body exceeds progress allowance')
        self.assertEqual(receipt['historicalReceiverOutcome'],'acknowledged','Large original receipt remains locally readable')
        self.assertEqual(self.advance()['state'],'acknowledged','Large cached acknowledgement needs no new POST')
        self.assertEqual(len(self.calls),1,'Large cached original is not sent again')

if __name__=='__main__':unittest.main()
