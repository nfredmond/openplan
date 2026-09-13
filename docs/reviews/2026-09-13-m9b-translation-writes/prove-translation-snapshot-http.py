"""Use the installed local PostgREST image with a disconnected proof database.

Only this runner's named loopback container is started/stopped. Credentials stay
in a mode-600 local env file; evidence contains synthetic results, never tokens.
"""
from pathlib import Path
import base64,hashlib,hmac,json,os,subprocess,time,urllib.error,urllib.parse,urllib.request

review=Path(__file__).parent
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/translation-snapshot')
fixture=json.loads((review/'translation-snapshot-fixture.json').read_text())
name='openplan_translation_snapshot_rest_20260913'
source='supabase_rest_openplan-restore-target-2731143'
database='openplan_translation_command_proof_20260913'
existing_names=subprocess.check_output(['docker','ps','-a','--format','{{.Names}}'],text=True).splitlines()
config=json.loads(subprocess.check_output(['docker','inspect',source],text=True))[0]
env=dict(item.split('=',1) for item in config['Config']['Env'] if '=' in item and item.startswith('PGRST_'))
uri=urllib.parse.urlsplit(env['PGRST_DB_URI'])
userinfo=uri.netloc.rsplit('@',1)[0]
env['PGRST_DB_URI']=urllib.parse.urlunsplit((uri.scheme,userinfo+'@supabase_db_openplan-restore-target-2731143:5432','/'+database,uri.query,''))
env['PGRST_DB_MAX_ROWS']='1000'
env['PGRST_DB_SCHEMAS']='public'
env['PGRST_SERVER_PORT']='3000'
env['PGRST_SERVER_HOST']='0.0.0.0'
env['PGRST_DB_ANON_ROLE']='anon'
env_path=private/'http.env'
fd=os.open(env_path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
with os.fdopen(fd,'w') as stream: stream.write(''.join(key+'='+value+'\n' for key,value in env.items()))
network=next(iter(config['NetworkSettings']['Networks']))
def encode(value):
    return base64.urlsafe_b64encode(value).decode().rstrip('=')
secret=env['PGRST_JWT_SECRET']
if secret.startswith('{'):
    keys=json.loads(secret)
    key=next(key for key in keys.get('keys',[keys]) if key['kty']=='oct')
    secret_bytes=base64.urlsafe_b64decode(key['k']+'='*((-len(key['k']))%4))
else:
    secret_bytes=base64.b64decode(secret) if env.get('PGRST_JWT_SECRET_IS_BASE64')=='true' else secret.encode()
def token(actor,role='authenticated'):
    header=encode(json.dumps({'alg':'HS256','typ':'JWT'},separators=(',',':')).encode())
    payload=encode(json.dumps({'sub':actor,'role':role,'aud':'authenticated','iat':int(time.time()),'exp':int(time.time())+300},separators=(',',':')).encode())
    content=header+'.'+payload
    return content+'.'+encode(hmac.new(secret_bytes,content.encode(),hashlib.sha256).digest())
def request(path,actor=None,body=None):
    headers={'Content-Type':'application/json'}
    if actor: headers['Authorization']='Bearer '+token(actor)
    req=urllib.request.Request('http://127.0.0.1:38961/'+path,data=None if body is None else json.dumps(body).encode(),headers=headers)
    try:
        with urllib.request.urlopen(req,timeout=15) as response: return response.status,json.load(response)
    except urllib.error.HTTPError as error: return error.code,json.load(error)
started=False
try:
    if name in existing_names:
        existing=json.loads(subprocess.check_output(['docker','inspect',name],text=True))[0]
        installed_env=dict(item.split('=',1) for item in existing['Config']['Env'] if '=' in item)
        assert existing['State']['Status']=='exited' and not existing['State']['Running'],'Existing proof service is not terminal'
        assert installed_env.get('PGRST_DB_URI')==env['PGRST_DB_URI'] and installed_env.get('PGRST_DB_MAX_ROWS')=='1000','Existing proof service targets another database/configuration'
        assert existing['HostConfig']['PortBindings'].get('3000/tcp')==[{'HostIp':'127.0.0.1','HostPort':'38961'}],'Existing proof service has another binding'
        assert existing['Config']['Image']==config['Config']['Image'],'Existing proof service uses another image'
        subprocess.check_output(['docker','start',name],text=True)
    else:
        subprocess.check_output(['docker','run','-d','--name',name,'--network',network,'--publish','127.0.0.1:38961:3000','--env-file',str(env_path),config['Config']['Image']],text=True)
    started=True
    deadline=time.monotonic()+20
    while True:
        try:
            status,data=request('rpc/read_engagement_translation_snapshot',fixture['actor'],{'p_campaign':fixture['campaign']})
            if status==503 and data.get('code')=='PGRST002':
                assert time.monotonic()<deadline,'Named proof HTTP schema cache did not become ready'
                time.sleep(.2)
                continue
            break
        except (urllib.error.URLError,ConnectionError):
            assert time.monotonic()<deadline,'Named proof HTTP service did not become reachable'
            time.sleep(.2)
    assert status==200,(status,data)
    assert len(data['categories'])==1005 and len(data['translations'])==1005,'Scalar HTTP snapshot was truncated'
    status,rows=request('engagement_categories?campaign_id=eq.'+fixture['campaign']+'&select=id',fixture['actor'])
    assert status==200 and len(rows)==1000,'Control did not demonstrate the configured HTTP row cap'
    status,viewer=request('rpc/read_engagement_translation_snapshot',fixture['viewer'],{'p_campaign':fixture['campaign']})
    assert status==200 and viewer==data,'Viewer current snapshot differs'
    for actor in [fixture['outsider'],None]:
        status,refusal=request('rpc/read_engagement_translation_snapshot',actor,{'p_campaign':fixture['campaign']})
        assert status in (401,403) and refusal['code']=='42501','Unauthorized HTTP snapshot was not refused'
    for table in ['engagement_translation_history','engagement_translation_write_receipts']:
        status,rows=request(table+'?campaign_id=eq.'+fixture['campaign']+'&select=*',fixture['viewer'])
        assert status==200 and rows==[], 'Viewer gained private history or receipt access'
    (private/'http-snapshot.json').write_text(json.dumps(data)+'\n')
    report={'database':database,'container':name,'image':config['Config']['Image'],'binding':'127.0.0.1:38961',
      'configuredMaxRows':1000,'controlRowsetCount':1000,'scalarCounts':data['counts'],
      'ownerAndViewerCurrentRead':True,'outsiderAndAnonymousRefused':True,'viewerPrivateHistoryAndReceiptsEmpty':True,
      'snapshotSha256':hashlib.sha256((private/'http-snapshot.json').read_bytes()).hexdigest(),
      'limits':'Real local HTTP snapshot and cap/access controls. No app navigation or browser write acceptance.'}
    (review/'translation-snapshot-http-results.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report))
finally:
    if started: subprocess.run(['docker','stop','--time','5',name],check=True,capture_output=True,text=True,timeout=15)
