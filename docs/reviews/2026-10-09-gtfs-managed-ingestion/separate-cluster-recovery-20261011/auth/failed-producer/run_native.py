"""Read recovered planner/outsider access and account for each password login."""
import importlib.util, json, os, subprocess, sys, time
from pathlib import Path
from urllib.parse import quote
import requests

OUT=Path(__file__).parent;BASE=OUT.parent;API_PROOF=BASE/'separate-cluster-api-20261011-01';ROLE=BASE/'separate-cluster-point-20261011-02'
sys.path.extend([str(API_PROOF),str(ROLE)])
import services, network_scope as n, continuation_guards as binding, run_database as database
from scope import DB_ID,DATABASE,NETWORK,require
from start_services import verify_result
import access_guards as g
from auth_preservation import verify_auth,TABLES

record={'state':'prepared-authenticated-recovery','requests':[],'logins':[],'serviceStops':[]}
point=BASE/'transit-expanded-local-point-20261011-03/source-point-private'
restored=ROLE/'restored-private'/point.relative_to('/');protected=restored/'configuration-private';storage=restored/'storage-objects'
state=json.loads((API_PROOF/'api-service-receipts-private.json').read_text());receipt=json.loads((ROLE/'container-receipt.json').read_text())

def save():
    (OUT/'progress-private.json').write_text(json.dumps(record,indent=2)+'\n')

def private(name,value):
    (OUT/name).write_text(json.dumps(value,indent=2)+'\n')

def db_guard():
    n.verify_database_attachment(services.inspect(DB_ID),receipt,database.VOLUME,ROLE/'mounted-root-private.key',database.g.verify_container,True)

def auth_rows(label):
    fields=[]
    for table in TABLES:
        fields.append("'"+table+"',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM auth."+table+" t)")
    value=json.loads(database.archive.sql(DB_ID,'SELECT jsonb_build_object('+','.join(fields)+')',DATABASE));private(label+'-auth-rows-private.json',value);return value

def request(session,method,url,key,token=None,body=None):
    headers={'apikey':key,'Authorization':'Bearer '+(token or key)}
    with session.request(method,url,headers=headers,json=body,timeout=15) as response:return response.status_code,response.json()

