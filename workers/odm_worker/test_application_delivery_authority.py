"""Separate delivery access tied to actual saved dispatch custody."""
import copy
import hashlib
import json
import time
import unittest
import application_delivery_authority as module
import test_application_dispatch_reader as fixtures


class Checks(unittest.TestCase):
    def setUp(self):
        self.f=fixtures.Checks();self.f.setUp();self.addCleanup(self.f.tearDown)
        with self.f.runtime.owner():
            entry=self.f.started();self.f.custody.save(self.f.request['requestId'],self.f.payload.encode(),self.f.row)
        self.binding={'installationId':self.f.runtime.installation['installationId'],'targetId':self.f.custody.target,
            'requestId':self.f.request['requestId'],'jobReference':entry.job_reference,'originalApplicationJob':copy.deepcopy(self.f.row),
            'originalDispatchSha256':hashlib.sha256(self.f.payload.encode()).hexdigest()}
        self.receipt={'format':module.FORMAT,'installationId':self.binding['installationId'],'targetId':self.binding['targetId'],
            'operation':module.ARTIFACT,'applicationJob':copy.deepcopy(self.f.row),'payloadSha256':self.binding['originalDispatchSha256'],
            'authorizedNow':True,'authorityObservedAt':'2026-10-14T14:00:00.123456Z','engineTransportPermission':False}
        self.calls=[];self.raw=None;self.effect=None
        def transport(arguments,deadline,*,owned):
            self.calls.append((copy.deepcopy(arguments),deadline,owned()))
            if self.effect:self.effect()
            return self.raw if self.raw is not None else json.dumps(self.receipt).encode()
        self.transport=transport;self.authority=module.Authority(self.f.custody,transport,timeout=4)
        self.callback={'schemaVersion':self.f.request['schemaVersion'],'requestId':self.binding['requestId'],
            'jobReference':entry.job_reference,'callbackId':'original-terminal','occurredAt':'2026-10-14T14:00:00Z','status':'succeeded'}

    def call(self,**changes):
        fields={'binding':self.binding,'operation':module.ARTIFACT,'deadline':time.monotonic()+4,'owned':lambda:self.f.runtime._owned,**changes}
        with self.f.runtime.owner():return self.authority(**fields)

    def test_original_arguments_and_ownership(self):
        self.assertIs(self.call(),True)
        self.assertEqual(self.calls[0][0],{'p_request':self.binding['requestId'],'p_installation':self.binding['installationId'],
            'p_target':self.binding['targetId'],'p_reference':self.binding['jobReference'],'p_operation':module.ARTIFACT,'p_callback':None},'Delivery RPC sends exact original scope')
        self.assertIs(self.calls[0][2],True,'Delivery transport carries original ownership')

    def test_revocation_stays_false(self):
        self.receipt['authorizedNow']=False
        self.assertIs(self.call(),False,'Current refusal cannot become delivery access')

    def test_completed_processing_does_not_control_delivery(self):
        self.f.receipt['authorizedNow']=False
        self.assertIs(self.call(),True,'Distinct scope permits completed delivery')
        self.assertEqual(self.f.calls,[],'Delivery cannot reenter processing reader')

    def test_terminal_callback_is_original(self):
        self.receipt['operation']=module.TERMINAL
        self.assertIs(self.call(operation=module.TERMINAL,callback=self.callback),True)
        self.assertEqual(self.calls[0][0]['p_callback'],self.callback,'Terminal access observes exact original callback')

    def test_changed_binding_refuses(self):
        changed=copy.deepcopy(self.binding);changed['originalDispatchSha256']='0'*64
        with self.assertRaisesRegex(ValueError,'supplied original differs'):self.call(binding=changed)
        self.assertEqual(self.calls,[],'Changed original cannot reach transport')

    def test_processing_operation_refuses(self):
        with self.assertRaisesRegex(ValueError,'operation or callback scope differs'):self.call(operation='processing')

    def test_artifact_callback_refuses(self):
        with self.assertRaisesRegex(ValueError,'operation or callback scope differs'):self.call(callback=self.callback)

    def test_missing_terminal_callback_refuses(self):
        with self.assertRaisesRegex(ValueError,'operation or callback scope differs'):self.call(operation=module.TERMINAL)

    def test_changed_terminal_original_refuses(self):
        changed=copy.deepcopy(self.callback);changed['jobReference']='other'
        with self.assertRaisesRegex(ValueError,'terminal original differs'):self.call(operation=module.TERMINAL,callback=changed)

    def test_wrong_operation_receipt_refuses(self):
        self.receipt['operation']=module.TERMINAL
        with self.assertRaisesRegex(ValueError,'response original scope differs'):self.call()

    def test_wrong_original_receipt_refuses(self):
        self.receipt['applicationJob']['created_by']='other'
        with self.assertRaisesRegex(ValueError,'response original scope differs'):self.call()

    def test_nonboolean_access_refuses(self):
        self.receipt['authorizedNow']=1
        with self.assertRaisesRegex(ValueError,'response original scope differs'):self.call()

    def test_engine_permission_refuses(self):
        self.receipt['engineTransportPermission']=True
        with self.assertRaisesRegex(ValueError,'response original scope differs'):self.call()

    def test_extra_receipt_refuses(self):
        self.receipt['extra']=True
        with self.assertRaisesRegex(ValueError,'response original scope differs'):self.call()

    def test_response_size_refuses(self):
        self.raw=b'X'*(module.REPLY_LIMIT+1)
        with self.assertRaisesRegex(ValueError,'response byte count differs'):self.call()

    def test_invalid_json_refuses(self):
        self.raw=b'not-json'
        with self.assertRaisesRegex(ValueError,'response JSON differs'):self.call()

    def test_duplicate_json_refuses(self):
        self.raw=json.dumps(self.receipt).encode()[:-1]+b',"authorizedNow":true}'
        with self.assertRaisesRegex(ValueError,'response JSON differs'):self.call()

    def test_nonfinite_json_refuses(self):
        self.raw=json.dumps(self.receipt).encode()[:-1]+b',"unexpected":NaN}'
        with self.assertRaisesRegex(ValueError,'response JSON differs'):self.call()

    def test_bad_observation_time_refuses(self):
        self.receipt['authorityObservedAt']='yesterday'
        with self.assertRaisesRegex(ValueError,'observation time differs'):self.call()

    def test_impossible_time_refuses(self):
        self.receipt['authorityObservedAt']='2026-99-14T14:00:00Z'
        with self.assertRaisesRegex(ValueError,'observation time differs'):self.call()

    def test_owner_loss_after_transport_refuses(self):
        self.effect=lambda:setattr(self.f.runtime,'_owned',False)
        with self.assertRaisesRegex(InterruptedError,'ownership ended'):self.call()

    def test_expired_deadline_refuses(self):
        with self.assertRaisesRegex(TimeoutError,'deadline exceeded'):self.call(deadline=time.monotonic()-1)
        self.assertEqual(self.calls,[],'Expired deadline prevents transport')

    def test_invalid_constructor_refuses(self):
        with self.assertRaisesRegex(ValueError,'original custody and explicit transport'):module.Authority(None,self.transport)
        with self.assertRaisesRegex(ValueError,'finite and positive'):module.Authority(self.f.custody,self.transport,timeout=True)

    def test_invalid_deadline_refuses(self):
        with self.assertRaisesRegex(ValueError,'shared deadline and ownership'):self.call(deadline=float('inf'))

    def test_invalid_binding_refuses(self):
        with self.assertRaisesRegex(ValueError,'requires its original binding'):self.call(binding=None)


if __name__=='__main__':unittest.main()
