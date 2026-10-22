"""Actual supervised body cancellation through the original composed pipeline."""
import copy
import hashlib
import json
import os
import select
import socket
import struct
import subprocess
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from unittest.mock import patch

from draft_http import Transport as EngineTransport
from runtime_admission import Runtime
from runtime_url_intake import Intake
from runtime_url_draft import Pipeline
from url_transport import Transport as SourceTransport
import test_runtime_url_intake as fixture


def peer_closed(connection):
    """Observe EOF or TCP reset without treating other I/O failures as closure."""
    try:return connection.recv(1)==b''
    except ConnectionResetError:return True


class Checks(unittest.TestCase):
    def setUp(self):self.f=fixture.Checks();self.f.setUp()
    def tearDown(self):self.f.tearDown()

    def exercise(self,stage):
        signal=threading.Event();closed=threading.Event();held=threading.Event();calls=[];children=[];spawn=subprocess.Popen
        raw=self.f.raw
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def respond(self,payload,stall):
                self.send_response(200);self.send_header('Content-Length',str(len(payload)));self.end_headers()
                if stall:
                    self.wfile.write(payload[:4]);self.wfile.flush();held.set();signal.set()
                    readable,_,_=select.select([self.connection],[],[],4)
                    if readable and peer_closed(self.connection):closed.set()
                else:self.wfile.write(payload);self.wfile.flush()
            def do_GET(self):
                calls.append(('GET',self.path));slot=0 if self.path=='/a.jpg' else 1
                self.respond(raw[slot],stage=='source' and slot==1)
            def do_POST(self):
                calls.append(('POST',self.path));self.rfile.read(int(self.headers['Content-Length']))
                self.respond(json.dumps({'uuid':self.headers['set-uuid']}).encode(),stage=='engine')
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.daemon_threads=True
        thread=threading.Thread(target=lambda:server.serve_forever(poll_interval=.02),daemon=True);thread.start()
        origin='http://127.0.0.1:'+str(server.server_address[1]);f=self.f
        request=copy.deepcopy(f.request);request['requestId']='synthetic-composed-'+stage+'-cancel'
        for photo in request['imagery']['photos']:photo['url']=origin+'/'+photo['filename']
        root=f.fixture.base/'actual-url-pipeline';root.mkdir(mode=0o700)
        runtime=Runtime(root,'synthetic-installation',max_queued=1,pipeline=lambda job:None);entry,_=runtime.submit(request)
        settings=copy.deepcopy(f.spec);settings['applicationJob']['request_id']=request['requestId'];settings['engine']['endpoint']=origin
        source=SourceTransport(allowed_networks=('127.0.0.1/32',),allowed_ports=(server.server_address[1],),cancelled=signal.is_set)
        intake=Intake(runtime,f.source_root,'synthetic-local-target',lambda entry:settings,source,timeout=2,cancelled=signal.is_set)
        transport=EngineTransport(settings['engine'],lambda reference:None,cancelled=signal.is_set)
        pipeline=Pipeline(intake,lambda *args:True,transport,timeout=2)
        def observed(*args,**kwargs):process=spawn(*args,**kwargs);children.append(process);return process
        name=hashlib.sha256(request['requestId'].encode()).hexdigest();folder=root/('preparation-'+name)
        began=time.monotonic()
        try:
            with patch('subprocess.Popen',side_effect=observed),runtime.owner():
                runtime.journal.start(request['requestId'],entry.job_reference,runtime.context)
                with self.assertRaises(InterruptedError,msg='Shared cancellation must interrupt the actual stalled '+stage+' body'):
                    pipeline.advance(request['requestId'])
                self.assertTrue(held.is_set(),'Actual response body must reach the stalled boundary')
                self.assertLess(time.monotonic()-began,1.5,'Shared cancellation cannot wait for the whole deadline')
                self.assertTrue(closed.wait(1),'Cancelled composed transport must close the actual peer')
                self.assertTrue(children and all(child.poll() is not None for child in children),'Every composed HTTP child must be awaited')
                if stage=='source':
                    pack=f.source_root/('request-'+name)
                    self.assertTrue((pack/'source-00000.complete.json').exists())
                    self.assertFalse((pack/'source-00001.complete.json').exists(),'Cancelled source cannot gain a complete receipt')
                    self.assertFalse(folder.exists(),'Cancelled source cannot prepare or issue an engine task')
                    self.assertEqual(calls,[('GET','/a.jpg'),('GET','/b.jpg')])
                else:
                    self.assertTrue((folder/'engine/command-00000.intent.json').exists(),'Original engine intent must precede actual HTTP')
                    self.assertFalse((folder/'engine/command-00000.reply.json').exists(),'Cancelled body cannot become an engine reply')
                    self.assertFalse((folder/'engine/command-00001.intent.json').exists())
                    before=list(calls);signal.clear()
                    pipeline.authorize=lambda *args:(_ for _ in ()).throw(AssertionError('Uncertain cancelled body requested another permission'))
                    result=pipeline.advance(request['requestId'])
                    self.assertEqual(result['draft']['state'],'held_uncertain');self.assertEqual(calls,before,'Cancelled original intent cannot reissue HTTP')
                    self.assertEqual(calls,[('GET','/a.jpg'),('GET','/b.jpg'),('POST','/task/new/init')])
        finally:
            for child in children:
                if child.poll() is None:child.kill()
                child.wait(timeout=5)
            server.shutdown();server.server_close();thread.join(3)

    def test_actual_source_body_cancellation_stops_before_engine(self):self.exercise('source')
    def test_actual_engine_body_cancellation_retains_unresolved_original_intent(self):self.exercise('engine')

    def peers(self):
        listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen(1)
        self.addCleanup(listener.close)
        client=socket.create_connection(listener.getsockname(),timeout=1);peer,_=listener.accept();peer.settimeout(1)
        self.addCleanup(client.close);self.addCleanup(peer.close)
        return client,peer

    def test_peer_observer_accepts_actual_fin(self):
        client,peer=self.peers();client.close()
        self.assertTrue(peer_closed(peer),'Actual TCP EOF must count as a closed peer')

    def test_peer_observer_accepts_actual_reset(self):
        client,peer=self.peers();seen=[]
        class Observed:
            def recv(self,count):
                try:return peer.recv(count)
                except ConnectionResetError:seen.append('reset');raise
        client.setsockopt(socket.SOL_SOCKET,socket.SO_LINGER,struct.pack('ii',1,0));client.close()
        self.assertTrue(peer_closed(Observed()),'Actual TCP reset must count as a closed peer')
        self.assertEqual(seen,['reset'],'The reset control must observe the real socket exception')

    def test_peer_observer_rejects_actual_available_bytes(self):
        client,peer=self.peers();client.sendall(b'x')
        self.assertFalse(peer_closed(peer),'Received bytes cannot count as peer closure')

    def test_peer_observer_propagates_actual_timeout(self):
        client,peer=self.peers();peer.settimeout(.01)
        with self.assertRaises(TimeoutError,msg='A live idle socket timeout cannot count as closure'):
            peer_closed(peer)


if __name__=='__main__':unittest.main()
