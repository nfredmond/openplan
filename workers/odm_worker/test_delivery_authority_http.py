"""Supervised delivery RPC over an actual private loopback HTTP fixture."""
import copy
import json
import time
import unittest
import application_dispatch_http as module
from application_delivery_authority import ARTIFACT, TERMINAL
import test_application_dispatch_http as fixtures


class Checks(unittest.TestCase):
    def setUp(self):
        self.f=fixtures.Checks();self.f.setUp();self.addCleanup(self.f.tearDown)
        self.args={**self.f.args,'p_reference':'odm-original-reference','p_operation':ARTIFACT,'p_callback':None}
        self.transport=module.Transport(self.f.url+'/rest/v1','original-credential',lambda _:self.f.tokens,
            allow_http=True,max_response_bytes=4096,rpc=module.DELIVERY_RPC)

    def read(self,args=None):
        return self.transport(self.args if args is None else args,time.monotonic()+3)

    def callback(self):
        return {'schemaVersion':'natford-aerial-processing.v1','requestId':self.args['p_request'],
            'jobReference':self.args['p_reference'],'callbackId':'🚀'*4,'status':'succeeded',
            'occurredAt':'2026-10-14T14:00:00Z'}

    def test_fixed_delivery_path_and_original_scope(self):
        self.assertEqual(self.read(),self.f.body,'Delivery response bytes remain exact')
        path,headers,body=self.f.requests[0]
        self.assertEqual(path,'/rest/v1/rpc/read_aerial_delivery_authority','Only explicit delivery RPC receives delivery scope')
        self.assertEqual(json.loads(body),self.args,'Delivery scope reaches actual HTTP unchanged')
        self.assertEqual(headers['Authorization'],'Bearer '+self.f.tokens['bearerToken'],'Configured private credential reaches original target')

    def test_terminal_body_and_unicode_identity_remain_exact(self):
        args={**self.args,'p_operation':TERMINAL,'p_callback':self.callback()}
        self.read(args)
        self.assertEqual(json.loads(self.f.requests[0][2]),args,'Terminal authority receives exact original callback including Unicode')

    def test_large_utf8_callback_fits_private_metadata(self):
        callback=self.callback();callback['callbackId']='🚀'*15000
        args={**self.args,'p_operation':TERMINAL,'p_callback':callback}
        self.read(args)
        self.assertEqual(json.loads(self.f.requests[0][2]),args,'UTF8 delivery callback fits actual supervised metadata')

    def test_default_rpc_cannot_accept_delivery_arguments(self):
        with self.assertRaisesRegex(ValueError,'RPC parameters differ'):
            self.f.transport(self.args,time.monotonic()+3)
        self.assertEqual(self.f.requests,[],'Default processing path cannot infer delivery scope')

    def test_unknown_rpc_constructor_refuses(self):
        with self.assertRaisesRegex(ValueError,'RPC selection differs'):
            module.Transport(self.f.url,'original-credential',lambda _:self.f.tokens,allow_http=True,rpc='arbitrary_write')

    def test_unknown_rpc_child_refuses_before_network(self):
        metadata={**self.f.child_metadata(),'rpc':'arbitrary_write','parameters':self.args}
        code,body,error=self.f.invoke_child(metadata)
        self.assertEqual((code,body,error),(2,b'',b'Private dispatch RPC read failed\n'),'Child independently refuses arbitrary RPC')
        self.assertEqual(self.f.requests,[],'Unknown child RPC precedes network work')

    def test_missing_original_reference_refuses(self):
        args=copy.deepcopy(self.args);del args['p_reference']
        with self.assertRaisesRegex(ValueError,'delivery RPC parameters differ'):self.read(args)

    def test_blank_original_reference_refuses(self):
        args={**self.args,'p_reference':' '}
        with self.assertRaisesRegex(ValueError,'delivery RPC parameters differ'):self.read(args)

    def test_unknown_operation_refuses(self):
        with self.assertRaisesRegex(ValueError,'delivery RPC operation differs'):
            self.read({**self.args,'p_operation':'processing'})

    def test_artifact_scope_cannot_carry_callback(self):
        with self.assertRaisesRegex(ValueError,'delivery RPC operation differs'):
            self.read({**self.args,'p_callback':self.callback()})

    def test_terminal_scope_needs_callback(self):
        with self.assertRaisesRegex(ValueError,'delivery RPC operation differs'):
            self.read({**self.args,'p_operation':TERMINAL})

    def test_nonfinite_callback_refuses_before_network(self):
        callback=self.callback();callback['progress']=float('inf')
        with self.assertRaisesRegex(ValueError,'delivery callback JSON differs'):
            self.read({**self.args,'p_operation':TERMINAL,'p_callback':callback})
        self.assertEqual(self.f.requests,[],'Invalid callback cannot start private RPC')

    def test_oversized_callback_refuses_before_network(self):
        callback=self.callback();callback['message']='X'*module.DELIVERY_BODY_LIMIT
        with self.assertRaisesRegex(ValueError,'delivery callback exceeds its bound'):
            self.read({**self.args,'p_operation':TERMINAL,'p_callback':callback})
        self.assertEqual(self.f.requests,[],'Oversized callback cannot start private RPC')


if __name__=='__main__':unittest.main()
