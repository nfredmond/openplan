"""Owned loopback source transport and supplied-policy checks, not public acceptance."""
import copy
import ctypes
from email.message import Message
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import ipaddress
import json
import os
from pathlib import Path
import select
import socket
import ssl
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch

import url_transport as module
from url_transport import Transport


class Checks(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='odm-url-transport-');self.root=Path(self.temp.name)
        self.raw=b'Synthetic source bytes\x00\xff';self.mode='ordinary';self.requests=[];self.children=[]
        self.entered,self.release,self.closed=threading.Event(),threading.Event(),threading.Event()
        self.finished=threading.Event()
        self.original_spawn=subprocess.Popen;fixture=self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*_args):pass
            def peer_closed(self,closed):
                readable,_,_=select.select([self.connection],[],[],3)
                if not readable:return
                try:
                    if self.connection.recv(1)==b'':closed.set()
                except ConnectionResetError:
                    # Killing a reader with unread response bytes can send RST.
                    closed.set()
            def do_GET(self):
                mode=fixture.mode
                entered,release,closed,finished=fixture.entered,fixture.release,fixture.closed,fixture.finished
                fixture.requests.append({'path':self.path,'headers':dict(self.headers)})
                try:
                    if mode=='held_headers':
                        entered.set();self.peer_closed(closed);release.wait(3);return
                    if self.path.startswith('/redirect'):
                        self.send_response(302)
                        self.send_header('Location',fixture.redirect)
                        self.send_header('Content-Length','999999');self.end_headers()
                        self.peer_closed(closed);return
                    self.send_response(206 if mode=='partial_status' else 200)
                    if mode in ('chunked','truncated_chunked'):self.send_header('Transfer-Encoding','chunked')
                    elif mode not in ('unknown_length','encoded','ambiguous','bad_length'):
                        length=len(fixture.raw)+(10 if mode in ('truncated','held_body') else 0)
                        self.send_header('Content-Length',str(length))
                        if mode=='duplicate_length':self.send_header('Content-Length',str(length))
                    if mode=='bad_length':self.send_header('Content-Length','-1')
                    if mode=='encoded':self.send_header('Content-Encoding','gzip')
                    if mode=='ambiguous':
                        self.send_header('Content-Length',str(len(fixture.raw)));self.send_header('Transfer-Encoding','chunked')
                    self.end_headers()
                    if mode=='held_body':
                        self.wfile.write(fixture.raw[:3]);self.wfile.flush();entered.set()
                        self.peer_closed(closed);release.wait(3);return
                    if mode in ('chunked','truncated_chunked'):
                        self.wfile.write(f'{len(fixture.raw):x}\r\n'.encode()+fixture.raw+b'\r\n'+(b'0\r\n\r\n' if mode=='chunked' else b''))
                    else:self.wfile.write(fixture.raw)
                    self.wfile.flush()
                except (BrokenPipeError,ConnectionResetError):pass
                finally:finished.set()
        self.Handler=Handler;self.launch()

    def launch(self,context=None):
        self.server=ThreadingHTTPServer(('127.0.0.1',0),self.Handler);self.server.daemon_threads=True
        if context:self.server.socket=context.wrap_socket(self.server.socket,server_side=True)
        self.port=self.server.server_address[1];self.url=('https' if context else 'http')+'://127.0.0.1:'+str(self.port)
        self.redirect=self.url+'/original?synthetic=query'
        self.thread=threading.Thread(target=lambda:self.server.serve_forever(poll_interval=0.02),daemon=True);self.thread.start()

    def tearDown(self):
        self.release.set()
        for child in self.children:
            if child.poll() is None:child.kill()
            child.wait(timeout=5)
        self.server.shutdown();self.server.server_close();self.thread.join(3);self.temp.cleanup()

    def transport(self,**changes):
        return Transport(**{'allowed_networks':('127.0.0.1/32',),'allowed_ports':(self.port,),**changes})

    def spawn(self,*args,**kwargs):
        child=self.original_spawn(*args,**kwargs);self.children.append(child);return child

    def fetch(self,**changes):
        output=io.BytesIO();count=self.transport(**changes)(self.url+'/original?synthetic=query',output,4096,time.monotonic()+3)
        return output.getvalue(),count

    def test_actual_exact_get_and_proxy_independence(self):
        with patch.dict(os.environ,{'HTTP_PROXY':'http://127.0.0.1:1','HTTPS_PROXY':'http://127.0.0.1:1'}):raw,count=self.fetch()
        self.assertEqual((raw,count),(self.raw,len(self.raw)),'Exact source bytes and count must return')
        self.assertEqual(len(self.requests),1,'A source GET must not retry')
        self.assertEqual(self.requests[0]['path'],'/original?synthetic=query','Original signed query must reach the source')
        self.assertEqual(self.requests[0]['headers']['Host'],'127.0.0.1:'+str(self.port))
        self.assertEqual(self.requests[0]['headers']['Accept-Encoding'],'identity')
        self.assertNotIn('Authorization',self.requests[0]['headers'])

    def test_actual_chunked_and_unknown_length(self):
        for mode in ('chunked','unknown_length'):
            with self.subTest(mode=mode):self.mode=mode;self.assertEqual(self.fetch(),(self.raw,len(self.raw)))

    def test_approved_redirect_closes_unread_body(self):
        output=io.BytesIO();count=self.transport()(self.url+'/redirect',output,4096,time.monotonic()+3)
        self.assertEqual((output.getvalue(),count),(self.raw,len(self.raw)))
        self.assertTrue(self.closed.wait(1),'Redirect cleanup must close without reading its stalled body')
        self.assertEqual([row['path'] for row in self.requests],['/redirect','/original?synthetic=query'])

    def test_redirect_address_checked_before_connection(self):
        shadow=ThreadingHTTPServer(('127.0.0.2',self.port),self.Handler);shadow.daemon_threads=True
        thread=threading.Thread(target=lambda:shadow.serve_forever(poll_interval=0.02),daemon=True);thread.start()
        try:
            self.redirect='http://127.0.0.2:'+str(self.port)+'/never'
            with self.assertRaisesRegex(ValueError,'Source transport did not complete'):
                self.transport()(self.url+'/redirect',io.BytesIO(),4096,time.monotonic()+3)
            self.assertEqual(len(self.requests),1,'An available unapproved redirect cannot issue another request')
        finally:shadow.shutdown();shadow.server_close();thread.join(3)

    def test_redirect_limit_and_port_checked(self):
        for target,limit in ((self.url+'/redirect',1),('http://127.0.0.1:1/never',5)):
            with self.subTest(target=target):
                self.requests.clear();self.redirect=target
                with self.assertRaisesRegex(ValueError,'Source transport did not complete'):
                    self.transport(max_redirects=limit)(self.url+'/redirect',io.BytesIO(),4096,time.monotonic()+3)
                self.assertEqual(len(self.requests),limit+1 if target.endswith('/redirect') else 1,'Redirect limit/port must hold')
                if target.endswith('/redirect'):
                    result=self.direct_child(url=self.url+'/redirect',redirects=limit)
                    self.assertEqual(result.returncode,2,'Redirect child must refuse at its original ceiling')

    def test_invalid_urls_refuse_before_spawn(self):
        urls=['ftp://example.org/a','http://u:p@example.org/a','http://example.org/a#part','http://example.org/a#','http://example.org/a\n','http://example.org\\a',
              'http://example.org:0/a','http://example.org:65536/a','http://[::1%25lo]/a','http://example.org/é','http://','http://example.org/'+('a'*65536)]
        for url in urls:
            with self.subTest(url=url[:70]),patch('url_transport.subprocess.Popen',side_effect=AssertionError('Invalid URL spawned')),self.assertRaises(ValueError):
                Transport()(url,io.BytesIO(),4096,time.monotonic()+3)

    def test_pre_cancelled_refuses_before_spawn(self):
        with patch('url_transport.subprocess.Popen',side_effect=AssertionError('Cancelled source spawned')),self.assertRaisesRegex(InterruptedError,'Source transport cancelled'):
            self.fetch(cancelled=lambda:True)
        self.assertEqual(self.requests,[])

    def test_expired_or_nonfinite_deadline_refuses_before_spawn(self):
        for deadline in (float('nan'),float('inf'),True):
            with self.subTest(deadline=deadline),patch('url_transport.subprocess.Popen',side_effect=AssertionError('Expired source spawned')),self.assertRaisesRegex(ValueError,'deadline must be finite'):
                self.transport()(self.url,io.BytesIO(),4096,deadline)
        with patch('url_transport.subprocess.Popen',side_effect=AssertionError('Expired source spawned')),self.assertRaisesRegex(TimeoutError,'Source transport deadline exceeded'):
            self.transport()(self.url,io.BytesIO(),4096,time.monotonic()-1)

    def test_invalid_cancellation_type_refuses(self):
        with patch('url_transport.subprocess.Popen',side_effect=AssertionError('Implicit source cancellation spawned')),self.assertRaisesRegex(ValueError,'cancellation must be a boolean'):
            self.fetch(cancelled=lambda:'no')

    def test_invalid_constructor_policy(self):
        for changes in ({'allowed_networks':'127.0.0.1/32'},{'allowed_networks':(True,)},{'allowed_networks':('127.0.0.1/8',)},{'allowed_ports':(True,)},{'allowed_ports':()},{'allowed_ports':(0,)},
                        {'max_redirects':True},{'max_redirects':6},{'cancelled':None},{'ca_file':'relative.pem'}):
            with self.subTest(changes=changes),self.assertRaises(ValueError):self.transport(**changes)
        with patch('url_transport.sys.platform','unsupported'),self.assertRaisesRegex(ValueError,'Linux source supervision'):self.transport()

    def test_invalid_byte_limit_or_writer_refuses_before_spawn(self):
        for limit,writer in ((-1,io.BytesIO()),(True,io.BytesIO()),(2**63,io.BytesIO()),(4,object())):
            with self.subTest(limit=limit),patch('url_transport.subprocess.Popen',side_effect=AssertionError('Invalid byte writer spawned')),self.assertRaises(ValueError):
                self.transport()(self.url,writer,limit,time.monotonic()+3)

    def test_metadata_bound_refuses_before_spawn(self):
        networks=['127.0.0.1/32']*20000
        with patch('url_transport.subprocess.Popen',side_effect=AssertionError('Oversized metadata spawned')),self.assertRaisesRegex(ValueError,'metadata exceeds its bound'):
            self.fetch(allowed_networks=networks)

    def test_address_policy_public_and_explicit_local(self):
        self.assertTrue(module.address_allowed('8.8.8.8',()))
        self.assertTrue(module.address_allowed('2606:4700:4700::1111',()))
        for address in ('127.0.0.1','10.0.0.1','169.254.169.254','100.64.0.1','192.0.2.1','::1','fc00::1','224.0.0.1','::','::ffff:8.8.8.8','64:ff9b::808:808'):
            with self.subTest(address=address):self.assertFalse(module.address_allowed(address,()),'Only public unicast is permitted by default')
        self.assertTrue(module.address_allowed('127.0.0.1',(ipaddress.ip_network('127.0.0.1/32'),)))
        self.assertFalse(module.address_allowed('127.0.0.2',(ipaddress.ip_network('127.0.0.1/32'),)))
        self.assertFalse(module.address_allowed('224.0.0.1',(ipaddress.ip_network('224.0.0.0/4'),)))
        self.assertFalse(module.address_allowed('64:ff9b::808:808',(module.NAT64,)),'Explicit networks cannot admit translated IPv4 aliases')

    def test_all_dns_answers_must_pass_policy(self):
        parts,port=module.parse_url('http://example.org/a',(80,))
        good=(socket.AF_INET,socket.SOCK_STREAM,6,'',('8.8.8.8',port));bad=(socket.AF_INET,socket.SOCK_STREAM,6,'',('127.0.0.1',port))
        with patch('url_transport.socket.getaddrinfo',return_value=[good,bad]),self.assertRaisesRegex(ValueError,'resolved address is not approved'):module.resolve(parts,port,())
        with patch('url_transport.socket.getaddrinfo',return_value=[]),self.assertRaisesRegex(ValueError,'resolved address is not approved'):module.resolve(parts,port,())

    def test_pinned_connection_does_not_resolve_again(self):
        parts,port=module.parse_url('http://original.example:'+str(self.port)+'/original',(self.port,))
        rows=[(socket.AF_INET,socket.SOCK_STREAM,6,'',('127.0.0.1',port))]
        with patch('url_transport.socket.getaddrinfo',side_effect=AssertionError('Pinned connection resolved again')):
            client=module.connection(parts,port,rows,time.monotonic()+3,None)
            try:client.request('GET','/original');response=client.getresponse();self.assertEqual(response.read(),self.raw)
            finally:client.close()
        self.assertEqual(self.requests[0]['headers']['Host'],'original.example:'+str(self.port),'Pinned address must preserve original host')

    def test_incomplete_encoded_ambiguous_or_partial_response_refuses(self):
        for mode in ('truncated','truncated_chunked','encoded','ambiguous','duplicate_length','bad_length','partial_status'):
            with self.subTest(mode=mode):
                self.mode=mode
                with self.assertRaisesRegex(ValueError,'Source transport did not complete'):self.fetch()

    def test_declared_and_actual_overflow_never_write_excess(self):
        for mode in ('ordinary','unknown_length','chunked'):
            with self.subTest(mode=mode):
                self.mode=mode;output=io.BytesIO()
                with self.assertRaisesRegex(ValueError,'Source transport did not complete'):
                    self.transport()(self.url,output,3,time.monotonic()+3)
                self.assertLessEqual(len(output.getvalue()),3,'Oversized response cannot spend excess bytes')

    def test_actual_cancellation_reaps_child_and_closes_headers_and_body(self):
        for mode in ('held_headers','held_body'):
            with self.subTest(mode=mode):
                self.mode=mode
                self.entered,self.release,self.closed,self.finished=(threading.Event() for _ in range(4))
                cancelled=threading.Event();output=io.BytesIO()
                thread=threading.Thread(target=lambda:cancelled.set() if self.entered.wait(2) else None,daemon=True);thread.start()
                try:
                    with patch('url_transport.subprocess.Popen',side_effect=self.spawn),self.assertRaisesRegex(InterruptedError,'Source transport cancelled'):
                        self.transport(cancelled=cancelled.is_set)(self.url,output,4096,time.monotonic()+3)
                    self.assertTrue(self.entered.is_set() and cancelled.is_set(),'Cancellation must follow source readiness')
                    self.assertIsNotNone(self.children[-1].poll(),'Cancelled source child must be reaped')
                    self.assertTrue(self.closed.wait(1),'Cancelled source peer must see connection close')
                    self.assertLess(len(output.getvalue()),len(self.raw),'Cancelled body cannot complete')
                finally:
                    self.release.set();thread.join(3)
                    self.assertFalse(thread.is_alive(),'Owned cancellation waiter must finish')
                    if self.entered.is_set():
                        self.assertTrue(self.finished.wait(3),'Owned source handler must finish before the next mode')

    def test_actual_deadline_reaps_stalled_response(self):
        self.mode='held_headers';began=time.monotonic()
        with patch('url_transport.subprocess.Popen',side_effect=self.spawn),self.assertRaisesRegex(TimeoutError,'Source transport deadline exceeded'):
            self.transport()(self.url,io.BytesIO(),4096,began+0.25)
        self.assertIsNotNone(self.children[-1].poll(),'Expired source child must be reaped')
        self.assertTrue(self.closed.wait(1),'Expired response must close its peer')
        self.assertLess(time.monotonic()-began,1.5,'Deadline must bound stalled headers')

    def child_script(self,raw):
        path=self.root/'supplied-child.py';path.write_text('import sys\nsys.stdin.buffer.read()\nsys.stdout.buffer.write('+repr(raw)+')\nsys.stdout.buffer.flush()\n')
        return patch.object(module,'__file__',str(path))

    def test_parent_frame_and_completion_checks(self):
        full=b'B'+struct.pack('!I',len(self.raw))+self.raw
        end=b'F'+struct.pack('!I',40)+struct.pack('!Q',len(self.raw))+hashlib.sha256(self.raw).digest()
        cases=((b'X'+struct.pack('!I',1)+b'x','frame differs'),(b'B'+struct.pack('!I',module.CHUNK+1),'frame differs'),(full+end+full,'frame differs'),
            (full+end[:-1],'did not complete'),(full+end[:-1]+bytes([end[-1]^1]),'completion differs'),(full,'did not complete'),
            (full+b'F'+struct.pack('!I',1)+b'x','completion differs'),(b'B'+struct.pack('!I',0),'bytes exceed their bound'))
        for raw,reason in cases:
            with self.subTest(reason=reason),self.child_script(raw),self.assertRaisesRegex(ValueError,'Source transport '+reason):self.fetch()
        with self.child_script(full+end):self.assertEqual(self.fetch(),(self.raw,len(self.raw)))

    def test_parent_bounds_supplied_child_and_short_local_write(self):
        raw=b'B'+struct.pack('!I',len(self.raw))+self.raw
        with self.child_script(raw),self.assertRaisesRegex(ValueError,'Source transport bytes exceed their bound'):
            self.transport()(self.url,io.BytesIO(),3,time.monotonic()+3)
        class Short:
            def write(self,chunk):return len(chunk)-1
        with self.child_script(raw),self.assertRaisesRegex(OSError,'local write did not finish'):
            self.transport()(self.url,Short(),4096,time.monotonic()+3)

    def test_response_shape_refuses_before_body(self):
        for rows,reason in (((('Content-Length','-1'),),'length differs'),((('Content-Length','٢'),),'length differs'),
            ((('Content-Length','4097'),),'bytes exceed their bound'),((('Content-Encoding','gzip'),),'encoding or length differs'),
            ((('Content-Length','1'),('Content-Length','1')),'encoding or length differs'),
            ((('Content-Length','1'),('Transfer-Encoding','chunked')),'encoding or length differs'),((('Transfer-Encoding','gzip'),),'encoding or length differs')):
            headers=Message()
            for name,value in rows:headers[name]=value
            with self.subTest(rows=rows),self.assertRaisesRegex(ValueError,'Source response '+reason):module.response_length(headers,4096)
        empty=Message();self.assertIsNone(module.response_length(empty,4096));empty['Content-Length']='0';self.assertEqual(module.response_length(empty,4096),0)

    def direct_child(self,*,invocation='--child',**changes):
        metadata={'url':self.url,'ports':[self.port],'networks':['127.0.0.1/32'],'redirects':5,'caFile':None,'maxBytes':4096,'deadline':time.monotonic()+3,**changes}
        payload=json.dumps(metadata,separators=(',',':')).encode();read,write=os.pipe()
        try:return subprocess.run([sys.executable,'-B',str(Path(module.__file__)),invocation,str(read)],input=struct.pack('!I',len(payload))+payload,pass_fds=(read,),capture_output=True,timeout=4)
        finally:os.close(read);os.close(write)

    def test_child_actual_overflow_refuses_without_parent_guard(self):
        self.mode='unknown_length';result=self.direct_child(maxBytes=3)
        self.assertEqual(result.returncode,2,'Oversized child must refuse before a byte frame')
        self.assertEqual(result.stdout,b'','Oversized child must not send excess bytes to its parent')

    def test_invalid_child_invocation_refuses_before_request(self):
        result=self.direct_child(invocation='--other')
        self.assertEqual(result.returncode,2,'Invalid child invocation must refuse before input')
        self.assertEqual(self.requests,[],'Invalid child invocation cannot reach the source')

    def test_child_diagnostics_and_metadata_bound(self):
        result=self.direct_child(caFile='synthetic-private-trust-detail',url='https://127.0.0.1:'+str(self.port))
        self.assertEqual(result.returncode,2)
        self.assertEqual(result.stderr,b'Original source transport failed\n','Child diagnostics cannot expose a private trust path')
        result=self.direct_child(extra='x'*module.METADATA_LIMIT)
        self.assertEqual(result.returncode,2,'Oversized child metadata must refuse')
        self.assertEqual(self.requests,[],'Oversized child metadata cannot reach the source')

    def test_parent_diagnostic_bound(self):
        path=self.root/'noisy-child.py';path.write_text('import sys\nsys.stdin.buffer.read()\nsys.stderr.buffer.write(b"x"*'+str(module.ERROR_LIMIT+1)+')\nsys.stderr.buffer.flush()\n')
        with patch.object(module,'__file__',str(path)),self.assertRaisesRegex(ValueError,'diagnostics exceed their bound'):self.fetch()

    def test_child_environment_has_no_unrelated_credentials(self):
        observed=[]
        def spawn(*args,**kwargs):observed.append(kwargs['env']);return self.spawn(*args,**kwargs)
        with patch.dict(os.environ,{'SYNTHETIC_PRIVATE_WORKER_SECRET':'synthetic-only'}),patch('url_transport.subprocess.Popen',side_effect=spawn):
            self.assertEqual(self.fetch(),(self.raw,len(self.raw)))
        self.assertNotIn('SYNTHETIC_PRIVATE_WORKER_SECRET',observed[0],'Source child cannot inherit unrelated credentials')

    def test_actual_source_receipts_and_preparation_use_complete_bytes_once(self):
        import test_runtime_preparation as fixture
        from runtime_preparation import Preparation
        from url_source_custody import UrlSources
        checks=fixture.Checks();checks.setUp()
        try:
            request=copy.deepcopy(checks.request);request['requestId']='synthetic-http-source'
            for index,row in enumerate(request['imagery']['photos']):row.update(url=self.url+'/original?slot='+str(index),sizeBytes=len(self.raw),checksumSha256=hashlib.sha256(self.raw).hexdigest())
            entry,_=checks.runtime.submit(request);job={**checks.spec['applicationJob'],'request_id':request['requestId']}
            source=UrlSources(checks.runtime,checks.base/'http-sources','synthetic-local-target',self.transport(),max_bytes=4096,timeout=3)
            with checks.runtime.owner():
                checks.runtime.journal.start(request['requestId'],entry.job_reference,checks.runtime.context)
                retained=source.prepare(request['requestId'],job);self.raw=b'Changed source after receipt'
                self.assertEqual(source.prepare(request['requestId'],job),retained,'Complete receipts cannot refetch changed URLs')
                spec={**checks.spec,'applicationJob':job,'sourceRoot':retained['sourceRoot'],'sources':retained['sources']}
                prepared=Preparation(checks.runtime,lambda entry:spec,timeout=3).resume(request['requestId'])
            self.assertEqual(len(self.requests),2,'Only two original source slots may download')
            folder=checks.root/('preparation-'+hashlib.sha256(request['requestId'].encode()).hexdigest())
            for index in range(2):self.assertEqual((folder/f'retained/objects/source-{index:05d}.bin').read_bytes(),b'Synthetic source bytes\x00\xff')
            self.assertIs(prepared['engineTransportPermission'],False)
            self.assertEqual(prepared['authorityVerification'],'unassessed')
            self.assertFalse(list((folder/'engine').glob('*.intent.json')))
        finally:checks.tearDown()

    def test_actual_source_cancelled_body_has_no_complete_receipt(self):
        import test_runtime_preparation as fixture
        from url_source_custody import UrlSources
        checks=fixture.Checks();checks.setUp();self.mode='held_body';cancelled=threading.Event()
        thread=threading.Thread(target=lambda:cancelled.set() if self.entered.wait(2) else None,daemon=True);thread.start()
        try:
            request=copy.deepcopy(checks.request);request['requestId']='synthetic-cancelled-source'
            for row in request['imagery']['photos']:row.update(url=self.url,sizeBytes=len(self.raw),checksumSha256=hashlib.sha256(self.raw).hexdigest())
            entry,_=checks.runtime.submit(request);job={**checks.spec['applicationJob'],'request_id':request['requestId']}
            source=UrlSources(checks.runtime,checks.base/'cancelled-http-sources','synthetic-local-target',self.transport(cancelled=cancelled.is_set),max_bytes=4096,timeout=3,cancelled=lambda:False)
            with checks.runtime.owner(),patch('url_transport.subprocess.Popen',side_effect=self.spawn):
                checks.runtime.journal.start(request['requestId'],entry.job_reference,checks.runtime.context)
                with self.assertRaisesRegex(InterruptedError,'Source transport cancelled'):source.prepare(request['requestId'],job)
            pack=source.root/('request-'+hashlib.sha256(request['requestId'].encode()).hexdigest())
            self.assertTrue((pack/'plan.json').exists(),'Original source plan must survive cancellation')
            self.assertFalse(list(pack.glob('*.complete.json')),'Cancelled body cannot publish a complete source receipt')
            self.assertFalse((pack/'completed.json').exists(),'Cancelled body cannot publish a complete source set')
            self.assertIsNotNone(self.children[-1].poll(),'Cancelled source intake must reap its transport child')
        finally:self.release.set();thread.join(3);checks.tearDown()

    def tls(self,subject='IP:127.0.0.1'):
        certificate=self.root/'synthetic-ca.pem';key=self.root/'synthetic-key.pem'
        result=subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=synthetic-local-source',
            '-addext','subjectAltName='+subject,'-keyout',str(key),'-out',str(certificate)],capture_output=True,timeout=10)
        self.assertEqual(result.returncode,0,'Owned synthetic TLS certificate creation must pass')
        context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);context.load_cert_chain(certificate,key)
        self.server.shutdown();self.server.server_close();self.thread.join(3);self.launch(context)
        return certificate

    def test_actual_tls_checks_original_host_and_explicit_trust(self):
        certificate=self.tls()
        self.assertEqual(self.fetch(ca_file=str(certificate)),(self.raw,len(self.raw)))
        with self.assertRaisesRegex(ValueError,'Source transport did not complete'):self.fetch()
        self.assertEqual(len(self.requests),1,'Untrusted TLS cannot send a source request')

    def test_actual_tls_wrong_host_and_downgrade_refuse(self):
        certificate=self.tls('DNS:synthetic-invalid.example')
        with self.assertRaisesRegex(ValueError,'Source transport did not complete'):self.fetch(ca_file=str(certificate))
        self.assertEqual(self.requests,[],'Wrong TLS hostname cannot send a source request')
        # Replace only this owned TLS fixture with a certificate for its actual address.
        certificate=self.tls();plain=ThreadingHTTPServer(('127.0.0.1',0),self.Handler);plain.daemon_threads=True
        thread=threading.Thread(target=lambda:plain.serve_forever(poll_interval=0.02),daemon=True);thread.start()
        try:
            self.redirect='http://127.0.0.1:'+str(plain.server_address[1])+'/never'
            with self.assertRaisesRegex(ValueError,'Source transport did not complete'):
                self.transport(ca_file=str(certificate),allowed_ports=(self.port,plain.server_address[1]))(self.url+'/redirect',io.BytesIO(),4096,time.monotonic()+3)
            self.assertEqual(len(self.requests),1,'An available HTTPS downgrade cannot issue another request')
        finally:plain.shutdown();plain.server_close();thread.join(3)

    def test_stalled_dns_cancellation_prevents_late_request(self):
        source=Path(module.__file__).read_text();marker=self.root/'resolver-entered';script=self.root/'held-dns.py'
        source=source.replace('from draft_http import ', 'sys.path.insert(0,'+repr(str(Path(module.__file__).parent))+')\nfrom draft_http import ',1)
        anchor='    rows = socket.getaddrinfo(parts.hostname, port, type=socket.SOCK_STREAM)\n'
        self.assertEqual(source.count(anchor),1)
        script.write_text(source.replace(anchor,'    Path('+repr(str(marker))+').touch()\n    time.sleep(.8)\n'+anchor,1))
        cancelled=threading.Event()
        def cancel():
            until=time.monotonic()+2
            while not marker.exists() and time.monotonic()<until:time.sleep(.01)
            if marker.exists():cancelled.set()
        thread=threading.Thread(target=cancel,daemon=True);thread.start()
        def spawn(args,**kwargs):
            args=list(args);args[2]=str(script);child=self.spawn(args,**kwargs)
            child.wait=Mock(wraps=child.wait);return child
        try:
            with patch('url_transport.subprocess.Popen',side_effect=spawn),self.assertRaisesRegex(InterruptedError,'Source transport cancelled'):
                self.fetch(cancelled=cancelled.is_set)
            self.assertTrue(marker.exists(),'DNS probe must reach actual child resolution')
            self.assertGreater(self.children[-1].wait.call_count,0,'Cancelled DNS child must be awaited before return')
            self.assertIsNotNone(self.children[-1].poll(),'Cancelled DNS child must be reaped')
            time.sleep(.85)
            self.assertEqual(self.requests,[],'Abandoned DNS cannot start a late request')
        finally:thread.join(3)

    def test_abrupt_parent_exit_stops_and_reaps_owned_source_child(self):
        libc=ctypes.CDLL(None,use_errno=True);previous=ctypes.c_int()
        self.assertEqual(libc.prctl(37,ctypes.byref(previous),0,0,0),0);self.assertEqual(libc.prctl(36,1,0,0,0),0)
        self.mode='held_body';owner=None;record=None;reaped=False
        marker=self.root/'owned-child.json';exit_flag=self.root/'exit-owner';script=self.root/'owner.py'
        def identity(pid):
            path=Path('/proc')/str(pid)/'stat'
            if not path.exists():return None
            return path.read_text().rsplit(')',1)[1].split()[19]
        source=("import sys,os,json,subprocess,threading,time,io\nfrom pathlib import Path\n"
            "sys.path.insert(0,"+repr(str(Path(module.__file__).parent))+")\nimport url_transport\noriginal=subprocess.Popen\n"
            "def observed(*args,**kwargs):\n child=original(*args,**kwargs)\n"
            " start=Path('/proc')/str(child.pid)/'stat'\n value={'pid':child.pid,'start':start.read_text().rsplit(')',1)[1].split()[19]}\n"
            " path=Path("+repr(str(marker))+");pending=path.with_suffix('.pending')\n pending.write_text(json.dumps(value));pending.rename(path)\n return child\n"
            "url_transport.subprocess.Popen=observed\ndef leave():\n"
            " while not Path("+repr(str(exit_flag))+").exists():time.sleep(.01)\n os._exit(19)\n"
            "threading.Thread(target=leave,daemon=True).start()\n"
            "url_transport.Transport(allowed_networks=('127.0.0.1/32',),allowed_ports=("+str(self.port)+",))("+repr(self.url)+",io.BytesIO(),4096,time.monotonic()+4)\n")
        script.write_text(source)
        try:
            owner=subprocess.Popen([sys.executable,'-B',str(script)],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            self.assertTrue(self.entered.wait(3),'Parent-exit source probe must reach actual body reading')
            record=json.loads(marker.read_text());exit_flag.touch();self.assertEqual(owner.wait(3),19)
            deadline=time.monotonic()+2
            while time.monotonic()<deadline:
                pid,_status=os.waitpid(record['pid'],os.WNOHANG)
                if pid==record['pid']:reaped=True;break
                time.sleep(.01)
            self.assertTrue(reaped,'Parent exit must stop the owned source child')
            self.assertTrue(self.closed.wait(1),'Parent exit must close the source peer')
            self.assertEqual(len(self.requests),1,'Orphaned source transport cannot retry')
        finally:
            self.release.set()
            if owner is not None:
                if owner.poll() is None:owner.kill()
                owner.wait(5)
                for handle in (owner.stdout,owner.stderr):handle.close()
            if record is None and marker.exists():record=json.loads(marker.read_text())
            if record is not None and not reaped:
                if identity(record['pid'])==record['start']:os.kill(record['pid'],9)
                try:os.waitpid(record['pid'],0)
                except ChildProcessError:pass
            self.assertEqual(libc.prctl(36,previous.value,0,0,0),0)


if __name__=='__main__':unittest.main()
