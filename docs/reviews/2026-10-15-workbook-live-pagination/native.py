"""Owned synthetic clone and bounded PostgREST runner. Never prints credentials."""
import contextlib
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import urllib.parse
import uuid

import psycopg2
from psycopg2.extras import Json, RealDictCursor

BASE = Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/workbook-live-pagination-20261015')
CLUSTER = 'a4181e334bb0da63e213aaea5966d163e24faab58ddb3e6122665b3c41042cce'
NAME = 'supabase_db_openplan-restore-target-2026091050'
SOURCE = 'openplan_jurisdiction_native_3d281df106064b8cbb9e0c82_up'
NETWORK = 'supabase_network_openplan-restore-target-2026091050'
IMAGE = 'sha256:2f8e7b656f09db697a8875177694b417b35cb76c21370de07fc54e711e902326'
REV = '54537205a4f7c47f1f68f0827209bbf55de505d9'
REPO = Path(__file__).resolve().parents[3]
HOST, PORT = '127.74.18.10', 29946

def write(path, value):
    path.write_text(json.dumps(value, indent=2, default=str)+'\n')
    path.chmod(0o600)

def sha(value):
    if not isinstance(value, bytes): value = json.dumps(value, sort_keys=True, default=str).encode()
    return hashlib.sha256(value).hexdigest()

def command(args, **kw):
    p = subprocess.run(args, capture_output=True, timeout=180, **kw)
    if p.returncode: raise RuntimeError('command failed: '+args[0]+'; private logs retained')
    return p.stdout

def guard_database(database, readonly, target):
    assert (database==SOURCE and readonly) or (database!=SOURCE and database==target and database.startswith('openplan_workbook_native_')), 'database allowlist'

def guard_cluster(info):
    assert info['Id']==CLUSTER and info['Name']=='/'+NAME and info['State']['Running'], 'cluster identity'

def guard_runner(memory, swap):
    assert memory=='1073741824' and swap=='0', 'runner bounds'

def guard_helper(value, identity, name, target, uri):
    assert value['Id']==identity and value['Name']=='/'+name and value['Image']==IMAGE, 'owned helper identity'
    assert value['Config']['Labels']['openplan.proof.database']==target, 'owned helper target'
    assert value['HostConfig']['Memory']==536870912 and value['HostConfig']['MemorySwap']==536870912 and value['HostConfig']['NanoCpus']==500000000, 'helper bounds'
    assert value['HostConfig']['PortBindings']=={'3000/tcp':[{'HostIp':HOST,'HostPort':str(PORT)}]} and not value['Mounts'], 'loopback no mounts'
    assert dict(x.split('=',1) for x in value['Config']['Env'] if '=' in x)['PGRST_DB_URI']==uri, 'helper URI target exact'

