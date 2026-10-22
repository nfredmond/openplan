"""Opt-in HTTP lifecycle for the explicitly assembled original worker.

The caller supplies every operator setting and credential adapter. No legacy
entry point, environment, default worker or hosted setting is changed here.
"""
import hmac
import json
import math
import socket
import sqlite3
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import contract
from admission_journal import IdentityConflict, QueueFull
from runtime_bundle import Bundle

BODY_LIMIT=32*1024*1024


class Handler(BaseHTTPRequestHandler):
    server_version='openplan-original-worker'
    protocol_version='HTTP/1.0'

    def setup(self):
        super().setup();self.connection.settimeout(self.server.socket_timeout)
        self._header_timer=threading.Timer(self.server.socket_timeout,self._expire)
        self._header_timer.daemon=True;self._header_timer.start()

    def _expire(self):
        try:self.connection.shutdown(socket.SHUT_RDWR)
        except OSError:pass

    def parse_request(self):
        result=super().parse_request();self._header_timer.cancel();return result

    def finish(self):
        self._header_timer.cancel();super().finish()

    def _send_json(self,status,value):
        self.close_connection=True
        self.connection.settimeout(.25 if status==503 else self.server.socket_timeout)
        body=json.dumps(value,separators=(',',':')).encode()
        self.send_response(status);self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(body)));self.send_header('Connection','close')
        self.end_headers();self.wfile.write(body)

    def _active(self):
        try:
            service=self.server.original_service();service.check();return service
        except (ValueError,OSError,InterruptedError):
            self._send_json(503,{'error':'original_worker_unavailable'});return None

    def _read_body(self,length):
        deadline=time.monotonic()+self.server.socket_timeout;parts=[];remaining=length
        while remaining:
            left=deadline-time.monotonic()
            if left<=0:raise TimeoutError('Original body deadline')
            self.connection.settimeout(left)
            part=self.rfile.read1(min(remaining,65536))
            if not part:raise ValueError('Short original request')
            parts.append(part);remaining-=len(part)
        self.connection.settimeout(self.server.socket_timeout)
        return b''.join(parts)

    def do_GET(self):
        service=self._active()
        if service is None:return
        if self.path=='/healthz':
            self._send_json(200,{'status':'ok','service':'original-worker',
                'verification':'process_only','applicationAcceptanceVerification':'unassessed'})
        elif self.path.startswith('/artifacts/'):
            service.bundle.download(self)
        else:self._send_json(404,{'error':'not_found'})

    def do_POST(self):
        service=self._active()
        if service is None:return
        if self.path!='/api/v1/processing-requests':
            self._send_json(404,{'error':'not_found'});return
        presented=self.headers.get('Authorization','')
        if not hmac.compare_digest(presented.encode('utf-8'),('Bearer '+self.server.inbound_token).encode('ascii')):
            self._send_json(401,{'error':'unauthorized'});return
        lengths=self.headers.get_all('Content-Length',[])
        if (self.headers.get('Transfer-Encoding') is not None or len(lengths)!=1
                or not lengths[0].isascii() or not lengths[0].isdigit()
                or len(lengths[0])>10):
            self._send_json(400,{'error':'invalid_body_length'});return
        length=int(lengths[0])
        if not 0<length<=self.server.max_body:
            self._send_json(413,{'error':'request_body_too_large_or_empty'});return
        try:
            payload=json.loads(self._read_body(length).decode('utf-8'))
        except (ValueError,UnicodeDecodeError,TimeoutError,OSError):
            self._send_json(400,{'error':'invalid_request_body'});return
        issues=contract.validate_processing_request(payload)
        if issues:
            self._send_json(422,{'error':'contract_validation_failed','issues':issues});return
        try:
            service.check();entry,first=service.bundle.submit(payload)
        except IdentityConflict:self._send_json(409,{'error':'request_identity_conflict'})
        except QueueFull:self._send_json(503,{'error':'queue_full'})
        except (ValueError,OSError,InterruptedError,sqlite3.Error):self._send_json(503,{'error':'admission_unavailable'})
        else:self._send_json(202 if first else 200,entry.admission)

    def log_message(self,*args):
        # Artifact paths and request bodies contain private information.
        pass


