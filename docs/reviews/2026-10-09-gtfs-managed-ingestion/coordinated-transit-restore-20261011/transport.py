"""Scoped, bounded native transport for the fresh coordinated proof databases."""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, urlunsplit
import base64, hashlib, hmac, json, os, re, secrets, socket, subprocess, threading, time, uuid
import requests
from preflight import require, verify_backend

REST_ID='c4b4c9b7a121bc0c4b7184c84719918d9d71ff2928ba54e0a6953db4aa432f9a'
REST_IMAGE='sha256:2f8e7b656f09db697a8875177694b417b35cb76c21370de07fc54e711e902326'
NETWORK='supabase_network_openplan-restore-target-2026091050'
OWNER='gtfs-coordinated-recovery-20261011'
PATHS=tuple('/rest/v1/rpc/'+name for name in ('claim_gtfs_ingest','read_gtfs_ingest_attempt','complete_gtfs_ingest'))

def verify_source(info):
    require(info['Id']==REST_ID and info['Name']=='/supabase_rest_openplan-restore-target-2026091050','coordinated-rest-identity')
    require(info['Image']==REST_IMAGE and info['Config']['Labels'].get('com.supabase.cli.project')=='openplan-restore-target-2026091050','coordinated-rest-owner')
    require(info['State']['Running'] and list(info['NetworkSettings']['Networks'])==[NETWORK],'coordinated-rest-network')

def verify_database(database):
    require(re.fullmatch(r'openplan_attempt_cli_[0-9a-f]{32}',database),'coordinated-backend-database-name')

def verify_request(method,path,length,authorized):
    require(method=='POST' and path in PATHS,'coordinated-request-path')
    require(type(length) is int and 0<length<=4194304,'coordinated-request-size')
    require(authorized,'coordinated-request-authorization')

def verify_network(info):
    require(list(info['NetworkSettings']['Networks'])==[NETWORK],'coordinated-created-network')

def verify_body(actual,expected):
    require(actual==expected,'coordinated-request-body')

def verify_response(total):
    require(total<=1048576,'coordinated-response-size')

def inspect(identity):
    return json.loads(subprocess.check_output(['docker','inspect',identity],stderr=subprocess.PIPE))[0]

def jwt(secret):
    def encoded(value):return base64.urlsafe_b64encode(value).rstrip(b'=').decode()
    head=encoded(b'{"alg":"HS256","typ":"JWT"}')
    payload=encoded(json.dumps({'role':'service_role','exp':int(time.time())+600}).encode())
    message=head+'.'+payload
    return message+'.'+encoded(hmac.new(secret.encode(),message.encode(),hashlib.sha256).digest())