class Native:
    def __init__(self):
        os.umask(0o077)
        self.info = json.loads(command(['docker','inspect',CLUSTER]))[0]
        guard_cluster(self.info)
        env = dict(v.split('=',1) for v in self.info['Config']['Env'] if '=' in v)
        self.connection_args = dict(host=self.info['NetworkSettings']['Networks'][NETWORK]['IPAddress'],port=5432,
            user='supabase_admin',password=env['POSTGRES_PASSWORD'],connect_timeout=5)
        self.plan = json.loads((BASE/'plan.json').read_text()) if (BASE/'plan.json').exists() else {}
        cg=Path('/sys/fs/cgroup'+Path('/proc/self/cgroup').read_text().strip().split('::')[1])
        guard_runner((cg/'memory.max').read_text().strip(),(cg/'memory.swap.max').read_text().strip())
        self.cg=cg

    def connect(self, database, readonly=False):
        guard_database(database,readonly,self.plan.get('target'))
        c=psycopg2.connect(dbname=database,**self.connection_args);c.autocommit=True
        self.query(c,"set work_mem='16MB'; set statement_timeout='30s'; set lock_timeout='3s'; set idle_in_transaction_session_timeout='30s'; set application_name='workbook-live-pagination-proof'")
        if readonly:self.query(c,'set default_transaction_read_only=on')
        return c

    def query(self,c,sql,args=()):
        with c.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql,args)
            return [dict(r) for r in cur.fetchall()] if cur.description else []

    def inventory(self,c):
        result={}
        for table in ['public.projects','public.project_corridors','public.workspaces','public.workspace_members','auth.users','supabase_migrations.schema_migrations']:
            result[table]=self.query(c,'select to_jsonb(t) row from '+table+' t order by to_jsonb(t)::text')
        result['roles']=self.query(c,'select rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconnlimit,rolconfig from pg_roles order by rolname')
        result['memberships']=self.query(c,'select roleid::regrole::text,member::regrole::text,grantor::regrole::text,admin_option from pg_auth_members order by 1,2,3')
        return result

    def setup(self):
        assert not self.plan,'new setup only'
        with contextlib.closing(self.connect(SOURCE,True)) as c:
            inv=self.inventory(c);write(BASE/'source-before-private.json',inv)
            versions=self.query(c,'select version from supabase_migrations.schema_migrations order by version')
            assert len(versions)==419 and versions[-1]['version']=='20261017000016','source419/latest16'
            size=self.query(c,'select pg_database_size(current_database()) bytes')[0]['bytes']
            stat=os.statvfs(BASE); free=stat.f_bavail*stat.f_frsize
            assert free>max(size*4,2*1024**3),'clone disk headroom'
            self.plan={'cluster':CLUSTER,'source':SOURCE,'target':'openplan_workbook_native_'+uuid.uuid4().hex[:24],
                'sourceRowsSha256':sha(inv),'sourceBytes':size,'freeDiskBytes':free,'versions':{'count':len(versions),'latest':versions[-1]['version']},
                'server':self.query(c,'select version() version')[0]['version'],'createdAt':dt.datetime.now(dt.timezone.utc).isoformat()}
            assert not self.query(c,'select 1 from pg_database where datname=%s',(self.plan['target'],)),'target absent'
        write(BASE/'plan.json',self.plan)
        command(['docker','exec',CLUSTER,'createdb','-U','supabase_admin','-T','template0','-O','postgres',self.plan['target']])
        archive=BASE/'source-private.dump'
        opts='-c work_mem=16MB -c statement_timeout=120000 -c lock_timeout=3000'
        with archive.open('xb') as f:
            p=subprocess.run(['docker','exec','-e','PGOPTIONS='+opts,CLUSTER,'pg_dump','-U','supabase_admin','-d',SOURCE,'-Fc','--no-publications','--no-subscriptions'],stdout=f,stderr=subprocess.PIPE,timeout=180)
        (BASE/'dump-private.log').write_bytes(p.stderr);assert p.returncode==0,'single job dump'
        with archive.open('rb') as f:
            p=subprocess.run(['docker','exec','-i','-e','PGOPTIONS='+opts,CLUSTER,'pg_restore','-U','supabase_admin','-d',self.plan['target'],'--single-transaction','--exit-on-error'],stdin=f,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=180)
        (BASE/'restore-private.log').write_bytes(p.stdout+p.stderr);assert p.returncode==0,'single job restore'
        self.plan['archive']={'sha256':sha(archive.read_bytes()),'bytes':archive.stat().st_size}
        with contextlib.closing(self.connect(self.plan['target'])) as c:
            assert self.inventory(c)==inv,'clone rows/history/global roles exact'
            self.plan['targetCatalog']=self.query(c,'select oid,datname,datdba::regrole::text,datcollate,datctype from pg_database where datname=current_database()')[0]
        write(BASE/'plan.json',self.plan)
        self.fixtures()

    def fixtures(self):
        f={'actor':str(uuid.uuid4()),'portfolios':[]}
        with contextlib.closing(self.connect(self.plan['target'])) as c:
            self.query(c,'BEGIN')
            try:
                self.query(c,'SET LOCAL ROLE postgres')
                self.query(c,"insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values(%s,'authenticated','authenticated',%s,'{}','{}',now(),now())",(f['actor'],'synthetic-'+f['actor']+'@workbook.invalid'))
                # Two accessible workspaces detect a missing route filter. Another remains invisible to this actor.
                for n in [0,1000,2000,2001,7,3]:
                    workspace=str(uuid.uuid4()); name='Synthetic portfolio '+str(n)
                    self.query(c,'insert into public.workspaces(id,name,slug) values(%s,%s,%s)',(workspace,name,'workbook-'+workspace))
                    if n!=3:self.query(c,"insert into public.workspace_members(workspace_id,user_id,role) values(%s,%s,'viewer')",(workspace,f['actor']))
                    for i in reversed(range(n)):
                        ident=str(uuid.uuid5(uuid.UUID(workspace),str(i)))
                        self.query(c,"""insert into public.projects(id,workspace_id,name,summary,created_by,estimated_cost_amount,estimated_cost_currency,estimated_cost_basis_year,
                            estimated_cost_recorded_at,place_source,place_kind,place_ref,place_label,place_country_code,place_subdivision_code,
                            place_min_lon,place_min_lat,place_max_lon,place_max_lat,place_set_at,latitude,longitude)
                            values(%s,%s,%s,%s,%s,%s,'USD',%s,'2026-10-01T01:02:03Z','tigerweb','county','06045','Synthetic study location only','US','CA',
                            -123.2,39.1,-123.0,39.3,'2026-10-01T01:02:03Z',39.123,-123.123)""",
                            (ident,workspace,'=Literal '+str(i),'Synthetic source text; legal authority differs from study location',f['actor'],'123456789.12' if i%2 else '42.01',2025 if i%2 else None))
                    # Remove the timestamp trigger only in this transaction, in this NEW target, to install true timestamp ties.
                    self.query(c,'alter table public.projects disable trigger user')
                    self.query(c,"update public.projects set created_at='2026-10-01T01:02:03Z',updated_at=case when right(name,1) in ('0','2','4','6','8') then '2026-10-03T01:02:03Z'::timestamptz else '2026-10-02T01:02:03Z'::timestamptz end where workspace_id=%s",(workspace,))
                    self.query(c,'alter table public.projects enable trigger user')
                    rows=self.query(c,'select * from public.projects where workspace_id=%s order by updated_at desc,id asc',(workspace,))
                    f['portfolios'].append({'count':n,'workspace':workspace,'name':name,'rows':rows})
                self.query(c,'COMMIT')
            except BaseException:self.query(c,'ROLLBACK');raise
        write(BASE/'fixtures-private.json',f)
        self.plan['fixtureCounts']=[x['count'] for x in f['portfolios']];write(BASE/'plan.json',self.plan)

    def helper(self,cap):
        out=BASE/('cap-'+str(cap))
        if out.exists():out.rename(BASE/('earlier-cap-'+str(cap)+'-'+uuid.uuid4().hex[:8]))
        out.mkdir(mode=0o700)
        with socket.socket() as s:s.bind((HOST,PORT))
        old=json.loads(command(['docker','inspect','e743ca20ff99bb6db5dd7152850a0f81dd1454e90a095ba5b88b767cc51bd9c2']))[0]
        assert old['Image']==IMAGE,'cached helper image'
        oldenv=dict(v.split('=',1) for v in old['Config']['Env'] if '=' in v)
        uri=urllib.parse.urlsplit(oldenv['PGRST_DB_URI'])
        assert uri.hostname==NAME and uri.username=='authenticator','source URI custody'
        uri=urllib.parse.urlunsplit(uri._replace(path='/'+self.plan['target'],query=urllib.parse.urlencode({'options':'-c work_mem=16MB -c statement_timeout=10000 -c lock_timeout=3000'},quote_via=urllib.parse.quote)))
        secret=uuid.uuid4().hex+uuid.uuid4().hex
        env={'PGRST_DB_URI':uri,'PGRST_JWT_SECRET':secret,'PGRST_DB_SCHEMAS':'public','PGRST_DB_ANON_ROLE':'anon','PGRST_OPENAPI_MODE':'disabled',
            'PGRST_DB_POOL':'1','PGRST_DB_POOL_ACQUISITION_TIMEOUT':'5','PGRST_SERVER_PORT':'3000','PGRST_DB_MAX_ROWS':str(cap)}
        envpath=out/'runtime-private.env';envpath.write_text('\n'.join(k+'='+v for k,v in env.items())+'\n');envpath.chmod(0o600)
        write(out/'client-private.json',{'url':f'http://{HOST}:{PORT}','secret':secret,'cap':cap})
        name='openplan-workbook-native-rest-'+uuid.uuid4().hex[:12]
        identity=command(['docker','run','--detach','--pull','never','--name',name,'--network',NETWORK,'--publish',f'{HOST}:{PORT}:3000',
            '--memory','536870912','--memory-swap','536870912','--cpus','0.5','--pids-limit','128','--label','openplan.purpose=workbook-live-pagination-20261015',
            '--label','openplan.proof.database='+self.plan['target'],'--env-file',str(envpath),IMAGE]).decode().strip()
        receipt={'id':identity,'name':name,'database':self.plan['target'],'image':IMAGE,'cap':cap,'publish':f'{HOST}:{PORT}', 'memory':536870912,'memorySwap':536870912,'cpu':0.5}
        write(out/'receipt.json',receipt)
        def inspect():
            v=json.loads(command(['docker','inspect',identity]))[0]
            guard_helper(v,identity,name,self.plan['target'],uri)
            return v
        try:
            inspect();time.sleep(1)
            receipt['version']=command(['docker','exec',identity,'postgrest','--version']).decode().strip()
            assert '14.15' in receipt['version'],'PostgREST version';write(out/'receipt.json',receipt)
            script=REPO/'docs/reviews/2026-10-15-workbook-live-pagination/controls.py'
            p=subprocess.run([sys.executable,'-B',str(script),str(cap),*sys.argv[3:]],capture_output=True,timeout=180)
            (out/'controller-private.log').write_bytes(p.stdout+p.stderr)
            assert p.returncode==0,'native control runner, inspect private controller log'
        finally:
            value=inspect()
            logs=subprocess.run(['docker','logs',identity],capture_output=True,timeout=10)
            (out/'postgrest-private.log').write_bytes(logs.stdout+logs.stderr)
            if value['State']['Running']:command(['docker','stop','--time','5',identity])
            value=inspect();assert not value['State']['Running'],'owned helper stopped'
            write(out/'stopped.json',{'id':identity,'running':False,'oomKilled':value['State']['OOMKilled'],'exitCode':value['State']['ExitCode']})
            write(out/'resources.json',{'runnerMax':(self.cg/'memory.max').read_text().strip(),'runnerSwapMax':(self.cg/'memory.swap.max').read_text().strip(),
                'runnerPeak':(self.cg/'memory.peak').read_text().strip(),'runnerEvents':(self.cg/'memory.events').read_text().strip()})

    def final(self):
        with contextlib.closing(self.connect(SOURCE,True)) as c:
            after=self.inventory(c);write(BASE/'source-after-private.json',after)
            assert sha(after)==self.plan['sourceRowsSha256'],'source rows/history/roles unchanged'
        fixtures=json.loads((BASE/'fixtures-private.json').read_text())
        with contextlib.closing(self.connect(self.plan['target'],True)) as c:
            for portfolio in fixtures['portfolios']:
                rows=self.query(c,'select * from public.projects where workspace_id=%s order by updated_at desc,id asc',(portfolio['workspace'],))
                assert sha(rows)==sha(portfolio['rows']),'target synthetic projects remain exact'
            history=self.query(c,'select version from supabase_migrations.schema_migrations order by version')
            assert len(history)==419 and history[-1]['version']=='20261017000016','target419 retained'
            full_history=self.query(c,'select to_jsonb(t) row from supabase_migrations.schema_migrations t order by to_jsonb(t)::text')
            source_history=json.loads((BASE/'source-before-private.json').read_text())['supabase_migrations.schema_migrations']
            assert sha(full_history)==sha(source_history),'target complete migration history unchanged'
        # Challenge the preservation oracle with changed private readback material, never a source write.
        unchanged=json.loads((BASE/'source-before-private.json').read_text())
        assert sha(unchanged)==self.plan['sourceRowsSha256'],'preservation harmless survivor'
        for category in ['public.projects','supabase_migrations.schema_migrations','roles','memberships']:
            broken=json.loads(json.dumps(unchanged));broken[category].append({'synthetic_corruption':True})
            assert sha(broken)!=self.plan['sourceRowsSha256'],'preservation oracle detects '+category
        write(BASE/'preservation.json',{'sourceUnchanged':True,'sourceSha256':sha(after),'clusterMemory':self.info['HostConfig']['Memory'],
            'clusterMemorySwap':self.info['HostConfig']['MemorySwap'],'runnerMax':(self.cg/'memory.max').read_text().strip(),
            'runnerSwapMax':(self.cg/'memory.swap.max').read_text().strip(),'runnerPeak':(self.cg/'memory.peak').read_text().strip(),
            'runnerEvents':(self.cg/'memory.events').read_text().strip(),'targetRowsUnchanged':True,'targetHistory':{'count':419,'latest':'20261017000016','exactRows':True},
            'preservationOracle':{'harmless':'survived','corruptedProject':'killed','corruptedHistory':'killed','corruptedRoles':'killed','corruptedMemberships':'killed',
                'blind':'Corrupted in-memory readback controls, not actual source or archive damage.'}})

if __name__=='__main__':
    native=Native()
    try:
        if sys.argv[1]=='setup':native.setup()
        elif sys.argv[1]=='fixtures':native.fixtures()
        elif sys.argv[1]=='helper':native.helper(int(sys.argv[2]))
        elif sys.argv[1]=='final':native.final()
    except BaseException as e:
        write(BASE/('failed-'+uuid.uuid4().hex[:10]+'.json'),{'type':type(e).__name__,'message':str(e)})
        raise
