"""Bound managed claim/progress POSTs and exact stage ownership projections."""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler,HTTPServer
import hashlib,json,socket,threading
from urllib.parse import urlsplit,parse_qs
import requests
POST_PATHS=('/rest/v1/rpc/claim_model_stage_attempt','/rest/v1/rpc/write_model_stage_attempt')
PROJECTIONS=('id,run_id,status,attempt_managed,active_attempt_id,model_runs!inner(id,workspace_id,status,attempt_managed)','id,run_id,status,attempt_managed,active_attempt_id,log_tail,error_message,model_runs!inner(id,workspace_id,status,attempt_managed)')
def require(value,reason):
 if not value:raise ValueError(reason)
def verify_post(method,path,length,authorized):
 require(method=='POST','stagepoint-post-method')
 require(path in POST_PATHS,'stagepoint-post-path')
 require(type(length) is int and 0<length<=4194304,'stagepoint-post-size')
 require(authorized,'stagepoint-authorization')
def verify_read(method,path,authorized,bindings):
 require(method=='GET','stagepoint-read-method')
 require(type(path) is str and len(path)<=4096,'stagepoint-read-size')
 split=urlsplit(path);require(split.path=='/rest/v1/model_run_stages','stagepoint-read-path')
 try:query=parse_qs(split.query,strict_parsing=True)
 except ValueError:raise ValueError('stagepoint-read-query') from None
 require(set(query)=={'id','run_id','model_runs.workspace_id','select'} and all(len(v)==1 for v in query.values()),'stagepoint-read-query')
 stage=query['id'][0].removeprefix('eq.');binding=bindings.get(stage)
 require(binding is not None and query['id'][0]=='eq.'+stage and query['run_id'][0]=='eq.'+binding['run'] and query['model_runs.workspace_id'][0]=='eq.'+binding['workspace'],'stagepoint-read-scope')
 require(query['select'][0] in PROJECTIONS,'stagepoint-read-projection')
 require(authorized,'stagepoint-authorization')
def verify_body(actual,expected):require(actual==expected,'stagepoint-body-length')
def verify_response(total):require(total<=1048576,'stagepoint-response-size')
@contextmanager
def bridge(connection,bindings,drop_operations,records,port=0):
 drops=set(drop_operations)
 class Handler(BaseHTTPRequestHandler):
  protocol_version='HTTP/1.1'
  def log_message(self,*args):pass
  def forward(self):
   try:
    authorized=self.headers.get('Authorization')=='Bearer '+connection['service_token']
    if self.command=='POST':
     length=int(self.headers.get('Content-Length','0'));verify_post(self.command,self.path,length,authorized)
     self.connection.settimeout(15);body=self.rfile.read(length);verify_body(len(body),length)
    else:verify_read(self.command,self.path,authorized,bindings);body=None
    with requests.request(self.command,connection['url']+self.path.removeprefix('/rest/v1'),headers={'Authorization':'Bearer '+connection['service_token'],'Content-Type':'application/json'},data=body,timeout=15,stream=True,allow_redirects=False) as response:
     parts=[];total=0
     for part in response.iter_content(65536):total+=len(part);verify_response(total);parts.append(part)
     content=b''.join(parts);status=response.status_code
    operation=self.path.rsplit('/',1)[-1];dropped=self.command=='POST' and status==200 and operation in drops
    records.append({'method':self.command,'path':self.path,'requestSha256':hashlib.sha256(body or b'').hexdigest(),'status':status,'responseSha256':hashlib.sha256(content).hexdigest(),'dropped':dropped})
    if dropped:
     drops.remove(operation);self.close_connection=True;self.connection.shutdown(socket.SHUT_RDWR);self.connection.close();return
    self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(content)));self.send_header('Connection','close');self.end_headers();self.wfile.write(content);self.close_connection=True
   except Exception as error:
    records.append({'transportErrorType':type(error).__name__});self.close_connection=True
    try:self.connection.shutdown(socket.SHUT_RDWR)
    except OSError:pass
  def do_POST(self):self.forward()
  def do_GET(self):self.forward()
 server=HTTPServer(('127.0.0.1',port),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 try:yield 'http://127.0.0.1:'+str(server.server_port)
 finally:server.shutdown();server.server_close();thread.join(timeout=5)
