"""Original retained downloads through an actual explicitly supplied HTTP handler."""
import copy
from contextlib import redirect_stdout
import io
import http.client
import json
from pathlib import Path
import shutil
import socket
import sqlite3
import time
import threading
import unittest
from unittest.mock import patch

import main
import runtime_artifact_http as module
import runtime_artifact_access as access_module
from admission_journal import Journal
from retained_source import json_bytes
import test_runtime_artifact_access as fixtures

class Checks(unittest.TestCase):
    def setUp(self):
        self.f=fixtures.Checks();self.f.setUp();self.addCleanup(self.f.doCleanups)
        self.lease=self.f.prepare(public_base_url='https://worker.example')
        self.runtime=self.f.runtime;self.bridge=module.Download(self.f.access,timeout=4)
        self.server=main.build_server('127.0.0.1',0,admissions=self.runtime,artifact_download=self.bridge)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start();self.addCleanup(self.stop)
        row=next(r for r in self.lease['artifacts'] if r['filename']=='orthophoto.tif')
        self.path=row['downloadUrl'].removeprefix('https://worker.example')
    def stop(self):
        self.server.shutdown();self.server.server_close();self.thread.join(timeout=5)
    def request(self,path=None):
        connection=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=4)
        try:
            connection.request('GET',self.path if path is None else path)
            response=connection.getresponse();headers=dict(response.getheaders())
            try:body=response.read();complete=True
            except http.client.IncompleteRead as error:body=error.partial;complete=False
            return response.status,headers,body,complete
        finally:connection.close()
    def call(self,path=None):
        with self.runtime.owner():return self.request(path)
    def test_original_bytes_headers_and_no_memory_token_registry(self):
        with patch.dict(main.ARTIFACTS,{},clear=True):status,headers,body,complete=self.call()
        self.assertEqual((status,body,complete),(200,self.f.bytes(),True),'Durable original bytes reach actual HTTP')
        self.assertEqual(headers['Content-Length'],str(len(body)),'Original byte count reaches HTTP')
        self.assertEqual(headers['Content-Type'],'image/tiff','Original descriptor reaches HTTP')
        self.assertEqual(headers['Cache-Control'],'private, no-store','Private output is not cached')
        self.assertEqual(headers['X-Content-Type-Options'],'nosniff','Descriptor type is explicit')
    def test_wrong_token_refuses_before_product_bytes(self):
        path=self.path.replace(self.lease['token'],'X'*43)
        reference,token,filename=self.bridge.path(path)
        with self.runtime.owner(),self.assertRaisesRegex(FileNotFoundError,'original URL differs'):
            self.bridge.original(reference,token,filename,time.monotonic()+4)
        status,_,body,complete=self.call(path)
        self.assertEqual(status,404,'Wrong token cannot select original output')
        self.assertNotEqual(body,self.f.bytes(),'Wrong token releases no product');self.assertTrue(complete)
    def test_missing_reference_cannot_fall_back_to_legacy_registry(self):
        path=self.path.replace(self.lease['binding']['jobReference'],'missing-original')
        with patch.dict(main.ARTIFACTS,{'missing-original':{'token':self.lease['token'],'expires_at':9999999999,'files':{'orthophoto.tif':str(self.f.root/'private-products/objects/orthophoto.tif')}}}):
            self.assertEqual(self.call(path)[0],404,'Explicit durable route never falls back to legacy tokens')
    def test_expired_original_is_not_renewed(self):
        saved=(self.f.pack/'lease.json').read_bytes();self.f.now=1100
        self.assertEqual(self.call()[0],410,'Original expiry reaches HTTP')
        self.assertEqual((self.f.pack/'lease.json').read_bytes(),saved,'HTTP cannot renew original expiry')
    def test_revoked_actor_receives_no_product(self):
        self.f.allowed=False
        self.assertEqual(self.call()[0],403,'Current original actor refusal reaches HTTP')
    def test_noncanonical_or_traversal_paths_refuse(self):
        for path in (self.path+'?token=extra',self.path.replace('/artifacts/','/artifacts//'),self.path.replace('orthophoto.tif','%6Frthophoto.tif'),self.path.replace('orthophoto.tif','../lease.json')):
            self.assertEqual(self.call(path)[0],404,'Noncanonical URL cannot reach a retained file')
    def test_absent_and_unselected_products_refuse(self):
        for name in ('dtm.tif','orthophoto.png','mesh.obj'):
            self.assertEqual(self.call(self.path.replace('orthophoto.tif',name))[0],404,'Unavailable product remains unavailable')
    def test_unowned_runtime_refuses_before_bytes(self):
        self.assertEqual(self.request()[0],503,'Unowned runtime cannot release retained bytes')
    def test_checksum_refusal_withholds_complete_http_body(self):
        path=self.f.root/'private-products/objects/orthophoto.tif';raw=self.f.bytes();path.write_bytes(b'X'+raw[1:])
        with patch.object(access_module,'CHUNK',32):status,_,body,complete=self.call()
        self.assertEqual(status,200,'Already started partial body retains its HTTP status')
        self.assertFalse(complete,'Checksum refusal closes incomplete HTTP body')
        self.assertLess(len(body),len(raw),'Checksum refusal withholds final original chunk')
    def test_size_refusal_precedes_headers(self):
        path=self.f.root/'private-products/objects/orthophoto.tif';path.write_bytes(self.f.bytes()+b'changed')
        reference,token,filename=self.bridge.path(self.path)
        with self.runtime.owner(),self.assertRaisesRegex(ValueError,'original file size differs'):
            self.bridge.original(reference,token,filename,time.monotonic()+4)
        self.assertEqual(self.call()[0],503,'Wrong original size cannot start product headers')
    def test_missing_receipt_cannot_serve(self):
        (self.f.pack/'receipt.json').unlink()
        self.assertEqual(self.call()[0],404,'Missing original completion cannot serve bytes')
    def test_changed_receipt_refuses(self):
        self.f.alter('receipt.json',lambda r:r.update(terminalCallbackPermission=0))
        reference,token,filename=self.bridge.path(self.path)
        with self.runtime.owner(),self.assertRaisesRegex(ValueError,'original lease receipt differs'):
            self.bridge.original(reference,token,filename,time.monotonic()+4)
        self.assertEqual(self.call()[0],503,'Typed original completion remains required')
    def test_current_processing_reader_is_not_reentered(self):
        with patch.object(self.f.access.plan.inspection.products.intake.observer.reader,'observe',side_effect=AssertionError('Download cannot reenter active processing')):
            self.assertEqual(self.call()[0],200,'Separate authority serves retained completed output')
    def test_logs_never_include_original_token_or_request_url(self):
        output=io.StringIO()
        with redirect_stdout(output):
            self.call()
            main.WorkerHandler.log_message(object(),'private request %s',self.path)
        self.assertNotIn(self.lease['token'],output.getvalue(),'HTTP logs cannot contain original token')
        self.assertNotIn(self.path,output.getvalue(),'HTTP logs cannot contain private request URL')
        self.assertIn('HTTP GET status 200',output.getvalue(),'HTTP logs keep bounded status')
    def test_handler_requires_same_original_runtime(self):
        with self.assertRaisesRegex(ValueError,'same original admission runtime'):
            main.build_server('127.0.0.1',0,admissions=object(),artifact_download=self.bridge)
    def test_constructor_refuses_unbounded_socket_deadlines(self):
        for timeout,write_timeout in ((0,.25),(True,.25),(4,0),(4,6),(4,True)):
            with self.assertRaisesRegex(ValueError,'bounded socket writes'):
                module.Download(self.f.access,timeout=timeout,write_timeout=write_timeout)
    def test_whole_copied_root_recovers_lookup_token_and_bytes(self):
        expected=self.f.bytes();parent=self.runtime.root.parent/'http-restored-runtime';shutil.copytree(self.runtime.root,parent)
        self.runtime.root.rename(self.runtime.root.parent/'disabled-original-runtime')
        self.runtime.root=parent;self.runtime.journal=Journal(parent/'admissions',require_existing=True)
        self.assertEqual(self.call()[2],expected,'Copied original root recovers durable HTTP bytes')

    def test_database_read_failure_returns_bounded_refusal(self):
        with patch.object(self.runtime.journal,'get_reference',side_effect=sqlite3.OperationalError('private fixture diagnostic')):
            try:status,_,body,_=self.call()
            except http.client.RemoteDisconnected:
                self.fail('Unavailable journal must return bounded HTTP refusal, not an abandoned response')
        self.assertEqual(status,503,'Unavailable journal reaches bounded HTTP refusal')
        self.assertNotIn(b'private fixture diagnostic',body,'Private journal details do not enter HTTP')
    def test_actor_revocation_after_first_chunk_withholds_complete_body(self):
        original=access_module.ArtifactAccess._write
        first=True
        def revoke(output,body,check):
            nonlocal first
            original(output,body,check)
            if first:first=False;self.f.allowed=False
        with patch.object(access_module,'CHUNK',32),patch.object(access_module.ArtifactAccess,'_write',side_effect=revoke):
            status,_,body,complete=self.call()
        self.assertEqual(status,200);self.assertFalse(complete,'Midstream actor refusal closes incomplete HTTP')
        self.assertLess(len(body),len(self.f.bytes()),'Midstream actor refusal withholds final bytes')
    def test_original_ownership_loss_after_first_chunk_closes_http(self):
        original=access_module.ArtifactAccess._write
        def revoke(output,body,check):
            original(output,body,check);self.runtime._owned=False
        with patch.object(access_module,'CHUNK',32),patch.object(access_module.ArtifactAccess,'_write',side_effect=revoke):
            status,_,body,complete=self.call()
        self.assertEqual(status,200);self.assertFalse(complete,'Lost original ownership closes incomplete HTTP')
        self.assertLess(len(body),len(self.f.bytes()),'Lost original ownership withholds final bytes')
    def test_stream_write_deadline_is_applied_to_actual_socket(self):
        timeouts=[];original_headers=main.WorkerHandler.end_headers
        def headers(handler):
            timeouts.append(handler.connection.gettimeout())
            return original_headers(handler)
        with patch.object(main.WorkerHandler,'end_headers',new=headers):self.call()
        self.assertTrue(timeouts and all(type(t) in (int,float) and 0<t<=.25 for t in timeouts),'Every actual artifact socket has a finite write bound')

    def after_headers(self,change):
        original=main.WorkerHandler.end_headers
        def ended(handler):
            original(handler);change()
        with patch.object(main.WorkerHandler,'end_headers',new=ended):return self.call()
    def test_selected_lease_hash_binds_stream_before_headers(self):
        original=self.bridge.original
        def altered(*args):
            request,observation,row,lease=original(*args)
            changed=copy.deepcopy(lease);changed['expiresAt']+=10
            return request,observation,row,changed
        with patch.object(self.bridge,'original',side_effect=altered):status,_,body,_=self.call()
        self.assertEqual(status,503,'Stream refuses a different selected HTTP lease before headers')
        self.assertNotEqual(body,self.f.bytes(),'Selected lease mismatch releases no product')
    def test_invalid_selected_lease_digest_refuses(self):
        output=io.BytesIO()
        with self.runtime.owner(),self.assertRaisesRegex(ValueError,'selected HTTP lease differs'):
            self.f.access.serve(self.f.request,self.f.observation,self.lease['binding']['jobReference'],self.lease['token'],'orthophoto.tif',output,expected_lease_sha256='invalid')
        self.assertEqual(output.getvalue(),b'','Invalid selected digest releases no bytes')
    def test_ownership_ending_during_headers_prevents_first_body_byte(self):
        status,_,body,complete=self.after_headers(lambda:setattr(self.runtime,'_owned',False))
        self.assertEqual(status,200);self.assertEqual(body,b'','Ownership loss during headers releases no product bytes')
        self.assertFalse(complete,'Ownership loss during headers closes incomplete body')
    def test_actor_revocation_during_headers_prevents_first_body_byte(self):
        status,_,body,complete=self.after_headers(lambda:setattr(self.f,'allowed',False))
        self.assertEqual(status,200);self.assertEqual(body,b'','Actor revocation during headers releases no product bytes')
        self.assertFalse(complete,'Actor revocation during headers closes incomplete body')
    def test_expiry_during_headers_prevents_first_body_byte(self):
        status,_,body,complete=self.after_headers(lambda:setattr(self.f,'now',1100))
        self.assertEqual(status,200);self.assertEqual(body,b'','Expiry during headers releases no product bytes')
        self.assertFalse(complete,'Expiry during headers closes incomplete body')
    def test_deadline_expiring_during_headers_prevents_first_body_byte(self):
        original_clock=time.monotonic;expired=False
        def expire():
            nonlocal expired
            expired=True
        def clock():return original_clock()+10 if expired else original_clock()
        with patch.object(module.time,'monotonic',new=clock):status,_,body,complete=self.after_headers(expire)
        self.assertEqual(status,200);self.assertEqual(body,b'','Deadline during headers releases no product bytes')
        self.assertFalse(complete,'Deadline during headers closes incomplete body')

if __name__=='__main__':unittest.main()
