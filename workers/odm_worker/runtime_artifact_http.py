"""Explicit retained artifact HTTP adapter with original durable lookup.

This does not enable the worker default or grant processing/quality acceptance.
Headers are delayed until the retained reader has accepted the first bytes.
"""
import hashlib
import math
import re
import sqlite3
import time
from urllib.parse import quote,unquote

from retained_source import json_bytes,read_json,reader
from runtime_artifact_access import ArtifactAccess,FORMAT,SCOPE,checksum


class Download:
    def __init__(self,access,*,timeout=120,write_timeout=.25):
        if (not isinstance(access,ArtifactAccess) or type(timeout) not in (int,float)
                or not math.isfinite(timeout) or timeout<=0
                or type(write_timeout) not in (int,float) or not math.isfinite(write_timeout)
                or not 0<write_timeout<=5):
            raise ValueError('Artifact HTTP needs original access and bounded socket writes')
        self.access=access;self.runtime=access.dispatch.runtime
        self.timeout=timeout;self.write_timeout=write_timeout

    @staticmethod
    def path(value):
        if not isinstance(value,str) or len(value)>8192 or '?' in value or '#' in value:
            raise FileNotFoundError('Artifact HTTP original URL differs')
        parts=value.split('/')
        if len(parts)!=5 or parts[:2]!=['','artifacts']:
            raise FileNotFoundError('Artifact HTTP original URL differs')
        reference,token,filename=map(unquote,parts[2:])
        if (not 1<=len(reference)<=256 or not re.fullmatch('[A-Za-z0-9_-]{43}',token)
                or not re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{0,179}',filename)
                or parts[2:]!=[quote(v,safe='') for v in (reference,token,filename)]):
            raise FileNotFoundError('Artifact HTTP original URL differs')
        return reference,token,filename

    def original(self,reference,token,filename,deadline):
        entry=self.runtime.journal.get_reference(reference)
        if entry is None:raise FileNotFoundError('Artifact HTTP original admission missing')
        request=entry.request['requestId'];self.access._check(request,deadline)
        root=self.runtime.root/('preparation-'+hashlib.sha256(request.encode()).hexdigest())
        saved=read_json(root/'private-artifact-access','lease.json')
        if not isinstance(saved,dict) or not isinstance(saved.get('binding'),dict):
            raise ValueError('Artifact HTTP original lease differs')
        observation=saved['binding'].get('observationSha256')
        root,manifest=self.access._plan(request,observation,deadline)
        lease=self.access._load(root,manifest)
        receipt=read_json(root/'private-artifact-access','receipt.json')
        if json_bytes(receipt)!=json_bytes({'format':FORMAT,'scope':SCOPE,
                'leaseSha256':checksum(lease),'terminalCallbackPermission':False}):
            raise ValueError('Artifact HTTP original lease receipt differs')
        import hmac
        if lease['binding']['jobReference']!=reference or not hmac.compare_digest(token,lease['token']):
            raise FileNotFoundError('Artifact HTTP original URL differs')
        row=next((r for r in lease['artifacts'] if r['filename']==filename and r['availability']=='retained'),None)
        if row is None:raise FileNotFoundError('Artifact HTTP original file missing')
        with reader(root,row['localRelativePath']) as (_,info):
            if info.st_size!=row['sizeBytes']:raise ValueError('Artifact HTTP original file size differs')
        return request,observation,row,lease

    def __call__(self,handler):
        deadline=time.monotonic()+self.timeout
        sent=False
        old_timeout=handler.connection.gettimeout()
        def check():
            if not self.runtime._owned:raise InterruptedError('Artifact HTTP original ownership ended')
            if time.monotonic()>=deadline:raise TimeoutError('Artifact HTTP deadline expired')
        class Output:
            def write(inner,body):
                nonlocal sent
                check();handler.connection.settimeout(min(self.write_timeout,max(.001,deadline-time.monotonic())))
                if not sent:
                    sent=True
                    handler.send_response(200)
                    handler.send_header('Content-Type',row['contentType'])
                    handler.send_header('Content-Length',str(row['sizeBytes']))
                    handler.send_header('Cache-Control','private, no-store')
                    handler.send_header('X-Content-Type-Options','nosniff')
                    handler.end_headers()
                    self.access._authority(lease['binding'],deadline)
                check();self.access._live(lease)
                handler.connection.settimeout(min(self.write_timeout,max(.001,deadline-time.monotonic())))
                count=handler.wfile.write(body);check();return count
        try:
            reference,token,filename=self.path(handler.path)
            check()
            request,observation,row,lease=self.original(reference,token,filename,deadline)
            self.access.serve(request,observation,reference,token,filename,Output(),deadline=deadline,
                              expected_lease_sha256=checksum(lease))
        except (FileNotFoundError,PermissionError,ValueError,InterruptedError,TimeoutError,OSError,sqlite3.Error) as error:
            handler.close_connection=True
            if not sent:
                handler.connection.settimeout(self.write_timeout)
                status=404 if isinstance(error,FileNotFoundError) else 403 if isinstance(error,PermissionError) else 503
                if isinstance(error,PermissionError) and str(error)=='Artifact access original lease expired':status=410
                handler._send_json(status,{'error':'original_artifact_unavailable'})
        finally:
            handler.close_connection=True
            handler.connection.settimeout(old_timeout)
