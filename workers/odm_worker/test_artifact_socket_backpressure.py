"""Real non-reading client challenges the explicit artifact socket bound.

The archive contains synthetic large raster bytes and mocked application reads.
This checks socket interruption, not photogrammetry quality or native RLS.
"""
import socket
import struct
import threading
import time
import unittest
from unittest.mock import patch

import main
from runtime_artifact_access import ArtifactAccess
from runtime_artifact_http import Download
import test_runtime_artifact_plan as fixtures


class Checks(unittest.TestCase):
    def test_nonreading_client_releases_owned_handler(self):
        fixture=fixtures.Checks();fixture.setUp();self.addCleanup(fixture.doCleanups)
        products=fixture.f.f
        products.members['odm_orthophoto/odm_orthophoto.tif']+=b'X'*(8*1024**2)
        products.archive()
        intake=products.f.intake
        intake._limits=tuple({**intake.limits,'max_archive_bytes':1024**2,'max_expanded_bytes':16*1024**2}.items())
        runtime=products.f.runtime
        with runtime.owner():fixture.plan.advance(fixture.request,fixture.observation)
        access=ArtifactAccess(fixture.plan,lambda *_args,**_kwargs:True,timeout=4)
        with runtime.owner():lease=access.prepare(fixture.request,fixture.observation,public_base_url='https://worker.example',expires_at=time.time()+120)
        finished=threading.Event()
        class Tracked(Download):
            def __call__(self,handler):
                try:return super().__call__(handler)
                finally:finished.set()
        class SmallSocket(main.WorkerHandler):
            def setup(self):
                super().setup();self.connection.setsockopt(socket.SOL_SOCKET,socket.SO_SNDBUF,4096)
        with patch.object(main,'WorkerHandler',SmallSocket):
            server=main.build_server('127.0.0.1',0,admissions=runtime,artifact_download=Tracked(access,timeout=4,write_timeout=.25))
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        client=socket.socket();client.setsockopt(socket.SOL_SOCKET,socket.SO_RCVBUF,4096)
        client.setsockopt(socket.SOL_SOCKET,socket.SO_LINGER,struct.pack('ii',1,0))
        try:
            client.connect(('127.0.0.1',server.server_port))
            row=next(r for r in lease['artifacts'] if r['filename']=='orthophoto.tif')
            path=row['downloadUrl'].removeprefix('https://worker.example')
            with runtime.owner():
                client.sendall(('GET '+path+' HTTP/1.1\r\nHost: local-fixture\r\n\r\n').encode())
                self.assertTrue(finished.wait(2),'Nonreading client must release the owned HTTP handler before its whole-stage deadline')
            end=time.monotonic()+4;received=bytearray()
            while True:
                remaining=end-time.monotonic()
                self.assertGreater(remaining,0,'Closed original socket must drain under a finite deadline')
                client.settimeout(remaining)
                chunk=client.recv(16384)
                if not chunk:break
                received.extend(chunk)
                self.assertLessEqual(len(received),row['sizeBytes']+8192,'Drained original response has a finite byte limit')
            headers,separator,body=bytes(received).partition(b'\r\n\r\n')
            self.assertTrue(headers.startswith(b'HTTP/1.0 200') and separator,'Actual bounded socket began an original product response')
            lengths=[int(line.split(b':',1)[1]) for line in headers.split(b'\r\n') if line.lower().startswith(b'content-length:')]
            self.assertEqual(lengths,[row['sizeBytes']],'Drained response declares the exact original length')
            self.assertLess(len(body),lengths[0],'Entire drained response ends before its original Content-Length')
        finally:
            client.close();server.shutdown();server.server_close();thread.join(timeout=5)


if __name__=='__main__':unittest.main()
