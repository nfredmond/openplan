"""Private parent-operated preview preparation. Default command is pure controls.

No cleanup, migrations, global role changes, hosted calls, downloads or resets.
"""
import base64
import hashlib
import hmac
import json
import os
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

import policy as p

OUT = Path(p.ROOT)
APP = OUT / 'candidate/openplan'
REPO = '/home/nathaniel/.t3/worktrees/openplan/t3-ce711498'
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
    path=OUT/name
    # Evidence and failed trials are append-only. No automatic overwrite/retry.
    with path.open('x') as stream:json.dump(value,stream,indent=2);stream.write('\n')
    path.chmod(0o600)


def read(name):return json.loads((OUT/name).read_text())


def run(args, *, data=None, log=None, timeout=120):
    result=subprocess.run(args,input=data,capture_output=True,timeout=timeout)
    if log:
        with (OUT/log).open('xb') as stream:stream.write(result.stdout+result.stderr)
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
    p.exact({'sha256':frozen['sha256']},{'sha256':p.digest(current)},'source-fingerprint')
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


def pinned_files():
    templates()
    expected=read('private-bindings.json')
    p.files(expected,{name:sha(OUT/name) for name in expected})
    plan=read('plan-private.json');p.target_name(plan['target'])
    p.exact({'head':p.HEAD,'source':p.SOURCE,'dbId':p.DB_ID,'api':p.API,'web':p.WEB,'root':str(OUT)},plan,'plan')
    p.configuration(plan,read('envs-private.json'),read('kong-private.json'),read('app-env-private.json'))
    return plan


def token(secret, role):
    def enc(value):return base64.urlsafe_b64encode(json.dumps(value,separators=(',',':')).encode()).decode().rstrip('=')
    data=enc({'alg':'HS256','typ':'JWT'})+'.'+enc({'role':role,'iss':'supabase','iat':int(time.time()),'exp':int(time.time())+7*86400})
    return data+'.'+base64.urlsafe_b64encode(hmac.new(secret.encode(),data.encode(),hashlib.sha256).digest()).decode().rstrip('=')


