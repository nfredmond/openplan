"""Private parent-operated preview preparation. Default command is pure controls.

No cleanup, migrations, global role changes, hosted calls, downloads or resets.
"""
import base64
import hashlib
import hmac
import json
import os
import re
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
import urllib.error
from urllib.parse import urlencode, urlsplit, urlunsplit

import rest_uri_recovery_01_policy as p

OUT = Path(p.ROOT)
RECOVERY = OUT / 'rest-uri-recovery-01'
ACTIVE_RECEIPTS = RECOVERY / 'active-service-receipts-private.json'
INPUT_MANIFEST_SHA256 = 'f4699a12503ed9f4d7488394f72edd5595d1c16b74e6b657fd2cec7af24881e8'
APP = OUT / 'candidate/openplan'
REPO = '/home/nathaniel/.t3/worktrees/openplan/t3-6bf6371f'
OLD = OUT.parent / 'stage-a-main323-preview-20261015'
OLD_IDS = {
    'rest':'8794d475161ec67b50b02400c7cbf78f88f9b4c8b3613769676a8cf3ee0d19dd',
    'auth':'6b7b5e2eb70f75d2036de6f63fbd14afc7e4961b9e1bd8bff8f8861a7cdf6d6c',
    'storage':'3e0b8c15f93ffec51bc210efb337798f50b9263ac3252999fa583c85ce56a935',
    'gateway':'cfc0cf61d99bfa89c645ef9219c07d1554adde6c8108266bfa4c91efe409974f',
}
OLD_STORAGE = OLD / 'storage-objects'
OLD_KONG = OLD / 'target-kong-runtime-private.json'
CAPTURE_INPUTS = [OLD/'services.py', OLD/'start_preview.py', OLD/'run_build.py',
    OUT.parent/'project-map-integration-20261015/start_preview.py',
    OUT.parent/'project-map-integration-20261015/run_build.py', OLD_KONG]


def sha(path):
    value=hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):value.update(block)
    return value.hexdigest()


def write(name, value):
    path=RECOVERY/name
    # Evidence and failed trials are append-only. No automatic overwrite/retry.
    with path.open('x') as stream:json.dump(value,stream,indent=2);stream.write('\n')
    path.chmod(0o600)


def read(name):return json.loads((OUT/name).read_text())


def run(args, *, data=None, log=None, timeout=120):
    result=subprocess.run(args,input=data,capture_output=True,timeout=timeout)
    if log:
        with (RECOVERY/log).open('xb') as stream:stream.write(result.stdout+result.stderr)
    if result.returncode:raise RuntimeError('command-refused; private log='+str(log))
    return result.stdout


def inspect(identity):return json.loads(run(['docker','inspect',identity]))[0]


def db_check():
    i=inspect(p.DB_ID)
    p.database(dict(Id=i['Id'],Name=i['Name'],Image=i['Image'],running=i['State']['Running'],
        project=i['Config']['Labels'].get('com.supabase.cli.project'),
        networkId=i['NetworkSettings']['Networks'].get(p.NETWORK,{}).get('NetworkID')))
    return i


def sql(database, query):
    # Every read, including reads of the target, starts a readonly session.
    return run(['docker','exec','-i','-e','PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=60000',
        p.DB_ID,'psql','-XqAt','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1'],data=query.encode()).decode().strip()


def literal(value):return "'"+value.replace("'","''")+"'"


def ident(value):return '"'+value.replace('"','""')+'"'


