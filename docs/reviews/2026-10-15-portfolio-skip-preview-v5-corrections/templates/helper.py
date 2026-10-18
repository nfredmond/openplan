"""Parent-only v5 operating stages. Preparation never dispatches these stages.

Only the new target receives the exact migration-17 upgrade. No source capture,
global role changes, hosted calls, downloads, cleanup or resets.
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
REPO = '/home/nathaniel/.t3/worktrees/openplan/t3-6bf6371f'
OLD = Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/stage-a-main323-preview-20261015')
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
    with path.open('x') as stream:
        json.dump(value,stream,indent=2);stream.write('\n');stream.flush();os.fsync(stream.fileno())
    fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)
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
    for port in [29949,3586]:
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
    app=read('app-env-private.json')
    optional=configured_source(app)
    p.native_rest_uri(read('envs-private.json')['rest']['PGRST_DB_URI'])
    p.configuration(plan,read('envs-private.json'),read('kong-private.json'),app,optional)
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
    return preserve()


def target_identity(target):
    p.target_name(target)
    return json.loads(sql('postgres',"SELECT jsonb_build_object('oid',oid,'database',datname,'owner',pg_get_userbyid(datdba)) FROM pg_database WHERE datname="+literal(target)+';'))


def target_check():
    plan=read('plan-private.json')
    p.exact(read('target-identity.json'),target_identity(plan['target']),'target-identity')


def restore():
    plan=pinned_files();source_check();unchanged_inputs();free_ports();fresh_target()
    p.exact({'target':TARGET},{'target':read('preflight-ready.json')['target']},'preflight-readiness')
    target=plan['target'];props=plan['properties']
    existing=json.loads(sql('postgres','SELECT jsonb_agg(datname) FROM pg_database;'))
    p.exact({'fresh':True},{'fresh':target not in existing},'clone')
    p.exact({'disk':True},{'disk':shutil.disk_usage(OUT).free>=8*1024**3},'clone')
    write('clone-intent.json',{'target':target,'container':p.DB_ID,'source':p.SOURCE})
    dump=FROZEN/'source-private.dump'
    retained_dump()
    args=['docker','exec',p.DB_ID,'createdb','-U','supabase_admin','-T','template0','--owner',props['owner'],
        '--encoding',props['encoding'],'--lc-collate',props['collate'],'--lc-ctype',props['ctype'],
        '--locale-provider','icu','--icu-locale',props['locale'],target]
    p.safe_parent_command(args,target);run(args,log='create-private.log')
    write('target-identity.json',target_identity(target));target_check()
    args=['docker','exec','-i',p.DB_ID,'pg_restore','-U','supabase_admin','-d',target,'--jobs=1','--exit-on-error','--single-transaction']
    p.safe_parent_command(args,target)
    p.exact({'sha256':DUMP_SHA},{'sha256':sha(dump)},'dump-bytes')
    target_check()
    with dump.open('rb') as stream:
        result=subprocess.run(args,stdin=stream,capture_output=True,timeout=300)
    (OUT/'restore-private.log').write_bytes(result.stdout+result.stderr)
    target_check()
    p.exact({'sha256':DUMP_SHA},{'sha256':sha(dump)},'dump-bytes')
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
        bindings={'8000/tcp':[{'HostIp':p.HOST,'HostPort':'29949'}]} if kind=='gateway' else {},
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
    plan=pinned_files();db_check();target_check();upgrade_ready()
    receipts=read('service-receipts-private.json')
    p.exact({'kinds':sorted(p.IMAGES)},{'kinds':sorted(receipts)},'helpers')
    envs=read('envs-private.json')
    for kind,receipt in receipts.items():
        p.exact({'name':plan['names'][kind],'database':plan['target']},receipt,'receipt')
        p.service(expected_service(kind,receipt,envs[kind]),observed_service(kind,receipt))
    health()
    return receipts


def services():
    plan=pinned_files();source_check();unchanged_inputs();free_ports();target_check();upgrade_ready()
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
        if kind=='gateway':args+=['--publish',p.HOST+':29949:8000']
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






# V4 additions use only this new target. Old operational entrypoints are absent.
FROZEN = Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-geography-preview-final-20261015')
DUMP_SHA = '181caa01d5ebe66b50da9dcba1242b225e75cfdc8bd0fe03e3c4a9ae86e4d398'
MIG_SHA = 'b129f80e37aa9be71069683acd42df3fb6fdb94078ed0458f20b6e9c5155a41b'
TARGET = 'openplan_project_portfolio_preview_8f43260b95a071cc4e6d2b90'
FUNCTION = 'public.commit_project_portfolio_import_v2(uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb)'


def retained_dump():
    f=FROZEN/'source-private.dump'
    p.exact({'regular':True,'bytes':16232305,'sha256':DUMP_SHA},
        {'regular':f.is_file() and not f.is_symlink(),'bytes':f.stat().st_size,'sha256':sha(f)},'retained-dump')


def fresh_target():
    plan=read('plan-private.json')
    p.exact({'target':TARGET},{'target':plan['target']},'fixed-target')
    existing=json.loads(sql('postgres',"SELECT coalesce(jsonb_agg(datname),'[]') FROM pg_database;"))
    p.exact({'fresh':True},{'fresh':TARGET not in existing},'target-reserved')
    names=[json.loads(line) for line in run(['docker','ps','-a','--format','{{json .Names}}']).decode().splitlines()]
    p.exact({'fresh':True},{'fresh':not set(names).intersection(plan['names'].values())},'helper-reserved')
    p.exact({'clean':True},{'clean':not any((OUT/n).exists() or (OUT/n).is_symlink() for n in
        ['clone-intent.json','target-identity.json','services-intent.json','candidate'])},'operation-reserved')


def preserve():
    actual_files={}
    for name,expected in read('preservation-files.json').items():
        f=Path(name)
        actual={'regular':f.is_file() and not f.is_symlink(),'mode':f.stat().st_mode&0o777,'sha256':sha(f)}
        p.exact({'regular':True,'mode':expected['mode'],'sha256':expected['sha256']},actual,'old-packet')
        actual_files[name]=actual
    # Freeze all V4 entries, including directories, modes and symlink text.
    frozen=read('v4-full-inventory-before.json')
    # Full old build/cache inventories belong to preparation custody. Rehashing
    # their gigabytes at every 512 MiB acquisition would perturb memory guards.
    # Runtime retains the complete V4 packet plus all inherited old-input,
    # database/global/helper/Storage checks, never a new old-cache immutability claim.
    v4_roots=['/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v4',
        '/home/nathaniel/.t3/worktrees/openplan/t3-9eeec4ad/docs/reviews/2026-10-15-portfolio-skip-preview-v4-preparation']
    for name in v4_roots:
        p.files(frozen[name],packet_inventory(Path(name)))
    web=protected_web()
    observed={'packetsSHA256':p.digest(actual_files),'v4InventorySHA256':p.digest(frozen),'oldWeb':web,
        'helpers':{},'databases':{}}
    if (OUT/'protected-runtime-before.json').exists():
        frozen=read('protected-runtime-before.json')
        for identity,expected in frozen['helpers'].items():
            i=inspect(identity)
            current={k:i[k] for k in ['Id','Name','Image','Config','HostConfig','Mounts']}
            actual=p.digest(current);p.exact({'sha256':expected},{'sha256':actual},'protected-helper')
            observed['helpers'][identity]=actual
        for database,expected in frozen['databases'].items():
            actual=snapshot(database)
            p.exact({'snapshot':expected},{'snapshot':actual},'protected-database')
            observed['databases'][database]=p.digest(actual)
    return observed


def packet_inventory(root):
    values={'.':{'mode':root.stat().st_mode&0o777,'kind':'directory'}}
    for path in sorted(root.rglob('*')):
        record={'mode':path.lstat().st_mode&0o777}
        if path.is_symlink():record.update(kind='symlink',target=os.readlink(path))
        elif path.is_dir():record.update(kind='directory')
        else:record.update(kind='file',bytes=path.stat().st_size,sha256=sha(path))
        values[str(path.relative_to(root))]=record
    return values


def protected_web():
    # Imported app/attestor mains intentionally have no user-bus environment.
    # Only this fixed transport crosses to the host user manager. It accepts no command.
    transport=OUT/'observer_transport.py'
    p.exact({'regular':True,'mode':0o600,'sha256':'452a0a83e6f214fe4031e94ba5defdfa506d23a27855892e4aa2604ce93588f4'},
        {'regular':transport.is_file() and not transport.is_symlink(),'mode':transport.stat().st_mode&0o777,
         'sha256':sha(transport)},'old-web-transport-seal')
    nonce=secrets.token_hex(32)
    environment={'PATH':'/usr/bin:/bin','HOME':str(OUT/'observer-home'),'PYTHONDONTWRITEBYTECODE':'1'}
    result=subprocess.run(['/usr/bin/python3','-B',str(transport),nonce],env=environment,capture_output=True,timeout=60)
    write('observer-receipts/caller-'+nonce+'.json',{'request':nonce,'returncode':result.returncode,
        'stdout':result.stdout.decode(errors='replace'),'stderr':result.stderr.decode(errors='replace')})
    p.exact({'returncode':0},{'returncode':result.returncode},'old-web-host-observer')
    value=json.loads(result.stdout)
    p.exact({'request':nonce,'unit':'openplan-current-project-preview-app-21510042e-v3-web.service',
        'invocation':'34615ba06b554482b0f79c90fe999a61','listenerPid':'4104299',
        'observerUserNamespace':'user:[4026531837]'},value,'old-web-host-result')
    return value


def preflight():
    pinned_files();retained_dump();source_check();unchanged_inputs();free_ports();fresh_target()
    p.exact({'disk':True},{'disk':shutil.disk_usage(OUT).free>=8*1024**3},'preflight')
    # Read only receipts; inspect IDs directly. Never invoke old launcher actions.
    original=json.loads((FROZEN/'rest-uri-recovery-01/active-service-receipts-private.json').read_text())
    helpers={}
    for receipt in original.values():
        i=inspect(receipt['id'])
        p.exact({'running':True},{'running':i['State']['Running']},'protected-active')
        helpers[i['Id']]=p.digest({k:i[k] for k in ['Id','Name','Image','Config','HostConfig','Mounts']})
    databases={database:snapshot(database) for database in read('protected-databases.json')}
    write('protected-runtime-before.json',{'helpers':helpers,'databases':databases})
    write('preflight-ready.json',{'target':TARGET,'sourceAnchor':p.SOURCE_ANCHOR,'dumpSHA256':DUMP_SHA})


def upgrade_state():
    target_check()
    return json.loads(sql(TARGET,"SELECT jsonb_build_object('database',current_database(),'historyCount',(SELECT count(*) FROM supabase_migrations.schema_migrations),'latest',(SELECT max(version) FROM supabase_migrations.schema_migrations),'versions',(SELECT jsonb_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations),'body',(SELECT prosrc FROM pg_proc WHERE oid="+literal(FUNCTION)+"::regprocedure),'statusConstraint',(SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.project_portfolio_import_rows'::regclass AND conname='project_portfolio_import_rows_resolved_status_check'),'phaseConstraint',(SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.project_portfolio_import_rows'::regclass AND conname='project_portfolio_import_rows_resolved_delivery_phase_check'),'priorHistoryDigest',(SELECT md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) FROM supabase_migrations.schema_migrations t WHERE version<>'20261017000017'),'historySQL',(SELECT statements FROM supabase_migrations.schema_migrations WHERE version='20261017000017'));"))


def upgraded(actual):
    expected=read('upgrade-expectations.json')
    p.exact({'database':TARGET,'historyCount':420,'latest':'20261017000017','versions':sorted(expected['versions']+['20261017000017']),
        'body':expected['newBody'],'priorHistoryDigest':expected['history']['digest'],'historySQL':[(OUT/'candidate17.sql').read_text()]},actual,'upgrade-state')
    expected_checks=read('expected-checks.json')
    p.exact({'migrationSHA256':MIG_SHA},expected_checks,'expected-check-source')
    p.exact(expected_checks['constraints'],actual,'upgrade-checks')


def upgrade_ready():
    receipt=read('upgrade-ready.json')
    p.exact({'target':TARGET,'migrationSHA256':MIG_SHA},{'target':receipt['target'],'migrationSHA256':receipt['migrationSHA256']},'upgrade-receipt')
    actual=upgrade_state();upgraded(actual)
    p.files(receipt['state'],actual)


def upgrade_sql():
    expected=read('upgrade-expectations.json')
    p.exact({'sha256':MIG_SHA},{'sha256':sha(OUT/'candidate17.sql')},'candidate17')
    hist=expected['history']
    return "\n".join([
        'BEGIN;', "SET LOCAL ROLE postgres;", "SET LOCAL statement_timeout='60s';", "SET LOCAL lock_timeout='3s';", "SET LOCAL idle_in_transaction_session_timeout='60s';", "SET LOCAL work_mem='16MB';",
        'SELECT pg_advisory_xact_lock(20261017,17);',
        'LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE;',
        "DO $exclusive$ BEGIN IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()) THEN RAISE EXCEPTION 'upgrade-target-connections'; END IF; END $exclusive$;",
        "DO $ready$ BEGIN IF current_database()<>"+literal(TARGET)+" OR (SELECT count(*) FROM supabase_migrations.schema_migrations)<>419 OR (SELECT max(version) FROM supabase_migrations.schema_migrations)<>'20261017000016' OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261017000017') THEN RAISE EXCEPTION 'upgrade-history419-target'; END IF;",
        "IF (SELECT md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) FROM supabase_migrations.schema_migrations t)<>"+literal(hist['digest'])+" THEN RAISE EXCEPTION 'upgrade-history-bytes'; END IF;",
        "IF (SELECT prosrc FROM pg_proc WHERE oid="+literal(FUNCTION)+"::regprocedure) IS DISTINCT FROM "+literal(expected['oldBody'])+" THEN RAISE EXCEPTION 'upgrade-original-body'; END IF; END $ready$;",
        (OUT/'candidate17.sql').read_text(),
        "INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('20261017000017','portfolio_skip_invalid_classifications',ARRAY["+literal((OUT/'candidate17.sql').read_text())+"]::text[]);",
        "DO $after$ BEGIN IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>420 OR (SELECT max(version) FROM supabase_migrations.schema_migrations)<>'20261017000017' THEN RAISE EXCEPTION 'upgrade-history420'; END IF; END $after$;",
        "NOTIFY pgrst, 'reload schema';", 'COMMIT;'])


def upgrade():
    pinned_files();retained_dump();source_check();unchanged_inputs();target_check()
    p.exact({'target':TARGET},{'target':read('clone-ready.json')['target']},'restored-readiness')
    p.exact({'target':TARGET},{'target':read('preflight-ready.json')['target']},'preflight-readiness')
    before=snapshot(TARGET)
    projection=lambda rows:[x for x in rows if 'table' in x or 'versions' in x or 'sequences' in x or 'properties' in x]
    p.exact({'data':projection(read('source-binding-private.json')['snapshot'])},{'data':projection(before)},'upgrade-original-data')
    statement=upgrade_sql()
    write('upgrade-intent.json',{'target':TARGET,'migrationSHA256':MIG_SHA,'SQLSHA256':hashlib.sha256(statement.encode()).hexdigest()})
    run(['docker','exec','-i',p.DB_ID,'psql','-Xq','-U','supabase_admin','-d',TARGET,'-v','ON_ERROR_STOP=1'],data=statement.encode(),log='upgrade-private.log')
    state=upgrade_state();upgraded(state)
    # All original rows, auth data and sequences stay exact. Only migration history differs.
    unchanged=lambda rows:[x for x in rows if ('table' in x and x['table']!='supabase_migrations.schema_migrations') or 'sequences' in x or 'properties' in x]
    p.exact({'data':unchanged(before)},{'data':unchanged(snapshot(TARGET))},'upgrade-data-preserved')
    source_check();unchanged_inputs()
    write('upgrade-ready.json',{'target':TARGET,'migrationSHA256':MIG_SHA,'state':state})


def post_journey():
    # Browser writes in the NEW preview are intentional. Compare only protected old DBs.
    pinned_files();db_check();target_check();upgrade_ready()
    baseline=OUT/'protected-runtime-before.json'
    p.exact({'regular':True,'mode':0o600},
        {'regular':baseline.is_file() and not baseline.is_symlink(),'mode':baseline.stat().st_mode&0o777},'post-preservation-baseline')
    protected=read('protected-databases.json')
    p.exact({'excluded':True},{'excluded':TARGET not in protected},'post-new-database-excluded')
    receipts=verify_services()
    current_source=source_check()
    preservation=unchanged_inputs()
    p.exact({'databases':sorted(protected)},
        {'databases':sorted(preservation['databases'])},'post-protected-databases')
    result={'schema':1,'phase':'post-journey-preservation','appHead':p.HEAD,'target':read('target-identity.json'),
        'newHelpers':receipts,'newHelperReceiptSHA256':sha(OUT/'service-receipts-private.json'),
        'sourceAnchor':p.SOURCE_ANCHOR,'observedSourceSHA256':p.digest(current_source),
        'preservation':preservation,'protectedBaselineSHA256':sha(baseline),
        'legacyStorageInventorySHA256':p.digest(read('storage-binding-private.json')),
        'newPreviewDataComparedToRestore':False,'helperSHA256':sha(Path(__file__)),
        'boundary':'Fresh protected-state and helper observation after root journey. Does not establish journey success.'}
    write('post-journey-result.json',result)
    print('Post-journey helper and protected-state observation retained.')

def main():
    os.umask(0o077)
    os.environ.clear();os.environ.update(PATH='/usr/bin:/bin',HOME=str(OUT/'tmp'),PYTHONDONTWRITEBYTECODE='1',XDG_RUNTIME_DIR='/run/user/'+str(os.getuid()))
    p.exact({'root':p.ROOT},{'root':str(Path(__file__).resolve().parent)},'launcher-root')
    operations={'preflight':preflight,'restore':restore,'upgrade':upgrade,'services':services,'verify-services':verify_services,'post-journey':post_journey}
    if len(sys.argv)!=2 or sys.argv[1] not in operations:raise ValueError('unknown-operation')
    try:operations[sys.argv[1]]()
    except BaseException as error:
        write('failure-'+sys.argv[1]+'-'+secrets.token_hex(6)+'.json',{'phase':sys.argv[1],'type':type(error).__name__,'reason':str(error) if type(error) is ValueError else 'See private logs; preserve partial state.'})
        print('REFUSED '+sys.argv[1]+'; retained private evidence.',file=sys.stderr);raise SystemExit(1)
if __name__=='__main__':main()