def capture():
    """Read-only acquisition and private files. No Docker/DB mutations."""
    templates();db_check();free_ports()
    current=snapshot(p.SOURCE)
    p.source(next(x for x in current if 'historyCount' in x))
    properties=next(x['properties'] for x in current if 'properties' in x)
    # These properties are the exact current retained source prerequisite.
    p.exact({'owner':'postgres','encoding':'UTF8','collate':'en_US.UTF-8','ctype':'en_US.UTF-8',
        'localeProvider':'i','connectionLimit':-1},properties,'properties')
    snapshots={kind:inspect(identity) for kind,identity in OLD_IDS.items()}
    old_binding={}
    for kind,i in snapshots.items():
        p.exact({'Id':OLD_IDS[kind],'Image':p.IMAGES[kind]},i,'old-helper')
        old_binding[kind]=p.digest({k:i[k] for k in ['Id','Name','Image','Config','HostConfig','Mounts']})
    for name in p.IMAGES.values():run(['docker','image','inspect',name])
    paths=run(['git','-C',REPO,'ls-tree','-r','--name-only',p.HEAD,'openplan/supabase/migrations']).decode().splitlines()
    versions=sorted(Path(name).name.split('_',1)[0] for name in paths if name.endswith('.sql'))
    p.exact({'versions':versions},{'versions':next(x['versions'] for x in current if 'versions' in x)},'candidate-migrations')
    migration_bytes={name:hashlib.sha256(run(['git','-C',REPO,'show',p.HEAD+':'+name])).hexdigest() for name in paths if name.endswith('.sql')}
    write('candidate-migrations.json',migration_bytes)
    target='openplan_project_combined_preview_'+secrets.token_hex(12)
    p.target_name(target)
    names={kind:'openplan-combined-'+kind+'-'+secrets.token_hex(6) for kind in p.IMAGES}
    jwt=secrets.token_hex(32);anon=token(jwt,'anon');service=token(jwt,'service_role')
    environments={kind:dict(row.split('=',1) for row in i['Config']['Env'] if '=' in row) for kind,i in snapshots.items()}
    # Keep only known engine settings. Drop image defaults, providers and inherited mail settings.
    allow={
        'rest':['PGRST_DB_ANON_ROLE','PGRST_DB_SCHEMAS','PGRST_DB_EXTRA_SEARCH_PATH','PGRST_LOG_LEVEL'],
        'auth':['GOTRUE_DB_DRIVER','GOTRUE_DB_MIGRATIONS_PATH','GOTRUE_JWT_DEFAULT_GROUP_NAME','GOTRUE_JWT_AUD','GOTRUE_JWT_ADMIN_ROLES','GOTRUE_LOG_LEVEL'],
        'storage':['GLOBAL_S3_BUCKET','TENANT_ID','STORAGE_BACKEND','FILE_STORAGE_BACKEND_PATH','FILE_SIZE_LIMIT','UPLOAD_FILE_SIZE_LIMIT','UPLOAD_FILE_SIZE_LIMIT_STANDARD','DB_MIGRATIONS_FREEZE_AT'],
        'gateway':['KONG_DATABASE','KONG_DECLARATIVE_CONFIG','KONG_DNS_ORDER','KONG_MEM_CACHE_SIZE','KONG_NGINX_WORKER_PROCESSES','KONG_PLUGINS','KONG_PROXY_ACCESS_LOG','KONG_PROXY_ERROR_LOG'],
    }
    envs={kind:{key:environments[kind][key] for key in keys} for kind,keys in allow.items()}
    for kind,key in p.URI_KEYS.items():
        uri=urlsplit(environments[kind][key])
        p.exact({'host':p.DB_NAME,'port':5432,'role':p.ROLES[kind],'query':'','hasPassword':True},
            dict(host=uri.hostname,port=uri.port,role=uri.username,query=uri.query,hasPassword=bool(uri.password)),'helper-uri')
        # Connection-local settings avoid ALTER ROLE, ALTER DATABASE and server edits.
        envs[kind][key]=urlunsplit(uri._replace(path='/'+target,query=urlencode({'options':'-c search_path='+('auth,public,extensions' if kind=='auth' else 'storage,public,extensions' if kind=='storage' else 'public,extensions')})))
    envs['rest'].update(PGRST_DB_CONFIG='false',PGRST_DB_POOL='2',PGRST_OPENAPI_MODE='disabled',PGRST_JWT_SECRET=jwt,PGRST_SERVER_PORT='3000')
    envs['auth'].update(GOTRUE_API_HOST='0.0.0.0',GOTRUE_API_PORT='9999',GOTRUE_DB_MAX_POOL_SIZE='3',
        GOTRUE_SITE_URL=p.WEB,GOTRUE_URI_ALLOW_LIST=p.WEB+'/**',API_EXTERNAL_URL=p.API,
        GOTRUE_JWT_ISSUER=p.API+'/auth/v1',GOTRUE_JWT_SECRET=jwt,GOTRUE_JWT_EXP='3600',
        GOTRUE_DISABLE_SIGNUP='true',GOTRUE_EXTERNAL_EMAIL_ENABLED='true',GOTRUE_MAILER_AUTOCONFIRM='true',
        GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED='true')
    envs['storage'].update(AUTH_JWT_SECRET=jwt,ANON_KEY=anon,SERVICE_KEY=service,JWT_JWKS='',
        DB_POOL_MAX='3',VECTOR_ENABLED='false',VECTOR_STORE_MIGRATIONS_ENABLED='false',
        ENABLE_IMAGE_TRANSFORMATION='false',S3_PROTOCOL_ENABLED='false')
    envs['gateway'].update(KONG_ADMIN_LISTEN='off',KONG_PROXY_LISTEN='0.0.0.0:8000')
    kong=json.loads(OLD_KONG.read_text())
    for consumer in kong['consumers']:
        role={'proof-anon':anon,'proof-service':service}[consumer['username']]
        consumer['keyauth_credentials']=[{'key':role}]
    for plugin in kong['plugins']:
        if plugin['name']=='cors':plugin['config']['origins']=[p.WEB]
    for s in kong['services']:
        kind='storage' if s['name']=='storage-signed-read' else s['name']
        uri=urlsplit(s['url']);p.exact({'host':snapshots[kind]['Name'].lstrip('/')},{'host':uri.hostname},'kong-upstream')
        s['url']=urlunsplit(uri._replace(netloc=names[kind]+':'+str(p.PORTS[kind])))
    plan=dict(head=p.HEAD,source=p.SOURCE,dbId=p.DB_ID,target=target,api=p.API,web=p.WEB,root=str(OUT),names=names,properties=properties)
    write('plan-private.json',plan)
    write('source-binding-private.json',{'sha256':p.digest(current),'snapshot':current})
    write('old-helper-bindings-private.json',old_binding)
    write('input-bindings-private.json',{str(f):sha(f) for f in CAPTURE_INPUTS})
    write('storage-binding-private.json',inventory(OLD_STORAGE))
    write('envs-private.json',envs);write('kong-private.json',kong)
    write('app-env-private.json',dict(NEXT_PUBLIC_SUPABASE_URL=p.API,NEXT_PUBLIC_SUPABASE_ANON_KEY=anon,
        SUPABASE_SERVICE_ROLE_KEY=service,NEXT_PUBLIC_APP_URL=p.WEB,OPENPLAN_COMMIT_SHA=p.HEAD,
        OPENPLAN_GTFS_MANAGED_INGESTION='0',OPENPLAN_GTFS_PARSER_BUILD=p.HEAD))
    # Database ACL commands are generated by PostgreSQL, limited to the new database.
    acl=sql(p.SOURCE,"SELECT format('GRANT %s ON DATABASE %I TO %s%s;',a.privilege_type,"+literal(target)+",CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END,CASE WHEN a.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END) FROM pg_database d,LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=current_database() ORDER BY a.grantee,a.privilege_type;")
    write('acl-private.json',{'sql':'REVOKE ALL ON DATABASE '+ident(target)+' FROM PUBLIC;\n'+acl})
    protected=['candidate-migrations.json','plan-private.json','source-binding-private.json','old-helper-bindings-private.json',
        'input-bindings-private.json','storage-binding-private.json','envs-private.json','kong-private.json','app-env-private.json','acl-private.json']
    write('private-bindings.json',{name:sha(OUT/name) for name in protected})
    source_check()
    print('Read-only source capture and private configurations prepared. No clone or service created.')


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
    plan=pinned_files();source_check();unchanged_inputs();free_ports()
    target=plan['target'];props=plan['properties']
    existing=json.loads(sql('postgres','SELECT jsonb_agg(datname) FROM pg_database;'))
    p.exact({'fresh':True},{'fresh':target not in existing},'clone')
    p.exact({'disk':True},{'disk':shutil.disk_usage(OUT).free>=8*1024**3},'clone')
    write('clone-intent.json',{'target':target,'container':p.DB_ID,'source':p.SOURCE})
    dump=OUT/'source-private.dump'
    dump_args=p.source_dump_args();p.dump_command(dump_args)
    with dump.open('xb') as stream:
        result=subprocess.run(dump_args,stdout=stream,stderr=subprocess.PIPE,timeout=300)
    write('dump-result.json',{'returncode':result.returncode,'bytes':dump.stat().st_size,'sha256':sha(dump)})
    (OUT/'dump-private.log').write_bytes(result.stderr)
    p.exact({'ok':True},{'ok':result.returncode==0 and 0<dump.stat().st_size<=128*1024**2},'dump')
    source_check()
    args=['docker','exec',p.DB_ID,'createdb','-U','supabase_admin','-T','template0','--owner',props['owner'],
        '--encoding',props['encoding'],'--lc-collate',props['collate'],'--lc-ctype',props['ctype'],
        '--locale-provider','icu','--icu-locale',props['locale'],target]
    p.safe_parent_command(args,target);run(args,log='create-private.log')
    write('target-identity.json',target_identity(target));target_check()
    args=['docker','exec','-i',p.DB_ID,'pg_restore','-U','supabase_admin','-d',target,'--jobs=1','--exit-on-error','--single-transaction']
    p.safe_parent_command(args,target)
    p.exact({'sha256':read('dump-result.json')['sha256']},{'sha256':sha(dump)},'dump-bytes')
    target_check()
    with dump.open('rb') as stream:
        result=subprocess.run(args,stdin=stream,capture_output=True,timeout=300)
    (OUT/'restore-private.log').write_bytes(result.stdout+result.stderr)
    target_check()
    p.exact({'sha256':read('dump-result.json')['sha256']},{'sha256':sha(dump)},'dump-bytes')
    p.exact({'returncode':0},{'returncode':result.returncode},'restore')
    # Only generated database ACL grants. No roles, source properties, or global settings.
    run(['docker','exec','-i',p.DB_ID,'psql','-Xq','-U','supabase_admin','-d',target,'-v','ON_ERROR_STOP=1','--single-transaction'],
        data=read('acl-private.json')['sql'].encode(),log='target-acl-private.log')
    after=snapshot(target);before=read('source-binding-private.json')['snapshot']
    # Table rows, auth hashes, migration history and sequence state must match exactly.
    projection=lambda rows:[row for row in rows if 'table' in row or 'versions' in row or 'sequences' in row or 'properties' in row]
    p.exact({'data':projection(before)},{'data':projection(after)},'restored-data')
    p.files(read('storage-binding-private.json'),inventory(OLD_STORAGE))
    shutil.copytree(OLD_STORAGE,OUT/'storage-objects')
    p.files(read('storage-binding-private.json'),inventory(OUT/'storage-objects'))
    source_check();unchanged_inputs()
    write('clone-ready.json',dict(target=target,dumpSha256=sha(dump),sourceSha256=read('source-binding-private.json')['sha256'],
        targetDataSha256=p.digest(projection(after)),storageSha256=p.digest(inventory(OUT/'storage-objects'))))
    print('New retained clone prepared. No helper or app started.')


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
    p.exact({'auth':200,'rest':200,'storage':200,'ownOrigin':p.WEB,'oldOrigin':None},observed,'health')