def snapshot(database):
    # One repeatable-read transaction covers the complete table inventory and data.
    tables=json.loads(sql(database,"SELECT coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname) ORDER BY n.nspname,c.relname),'[]') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema';"))
    queries=["BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;"]
    for schema, table in tables:
        queries.append("SELECT jsonb_build_object('table',"+literal(schema+'.'+table)+",'count',count(*),'digest',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),''))) FROM ONLY "+ident(schema)+'.'+ident(table)+' t;')
    for table in ['pg_class','pg_attribute','pg_proc','pg_constraint','pg_namespace','pg_policy','pg_trigger','pg_rewrite','pg_depend','pg_default_acl','pg_extension']:
        queries.append("SELECT jsonb_build_object('catalog',"+literal(table)+",'digest',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),''))) FROM pg_catalog."+table+' t;')
    queries.append("SELECT jsonb_build_object('globalRoles',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),''))) FROM pg_authid t;")
    queries.append("SELECT jsonb_build_object('globalMembership',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),''))) FROM pg_auth_members t;")
    queries.append("SELECT jsonb_build_object('globalRoleSettings',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),''))) FROM pg_db_role_setting t WHERE setdatabase=0 OR setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database());")
    queries.append("SELECT jsonb_build_object('sequences',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),''))) FROM pg_sequences t;")
    queries.append("SELECT jsonb_build_object('database',current_database(),'readonly',current_setting('transaction_read_only'),'historyCount',(SELECT count(*) FROM supabase_migrations.schema_migrations),'latest',(SELECT max(version) FROM supabase_migrations.schema_migrations),'foreignTables',(SELECT count(*) FROM pg_foreign_table),'subscriptions',(SELECT count(*) FROM pg_subscription),'cron',to_regclass('cron.job') IS NOT NULL,'databaseSettings',(SELECT count(*) FROM pg_db_role_setting WHERE setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database())),'delegatedGrantors',(SELECT count(*) FROM pg_database d,LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE datname=current_database() AND a.grantor<>d.datdba));")
    queries.append("SELECT jsonb_build_object('properties',jsonb_build_object('owner',pg_get_userbyid(datdba),'encoding',pg_encoding_to_char(encoding),'collate',datcollate,'ctype',datctype,'localeProvider',datlocprovider,'locale',datlocale,'connectionLimit',datconnlimit,'acl',(SELECT jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantee,a.privilege_type) FROM aclexplode(coalesce(datacl,acldefault('d',datdba))) a))) FROM pg_database WHERE datname=current_database();")
    queries.append("SELECT jsonb_build_object('versions',jsonb_agg(version ORDER BY version)) FROM supabase_migrations.schema_migrations;")
    queries.append('COMMIT;')
    return [json.loads(line) for line in sql(database,'\n'.join(queries)).splitlines()]


def source_check():
    db_check()
    current=snapshot(p.SOURCE)
    info=next(x for x in current if 'historyCount' in x)
    p.source(info)
    frozen=read('source-binding-private.json')
    p.source_fingerprint(frozen,current)
    return current


def inventory(root):
    values={}
    for f in sorted(root.rglob('*')):
        if f.is_symlink():raise ValueError('storage-symlink')
        if f.is_file():values[str(f.relative_to(root))]={'bytes':f.stat().st_size,'sha256':sha(f)}
    return values


def free_ports():
    # A bind probe does not create a listening service. No SO_REUSEADDR bypass.
    for port in [29948,3585]:
        with socket.socket() as sock:sock.bind((p.HOST,port))


def templates():
    expected=read('template-binding.json')
    p.files(expected,{name:sha(OUT/name) for name in expected})
    expected=read('rest-uri-recovery-01/template-binding-v1.json')
    p.exact({'names':['rest_uri_recovery_01_controller.py','rest_uri_recovery_01_launcher.py','rest_uri_recovery_01_policy.py']},
            {'names':sorted(expected)},'recovery-templates')
    p.files(expected,{name:sha(OUT/name) for name in expected})


