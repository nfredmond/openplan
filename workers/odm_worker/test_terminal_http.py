"""Explicit terminal byte allowance with supervised loopback transport."""
import base64
import json
import struct
import time
import unittest
from unittest.mock import patch
import progress_http as module
import test_progress_http as fixtures

class Checks(unittest.TestCase):
    def setUp(self):
        self.f=fixtures.Checks();self.f.setUp();self.addCleanup(self.f.doCleanups)
    def test_explicit_large_body_reaches_original_endpoint_exactly(self):
        f=self.f
        transport=module.Transport(f.url,'original-key',lambda _: 'synthetic-only',
            allowed_networks=('127.0.0.1/32',),allowed_ports=(f.server.server_port,),max_body_bytes=64*1024)
        body=json.dumps({'original':'🚀'*10000},ensure_ascii=False).encode()
        self.assertEqual(transport(f.url,'original-key',body,time.monotonic()+4,owned=lambda:True),(200,f.reply),'Explicit larger callback completes')
        self.assertEqual(f.requests[0][2],body,'Larger terminal callback keeps exact UTF8 bytes')
    def test_default_body_bound_remains_progress_limit(self):
        with self.assertRaisesRegex(ValueError,'exact body bytes exceed'):
            self.f.transport(self.f.url,'original-key',b'x'*(module.BODY_LIMIT+1),time.monotonic()+4,owned=lambda:True)
        self.assertEqual(self.f.requests,[],'Default progress allowance stays unchanged')
    def test_invalid_body_allowance_refuses_constructor(self):
        for bound in (True,0,-1,64*1024+1,1.5,None):
            with self.assertRaisesRegex(ValueError,'body allowance differs'):
                module.Transport(self.f.url,'original-key',lambda _: 'synthetic-only',max_body_bytes=bound,
                    allowed_networks=('127.0.0.1/32',),allowed_ports=(self.f.server.server_port,))
    def child(self,bound,body):
        raw=json.dumps({'url':self.f.url,'ports':[self.f.server.server_port],'deadline':time.monotonic()+4,'maxBodyBytes':bound,'bodyBase64':base64.b64encode(body).decode()}).encode()
        values=iter([struct.pack('!I',len(raw)),raw])
        with patch.object(module.threading.Thread,'start'),patch.object(module,'exact_input',side_effect=lambda _:next(values)),patch.object(module,'parse_url',side_effect=AssertionError('Invalid child body must precede DNS')):
            module.child(0)
    def test_child_body_bound_refuses_before_dns(self):
        with self.assertRaisesRegex(ValueError,'child body exceeds'):self.child(1,b'xx')
    def test_child_allowance_refuses_before_dns(self):
        with self.assertRaisesRegex(ValueError,'body allowance differs'):self.child(True,b'x')

if __name__=='__main__':unittest.main()