def verify_services():
    plan=pinned_files();db_check();target_check()
    receipts=read('service-receipts-private.json')
    p.exact({'kinds':sorted(p.IMAGES)},{'kinds':sorted(receipts)},'helpers')
    envs=read('envs-private.json')
    for kind,receipt in receipts.items():
        p.exact({'name':plan['names'][kind],'database':plan['target']},receipt,'receipt')
        p.service(expected_service(kind,receipt,envs[kind]),observed_service(kind,receipt))
    health()
    return receipts


def services():
    plan=pinned_files();source_check();unchanged_inputs();free_ports();target_check()
    p.exact({'target':plan['target']},{'target':read('clone-ready.json')['target']},'clone-ready')
    envs=read('envs-private.json');receipts={}
    # Exclusive intent prevents retries from creating duplicates after lost acknowledgements.
    write('services-intent.json',{'names':plan['names'],'target':plan['target']})
    for kind in ['rest','auth','storage','gateway']:
        envfile=OUT/(kind+'-private.env')
        with envfile.open('x') as stream:
            for key,value in envs[kind].items():
                if '\n' in key+value or '\r' in key+value:raise ValueError('environment-newline')
                stream.write(key+'='+value+'\n')
        labels={'openplan.purpose':p.PURPOSE,'openplan.candidate':p.HEAD,'openplan.database':plan['target']}
        args=['docker','create','--pull','never','--name',plan['names'][kind],'--network',p.NETWORK,
            '--memory',str(p.LIMIT),'--memory-swap',str(p.LIMIT),'--cpus','0.5','--pids-limit','128','--env-file',str(envfile)]
        for key,value in labels.items():args+=['--label',key+'='+value]
        if kind=='gateway':args+=['--publish',p.HOST+':29948:8000']
        if kind=='storage':args+=['--mount','type=bind,source='+str(OUT/'storage-objects')+',target=/mnt']
        if kind=='gateway':
            # Kong's image user must read its bind-mounted config. The host parent
            # directory remains 0700; only this owned container receives the mount.
            (OUT/'kong-private.json').chmod(0o444)
            args+=['--mount','type=bind,source='+str(OUT/'kong-private.json')+',target=/etc/kong/proof.json,readonly']
        args.append(p.IMAGES[kind])
        identity=run(args,log=kind+'-create-private.log').decode().strip()
        receipt=dict(id=identity,name=plan['names'][kind],database=plan['target'],labels=labels)
        # Persist each exact returned ID before startup. Never stop by a name/prefix.
        write(kind+'-receipt-private.json',receipt);receipts[kind]=receipt
        expected=expected_service(kind,receipt,envs[kind])
        p.created_service(expected,observed_service(kind,receipt))
        run(['docker','start',identity],log=kind+'-start-private.log')
        p.service(expected_service(kind,receipt,envs[kind]),observed_service(kind,receipt))
    write('service-receipts-private.json',receipts)
    verify_services();source_check();unchanged_inputs()
    print('Exact helper identities started. Parent must check API health before app execution.')