def recovery_inputs(original, active):
    """Keep every helper input except the corrected REST query byte-identical."""
    expected=json.loads(json.dumps(original))
    old=expected['rest']['PGRST_DB_URI']
    p.exact({'query':'options=-c+search_path%3Dpublic%2Cextensions'},
            {'query':urlsplit(old).query},'recovery-original-uri')
    fixed=urlunsplit(urlsplit(old)._replace(query='options=-c%20search_path%3Dpublic%2Cextensions'))
    expected['rest']['PGRST_DB_URI']=fixed
    observed=json.loads(json.dumps(active))
    uri=urlsplit(observed['rest']['PGRST_DB_URI'])
    # Hex case is harmless; no form decoding or credential normalization.
    observed['rest']['PGRST_DB_URI']=urlunsplit(uri._replace(
        query=re.sub(r'%[0-9a-fA-F]{2}',lambda m:m[0].upper(),uri.query)))
    p.exact({'envs':expected},{'envs':observed},'recovery-inputs')
    return fixed


def active_receipts():
    """Select the replacement only after its exact persisted ID has started."""
    p.exact({'complete':True},{'complete':all((RECOVERY/name).is_file() and not (RECOVERY/name).is_symlink()
        for name in ['replacement-receipt-private.json','replacement-started-private.json',
        'active-service-receipts-private.json','active-binding-private.json'])},'recovery-state')
    original=read('service-receipts-private.json')
    created=read('rest-uri-recovery-01/replacement-receipt-private.json')
    started=read('rest-uri-recovery-01/replacement-started-private.json')
    active=read('rest-uri-recovery-01/active-service-receipts-private.json')
    binding=read('rest-uri-recovery-01/active-binding-private.json')
    old=original['rest']['id'];identity=created['id']
    p.exact({'valid':True},{'valid':isinstance(identity,str) and len(identity)==64 and
        all(c in '0123456789abcdef' for c in identity) and identity!=old},'replacement-id')
    expected={**original,'rest':{**original['rest'],'id':identity}}
    p.files(expected,active)
    p.files(expected['rest'],created)
    p.exact({'id':identity,'running':True},started,'replacement-started')
    p.exact({'receiptSha256':sha(ACTIVE_RECEIPTS),'id':identity,
        'createdSha256':sha(RECOVERY/'replacement-receipt-private.json'),
        'startedSha256':sha(RECOVERY/'replacement-started-private.json')},binding,'active-binding')
    return active


def pinned_files():
    templates()
    p.exact({'sha256':INPUT_MANIFEST_SHA256},{'sha256':sha(RECOVERY/'input-binding-v1.json')},'recovery-input-manifest')
    expected=read('private-bindings.json')
    p.files(expected,{name:sha(OUT/name) for name in expected})
    plan=read('plan-private.json');p.target_name(plan['target'])
    p.exact({'head':p.HEAD,'source':p.SOURCE,'dbId':p.DB_ID,'api':p.API,'web':p.WEB,'root':str(OUT)},plan,'plan')
    app=read('app-env-private.json')
    optional=configured_source(app)
    expected=read('rest-uri-recovery-01/input-binding-v1.json')
    p.files(expected,{name:sha(OUT/name) for name in expected})
    envs=read('rest-uri-recovery-01/envs-v1-private.json')
    p.native_rest_uri(envs['rest']['PGRST_DB_URI'])
    recovery_inputs(read('envs-private.json'),envs)
    p.configuration(plan,envs,read('kong-private.json'),app,optional)
    return plan


def configured_source(app):
    # Read only this fixed source path; never follow a path supplied by a binding.
    path=Path(p.CONFIG_SOURCE)
    p.exact({'regular':True,'private':True}, {'regular':path.is_file() and not path.is_symlink(),
        'private':path.stat().st_mode & 0o077 == 0}, 'optional-source-file')
    return p.configured_source(read('configured-source-private.json'),path.read_bytes(),app)


def token(secret, role):
    def enc(value):return base64.urlsafe_b64encode(json.dumps(value,separators=(',',':')).encode()).decode().rstrip('=')
    data=enc({'alg':'HS256','typ':'JWT'})+'.'+enc({'role':role,'iss':'supabase','iat':int(time.time()),'exp':int(time.time())+7*86400})
    return data+'.'+base64.urlsafe_b64encode(hmac.new(secret.encode(),data.encode(),hashlib.sha256).digest()).decode().rstrip('=')


