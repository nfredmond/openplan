"""Forward only bounded authenticated native CLI RPCs, with a real lost reply."""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import hashlib,hmac,socket,threading
import requests
from scope import API,require
PATHS=tuple('/rest/v1/rpc/'+name for name in ('scan_gtfs_ingest_candidates','claim_gtfs_ingest','read_gtfs_ingest_attempt','complete_gtfs_ingest'))
def request_scope(method,path,length,auth,key):
    require(method=='POST' and path in PATHS,'expanded-bridge-path')
    require(type(length) is int and 0<length<=4194304,'expanded-bridge-request-size')
    require(hmac.compare_digest(auth,'Bearer '+key),'expanded-bridge-auth')
def exact_body(actual,expected):require(actual==expected,'expanded-bridge-body')
def bounded_response(total):require(total<=1048576,'expanded-bridge-response-size')
@contextmanager
def bridge(key,drop,records):
    class Handler(BaseHTTPRequestHandler):
        protocol_version='HTTP/1.1'
        def log_message(self,*args):pass
        def do_POST(self):
            try:
                self.connection.settimeout(15);length=int(self.headers.get('Content-Length','0'))
                request_scope(self.command,self.path,length,self.headers.get('Authorization',''),key)
                data=self.rfile.read(length);exact_body(len(data),length)
                session=requests.Session();session.trust_env=False
                with session.post(API+self.path,headers={'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json'},data=data,timeout=15,stream=True) as response:
                    chunks=[];total=0
                    for chunk in response.iter_content(65536):total+=len(chunk);bounded_response(total);chunks.append(chunk)
                    payload=b''.join(chunks);dropped=drop and self.path==PATHS[3]
                    records.append({'path':self.path,'status':response.status_code,'requestSha256':hashlib.sha256(data).hexdigest(),'responseSha256':hashlib.sha256(payload).hexdigest(),'dropped':dropped,'candidateEmpty':payload==b'[]' if self.path==PATHS[0] else None})
                    if dropped:self.close_connection=True;self.connection.shutdown(socket.SHUT_RDWR);self.connection.close();return
                    self.send_response(response.status_code);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload)
            except Exception as error:
                records.append({'transportErrorType':type(error).__name__});self.close_connection=True
                try:self.connection.shutdown(socket.SHUT_RDWR)
                except OSError:pass
        def do_GET(self):self.send_error(405)
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.daemon_threads=False;server.block_on_close=True
    thread=threading.Thread(target=server.serve_forever);thread.start()
    try:yield 'http://127.0.0.1:'+str(server.server_port)
    finally:server.shutdown();server.server_close();thread.join(timeout=5);require(not thread.is_alive(),'expanded-bridge-stop')