def checkout():
    pinned_files()
    # Uses local objects only, never fetches or touches the parent integration tree.
    run(['git','-C',REPO,'worktree','add','--detach',str(OUT/'candidate'),p.HEAD],log='checkout-private.log')
    p.exact({'head':p.HEAD},{'head':run(['git','-C',str(APP),'rev-parse','HEAD']).decode().strip()},'checkout')
    for name in ['.env','.env.local','.env.production','.env.production.local','.env.development','.env.development.local','.env.test','.env.test.local']:
        if (APP/name).exists():raise ValueError('candidate-inherited-env')
    values=read('app-env-private.json')
    with (APP/'.env.local').open('x') as stream:
        for key,value in values.items():stream.write(key+'='+json.dumps(value)+'\n')
    write('app-env-binding.json',{'sha256':sha(APP/'.env.local')})
    print('Isolated candidate checkout configured. Dependencies and build remain parent operations.')


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
    # Allowlist values above omit every AI, mail, map, Census and hosted credential.
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
    (OUT/'build-private.log').write_bytes(result.stdout+result.stderr)
    report=dict(head=p.HEAD,returncode=result.returncode,seconds=time.monotonic()-started,envHash=sha(APP/'.env.local'),
        build=(APP/'.next/BUILD_ID').read_text().strip() if (APP/'.next/BUILD_ID').exists() else '',resources=cgroup(),
        serviceReceiptHash=sha(OUT/'service-receipts-private.json'))
    write('build-result.json',report)
    p.exact({'returncode':0},{'returncode':result.returncode},'build')
    app_check();source_check()
    write('build-files.json',inventory(APP/'.next'))
    print('Candidate build finished. No browser acceptance is claimed.')