def main():
    os.umask(0o077);started=time.monotonic()
    verify_result(json.loads((ROLE/'database-continuation-02-result.json').read_text()));db_guard()
    subprocess.run(['docker','start',DB_ID],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=30)
    for _ in range(100):
        if subprocess.run(['docker','exec',DB_ID,'pg_isready','-U','supabase_admin'],capture_output=True).returncode==0:break
        time.sleep(.2)
    else:raise TimeoutError('Recovered database readiness')
    db_guard()
    for kind in ('rest','auth','storage','gateway'):
        r=state['services'][kind];services.verify_new(kind,services.inspect(r['id']),r,DATABASE,storage,API_PROOF/'api-kong-runtime-private.json')
        subprocess.run(['docker','start',r['id']],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=30)
    peers={DB_ID}|{r['id'] for r in state['services'].values()}
    net=json.loads((API_PROOF/'network-result.json').read_text());info=json.loads(subprocess.check_output(['docker','network','inspect',net['networkId']]))[0]
    subnet=n.verify_network(info,net['networkId'],peers)
    gateway=services.inspect(state['services']['gateway']['id']);native=binding.binding(state,receipt,gateway['NetworkSettings']['Networks'][NETWORK]['IPAddress'],subnet)
    session=requests.Session();session.trust_env=False
    for _ in range(100):
        try:
            statuses=[]
            for path in ('/auth/v1/health','/rest/v1/gtfs_feed_versions?select=id&limit=0','/storage/v1/status'):
                with session.get(native+path,headers={'apikey':state['service_key'],'Authorization':'Bearer '+state['service_key']},timeout=1) as response:statuses.append(response.status_code)
            if services.ready_status(*statuses):break
        except requests.RequestException:pass
        time.sleep(.2)
    else:raise TimeoutError('Recovered API readiness')
    database.image.CONTAINER=DB_ID;database.image.OUT=OUT
    before=database.image.inventory(DATABASE,'auth-before-native')
    baseline=json.loads((API_PROOF/'separate-api-final-inventory-private.json').read_text());database.image.equal_image(baseline,before)
    files=database.files.inventory(restored)
    accounts=json.loads((protected/'fixture-accounts-private.json').read_text())
    fixture=json.loads((BASE/'capacity-20261011-01/capacity-native.json').read_text());version=fixture['versionId'];workspace=fixture['expectedBinding']['workspaceId']
    tokens={}
    for role in ('owner','viewer','outsider'):
        actor=accounts['accounts'][role];old=auth_rows(role+'-before')
        status,value=request(session,'POST',native+'/auth/v1/token?grant_type=password',state['anon_key'],body={'email':actor['email'],'password':actor['password']})
        g.signin(status,value,actor['id']);tokens[role]=value['access_token']
        status,user=request(session,'GET',native+'/auth/v1/user',state['anon_key'],tokens[role]);g.identity(status,user,actor['id'])
        after=auth_rows(role+'-after');graph=verify_auth(old,after,actor['id']);record['logins'].append({'role':role,'exactAuthGraph':graph});save()
    for role in ('owner','viewer','outsider','anon'):
        for table,column in [('gtfs_feed_versions','id'),('gtfs_route_service_levels','feed_version_id'),('gtfs_stop_service_levels','feed_version_id')]:
            path='/rest/v1/'+table+'?select='+column+',workspace_id&'+column+'=eq.'+version+'&limit=1'
            status,value=request(session,'GET',native+path,state['anon_key'],tokens.get(role));g.rows(role,status,value,column,version,workspace)
            record['requests'].append({'role':role,'table':table,'status':status,'rows':len(value) if isinstance(value,list) else None});save()
    manifest=json.loads((protected/'object-manifest-private.json').read_text())
    object_row=next(r for r in manifest if r['bucket']=='gtfs-uploads' and r['sha256']=='a9372be5b70fcee4ed98c9476433f86065637a9a500b8af6afbb84d000ef2746')
    object_url=native+'/storage/v1/object/'+quote(object_row['bucket'],safe='')+'/'+quote(object_row['name'],safe='/')
    with session.get(object_url,headers={'apikey':state['service_key'],'Authorization':'Bearer '+state['service_key'],'Range':'bytes=0-31'},stream=True,timeout=15) as response:exists=response.status_code in (200,206)
    for role in ('owner','viewer','outsider','anon'):
        with session.get(object_url,headers={'apikey':state['anon_key'],'Authorization':'Bearer '+tokens.get(role,state['anon_key'])},stream=True,timeout=15) as response:
            g.archive(role,response.status_code,exists);record['requests'].append({'role':role,'privateArchive':True,'status':response.status_code})
        save()
    body={'p_limit':1,'p_installation':fixture['expectedBinding']['installationId']}
    for role in ('service','owner','viewer','outsider','anon'):
        key=state['service_key'] if role=='service' else state['anon_key']
        status,value=request(session,'POST',native+'/rest/v1/rpc/scan_gtfs_ingest_candidates',key,tokens.get(role),body);g.rpc(role,status,value)
        record['requests'].append({'role':role,'workerRpc':True,'status':status});save()
    g.final_auth(after,auth_rows('final'))
    services.stop_stack(DATABASE,storage,API_PROOF/'api-kong-runtime-private.json',OUT,state,record['serviceStops'])
    actual=database.image.inventory(DATABASE,'auth-after-native')
    g.non_auth(before,actual,graph['refreshTokenId']);g.schema(before['schemaSha256'],actual['schemaSha256'])
    database.files.equal(files,database.files.inventory(restored))
    database.g.verify_properties(json.loads((protected/'database-properties-private.json').read_text()),database.archive.database_properties(DB_ID,DATABASE))
    roles=subprocess.check_output(['docker','exec',DB_ID,'pg_dumpall','-U','supabase_admin','--roles-only'],stderr=subprocess.PIPE,timeout=60).decode();(OUT/'roles-after-private.log').write_text(roles)
    database.g.verify_roles(json.loads((protected/'roles-inventory-private.json').read_text()),json.loads(database.archive.role_inventory(DB_ID)),(protected/'roles-private.sql').read_text(),roles)
    database.archive._keys.require_mounted_bytes(receipt,database.archive._keys.read_key(protected/'pgsodium-root-private.key',private=True))
    db_guard();subprocess.run(['docker','stop','--time','10',DB_ID],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=20);db_guard()
    require(not services.inspect(DB_ID)['State']['Running'],'expanded-stack-survived-stop')
    record.update(state='passed-native-authenticated-recovery',wallSeconds=round(time.monotonic()-started,3),tables=len(actual['tables']),sequences=len(actual['sequences']),privateArchiveBytes=object_row['bytes'],databaseStopped=True,filesUnchanged=True,propertiesRolesKeyEqual=True,scope='Three synthetic retained users on separate local cluster. Read-only GTFS/Storage/RPC probes with exact password-login deltas. No browser, cross-host, agency or all-table RLS acceptance.')
    save();private('result.json',record);print(json.dumps({'state':record['state'],'requests':len(record['requests']),'logins':3,'wallSeconds':record['wallSeconds']}),flush=True)

if __name__=='__main__':
    try:main()
    except BaseException as error:
        record.update(state='failed',failureType=type(error).__name__,reason=str(error));save()
        try:services.stop_stack(DATABASE,storage,API_PROOF/'api-kong-runtime-private.json',OUT,state,record['serviceStops'])
        finally:
            db_guard();subprocess.run(['docker','stop','--time','10',DB_ID],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=20)
        raise