# Capture is deliberately absent. The original source anchor cannot be recaptured.


def unchanged_inputs():
    for path,expected in read('input-bindings-private.json').items():
        p.exact({'sha256':expected},{'sha256':sha(Path(path))},'prior-input')
    for kind,expected in read('old-helper-bindings-private.json').items():
        i=inspect(OLD_IDS[kind])
        p.exact({'sha256':expected},{'sha256':p.digest({k:i[k] for k in ['Id','Name','Image','Config','HostConfig','Mounts']})},'prior-helper')
    p.files(read('storage-binding-private.json'),inventory(OLD_STORAGE))


def target_identity(target):
    p.target_name(target)
    return json.loads(sql('postgres',"SELECT jsonb_build_object('oid',oid,'database',datname,'owner',pg_get_userbyid(datdba)) FROM pg_database WHERE datname="+literal(target)+';'))


def target_check():
    plan=read('plan-private.json')
    p.exact(read('target-identity.json'),target_identity(plan['target']),'target-identity')


def clone():
    raise ValueError('recovery-disabled:clone')


def observed_service(kind, receipt):
    i=inspect(receipt['id']);env=dict(row.split('=',1) for row in i['Config']['Env'] if '=' in row)
    # Image default environment is part of the binding, as are complete publications.
    h=i['HostConfig']
    return dict(id=i['Id'],name=i['Name'],image=i['Image'],labels=i['Config']['Labels'],
        network=[v['NetworkID'] for v in i['NetworkSettings']['Networks'].values()],networkNames=sorted(i['NetworkSettings']['Networks']),
        memory=h['Memory'],swap=h['MemorySwap'],cpus=h['NanoCpus'],pids=h['PidsLimit'],
        environment=p.digest(env),mounts=[(x['Source'],x['Destination'],x['RW']) for x in i['Mounts']],
        bindings=h['PortBindings'],database=urlsplit(env[p.URI_KEYS[kind]]).path[1:] if kind!='gateway' else receipt['database'],
        running=i['State']['Running'],privileged=h['Privileged'],networkMode=h['NetworkMode'],
        extraHosts=h['ExtraHosts'],capAdd=h['CapAdd'],pidMode=h['PidMode'],binds=h['Binds'],readOnlyRoot=h['ReadonlyRootfs'])


def expected_service(kind, receipt, env):
    image=json.loads(run(['docker','image','inspect',p.IMAGES[kind]]))[0]
    defaults=dict(row.split('=',1) for row in image['Config'].get('Env',[]) if '=' in row);defaults.update(env)
    mounts=[]
    if kind=='storage':mounts=[(str(OUT/'storage-objects'),'/mnt',True)]
    if kind=='gateway':mounts=[(str(OUT/'kong-private.json'),'/etc/kong/proof.json',False)]
    return dict(id=receipt['id'],name='/'+receipt['name'],image=p.IMAGES[kind],
        labels={**(image['Config'].get('Labels') or {}),**receipt['labels']},network=[p.NETWORK_ID],networkNames=[p.NETWORK],memory=p.LIMIT,swap=p.LIMIT,
        cpus=500000000,pids=128,environment=p.digest(defaults),mounts=mounts,
        bindings={'8000/tcp':[{'HostIp':p.HOST,'HostPort':'29948'}]} if kind=='gateway' else {},
        database=receipt['database'],running=True,privileged=False,networkMode=p.NETWORK,
        extraHosts=None,capAdd=None,pidMode='',binds=None,readOnlyRoot=False)