@contextmanager
def gateway(database,out,records):
    verify_database(database)
    source=inspect(REST_ID);verify_source(source)
    source_env=dict(row.split('=',1) for row in source['Config']['Env'] if '=' in row)
    secret=secrets.token_urlsafe(48)
    settings={'PGRST_DB_URI':urlunsplit(urlsplit(source_env['PGRST_DB_URI'])._replace(path='/'+database)),
              'PGRST_DB_SCHEMAS':'public','PGRST_DB_CONFIG':'false','PGRST_DB_EXTRA_SEARCH_PATH':'',
              'PGRST_DB_POOL':'1','PGRST_DB_ANON_ROLE':'anon','PGRST_JWT_SECRET':secret,
              'PGRST_SERVER_PORT':'3000','PGRST_LOG_LEVEL':'crit','PGRST_OPENAPI_MODE':'disabled'}
    name='openplan-gtfs-coordinated-rest-'+uuid.uuid4().hex
    command=['docker','run','--detach','--name',name,'--label','openplan.proof.owner='+OWNER,
             '--network',NETWORK,'--publish','127.0.0.1::3000','--memory','128m','--memory-swap','128m',
             '--pids-limit','128','--cpus','0.5']
    for key in settings:command.extend(['--env',key])
    command.append(REST_IMAGE)
    identity=subprocess.check_output(command,env={**os.environ,**settings},stderr=subprocess.PIPE,text=True,timeout=30).strip()
    (out/(name+'-identity.json')).write_text(json.dumps({'id':identity,'name':name,'database':database,'owner':OWNER,'image':REST_IMAGE}))
    try:
        state=inspect(identity);verify_backend(state,identity,name,OWNER,REST_IMAGE,database)
        verify_network(state)
        require(state['State']['Running'],'coordinated-backend-startup')
        url='http://127.0.0.1:'+state['NetworkSettings']['Ports']['3000/tcp'][0]['HostPort']
        token=jwt(secret)
        ready=False
        for _ in range(60):
            try:
                with requests.head(url+'/gtfs_feed_versions?select=id&limit=0',headers={'Authorization':'Bearer '+token},timeout=1) as response:ready=response.status_code==200
            except requests.RequestException:pass
            if ready:break
            time.sleep(.1)
        require(ready,'coordinated-backend-readiness')
        yield {'url':url,'token':token}
    finally:
        state=inspect(identity);verify_backend(state,identity,name,OWNER,REST_IMAGE,database)
        verify_network(state)
        logs=subprocess.check_output(['docker','logs',identity],stderr=subprocess.STDOUT,timeout=15);(out/(name+'-private.log')).write_bytes(logs)
        if state['State']['Running']:subprocess.run(['docker','stop','--time','5',identity],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=15)
        remaining=subprocess.check_output(['docker','ps','-q','--no-trunc','--filter','id='+identity],text=True).strip()
        require(not remaining,'coordinated-backend-still-running')
        final=inspect(identity);require(not final['State']['Running'],'coordinated-backend-still-running')
        records.append({'identity':identity,'name':name,'image':REST_IMAGE,'memoryLimit':134217728,'swapLimit':134217728,'nanoCpus':500000000,'exactIdentityStopped':True,'retainedStoppedContainer':True,'exitCode':final['State']['ExitCode'],'startupOomKilled':final['State']['OOMKilled']})

@contextmanager
def bridge(connection,drop_completion,records):
    class Handler(BaseHTTPRequestHandler):
        protocol_version='HTTP/1.1'
        def log_message(self,*args):pass
        def do_POST(self):
            try:
                length=int(self.headers.get('Content-Length','0'))
                verify_request(self.command,self.path,length,self.headers.get('Authorization')=='Bearer '+connection['token'])
                self.connection.settimeout(15)
                data=self.rfile.read(length);verify_body(len(data),length)
                with requests.post(connection['url']+self.path.removeprefix('/rest/v1'),headers={'Authorization':'Bearer '+connection['token'],'Content-Type':'application/json'},data=data,timeout=15,stream=True) as response:
                    parts=[];total=0
                    for part in response.iter_content(65536):
                        total+=len(part);verify_response(total);parts.append(part)
                    payload=b''.join(parts)
                    dropped=drop_completion and self.path==PATHS[2]
                    records.append({'method':self.command,'path':self.path,'requestSha256':hashlib.sha256(data).hexdigest(),'status':response.status_code,'responseSha256':hashlib.sha256(payload).hexdigest(),'dropped':dropped})
                    if dropped:
                        self.close_connection=True;self.connection.shutdown(socket.SHUT_RDWR);self.connection.close();return
                    self.send_response(response.status_code);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload)
            except Exception as error:
                records.append({'transportErrorType':type(error).__name__})
                self.close_connection=True
                try:self.connection.shutdown(socket.SHUT_RDWR)
                except OSError:pass
        def do_GET(self):self.send_error(405)
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.daemon_threads=False;server.block_on_close=True
    thread=threading.Thread(target=server.serve_forever);thread.start()
    try:yield 'http://127.0.0.1:'+str(server.server_port)
    finally:server.shutdown();server.server_close();thread.join(timeout=5);require(not thread.is_alive(),'coordinated-bridge-still-running')
