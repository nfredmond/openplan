"""Actual owned HTTP admission and shutdown; no engine or application service."""
import copy
import http.client
import json
import socket
import sqlite3
import threading
import time
import unittest
from unittest.mock import patch
from types import SimpleNamespace

from admission_journal import FILENAME
from native_engine_attestation import IMAGE
from retained_source import writer
import test_runtime_configuration as fixtures
from test_worker_http import zip_request
import runtime_service as module


class Checks(unittest.TestCase):
    def setUp(self):
        self.fixture=fixtures.Checks();self.fixture.setUp();self.addCleanup(self.fixture.doCleanups)
        self.value=copy.deepcopy(self.fixture.value)
        self.value['engine']['instanceId']='c'*64;self.value['engine']['imageId']=IMAGE
        self.value['bounds']['pollSeconds']=300
        self.calls=[];self.services=[]
        def credentials(reference):self.calls.append(reference);raise AssertionError('Service cannot resolve external credentials')
        self.arguments={'max_queued':4,'application_credentials':credentials,'engine_credentials':credentials,
            'callback_credentials':credentials,'options':lambda request:[{'name':'dsm','value':True}]}
        self.addCleanup(self.cleanup_services)

    def build(self,**extra):
        args={**self.arguments,'host':'127.0.0.1','port':0,'inbound_token':'synthetic-worker-secret',**extra}
        service=module.Service(self.fixture.root,self.value,**args);self.services.append(service)
        return service

    def cleanup_services(self):
        for service in reversed(self.services):
            service.stop()
            thread=getattr(service,'test_thread',None)
            if thread is not None:
                thread.join(3);self.assertFalse(thread.is_alive(),'Owned service thread must stop')
            service._server.close_connections();service._server.server_close()

    def start(self,service):
        service.errors=[];service.stepped=threading.Event();original=service.bundle.step
        def step():
            try:return original()
            finally:service.stepped.set()
        service.bundle.step=step
        def run():
            try:service.run()
            except BaseException as error:service.errors.append(error)
        service.test_thread=threading.Thread(target=run,daemon=True);service.test_thread.start()
        self.assertTrue(service.stepped.wait(2),'Owned service reaches initial scheduler step')
        self.assertEqual(service.errors,[],'Owned service starts without error')
        return service.server.server_address[1]

    def request(self,service,method,path,body=None,token='synthetic-worker-secret',headers=None):
        connection=http.client.HTTPConnection('127.0.0.1',service.server.server_address[1],timeout=2)
        self.addCleanup(connection.close)
        raw=json.dumps(body).encode() if isinstance(body,(dict,list)) else body
        fields={'Authorization':'Bearer '+token} if token is not None else {}
        fields.update(headers or {})
        connection.request(method,path,body=raw,headers=fields)
        response=connection.getresponse();data=json.loads(response.read())
        connection.close();return response.status,data

    def wait_connection(self,service):
        deadline=time.monotonic()+1
        while time.monotonic()<deadline:
            with service.server.connections_lock:
                if service.server.connections:return
            time.sleep(.005)
        self.fail('Owned request reaches actual handler')

    def raw_socket(self,service):
        client=socket.create_connection(('127.0.0.1',service.server.server_address[1]),timeout=1)
        self.addCleanup(client.close);return client

    def drip(self,client):
        stopping=threading.Event()
        def write():
            while not stopping.wait(.025):
                try:client.sendall(b' ')
                except OSError:return
        thread=threading.Thread(target=write,daemon=True);thread.start()
        def cleanup():stopping.set();thread.join(1)
        self.addCleanup(cleanup)

    def test_owned_idle_health_does_not_resolve_credentials(self):
        service=self.build();self.start(service)
        status,body=self.request(service,'GET','/healthz',token=None)
        self.assertEqual(status,200,'Owned process health answers')
        self.assertEqual(body['verification'],'process_only','Health remains process-only evidence')
        self.assertTrue(service.bundle.runtime._owned,'HTTP lifetime retains original owner')
        self.assertEqual(self.calls,[],'Idle service cannot resolve external credentials')
        service.stop();service.test_thread.join(2)
        self.assertFalse(service.bundle.runtime._owned,'Shutdown releases lifetime owner')

    def test_actual_admission_replays_one_original_receipt(self):
        service=self.build();self.start(service);request=zip_request('owned-service-admission')
        first=self.request(service,'POST','/api/v1/processing-requests',request)
        replay=self.request(service,'POST','/api/v1/processing-requests',request)
        self.assertEqual([first[0],replay[0]],[202,200],'Actual admission distinguishes original and replay')
        self.assertEqual(first[1],replay[1],'Actual replay preserves exact receipt')
        self.assertEqual(len(service.bundle.runtime.journal.accepted()),1,'One request keeps one admission')
        self.assertEqual(self.calls,[],'Admission does not resolve processing credentials')

    def test_wrong_or_non_ascii_bearer_cannot_admit(self):
        service=self.build();self.start(service)
        for token in (None,'wrong-secret','\u00e9'):
            status,_=self.request(service,'POST','/api/v1/processing-requests',zip_request('unauthorized'),token)
            self.assertEqual(status,401,'Wrong inbound bearer refuses before admission')
        self.assertEqual(service.bundle.runtime.journal.accepted(),[],'Unauthorized request has no journal entry')

    def test_changed_original_payload_refuses(self):
        service=self.build();self.start(service);request=zip_request('original-conflict')
        self.assertEqual(self.request(service,'POST','/api/v1/processing-requests',request)[0],202)
        changed=copy.deepcopy(request);changed['presetId']='high-quality'
        self.assertEqual(self.request(service,'POST','/api/v1/processing-requests',changed)[0],409,
            'Changed original identity receives conflict')

    def test_full_original_queue_refuses_new_request(self):
        service=self.build(max_queued=1);self.start(service)
        self.assertEqual(self.request(service,'POST','/api/v1/processing-requests',zip_request('first-owned-admission'))[0],202)
        self.assertEqual(self.request(service,'POST','/api/v1/processing-requests',zip_request('second-owned-admission'))[0],503,
            'Full original queue refuses new work')
        self.assertEqual(len(service.bundle.runtime.journal.accepted()),1)

    def test_malformed_json_refuses(self):
        service=self.build();self.start(service)
        self.assertEqual(self.request(service,'POST','/api/v1/processing-requests',b'{')[0],400,
            'Malformed bytes cannot become an admission')

    def test_contract_invalid_body_refuses(self):
        service=self.build();self.start(service)
        self.assertEqual(self.request(service,'POST','/api/v1/processing-requests',{})[0],422,
            'Invalid contract refuses before journal')
        self.assertEqual(service.bundle.runtime.journal.accepted(),[])

    def test_oversized_body_cannot_admit(self):
        service=self.build(max_body=16);self.start(service)
        self.assertEqual(self.request(service,'POST','/api/v1/processing-requests',zip_request('oversized-owned-admission'))[0],413,
            'Declared oversized body cannot become an admission')

    def test_transfer_encoding_refuses(self):
        service=self.build();self.start(service)
        self.assertEqual(self.request(service,'POST','/api/v1/processing-requests',b'{}',headers={'Transfer-Encoding':'chunked','Content-Length':'2'})[0],400,
            'Ambiguous framing cannot become an admission')

    def test_dripping_headers_have_absolute_deadline(self):
        service=self.build(socket_timeout=.15);self.start(service);client=self.raw_socket(service)
        client.sendall(b'GET /healthz HTTP/1.0\r\nX-Test: ');self.drip(client);client.settimeout(.4)
        try:raw=client.recv(1)
        except TimeoutError:self.fail('Actual dripping header deadline did not close')
        self.assertEqual(raw,b'','Actual dripping headers close before another idle timeout')

    def test_dripping_body_has_absolute_deadline(self):
        service=self.build(socket_timeout=.15);self.start(service);client=self.raw_socket(service)
        client.sendall(b'POST /api/v1/processing-requests HTTP/1.0\r\nAuthorization: Bearer synthetic-worker-secret\r\nContent-Length: 1000\r\n\r\n{')
        self.drip(client);client.settimeout(.4)
        try:raw=client.recv(4096)
        except TimeoutError:self.fail('Actual dripping body deadline did not close')
        self.assertIn(b' 400 ',raw,'Actual dripping body reaches bounded refusal')
        self.assertEqual(service.bundle.runtime.journal.accepted(),[])

    def test_stop_closes_body_and_joins_handlers_before_owner_release(self):
        service=self.build();self.start(service);client=self.raw_socket(service)
        reading=threading.Event();original=module.Handler._read_body
        def observe(handler,length):reading.set();return original(handler,length)
        with patch.object(module.Handler,'_read_body',observe):
            client.sendall(b'POST /api/v1/processing-requests HTTP/1.0\r\nAuthorization: Bearer synthetic-worker-secret\r\nContent-Length: 1000\r\n\r\n{')
            self.assertTrue(reading.wait(1),'Owned request enters actual stalled body reader')
            service.stop();service.test_thread.join(1)
        self.assertFalse(service.test_thread.is_alive(),'Stop cannot leave an active original handler')
        self.assertFalse(service.bundle.runtime._owned,'Stopped handler cannot retain owner')
        self.assertEqual(service.server.connections,set(),'Stopped service closes every owned connection')
        self.assertEqual(service.server.handlers,set(),'Shutdown joins original handlers')
        self.assertEqual(service.errors,[],'Owned shutdown has no lost handler error')
        self.assertTrue(service.bundle.cancelled(),'Owned stop reaches actual Bundle cancellation')

    def test_inbound_credential_refuses_before_seal(self):
        with self.assertRaisesRegex(ValueError,'address and inbound credential'):self.build(inbound_token='')
        self.assertFalse((self.fixture.root/'operator-configuration.json').exists(),'Invalid inbound settings cannot seal a root')

    def test_resource_bound_refuses_before_seal(self):
        with self.assertRaisesRegex(ValueError,'resource bounds'):self.build(max_body=module.BODY_LIMIT+1)
        self.assertFalse((self.fixture.root/'operator-configuration.json').exists(),'Invalid resource bound cannot seal a root')

    def test_platform_poll_bound_refuses_before_seal(self):
        self.value['bounds']['pollSeconds']=threading.TIMEOUT_MAX*2
        with self.assertRaisesRegex(ValueError,'poll interval'):self.build()
        self.assertFalse((self.fixture.root/'operator-configuration.json').exists(),'Invalid platform timeout cannot seal a root')

    def test_caller_cancellation_adapter_refuses(self):
        try:self.build(cancelled=lambda:False)
        except ValueError as error:self.assertIn('owns its cancellation',str(error))
        except TypeError:self.fail('Caller cancellation cannot reach Bundle construction')
        else:self.fail('Caller cancellation cannot override original service stop')

    def test_lifetime_owner_precedes_listener(self):
        service=self.build()
        def bind():
            self.assertTrue(service.bundle.runtime._owned,'Original listener cannot bind without lifetime owner')
            raise ValueError('Probe after original ownership')
        with patch.object(service.server,'server_bind',bind):
            with self.assertRaisesRegex(ValueError,'Probe after original ownership'):service.run()

    def test_inactive_check_refuses_before_bundle_read(self):
        service=self.build()
        with patch.object(service.bundle,'_check',side_effect=AssertionError('Inactive service cannot read Bundle configuration')):
            with self.assertRaisesRegex(InterruptedError,'not active'):service.check()

    def test_connection_slots_bound_actual_handlers(self):
        service=self.build(max_connections=1);self.start(service);first=self.raw_socket(service)
        first.sendall(b'POST /api/v1/processing-requests HTTP/1.0\r\nAuthorization: Bearer synthetic-worker-secret\r\nContent-Length: 1000\r\n\r\n{')
        self.wait_connection(service);second=self.raw_socket(service)
        second.sendall(b'GET /healthz HTTP/1.0\r\n\r\n')
        try:raw=second.recv(4096)
        except ConnectionResetError:raw=b''
        self.assertEqual(raw,b'','Admission thread limit cannot answer a second request')

    def test_delayed_admission_keeps_owner_until_handler_exits(self):
        self.delayed_admission_case()

    def test_shutdown_error_still_drains_original_handlers(self):
        self.delayed_admission_case(shutdown_error=True)

    def delayed_admission_case(self,shutdown_error=False):
        service=self.build();self.start(service);entered=threading.Event();release=threading.Event()
        self.addCleanup(release.set);original=service.bundle.runtime.submit
        def submit(request):
            entered.set()
            if not release.wait(5):raise ValueError('Paused original admission was not released')
            return original(request)
        def post():
            connection=http.client.HTTPConnection('127.0.0.1',service.server.server_address[1],timeout=4)
            try:
                connection.request('POST','/api/v1/processing-requests',json.dumps(zip_request('delayed-owned-admission')),
                    {'Authorization':'Bearer synthetic-worker-secret'})
                connection.getresponse().read()
            except (OSError,http.client.HTTPException):pass
            finally:connection.close()
        original_shutdown=service.server.shutdown
        def shutdown():
            original_shutdown()
            if shutdown_error:raise ValueError('Original HTTP shutdown unavailable')
        with (patch.object(service.bundle.runtime,'submit',submit),patch.object(service.server,'shutdown',shutdown)):
            client=threading.Thread(target=post,daemon=True);client.start()
            try:
                self.assertTrue(entered.wait(1),'Actual admission enters original guarded runtime')
                service.stop()
                reason='Failed shutdown must drain original admission' if shutdown_error else 'Delayed handler produces shutdown diagnostic'
                self.assertTrue(service.shutdown_delayed.wait(2.5),reason)
                service.test_thread.join(.1)
                self.assertTrue(service.bundle.runtime._owned,'Delayed original handler must retain lifetime owner')
                with self.assertRaises(TimeoutError):
                    with writer(service.bundle.runtime.root,time.monotonic()+.05):
                        self.fail('Delayed original handler must retain lifetime owner: replacement overlapped')
            finally:
                release.set();client.join(1);service.test_thread.join(2)
        self.assertFalse(service.test_thread.is_alive(),'Released admission allows owned shutdown')
        expected=[(ValueError,'Original HTTP shutdown unavailable')] if shutdown_error else []
        self.assertEqual([(type(error),str(error)) for error in service.errors],expected,'Delayed owned shutdown preserves original outcome')
        self.assertEqual(len(service.bundle.runtime.journal.accepted()),1,'Original delayed admission remains durable')

    def test_replaced_cached_service_cannot_authenticate(self):
        service=self.build();self.start(service)
        service.server._service=SimpleNamespace(bundle=service.bundle,inbound_token='replacement-secret',
            socket_timeout=service.socket_timeout,check=lambda:None)
        status,_=self.request(service,'POST','/api/v1/processing-requests',zip_request('cached-service-admission'),'replacement-secret')
        self.assertEqual(status,503,'Changed cached service cannot admit with replacement credential')
        self.assertEqual(service.bundle.runtime.journal.accepted(),[],'Changed service role cannot create an admission')

    def test_changed_socket_setting_cannot_widen_header_deadline(self):
        service=self.build(socket_timeout=.15);self.start(service);service.socket_timeout=None
        client=self.raw_socket(service);client.sendall(b'GET /healthz HTTP/1.0\r\nX-Test: ')
        self.drip(client);client.settimeout(.4)
        try:raw=client.recv(1)
        except TimeoutError:self.fail('Changed socket settings cannot widen header deadline')
        self.assertEqual(raw,b'','Changed socket settings retain original header deadline')

    def test_actual_sqlite_contention_returns_unavailable(self):
        service=self.build();self.start(service);service.bundle.runtime.journal.timeout=.05
        connection=sqlite3.connect(service.bundle.runtime.journal.root/FILENAME,isolation_level=None)
        try:
            connection.execute('BEGIN IMMEDIATE')
            try:status,body=self.request(service,'POST','/api/v1/processing-requests',zip_request('busy-owned-admission'))
            except http.client.HTTPException:self.fail('Actual SQLite contention must return structured unavailable')
            self.assertEqual(status,503,'Actual SQLite contention must return structured unavailable')
            self.assertEqual(body['error'],'admission_unavailable')
        finally:connection.execute('ROLLBACK');connection.close()
        self.assertEqual(service.bundle.runtime.journal.accepted(),[],'Busy admission creates no journal entry')

    def test_pre_stopped_service_cannot_listen(self):
        service=self.build();service.stop()
        with self.assertRaisesRegex(InterruptedError,'stopped before listening'):service.run()
        self.assertFalse(service.ready.is_set(),'Pre-stopped service never becomes ready')
        self.assertEqual(service.server.socket.fileno(),-1,'Pre-stopped listener is closed')

    def test_changed_resource_setting_refuses_actual_health(self):
        service=self.build();self.start(service);service.max_body+=1
        self.assertEqual(self.request(service,'GET','/healthz')[0],503,'Changed service settings cannot answer healthy')

    def test_replaced_cancellation_event_refuses_actual_health(self):
        service=self.build();self.start(service);service.stopping=threading.Event()
        self.assertEqual(self.request(service,'GET','/healthz')[0],503,'Changed service components cannot answer healthy')

    def test_second_run_refuses(self):
        service=self.build();self.start(service);service.stop();service.test_thread.join(2)
        try:service.run()
        except ValueError as error:self.assertIn('can run only once',str(error))
        except InterruptedError:self.fail('Repeated service cannot reenter original owner')
        else:self.fail('Repeated service cannot start another listener')

    def test_scheduler_failure_stops_original_listener(self):
        service=self.build()
        with patch.object(service.bundle,'step',side_effect=ValueError('Original stage failed')):
            with self.assertRaisesRegex(ValueError,'Original stage failed'):service.run()
        self.assertTrue(service.stopping.is_set(),'Stage failure cancels owned transports')
        self.assertFalse(service.bundle.runtime._owned,'Stage failure releases lifetime owner')
        self.assertEqual(service.server.socket.fileno(),-1,'Stage failure closes original listener')

    def test_failed_http_thread_start_does_not_shutdown_unstarted_loop(self):
        service=self.build()
        with (patch.object(threading.Thread,'start',side_effect=RuntimeError('Original thread start failed')),
                patch.object(service.server,'shutdown',side_effect=AssertionError('Unstarted HTTP loop cannot be shut down'))):
            with self.assertRaisesRegex(RuntimeError,'Original thread start failed'):service.run()
        self.assertEqual(service.server.socket.fileno(),-1,'Failed start closes original listener')


if __name__=='__main__':unittest.main()