class Server(ThreadingHTTPServer):
    daemon_threads=True
    block_on_close=False
    request_queue_size=8

    def __init__(self,service,address):
        self.service=service;self._service=service;self.connections=set();self.handlers=set()
        self._accepted_service=service
        self._accepted_bounds=(service.socket_timeout,service.max_body,service.inbound_token)
        self.connections_lock=threading.Lock()
        self.slots=threading.BoundedSemaphore(service.max_connections)
        super().__init__(address,Handler,bind_and_activate=False)

    @property
    def socket_timeout(self):return self._accepted_bounds[0]

    @property
    def max_body(self):return self._accepted_bounds[1]

    @property
    def inbound_token(self):return self._accepted_bounds[2]

    def original_service(self):
        if self.service is not self._accepted_service or self._service is not self._accepted_service:
            raise ValueError('Original HTTP service role changed')
        return self._accepted_service

    def process_request(self,request,address):
        if not self.slots.acquire(blocking=False):
            request.close();return
        with self.connections_lock:self.connections.add(request)
        try:super().process_request(request,address)
        except BaseException:
            with self.connections_lock:self.connections.discard(request)
            self.slots.release();raise

    def process_request_thread(self,request,address):
        current=threading.current_thread()
        with self.connections_lock:self.handlers.add(current)
        try:super().process_request_thread(request,address)
        finally:
            with self.connections_lock:
                self.connections.discard(request);self.handlers.discard(current)
            self.slots.release()

    def close_connections(self):
        with self.connections_lock:connections=list(self.connections)
        for connection in connections:
            try:connection.shutdown(socket.SHUT_RDWR)
            except OSError:pass
            connection.close()

    def join_handlers(self):
        deadline=time.monotonic()+2
        while True:
            with self.connections_lock:threads=list(self.handlers);pending=bool(self.connections)
            if not threads and not pending:return
            if time.monotonic()>=deadline:self._accepted_service.shutdown_delayed.set()
            for thread in threads:thread.join(.02)
            if not threads:time.sleep(.01)

    def handle_error(self,*args):
        # A disconnected client must not put a token-bearing path in stderr.
        pass


class Service:
    def __init__(self,root,value,*,host,port,inbound_token,max_connections=4,
                 max_body=BODY_LIMIT,socket_timeout=2,**adapters):
        if (not isinstance(host,str) or not host or type(port) is not int or not 0<=port<=65535
                or not isinstance(inbound_token,str) or not inbound_token or len(inbound_token)>8192
                or any(ord(char)<33 or ord(char)>126 for char in inbound_token)):
            raise ValueError('Explicit service address and inbound credential are required')
        if (type(max_connections) is not int or not 1<=max_connections<=64
                or type(max_body) is not int or not 0<max_body<=BODY_LIMIT
                or type(socket_timeout) not in (int,float) or not math.isfinite(socket_timeout)
                or not 0<socket_timeout<=60):
            raise ValueError('Explicit service resource bounds differ')
        poll=value.get('bounds',{}).get('pollSeconds') if isinstance(value,dict) else None
        if type(poll) not in (int,float) or not math.isfinite(poll) or not 0<poll<=threading.TIMEOUT_MAX:
            raise ValueError('Explicit service poll interval differs')
        if 'cancelled' in adapters:raise ValueError('Explicit service owns its cancellation adapter')
        self.stopping=threading.Event();self.ready=threading.Event()
        self.shutdown_delayed=threading.Event();self.poll=poll
        self.inbound_token=inbound_token;self.max_connections=max_connections
        self.max_body=max_body;self.socket_timeout=socket_timeout
        self.bundle=Bundle(root,value,cancelled=self.stopping.is_set,**adapters)
        self.server=Server(self,(host,port));self._bundle=self.bundle
        self._server=self.server;self._stopping=self.stopping;self._used=False
        self._settings=(self.inbound_token,self.max_connections,self.max_body,self.socket_timeout,self.poll)

    def check(self):
        if self.bundle is not self._bundle or self.server is not self._server or self.stopping is not self._stopping:
            raise ValueError('Original service components changed')
        if (self.server.original_service() is not self or
                (self.inbound_token,self.max_connections,self.max_body,self.socket_timeout,self.poll)!=self._settings):
            raise ValueError('Original service settings changed')
        if self.stopping.is_set() or not self.ready.is_set() or not self.bundle.runtime._owned:
            raise InterruptedError('Original service is not active')
        self.bundle._check()

    def stop(self):
        self._stopping.set()

    def run(self):
        if self._used:raise ValueError('Original service can run only once')
        self._used=True;thread=None;started=False
        server=self._server;bundle=self._bundle;stopping=self._stopping
        try:
            with bundle.owner():
                try:
                    if stopping.is_set():raise InterruptedError('Original service stopped before listening')
                    server.server_bind();server.server_activate()
                    self.ready.set()
                    thread=threading.Thread(target=server.serve_forever,
                        kwargs={'poll_interval':.05},name='original-worker-http',daemon=True)
                    thread.start();started=True
                    while not stopping.is_set():
                        self.check();bundle.step();stopping.wait(self.poll)
                finally:
                    self.stop();self.ready.clear()
                    try:
                        if started:server.shutdown()
                    finally:
                        try:server.close_connections()
                        finally:
                            try:
                                if started:
                                    thread.join(2)
                                    if thread.is_alive():raise TimeoutError('Original HTTP service did not stop')
                            finally:server.join_handlers()
        finally:server.server_close()