def health():
    # Fixed loopback origin, no redirects and no ambient proxy. Never calls a provider.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):return None
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
    values=read('app-env-private.json');observed={}
    for name,path,method in [('auth','/auth/v1/health','GET'),('rest','/rest/v1/projects?select=id&limit=0','HEAD'),('storage','/storage/v1/status','GET')]:
        headers={'apikey':values['SUPABASE_SERVICE_ROLE_KEY'],'Authorization':'Bearer '+values['SUPABASE_SERVICE_ROLE_KEY']}
        with opener.open(urllib.request.Request(p.API+path,headers=headers,method=method),timeout=5) as response:
            observed[name]=response.status
    for label,origin in [('ownOrigin',p.WEB),('oldOrigin','http://127.74.15.10:3583')]:
        headers={'Origin':origin,'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'apikey,authorization'}
        with opener.open(urllib.request.Request(p.API+'/rest/v1/projects',headers=headers,method='OPTIONS'),timeout=5) as response:
            observed[label]=response.headers.get('Access-Control-Allow-Origin')
    p.health(observed)


def verify_services():
    plan=pinned_files();db_check();target_check()
    receipts=active_receipts()
    p.exact({'kinds':sorted(p.IMAGES)},{'kinds':sorted(receipts)},'helpers')
    envs=read('rest-uri-recovery-01/envs-v1-private.json')
    for kind,receipt in receipts.items():
        p.exact({'name':plan['names'][kind],'database':plan['target']},receipt,'receipt')
        p.service(expected_service(kind,receipt,envs[kind]),observed_service(kind,receipt))
    health()
    return receipts


def services():
    raise ValueError('recovery-disabled:services')


def checkout():
    raise ValueError('recovery-disabled:checkout')


def app_check():
    plan=pinned_files();verify_services()
    values=read('app-env-private.json')
    p.exact({'sha256':read('app-env-binding.json')['sha256']},{'sha256':sha(APP/'.env.local')},'app-env')
    other=[str(f) for f in APP.glob('.env*') if f.name not in ['.env.local','.env.example'] and f.is_file()]
    p.exact({'otherEnv':[]},{'otherEnv':other},'app-env')
    p.exact({'head':p.HEAD,'clean':True,'path':str(APP)},dict(
        head=run(['git','-C',str(APP),'rev-parse','HEAD']).decode().strip(),
        clean=not run(['git','-C',str(APP),'status','--porcelain']).strip(),path=str(APP.resolve())),'app')
    p.exact({'values':values},{'values':{key:json.loads(value) for key,value in (line.split('=',1) for line in (APP/'.env.local').read_text().splitlines())}},'app-values')
    # The sealed allowlist retains only the three authorized optional source keys.
    p.exact({'api':p.API,'web':p.WEB,'head':p.HEAD,'gtfs':'0'},dict(api=values['NEXT_PUBLIC_SUPABASE_URL'],
        web=values['NEXT_PUBLIC_APP_URL'],head=values['OPENPLAN_COMMIT_SHA'],gtfs=values['OPENPLAN_GTFS_MANAGED_INGESTION']),'app-values')
    bindings=read('candidate-migrations.json')
    p.files(bindings,{name:sha(OUT/'candidate'/name) for name in bindings})
    return plan,values


def clean_env(values,heap):
    # Do not inherit NODE_OPTIONS, dotenv switches, proxy settings or provider secrets.
    env={key:os.environ[key] for key in ['HOME','USER','LOGNAME','LANG','LC_ALL','TZ'] if key in os.environ}
    env.update(PATH='/usr/local/bin:/usr/bin:/bin',NODE_OPTIONS='--max-old-space-size='+str(heap),NEXT_TELEMETRY_DISABLED='1')
    env.update(values)
    return env


def cgroup():
    group=Path('/sys/fs/cgroup')/Path('/proc/self/cgroup').read_text().split('0::',1)[1].strip().lstrip('/')
    return {name:(group/name).read_text().strip() for name in ['memory.max','memory.swap.max','memory.events']}


def build():
    app_check();source_check()
    # Parent launches this phase in a separate systemd scope with 10GiB/zero swap.
    resources=cgroup()
    p.exact({'memory.max':str(10*1024**3),'memory.swap.max':'0'},resources,'build-budget')
    available=int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:')))*1024
    p.exact({'memory':True,'disk':True},dict(memory=available>=10*1024**3,disk=shutil.disk_usage(APP).free>=8*1024**3),'build-headroom')
    write('build-intent.json',{'head':p.HEAD,'environmentSha256':sha(APP/'.env.local')})
    started=time.monotonic()
    result=subprocess.run(['npm','run','build'],cwd=APP,env=clean_env(read('app-env-private.json'),6144),capture_output=True,timeout=900)
    (RECOVERY/'build-private.log').write_bytes(result.stdout+result.stderr)
    report=dict(head=p.HEAD,returncode=result.returncode,seconds=time.monotonic()-started,envHash=sha(APP/'.env.local'),
        build=(APP/'.next/BUILD_ID').read_text().strip() if (APP/'.next/BUILD_ID').exists() else '',resources=cgroup(),
        serviceReceiptHash=sha(ACTIVE_RECEIPTS))
    write('build-result.json',report)
    p.exact({'returncode':0},{'returncode':result.returncode},'build')
    app_check();source_check()
    write('build-files.json',inventory(APP/'.next'))
    print('Candidate build finished. No browser acceptance is claimed.')


def start():
    plan,values=app_check();source_check();unchanged_inputs()
    report=read('rest-uri-recovery-01/build-result.json');resources=cgroup()
    events=dict(line.split() for line in report['resources']['memory.events'].splitlines())
    expected=dict(head=p.HEAD,clean=True,app=str(APP),build=report['build'],buildHash=p.digest(read('rest-uri-recovery-01/build-files.json')),
        envHash=report['envHash'],sourceHash=read('clone-ready.json')['sourceSha256'],
        receiptHash=report['serviceReceiptHash'],api=p.API,web=p.WEB,disabledGTFS=True,
        absentAI=True,freePort=True,services=True,noOom=True,bounded=True)
    with socket.socket() as probe:probe.bind((p.HOST,3585))
    actual={**expected,'build':(APP/'.next/BUILD_ID').read_text().strip(),'buildHash':p.digest(inventory(APP/'.next')),
        'envHash':sha(APP/'.env.local'),'receiptHash':sha(ACTIVE_RECEIPTS),
        'noOom':report['returncode']==0 and bool(events) and all(events.get(k)=='0' for k in ['oom','oom_kill','oom_group_kill']),
        'bounded':resources['memory.max']==str(p.LIMIT) and resources['memory.swap.max']=='0'}
    # Service verification and identity acquisition occur above, not trusted receipt booleans.
    p.launch(expected,actual)
    write('preview-start.json',{'observed':actual,'launcherHash':sha(Path(__file__)),'boundary':'Unproven until parent runs identified desktop/390px journeys, console and artifact checks.'})
    os.chdir(APP)
    os.execve('/usr/bin/npm',['npm','run','start','--','--hostname',p.HOST,'--port','3585'],clean_env(values,320))


def main():
    os.umask(0o077)
    command=sys.argv[1] if len(sys.argv)>1 else 'active-check'
    p.exact({'root':p.ROOT},{'root':str(Path(__file__).resolve().parent)},'launcher-root')
    operations={'active-check':lambda:(verify_services(),source_check(),unchanged_inputs()),
        'build':build,'start':start,'verify-services':verify_services}
    if command not in operations:raise ValueError('unknown-operation')
    try:operations[command]()
    except BaseException as error:
        # Preserve failures without printing exceptions containing connection strings.
        write('failure-'+command+'-'+secrets.token_hex(6)+'.json',{'phase':command,'type':type(error).__name__,
            'reason':str(error) if isinstance(error,ValueError) else 'See private logs; no cleanup performed.'})
        print('REFUSED '+command+'; retained private failure evidence.',file=sys.stderr)
        raise SystemExit(1)


if __name__=='__main__':main()