def start():
    plan,values=app_check();source_check();unchanged_inputs()
    report=read('build-result.json');resources=cgroup()
    events=dict(line.split() for line in report['resources']['memory.events'].splitlines())
    expected=dict(head=p.HEAD,clean=True,app=str(APP),build=report['build'],buildHash=p.digest(read('build-files.json')),
        envHash=report['envHash'],sourceHash=read('clone-ready.json')['sourceSha256'],
        receiptHash=report['serviceReceiptHash'],api=p.API,web=p.WEB,disabledGTFS=True,
        absentAI=True,freePort=True,services=True,noOom=True,bounded=True)
    with socket.socket() as probe:probe.bind((p.HOST,3585))
    actual={**expected,'build':(APP/'.next/BUILD_ID').read_text().strip(),'buildHash':p.digest(inventory(APP/'.next')),
        'envHash':sha(APP/'.env.local'),'receiptHash':sha(OUT/'service-receipts-private.json'),
        'noOom':report['returncode']==0 and bool(events) and all(events.get(k)=='0' for k in ['oom','oom_kill','oom_group_kill']),
        'bounded':resources['memory.max']==str(p.LIMIT) and resources['memory.swap.max']=='0'}
    # Service verification and identity acquisition occur above, not trusted receipt booleans.
    p.launch(expected,actual)
    write('preview-start.json',{'observed':actual,'launcherHash':sha(Path(__file__)),'boundary':'Unproven until parent runs identified desktop/390px journeys, console and artifact checks.'})
    os.chdir(APP)
    os.execve('/usr/bin/npm',['npm','run','start','--','--hostname',p.HOST,'--port','3585'],clean_env(values,320))


def main():
    os.umask(0o077)
    command=sys.argv[1] if len(sys.argv)>1 else 'controls'
    if command=='controls':
        import controls
        print(json.dumps(controls.run(),indent=2));return
    p.exact({'root':p.ROOT},{'root':str(Path(__file__).resolve().parent)},'launcher-root')
    operations={'capture':capture,'check':lambda:(pinned_files(),source_check(),unchanged_inputs(),free_ports()),
        'clone':clone,'services':services,'checkout':checkout,'build':build,'start':start,'verify-services':verify_services}
    if command not in operations:raise ValueError('unknown-operation')
    try:operations[command]()
    except BaseException as error:
        # Preserve failures without printing exceptions containing connection strings.
        write('failure-'+command+'-'+secrets.token_hex(6)+'.json',{'phase':command,'type':type(error).__name__,
            'reason':str(error) if isinstance(error,ValueError) else 'See private logs; no cleanup performed.'})
        print('REFUSED '+command+'; retained private failure evidence.',file=sys.stderr)
        raise SystemExit(1)


if __name__=='__main__':main()
